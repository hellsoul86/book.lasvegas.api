const {
  ROUND_DURATION_MIN,
  ROUND_DURATION_MS,
  FLAT_THRESHOLD_PCT,
  FEED_LIMIT,
  VERDICT_LIMIT,
  JUDGMENT_LIMIT,
  ROUND_LIMIT,
  SCORE_EVENT_LIMIT,
} = require('../config');
const { trimTable } = require('../db');

function roundIdFor(date) {
  const pad = (num) => String(num).padStart(2, '0');
  return `r_${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate()
  )}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

function computeResult(deltaPct) {
  if (Math.abs(deltaPct) < FLAT_THRESHOLD_PCT) return 'FLAT';
  return deltaPct > 0 ? 'UP' : 'DOWN';
}

function formatDelta(deltaPct) {
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1)}%`;
}

function buildFlipCard({ agent, judgment, verdict, scoreChange }) {
  const result = judgment.direction === verdict.result ? 'WIN' : 'FAIL';
  const deltaText = formatDelta(verdict.delta_pct);

  return {
    title: `${result === 'FAIL' ? '❌' : '✅'} ${agent.name} ${
      result === 'FAIL' ? '被当场否决' : '暂时免刑'
    }`,
    text: `自信度：${judgment.confidence}% · 结果：${deltaText}`,
    agent: agent.name,
    agent_id: agent.id,
    confidence: judgment.confidence,
    result,
    score_change: scoreChange,
    round_id: verdict.round_id,
    timestamp: verdict.timestamp,
  };
}

function createRoundService({ db, state, priceService, judgmentService }) {
  const selectLiveRound = db.prepare(
    "SELECT * FROM rounds WHERE status != 'settled' ORDER BY start_time DESC LIMIT 1"
  );
  const selectRoundById = db.prepare('SELECT * FROM rounds WHERE round_id = ?');
  const insertRound = db.prepare(
    'INSERT INTO rounds (round_id, symbol, duration_min, start_price, end_price, status, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const updateRoundStatus = db.prepare('UPDATE rounds SET status = ? WHERE round_id = ?');
  const updateRoundEnd = db.prepare(
    'UPDATE rounds SET end_price = ?, status = ? WHERE round_id = ?'
  );

  const selectAgents = db.prepare('SELECT * FROM agents');
  const selectAgentById = db.prepare('SELECT * FROM agents WHERE id = ?');
  const updateAgentScore = db.prepare('UPDATE agents SET score = score + ? WHERE id = ?');

  const insertJudgment = db.prepare(
    'INSERT INTO judgments (round_id, agent_id, direction, confidence, comment, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const selectJudgmentsByRound = db.prepare(
    'SELECT * FROM judgments WHERE round_id = ?'
  );
  const selectJudgmentsByRoundSorted = db.prepare(
    'SELECT * FROM judgments WHERE round_id = ? ORDER BY confidence DESC'
  );
  const selectJudgmentsWithAgents = db.prepare(
    'SELECT j.*, a.name AS agent_name FROM judgments j LEFT JOIN agents a ON a.id = j.agent_id WHERE j.round_id = ?'
  );

  const insertVerdict = db.prepare(
    'INSERT INTO verdicts (round_id, result, delta_pct, timestamp) VALUES (?, ?, ?, ?)'
  );
  const selectLatestVerdict = db.prepare(
    'SELECT * FROM verdicts ORDER BY timestamp DESC LIMIT 1'
  );

  const insertScoreEvent = db.prepare(
    'INSERT INTO score_events (agent_id, round_id, confidence, correct, score_change, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const selectScoreEventsByAgent = db.prepare(
    'SELECT * FROM score_events WHERE agent_id = ? ORDER BY timestamp DESC LIMIT 5'
  );

  const insertFlipCard = db.prepare(
    'INSERT INTO flip_cards (title, text, agent, agent_id, confidence, result, score_change, round_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const selectFlipCards = db.prepare(
    'SELECT * FROM flip_cards ORDER BY timestamp DESC'
  );

  function buildAgentSnapshot(agent) {
    const recentEvents = selectScoreEventsByAgent.all(agent.id);
    const highConfFails = recentEvents.filter(
      (event) => !event.correct && event.confidence >= 80
    ).length;

    return {
      ...agent,
      recent_rounds: recentEvents.length,
      recent_high_conf_failures: highConfFails,
    };
  }

  function getLiveRound() {
    return selectLiveRound.get() || null;
  }

  function scheduleSettlement(roundId, endTime) {
    const delay = Math.max(0, new Date(endTime).getTime() - Date.now());
    if (state.settlementTimer) {
      clearTimeout(state.settlementTimer);
    }
    state.settlementTimer = setTimeout(() => settleRound(roundId), delay);
  }

  async function startRound() {
    const active = getLiveRound();
    if (active) return;

    const now = new Date();
    const startPrice = await priceService.getPrice();
    const round = {
      round_id: roundIdFor(now),
      symbol: 'BTCUSDT',
      duration_min: ROUND_DURATION_MIN,
      start_price: Number(startPrice.toFixed(2)),
      end_price: null,
      status: 'betting',
      start_time: now.toISOString(),
      end_time: new Date(now.getTime() + ROUND_DURATION_MS).toISOString(),
    };

    const context = { price: startPrice, deltaPct: state.lastDeltaPct };
    const agents = selectAgents.all();
    const judgments = agents.map((agent) => {
      const output = judgmentService.generateJudgment(agent, context);
      return {
        round_id: round.round_id,
        agent_id: agent.id,
        direction: output.direction,
        confidence: output.confidence,
        comment: output.comment,
        timestamp: now.toISOString(),
      };
    });

    const tx = db.transaction(() => {
      insertRound.run(
        round.round_id,
        round.symbol,
        round.duration_min,
        round.start_price,
        round.end_price,
        round.status,
        round.start_time,
        round.end_time
      );

      judgments.forEach((judgment) => {
        insertJudgment.run(
          judgment.round_id,
          judgment.agent_id,
          judgment.direction,
          judgment.confidence,
          judgment.comment,
          judgment.timestamp
        );
      });

      updateRoundStatus.run('locked', round.round_id);
      trimTable(db, 'rounds', ROUND_LIMIT, 'start_time');
      trimTable(db, 'judgments', JUDGMENT_LIMIT, 'timestamp');
    });

    tx();

    state.currentRoundId = round.round_id;
    scheduleSettlement(round.round_id, round.end_time);
  }

  async function settleRound(roundId) {
    const round = selectRoundById.get(roundId);
    if (!round || round.status === 'settled') {
      return;
    }

    const endPrice = await priceService.getPrice();
    const endPriceFixed = Number(endPrice.toFixed(2));
    const deltaPct = ((endPriceFixed - round.start_price) / round.start_price) * 100;
    const verdict = {
      round_id: round.round_id,
      result: computeResult(deltaPct),
      delta_pct: Number(deltaPct.toFixed(1)),
      timestamp: new Date().toISOString(),
    };

    const judgments = selectJudgmentsByRound.all(round.round_id);

    const tx = db.transaction(() => {
      updateRoundEnd.run(endPriceFixed, 'settled', round.round_id);
      insertVerdict.run(
        verdict.round_id,
        verdict.result,
        verdict.delta_pct,
        verdict.timestamp
      );

      judgments.forEach((judgment) => {
        const agent = selectAgentById.get(judgment.agent_id);
        if (!agent) return;

        const correct = judgment.direction === verdict.result;
        const scoreChange = correct
          ? judgment.confidence
          : -Math.round(judgment.confidence * 1.5);

        updateAgentScore.run(scoreChange, agent.id);

        insertScoreEvent.run(
          agent.id,
          round.round_id,
          judgment.confidence,
          correct ? 1 : 0,
          scoreChange,
          correct ? 'Correct' : 'High confidence failure',
          verdict.timestamp
        );

        const flipCard = buildFlipCard({
          agent,
          judgment,
          verdict,
          scoreChange,
        });

        insertFlipCard.run(
          flipCard.title,
          flipCard.text,
          flipCard.agent,
          flipCard.agent_id,
          flipCard.confidence,
          flipCard.result,
          flipCard.score_change,
          flipCard.round_id,
          flipCard.timestamp
        );
      });

      trimTable(db, 'verdicts', VERDICT_LIMIT, 'timestamp');
      trimTable(db, 'score_events', SCORE_EVENT_LIMIT, 'timestamp');
      trimTable(db, 'flip_cards', FEED_LIMIT, 'timestamp');
    });

    tx();

    state.currentRoundId = null;
    setTimeout(() => startRound(), 1000);
  }

  function buildSummary() {
    const live = getLiveRound();
    const liveJudgments = live
      ? selectJudgmentsWithAgents.all(live.round_id).map((item) => ({
          ...item,
          agent_name: item.agent_name || item.agent_id,
        }))
      : [];

    const lastVerdict = selectLatestVerdict.get() || null;
    let highlight = null;

    if (lastVerdict) {
      const top = selectJudgmentsByRoundSorted.get(lastVerdict.round_id);
      if (top) {
        const agent = selectAgentById.get(top.agent_id);
        if (agent) {
          const correct = top.direction === lastVerdict.result;
          const scoreChange = correct ? top.confidence : -Math.round(top.confidence * 1.5);
          highlight = buildFlipCard({
            agent,
            judgment: top,
            verdict: lastVerdict,
            scoreChange,
          });
        }
      }
    }

    const agents = selectAgents
      .all()
      .map((agent) => buildAgentSnapshot(agent))
      .sort((a, b) => b.score - a.score);

    const sortedFeed = selectFlipCards.all();
    const defaultFeed = sortedFeed.filter(
      (item) => item.result === 'FAIL' && item.confidence >= 80
    );

    const feed = (defaultFeed.length > 0 ? defaultFeed : sortedFeed).slice(0, 30);

    return {
      server_time: new Date().toISOString(),
      live: live
        ? {
            round_id: live.round_id,
            symbol: live.symbol,
            status: live.status,
            duration_min: live.duration_min,
            start_price: live.start_price,
            start_time: live.start_time,
            end_time: live.end_time,
            countdown_ms: Math.max(0, new Date(live.end_time).getTime() - Date.now()),
            current_price: state.currentPrice,
            judgments: liveJudgments,
          }
        : null,
      lastVerdict,
      highlight,
      agents,
      feed,
    };
  }

  return {
    getLiveRound,
    scheduleSettlement,
    startRound,
    settleRound,
    buildSummary,
  };
}

module.exports = {
  createRoundService,
};
