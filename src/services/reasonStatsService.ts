import type { Env } from '../types';

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 20000;
const DEFAULT_WINDOW_DAYS = 30;

export type ReasonStatsRow = {
  total_evaluated: number;
  total_valid: number;
  accuracy_all: number;
  accuracy_valid: number;
};

export type ReasonStatsSummary = {
  total_evaluated: number;
  total_valid: number;
  accuracy_all: number;
  accuracy_valid: number;
  avg_delta_pct: number;
  avg_abs_delta_pct: number;
};

export type ReasonStatsResponse = {
  ok: true;
  scope: 'global' | 'agent';
  agent_id?: string;
  since: string;
  until: string;
  total_evaluated: number;
  total_valid: number;
  accuracy_all: number;
  accuracy_valid: number;
  avg_delta_pct: number;
  avg_abs_delta_pct: number;
  by_timeframe: Array<ReasonStatsRow & { timeframe: string }>;
  by_pattern: Array<ReasonStatsRow & { pattern: string }>;
};

type ReasonStatsOptions = {
  scope: 'global' | 'agent';
  agentId?: string;
  since?: unknown;
  until?: unknown;
  limit?: unknown;
  nowMs?: number;
};

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseTime(value: unknown): number | null {
  const numeric = parseNumber(value);
  if (numeric !== null) return numeric;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeWindow(
  sinceInput: unknown,
  untilInput: unknown,
  nowMs: number
): { sinceMs: number; untilMs: number; sinceIso: string; untilIso: string } {
  const sinceMsRaw = parseTime(sinceInput);
  const untilMsRaw = parseTime(untilInput);

  let untilMs = untilMsRaw ?? nowMs;
  let sinceMs = sinceMsRaw ?? (untilMs - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    throw new Error('Invalid time range');
  }
  if (sinceMs >= untilMs) {
    throw new Error('since must be before until');
  }

  return {
    sinceMs,
    untilMs,
    sinceIso: new Date(sinceMs).toISOString(),
    untilIso: new Date(untilMs).toISOString(),
  };
}

function normalizeLimit(value: unknown): number {
  const parsed = parseNumber(value);
  const limit = parsed === null ? DEFAULT_LIMIT : Math.floor(parsed);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('Invalid limit');
  }
  if (limit > MAX_LIMIT) {
    throw new Error(`Limit exceeds max (${MAX_LIMIT})`);
  }
  return limit;
}

function numberOrZero(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildFilterSql(options: { agentId?: string }) {
  const base =
    'reason_correct IS NOT NULL AND reason_evaluated_at >= ? AND reason_evaluated_at <= ?';
  if (options.agentId) {
    return `${base} AND agent_id = ?`;
  }
  return base;
}

function buildParams(
  options: { agentId?: string; sinceIso: string; untilIso: string; limit: number }
): Array<string | number> {
  if (options.agentId) {
    return [options.sinceIso, options.untilIso, options.agentId, options.limit];
  }
  return [options.sinceIso, options.untilIso, options.limit];
}

async function querySummary(
  env: Env,
  filterSql: string,
  params: Array<string | number>
): Promise<ReasonStatsSummary> {
  const sql = `
    WITH filtered AS (
      SELECT reason_pattern_holds, reason_correct, reason_delta_pct
      FROM judgments
      WHERE ${filterSql}
      ORDER BY reason_evaluated_at DESC
      LIMIT ?
    )
    SELECT
      COUNT(*) AS total_evaluated,
      SUM(CASE WHEN reason_pattern_holds = 1 THEN 1 ELSE 0 END) AS total_valid,
      AVG(reason_correct) AS accuracy_all,
      AVG(CASE WHEN reason_pattern_holds = 1 THEN reason_correct END) AS accuracy_valid,
      AVG(reason_delta_pct) AS avg_delta_pct,
      AVG(ABS(reason_delta_pct)) AS avg_abs_delta_pct
    FROM filtered
  `;

  const result = await env.DB.prepare(sql).bind(...params).first<any>();
  return {
    total_evaluated: numberOrZero(result?.total_evaluated),
    total_valid: numberOrZero(result?.total_valid),
    accuracy_all: numberOrZero(result?.accuracy_all),
    accuracy_valid: numberOrZero(result?.accuracy_valid),
    avg_delta_pct: numberOrZero(result?.avg_delta_pct),
    avg_abs_delta_pct: numberOrZero(result?.avg_abs_delta_pct),
  };
}

type BreakdownRow = ReasonStatsRow & { label: string };

async function queryBreakdown(
  env: Env,
  filterSql: string,
  params: Array<string | number>,
  dimension: 'timeframe' | 'pattern'
): Promise<BreakdownRow[]> {
  const column = dimension === 'timeframe' ? 'reason_timeframe' : 'reason_pattern';
  const alias = dimension === 'timeframe' ? 'timeframe' : 'pattern';
  const sql = `
    WITH filtered AS (
      SELECT ${column} AS ${alias}, reason_pattern_holds, reason_correct
      FROM judgments
      WHERE ${filterSql}
      ORDER BY reason_evaluated_at DESC
      LIMIT ?
    )
    SELECT
      ${alias},
      COUNT(*) AS total_evaluated,
      SUM(CASE WHEN reason_pattern_holds = 1 THEN 1 ELSE 0 END) AS total_valid,
      AVG(reason_correct) AS accuracy_all,
      AVG(CASE WHEN reason_pattern_holds = 1 THEN reason_correct END) AS accuracy_valid
    FROM filtered
    WHERE ${alias} IS NOT NULL
    GROUP BY ${alias}
    ORDER BY total_evaluated DESC
  `;

  const result = await env.DB.prepare(sql).bind(...params).all<any>();
  return (result.results ?? []).map((row) => ({
    label: String(row[alias]),
    total_evaluated: numberOrZero(row.total_evaluated),
    total_valid: numberOrZero(row.total_valid),
    accuracy_all: numberOrZero(row.accuracy_all),
    accuracy_valid: numberOrZero(row.accuracy_valid),
  }));
}

export async function getReasonStats(
  env: Env,
  options: ReasonStatsOptions
): Promise<ReasonStatsResponse> {
  const nowMs = options.nowMs ?? Date.now();
  const limit = normalizeLimit(options.limit);
  const window = normalizeWindow(options.since, options.until, nowMs);

  const filterSql = buildFilterSql({ agentId: options.agentId });
  const params = buildParams({
    agentId: options.agentId,
    sinceIso: window.sinceIso,
    untilIso: window.untilIso,
    limit,
  });

  const summary = await querySummary(env, filterSql, params);
  const byTimeframe = await queryBreakdown(env, filterSql, params, 'timeframe');
  const byPattern = await queryBreakdown(env, filterSql, params, 'pattern');

  return {
    ok: true,
    scope: options.scope,
    agent_id: options.agentId,
    since: window.sinceIso,
    until: window.untilIso,
    total_evaluated: summary.total_evaluated,
    total_valid: summary.total_valid,
    accuracy_all: summary.accuracy_all,
    accuracy_valid: summary.accuracy_valid,
    avg_delta_pct: summary.avg_delta_pct,
    avg_abs_delta_pct: summary.avg_abs_delta_pct,
    by_timeframe: byTimeframe.map((row) => ({
      timeframe: row.label,
      total_evaluated: row.total_evaluated,
      total_valid: row.total_valid,
      accuracy_all: row.accuracy_all,
      accuracy_valid: row.accuracy_valid,
    })),
    by_pattern: byPattern.map((row) => ({
      pattern: row.label,
      total_evaluated: row.total_evaluated,
      total_valid: row.total_valid,
      accuracy_all: row.accuracy_all,
      accuracy_valid: row.accuracy_valid,
    })),
  };
}
