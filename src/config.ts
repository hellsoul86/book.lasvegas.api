import type { Env } from './types';

export type RuntimeConfig = {
  roundDurationMin: number;
  roundDurationMs: number;
  priceRefreshMs: number;
  flatThresholdPct: number;
  feedLimit: number;
  verdictLimit: number;
  judgmentLimit: number;
  roundLimit: number;
  scoreEventLimit: number;
};

const DEFAULTS = {
  roundDurationMin: 30,
  priceRefreshMs: 10_000,
  flatThresholdPct: 0.2,
  feedLimit: 200,
  verdictLimit: 200,
  judgmentLimit: 800,
  roundLimit: 200,
  scoreEventLimit: 1000,
};

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getRuntimeConfig(env?: Env): RuntimeConfig {
  const roundDurationMin = parseNumber(env?.ROUND_DURATION_MIN, DEFAULTS.roundDurationMin);
  const priceRefreshMs = parseNumber(env?.PRICE_REFRESH_MS, DEFAULTS.priceRefreshMs);
  const flatThresholdPct = parseNumber(env?.FLAT_THRESHOLD_PCT, DEFAULTS.flatThresholdPct);

  return {
    roundDurationMin,
    roundDurationMs: roundDurationMin * 60 * 1000,
    priceRefreshMs,
    flatThresholdPct,
    feedLimit: DEFAULTS.feedLimit,
    verdictLimit: DEFAULTS.verdictLimit,
    judgmentLimit: DEFAULTS.judgmentLimit,
    roundLimit: DEFAULTS.roundLimit,
    scoreEventLimit: DEFAULTS.scoreEventLimit,
  };
}
