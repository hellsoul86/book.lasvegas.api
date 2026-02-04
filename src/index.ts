import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { advanceState } from './advanceState';
import { getMeta, getMetaValue, setMetaValue, trimTable } from './db';
import type { Env } from './types';
import { createRoundService } from './services/roundService';
import { getLivePrice } from './services/priceService';
import { buildKlinesResponse, getKlineConfig } from './services/klineService';
import { getRuntimeConfig } from './config';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({ origin: '*' }));

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
      },
      required: ['round_id', 'direction', 'confidence', 'comment'],
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
  const roundId = typeof args?.round_id === 'string' ? args.round_id : '';
  const direction = typeof args?.direction === 'string' ? args.direction : '';
  const confidence = Number(args?.confidence);
  const comment = typeof args?.comment === 'string' ? args.comment.trim() : '';

  if (!roundId || !['UP', 'DOWN', 'FLAT'].includes(direction)) {
    throw new Error('Invalid payload');
  }
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new Error('Invalid confidence');
  }
  if (!comment || comment.length > 140) {
    throw new Error('Invalid comment');
  }

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
  await env.DB.batch([
    env.DB.prepare('DELETE FROM judgments WHERE round_id = ? AND agent_id = ?').bind(
      roundId,
      agentId
    ),
    env.DB.prepare(
      'INSERT INTO judgments (round_id, agent_id, direction, confidence, comment, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(roundId, agentId, direction, Math.round(confidence), comment, now),
  ]);
  await trimTable(env, 'judgments', config.judgmentLimit);

  return { ok: true };
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
    ctx.waitUntil(advanceState(env, config));
  },
};
