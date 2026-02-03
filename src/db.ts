import { DEFAULT_AGENTS } from './agents';
import type { Agent, Env, MetaState } from './types';

const DEFAULT_META: MetaState = {
  lastPrice: 42000,
  currentPrice: 42000,
  lastDeltaPct: 0,
  lastPriceAt: null,
};

type TrimTable = 'rounds' | 'judgments' | 'verdicts' | 'score_events' | 'flip_cards';

const TRIM_CONFIG: Record<TrimTable, { id: string; order: string }> = {
  rounds: { id: 'round_id', order: 'start_time' },
  judgments: { id: 'id', order: 'timestamp' },
  verdicts: { id: 'id', order: 'timestamp' },
  score_events: { id: 'id', order: 'timestamp' },
  flip_cards: { id: 'id', order: 'timestamp' },
};

export async function getMeta(env: Env): Promise<MetaState> {
  const result = await env.DB.prepare('SELECT key, value FROM meta').all<{
    key: string;
    value: string;
  }>();

  const meta: MetaState = { ...DEFAULT_META };
  for (const row of result.results ?? []) {
    if (row.key === 'lastPrice') {
      meta.lastPrice = Number(row.value) || meta.lastPrice;
    } else if (row.key === 'currentPrice') {
      meta.currentPrice = Number(row.value) || meta.currentPrice;
    } else if (row.key === 'lastDeltaPct') {
      meta.lastDeltaPct = Number(row.value) || meta.lastDeltaPct;
    } else if (row.key === 'lastPriceAt') {
      meta.lastPriceAt = row.value || null;
    }
  }

  return meta;
}

export async function setMeta(env: Env, meta: MetaState): Promise<void> {
  const stmt = env.DB.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  await env.DB.batch([
    stmt.bind('lastPrice', String(meta.lastPrice)),
    stmt.bind('currentPrice', String(meta.currentPrice)),
    stmt.bind('lastDeltaPct', String(meta.lastDeltaPct)),
    stmt.bind('lastPriceAt', meta.lastPriceAt || ''),
  ]);
}

export async function seedAgents(env: Env): Promise<void> {
  const stmt = env.DB.prepare(
    `
      INSERT INTO agents (id, name, persona, status, score, prompt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        persona = excluded.persona,
        prompt = excluded.prompt,
        status = COALESCE(agents.status, excluded.status),
        score = COALESCE(agents.score, excluded.score)
    `
  );

  const statements = DEFAULT_AGENTS.map((agent: Agent) =>
    stmt.bind(
      agent.id,
      agent.name,
      agent.persona,
      agent.status,
      agent.score,
      agent.prompt
    )
  );

  await env.DB.batch(statements);
}

export async function trimTable(
  env: Env,
  table: TrimTable,
  limit: number
): Promise<void> {
  if (!limit || limit <= 0) return;
  const config = TRIM_CONFIG[table];
  const sql = `DELETE FROM ${table} WHERE ${config.id} NOT IN (SELECT ${config.id} FROM ${table} ORDER BY ${config.order} DESC LIMIT ?)`;
  await env.DB.prepare(sql).bind(limit).run();
}
