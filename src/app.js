const fastify = require('fastify');
const cors = require('@fastify/cors');

const config = require('./config');
const { DEFAULT_AGENTS } = require('./agents');
const { openDb, initSchema, seedAgents } = require('./db');
const { createPriceService } = require('./services/priceService');
const { createJudgmentService } = require('./services/judgmentService');
const { createRoundService } = require('./services/roundService');

function buildApp() {
  const app = fastify({ logger: true });

  app.register(cors, { origin: '*' });

  const db = openDb(config.DB_PATH);
  initSchema(db);
  seedAgents(db, DEFAULT_AGENTS);

  const state = {
    currentRoundId: null,
    currentPrice: 42000,
    lastPrice: 42000,
    lastDeltaPct: 0,
    lastPriceAt: null,
    settlementTimer: null,
    priceTimer: null,
  };

  const priceService = createPriceService({ state });
  const judgmentService = createJudgmentService();
  const roundService = createRoundService({
    db,
    state,
    priceService,
    judgmentService,
  });

  app.decorate('db', db);
  app.decorate('state', state);
  app.decorate('services', {
    priceService,
    judgmentService,
    roundService,
  });

  app.register(require('./routes/summary'));
  app.register(require('./routes/health'));

  app.addHook('onReady', async () => {
    await priceService.refresh();
    const live = roundService.getLiveRound();

    if (live) {
      state.currentRoundId = live.round_id;
      roundService.scheduleSettlement(live.round_id, live.end_time);
    } else {
      await roundService.startRound();
    }

    state.priceTimer = setInterval(() => {
      priceService.refresh();
    }, config.PRICE_REFRESH_MS);
  });

  app.addHook('onClose', async () => {
    if (state.priceTimer) {
      clearInterval(state.priceTimer);
    }
    if (state.settlementTimer) {
      clearTimeout(state.settlementTimer);
    }
    db.close();
  });

  return app;
}

module.exports = {
  buildApp,
};
