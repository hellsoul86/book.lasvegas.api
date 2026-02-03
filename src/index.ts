import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { advanceState } from './advanceState';
import { getMeta, getMetaValue, setMetaValue } from './db';
import type { Env } from './types';
import { createRoundService } from './services/roundService';
import { getLivePrice } from './services/priceService';
import { getRuntimeConfig } from './config';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: '*' }));

app.get('/api/health', (c) => {
  return c.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/advance', async (c) => {
  const config = getRuntimeConfig(c.env);
  const meta = await advanceState(c.env, config);
  return c.json({
    ok: true,
    server_time: new Date().toISOString(),
    meta,
  });
});

app.get('/api/diagnostics/binance', (c) => {
  return c.json(
    { ok: false, message: 'Binance diagnostics deprecated. Use /api/diagnostics/hyperliquid.' },
    410
  );
});

app.get('/api/diagnostics/binance/last', (c) => {
  return c.json(
    { ok: false, message: 'Binance diagnostics deprecated. Use /api/diagnostics/hyperliquid/last.' },
    410
  );
});

app.get('/api/diagnostics/hyperliquid', async (c) => {
  const id = c.env.PRICE_FEED.idFromName('primary');
  const stub = c.env.PRICE_FEED.get(id);
  const res = await stub.fetch('https://price-feed/diag');
  const payload = await res.json();
  await setMetaValue(c.env, 'lastHyperliquidDiag', JSON.stringify(payload));
  return c.json(payload, res.status);
});

app.get('/api/diagnostics/hyperliquid/last', async (c) => {
  const raw = await getMetaValue(c.env, 'lastHyperliquidDiag');
  if (!raw) {
    return c.json({ ok: false, message: 'No diagnostics recorded' }, 404);
  }
  try {
    return c.json(JSON.parse(raw));
  } catch {
    return c.json({ ok: false, message: 'Diagnostics corrupted', raw }, 500);
  }
});

app.get('/api/summary', async (c) => {
  const config = getRuntimeConfig(c.env);
  const meta = await getMeta(c.env);
  const roundService = createRoundService(c.env, config);
  try {
    const live = await getLivePrice(c.env);
    const updatedAtMs = Date.parse(live.updatedAt);
    if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= config.priceStaleMs) {
      meta.currentPrice = live.price;
    }
  } catch (error) {
    console.warn('Live price unavailable', error);
  }
  const summary = await roundService.buildSummary(meta);
  return c.json(summary);
});

export { PriceFeedDO } from './priceFeed';

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const config = getRuntimeConfig(env);
    ctx.waitUntil(advanceState(env, config));
  },
};
