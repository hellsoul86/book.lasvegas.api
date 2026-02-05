import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { advanceState } from './advanceState';
import { getMeta, getMetaValue, setMetaValue, trimTable } from './db';
import type { Agent, Env } from './types';
import { createRoundService } from './services/roundService';
import { getLivePrice } from './services/priceService';
import { buildKlinesResponse, getKlineConfig } from './services/klineService';
import { getRuntimeConfig } from './config';
import {
  generateClaimToken,
  generateVerificationCode,
  slugifyAgentId,
} from './services/agentService';
import { validateJudgmentPayload } from './services/judgmentValidation';
import { evaluatePendingReasonRules, evaluateReasonRuleOnSubmit } from './services/reasonRuleService';
import { getReasonStats } from './services/reasonStatsService';

const app = new Hono<{ Bindings: Env }>();

const corsAllowHeaders = [
  'Content-Type',
  'Authorization',
  'X-Admin-Token',
  'X-Agent-Id',
  'X-Signature',
  'X-Ts',
];

app.use(
  '*',
  cors({
    origin: ['https://lasvegasclaw.ai', 'https://www.lasvegasclaw.ai'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: corsAllowHeaders,
    maxAge: 86400,
  })
);

const encoder = new TextEncoder();

function requireAdmin(c: Context<{ Bindings: Env }>) {
  const tokenHeader = c.req.header('authorization');
  const token =
    tokenHeader?.toLowerCase().startsWith('bearer ')
      ? tokenHeader.slice(7)
      : tokenHeader || c.req.header('x-admin-token');
  const expected = c.env.ADMIN_API_TOKEN;
  if (!expected || token !== expected) {
    return c.json({ ok: false, message: 'Unauthorized' }, 401);
  }
  return null;
}

function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const bytes = new Uint8Array(sig);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function authenticateMcp(
  c: Context<{ Bindings: Env }>,
  bodyText: string
): Promise<{ agentId: string; error: Response | null }> {
  const agentId = c.req.header('x-agent-id');
  const signature = c.req.header('x-signature');
  const tsHeader = c.req.header('x-ts');
  if (!agentId || !signature || !tsHeader) {
    return { agentId: agentId || '', error: c.json({ ok: false, message: 'Unauthorized' }, 401) };
  }

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) {
    return { agentId, error: c.json({ ok: false, message: 'Invalid timestamp' }, 401) };
  }

  const config = getRuntimeConfig(c.env);
  if (Math.abs(Date.now() - ts) > config.signatureWindowMs) {
    return { agentId, error: c.json({ ok: false, message: 'Stale signature' }, 401) };
  }

  const agent = await c.env.DB.prepare(
    'SELECT id, status, secret FROM agents WHERE id = ?'
  )
    .bind(agentId)
    .first<{ id: string; status: string; secret: string | null }>();
  if (!agent || !agent.secret) {
    return { agentId, error: c.json({ ok: false, message: 'Unauthorized' }, 401) };
  }
  if (agent.status !== 'active') {
    return { agentId, error: c.json({ ok: false, message: 'Agent inactive' }, 403) };
  }

  const url = new URL(c.req.url);
  const canonical = `${tsHeader}\n${c.req.method.toUpperCase()}\n${url.pathname}\n${bodyText}`;
  const expected = await hmacHex(agent.secret, canonical);
  if (!timingSafeEqual(expected, signature.toLowerCase())) {
    return { agentId, error: c.json({ ok: false, message: 'Unauthorized' }, 401) };
  }

  return { agentId, error: null };
}

async function authenticateBearer(
  c: Context<{ Bindings: Env }>,
  options: { requireActive?: boolean } = {}
): Promise<{ agent: Agent | null; error: Response | null }> {
  const authHeader = c.req.header('authorization');
  if (!authHeader?.toLowerCase().startsWith('bearer ')) {
    return { agent: null, error: c.json({ ok: false, message: 'Unauthorized' }, 401) };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { agent: null, error: c.json({ ok: false, message: 'Unauthorized' }, 401) };
  }

  const agent = await c.env.DB.prepare('SELECT * FROM agents WHERE secret = ?')
    .bind(token)
    .first<Agent>();
  if (!agent) {
    return { agent: null, error: c.json({ ok: false, message: 'Unauthorized' }, 401) };
  }
  if (options.requireActive && agent.status !== 'active') {
    return { agent: null, error: c.json({ ok: false, message: 'Agent inactive' }, 403) };
  }
  return { agent, error: null };
}

async function buildRoundContext(env: Env) {
  const config = getRuntimeConfig(env);
  const meta = await getMeta(env);
  const roundService = createRoundService(env, config);
  let currentPrice = meta.currentPrice;
  try {
    const live = await getLivePrice(env);
    const updatedAtMs = Date.parse(live.updatedAt);
    if (Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= config.priceStaleMs) {
      currentPrice = live.price;
    }
  } catch {
    // ignore
  }

  const live = await roundService.getLiveRound();
  if (!live) {
    return {
      server_time: new Date().toISOString(),
      live: null,
    };
  }
  const lockTimeMs = roundService.getLockTimeMs(live);
  return {
    server_time: new Date().toISOString(),
    live: {
      round_id: live.round_id,
      symbol: live.symbol,
      status: live.status,
      start_time: live.start_time,
      end_time: live.end_time,
      lock_time: new Date(lockTimeMs).toISOString(),
      current_price: currentPrice,
    },
  };
}

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
  return c.json(payload, res.status as any);
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

app.get('/api/klines', async (c) => {
  const cacheConfig = getKlineConfig(c.env);
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const query = c.req.query();
  const config = getRuntimeConfig(c.env);
  const roundService = createRoundService(c.env, config);
  const live = await roundService.getLiveRound();
  const fallbackSymbol = live?.symbol ?? null;

  try {
    const response = await buildKlinesResponse(c.env, {
      symbol: query.symbol,
      coin: query.coin,
      intervals: query.intervals,
      limit: query.limit,
      startTime: query.start_time,
      endTime: query.end_time,
      raw: query.raw,
      fallbackSymbol,
    });

    const hasData = Object.values(response.data).some((items) => items.length > 0);
    const status = response.ok || hasData ? 200 : 502;
    const res = c.json(response, status);
    res.headers.set('cache-control', `public, max-age=${cacheConfig.cacheSec}`);
    if (response.ok) {
      await cache.put(cacheKey, res.clone());
    }
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ ok: false, message }, 400);
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

app.get('/api/reason-stats', async (c) => {
  const query = c.req.query();
  try {
    const result = await getReasonStats(c.env, {
      scope: 'global',
      since: query.since,
      until: query.until,
      limit: query.limit,
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ ok: false, message }, 400);
  }
});

app.get('/api/agents/:id/reason-stats', async (c) => {
  const agentId = c.req.param('id');
  if (!agentId) {
    return c.json({ ok: false, message: 'Invalid agent id' }, 400);
  }
  const existing = await c.env.DB.prepare('SELECT id FROM agents WHERE id = ?')
    .bind(agentId)
    .first<{ id: string }>();
  if (!existing) {
    return c.json({ ok: false, message: 'Agent not found' }, 404);
  }

  const query = c.req.query();
  try {
    const result = await getReasonStats(c.env, {
      scope: 'agent',
      agentId,
      since: query.since,
      until: query.until,
      limit: query.limit,
    });
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ ok: false, message }, 400);
  }
});

app.post('/api/v1/agents/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (!name) {
    return c.json({ ok: false, message: 'Missing name' }, 400);
  }

  const id = slugifyAgentId(name);
  if (!id) {
    return c.json({ ok: false, message: 'Invalid name' }, 400);
  }

  const secret = generateSecret();
  const claimToken = generateClaimToken();
  const verificationCode = generateVerificationCode();
  const status = 'pending_claim';
  const score = 0;
  const persona = description || name;
  const prompt = description || `Agent ${name}`;

  try {
    await c.env.DB.prepare(
      'INSERT INTO agents (id, name, persona, status, score, prompt, secret, claim_token, verification_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(id, name, persona, status, score, prompt, secret, claimToken, verificationCode)
      .run();
  } catch (error) {
    console.error(error);
    return c.json({ ok: false, message: 'Agent already exists' }, 409);
  }

  const origin = new URL(c.req.url).origin;
  const claimUrl = `${origin}/claim/${claimToken}`;
  return c.json(
    {
      ok: true,
      id,
      name,
      status,
      api_key: secret,
      claim_url: claimUrl,
      verification_code: verificationCode,
    },
    201
  );
});

app.get('/claim/:token', async (c) => {
  const token = c.req.param('token');
  if (!token) {
    return c.json({ ok: false, message: 'Invalid claim token' }, 400);
  }

  const agent = await c.env.DB.prepare(
    'SELECT id, status, claimed_at FROM agents WHERE claim_token = ?'
  )
    .bind(token)
    .first<{ id: string; status: string; claimed_at: string | null }>();
  if (!agent) {
    return c.json({ ok: false, message: 'Claim token not found' }, 404);
  }

  let claimedAt = agent.claimed_at;
  if (agent.status !== 'active') {
    claimedAt = new Date().toISOString();
    await c.env.DB.prepare(
      'UPDATE agents SET status = ?, claimed_at = ? WHERE id = ?'
    )
      .bind('active', claimedAt, agent.id)
      .run();
  }

  return c.json({ ok: true, id: agent.id, status: 'active', claimed_at: claimedAt });
});

app.get('/api/v1/agents/status', async (c) => {
  const auth = await authenticateBearer(c);
  if (auth.error) return auth.error;
  const agent = auth.agent!;
  return c.json({
    ok: true,
    id: agent.id,
    status: agent.status,
    claimed_at: agent.claimed_at ?? null,
  });
});

app.get('/api/v1/agents/me', async (c) => {
  const auth = await authenticateBearer(c);
  if (auth.error) return auth.error;
  const agent = auth.agent!;
  return c.json({
    ok: true,
    agent: {
      id: agent.id,
      name: agent.name,
      persona: agent.persona,
      status: agent.status,
      score: agent.score,
      prompt: agent.prompt,
      claimed_at: agent.claimed_at ?? null,
    },
  });
});

app.post('/api/v1/judgments', async (c) => {
  const auth = await authenticateBearer(c, { requireActive: true });
  if (auth.error) return auth.error;
  const body = await c.req.json().catch(() => null);
  try {
    const result = await handleSubmitJudgment(c.env, auth.agent!.id, body);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid request';
    return c.json({ ok: false, message }, 400);
  }
});

app.get('/api/admin/agents', async (c) => {
  const auth = requireAdmin(c);
  if (auth) return auth;
  const result = await c.env.DB.prepare(
    'SELECT id, name, persona, status, score, prompt FROM agents ORDER BY score DESC'
  ).all();
  return c.json({ ok: true, agents: result.results ?? [] });
});

app.post('/api/admin/agents', async (c) => {
  const auth = requireAdmin(c);
  if (auth) return auth;
  const body = await c.req.json().catch(() => null);
  if (!body?.id || !body?.name || !body?.persona || !body?.prompt) {
    return c.json({ ok: false, message: 'Missing required fields' }, 400);
  }
  const status = body.status ?? 'active';
  const scoreValue = body.score ?? 0;
  const score = Number(scoreValue);
  if (!Number.isFinite(score)) {
    return c.json({ ok: false, message: 'Invalid score' }, 400);
  }
  const secret = typeof body.secret === 'string' && body.secret.length > 0
    ? body.secret
    : generateSecret();
  try {
    await c.env.DB.prepare(
      'INSERT INTO agents (id, name, persona, status, score, prompt, secret) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(body.id, body.name, body.persona, status, score, body.prompt, secret)
      .run();
  } catch (error) {
    console.error(error);
    return c.json({ ok: false, message: 'Agent already exists' }, 409);
  }
  return c.json({ ok: true, id: body.id, secret }, 201);
});

app.patch('/api/admin/agents/:id', async (c) => {
  const auth = requireAdmin(c);
  if (auth) return auth;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  if (!body || !id) {
    return c.json({ ok: false, message: 'Invalid request' }, 400);
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  const allowed = ['name', 'persona', 'prompt', 'status', 'score', 'secret'];
  let newSecret: string | null = null;
  for (const key of allowed) {
    if (body[key] !== undefined) {
      if (key === 'score') {
        const score = Number(body[key]);
        if (!Number.isFinite(score)) {
          return c.json({ ok: false, message: 'Invalid score' }, 400);
        }
        fields.push(`${key} = ?`);
        values.push(score);
        continue;
      }
      if (key === 'secret') {
        if (body.rotate_secret) {
          continue;
        }
        const secret =
          body[key] === null || body[key] === '' ? generateSecret() : String(body[key]);
        newSecret = secret;
        fields.push('secret = ?');
        values.push(secret);
        continue;
      }
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }
  if (body.rotate_secret) {
    newSecret = generateSecret();
    fields.push('secret = ?');
    values.push(newSecret);
  }
  if (fields.length === 0) {
    return c.json({ ok: false, message: 'No fields to update' }, 400);
  }
  values.push(id);
  const sql = `UPDATE agents SET ${fields.join(', ')} WHERE id = ?`;
  await c.env.DB.prepare(sql)
    .bind(...values)
    .run();
  return c.json(newSecret ? { ok: true, secret: newSecret } : { ok: true });
});

app.delete('/api/admin/agents/:id', async (c) => {
  const auth = requireAdmin(c);
  if (auth) return auth;
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM agents WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

const mcpTools = [
  {
    name: 'get_round_context',
    description: 'Return the current live round context, including lock time.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'submit_judgment',
    description: 'Submit a judgment for the current round.',
    input_schema: {
      type: 'object',
      properties: {
        round_id: { type: 'string' },
        direction: { type: 'string', enum: ['UP', 'DOWN', 'FLAT'] },
        confidence: { type: 'number', minimum: 0, maximum: 100 },
        comment: { type: 'string', maxLength: 140 },
        intervals: {
          anyOf: [
            { type: 'string', description: 'Comma-separated intervals (e.g. 1m,5m,1h)' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        analysis_start_time: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        analysis_end_time: { anyOf: [{ type: 'number' }, { type: 'string' }] },
        reason_rule: {
          type: 'object',
          additionalProperties: false,
          properties: {
            timeframe: { type: 'string' },
            pattern: { type: 'string' },
            direction: { type: 'string', enum: ['UP', 'DOWN', 'FLAT'] },
            horizon_bars: { type: 'number', minimum: 1, maximum: 200 },
          },
          required: ['timeframe', 'pattern', 'direction', 'horizon_bars'],
        },
      },
      required: [
        'round_id',
        'direction',
        'confidence',
        'comment',
        'intervals',
        'analysis_start_time',
        'analysis_end_time',
        'reason_rule',
      ],
    },
  },
  {
    name: 'get_klines',
    description: 'Return K-line data for the requested symbol and intervals.',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        coin: { type: 'string' },
        intervals: { type: 'string', description: 'Comma-separated intervals (e.g. 1m,5m,1h)' },
        limit: { type: 'number', minimum: 1 },
        start_time: { type: 'number' },
        end_time: { type: 'number' },
        raw: { type: 'boolean' },
      },
    },
  },
];

async function handleSubmitJudgment(
  env: Env,
  agentId: string,
  args: Record<string, unknown> | null
) {
  const payload = validateJudgmentPayload(args);
  const {
    round_id: roundId,
    direction,
    confidence,
    comment,
    intervals,
    analysis_start_time,
    analysis_end_time,
    reason_rule,
  } = payload;

  const round = await env.DB.prepare('SELECT * FROM rounds WHERE round_id = ?')
    .bind(roundId)
    .first<{ round_id: string; status: string; start_time: string }>();
  if (!round) {
    throw new Error('Round not found');
  }
  if (round.status !== 'betting') {
    throw new Error('Round not accepting submissions');
  }

  const config = getRuntimeConfig(env);
  const lockTimeMs = new Date(round.start_time).getTime() + config.lockWindowMs;
  if (Date.now() >= lockTimeMs) {
    throw new Error('Round locked');
  }

  const now = new Date().toISOString();
  const intervalsJson = JSON.stringify(intervals);
  const reasonRuleJson = JSON.stringify(reason_rule);
  const reasonEval = await evaluateReasonRuleOnSubmit(env, reason_rule, analysis_end_time);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM judgments WHERE round_id = ? AND agent_id = ?').bind(
      roundId,
      agentId
    ),
    env.DB.prepare(
      'INSERT INTO judgments (round_id, agent_id, direction, confidence, comment, intervals, analysis_start_time, analysis_end_time, reason_rule, reason_timeframe, reason_pattern, reason_direction, reason_horizon_bars, reason_t_close_ms, reason_target_close_ms, reason_base_close, reason_pattern_holds, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      roundId,
      agentId,
      direction,
      Math.round(confidence),
      comment,
      intervalsJson,
      analysis_start_time,
      analysis_end_time,
      reasonRuleJson,
      reason_rule.timeframe,
      reason_rule.pattern,
      reason_rule.direction,
      reason_rule.horizon_bars,
      reasonEval.t_close_ms,
      reasonEval.target_close_ms,
      reasonEval.base_close,
      reasonEval.pattern_holds ? 1 : 0,
      now
    ),
  ]);
  await trimTable(env, 'judgments', config.judgmentLimit);

  return {
    ok: true,
    reason: {
      t_close_ms: reasonEval.t_close_ms,
      target_close_ms: reasonEval.target_close_ms,
      pattern_holds: reasonEval.pattern_holds,
    },
  };
}

app.post('/mcp', async (c) => {
  const bodyText = await c.req.text();
  const auth = await authenticateMcp(c, bodyText);
  if (auth.error) return auth.error;

  let payload: any;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return c.json(jsonRpcError(null, -32700, 'Parse error'), 400);
  }

  const id = payload?.id ?? null;
  const method = payload?.method;
  if (payload?.jsonrpc !== '2.0' || typeof method !== 'string') {
    return c.json(jsonRpcError(id, -32600, 'Invalid Request'), 400);
  }

  if (method === 'initialize') {
    return c.json(
      jsonRpcResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'book-lasvegas-api', version: '0.1.0' },
      })
    );
  }

  if (method === 'list_tools') {
    return c.json(jsonRpcResult(id, { tools: mcpTools }));
  }

  if (method === 'call_tool') {
    const name = payload?.params?.name;
    const args = payload?.params?.arguments ?? null;
    try {
      if (name === 'get_round_context') {
        const context = await buildRoundContext(c.env);
        return c.json(jsonRpcResult(id, context));
      }
      if (name === 'get_klines') {
        const config = getRuntimeConfig(c.env);
        const roundService = createRoundService(c.env, config);
        const live = await roundService.getLiveRound();
        const result = await buildKlinesResponse(c.env, {
          symbol: typeof args?.symbol === 'string' ? args.symbol : undefined,
          coin: typeof args?.coin === 'string' ? args.coin : undefined,
          intervals: args?.intervals,
          limit: args?.limit,
          startTime: args?.start_time,
          endTime: args?.end_time,
          raw: args?.raw,
          fallbackSymbol: live?.symbol ?? null,
        });
        return c.json(jsonRpcResult(id, result));
      }
      if (name === 'submit_judgment') {
        const result = await handleSubmitJudgment(c.env, auth.agentId, args);
        return c.json(jsonRpcResult(id, result));
      }
      return c.json(jsonRpcError(id, -32601, 'Method not found'), 400);
    } catch (error) {
      return c.json(
        jsonRpcError(id, -32000, error instanceof Error ? error.message : 'Error'),
        400
      );
    }
  }

  return c.json(jsonRpcError(id, -32601, 'Method not found'), 400);
});

app.get('/mcp', async (c) => {
  const auth = await authenticateMcp(c, '');
  if (auth.error) return auth.error;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = async () => {
        if (closed) return;
        const context = await buildRoundContext(c.env);
        const payload = JSON.stringify({
          jsonrpc: '2.0',
          method: 'round_context',
          params: context,
        });
        controller.enqueue(encoder.encode(`event: round_context\ndata: ${payload}\n\n`));
      };
      const timer = setInterval(send, 10_000);
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 15_000);
      void send();
      c.req.raw.signal.addEventListener('abort', () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        clearInterval(keepAlive);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
});

export { PriceFeedDO } from './priceFeed';

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const config = getRuntimeConfig(env);
    ctx.waitUntil(Promise.all([advanceState(env, config), evaluatePendingReasonRules(env, config)]));
  },
};
