import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { advanceState } from './advanceState';
import type { Env } from './types';
import { createRoundService } from './services/roundService';
import { getRuntimeConfig } from './config';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: '*' }));

app.get('/api/health', (c) => {
  return c.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/summary', async (c) => {
  const config = getRuntimeConfig(c.env);
  const meta = await advanceState(c.env, config);
  const roundService = createRoundService(c.env, config);
  const summary = await roundService.buildSummary(meta);
  return c.json(summary);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const config = getRuntimeConfig(env);
    ctx.waitUntil(advanceState(env, config));
  },
};
