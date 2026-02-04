import type { Env, Kline, KlinesResponse } from '../types';

const DEFAULT_INFO_URL = 'https://api.hyperliquid.xyz/info';
const DEFAULT_INTERVALS = ['1m', '5m', '1h'];
const DEFAULT_LIMIT = 200;
const DEFAULT_MAX_LIMIT = 500;
const DEFAULT_CACHE_SEC = 15;

const VALID_INTERVALS = new Set([
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '12h',
  '1d',
]);

export type KlineConfig = {
  infoUrl: string;
  defaultIntervals: string[];
  defaultLimit: number;
  maxLimit: number;
  cacheSec: number;
};

type KlineServiceOptions = {
  coin?: unknown;
  symbol?: unknown;
  intervals?: unknown;
  limit?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  raw?: unknown;
  fallbackSymbol?: string | null;
  fallbackCoin?: string | null;
};

type HyperliquidCandle = {
  t: number;
  T?: number;
  o: string | number;
  h: string | number;
  l: string | number;
  c: string | number;
  v: string | number;
  n?: number;
};

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  return false;
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

function intervalToMs(interval: string): number {
  const unit = interval.slice(-1);
  const count = Number(interval.slice(0, -1));
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`Invalid interval: ${interval}`);
  }
  if (unit === 'm') return count * 60 * 1000;
  if (unit === 'h') return count * 60 * 60 * 1000;
  if (unit === 'd') return count * 24 * 60 * 60 * 1000;
  throw new Error(`Invalid interval: ${interval}`);
}

function alignEndTime(timestampMs: number, intervalMs: number): number {
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

function normalizeIntervals(value: unknown, defaults: string[]): string[] {
  let intervals: string[] = [];
  if (Array.isArray(value)) {
    intervals = value.map((item) => String(item));
  } else if (typeof value === 'string') {
    intervals = value.split(',');
  }

  const cleaned = intervals
    .map((interval) => interval.trim())
    .filter(Boolean)
    .map((interval) => interval.toLowerCase());

  const resolved = cleaned.length > 0 ? cleaned : defaults;
  for (const interval of resolved) {
    if (!VALID_INTERVALS.has(interval)) {
      throw new Error(`Invalid interval: ${interval}`);
    }
  }
  return resolved;
}

function normalizeLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
  const parsed = parseNumber(value);
  const limit = parsed === null ? defaultLimit : Math.floor(parsed);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error('Invalid limit');
  }
  if (limit > maxLimit) {
    throw new Error(`Limit exceeds max (${maxLimit})`);
  }
  return limit;
}

function normalizeCoin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^a-zA-Z]/g, '');
  return cleaned ? cleaned.toUpperCase() : null;
}

function coinFromSymbol(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  const upper = symbol.toUpperCase();
  if (upper.endsWith('USDT')) return upper.slice(0, -4);
  if (upper.endsWith('USDC')) return upper.slice(0, -4);
  if (upper.endsWith('USD')) return upper.slice(0, -3);
  const cleaned = upper.replace(/[^A-Z]/g, '');
  return cleaned || null;
}

export function getKlineConfig(env: Env): KlineConfig {
  const infoUrl = env.HL_INFO_URL || DEFAULT_INFO_URL;
  const defaultIntervals = (env.KLINE_DEFAULT_INTERVALS || DEFAULT_INTERVALS.join(','))
    .split(',')
    .map((interval) => interval.trim())
    .filter(Boolean)
    .map((interval) => interval.toLowerCase());
  const defaultLimit = Number(env.KLINE_DEFAULT_LIMIT || DEFAULT_LIMIT);
  const maxLimit = Number(env.KLINE_MAX_LIMIT || DEFAULT_MAX_LIMIT);
  const cacheSec = Number(env.KLINE_CACHE_SEC || DEFAULT_CACHE_SEC);

  return {
    infoUrl,
    defaultIntervals: defaultIntervals.length > 0 ? defaultIntervals : DEFAULT_INTERVALS,
    defaultLimit: Number.isFinite(defaultLimit) ? defaultLimit : DEFAULT_LIMIT,
    maxLimit: Number.isFinite(maxLimit) ? maxLimit : DEFAULT_MAX_LIMIT,
    cacheSec: Number.isFinite(cacheSec) ? cacheSec : DEFAULT_CACHE_SEC,
  };
}

function normalizeSymbol(input: unknown): string | null {
  if (!input) return null;
  const symbol = String(input).trim();
  return symbol ? symbol.toUpperCase() : null;
}

function buildFallbackSymbol(coin: string): string {
  return `${coin}USDT`;
}

async function fetchHyperliquidCandles(
  infoUrl: string,
  coin: string,
  interval: string,
  startTime: number,
  endTime: number,
  limit: number
): Promise<HyperliquidCandle[]> {
  const payload = {
    type: 'candleSnapshot',
    req: {
      coin,
      interval,
      startTime,
      endTime,
    },
  };

  const res = await fetch(infoUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Hyperliquid error ${res.status}: ${body}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) {
    throw new Error('Invalid Hyperliquid response');
  }

  const sliced = data.slice(-limit);
  return sliced as HyperliquidCandle[];
}

function normalizeKlines(
  candles: HyperliquidCandle[],
  intervalMs: number
): Kline[] {
  return candles.map((candle) => {
    const openTime = Number(candle.t);
    const closeTime = Number.isFinite(candle.T) ? Number(candle.T) : openTime + intervalMs;
    return {
      open_time: openTime,
      close_time: closeTime,
      open: Number(candle.o),
      high: Number(candle.h),
      low: Number(candle.l),
      close: Number(candle.c),
      volume: Number(candle.v),
      trades_count: candle.n ? Number(candle.n) : 0,
    };
  });
}

export async function buildKlinesResponse(
  env: Env,
  options: KlineServiceOptions
): Promise<KlinesResponse> {
  const config = getKlineConfig(env);
  const intervals = normalizeIntervals(options.intervals, config.defaultIntervals);
  const limit = normalizeLimit(options.limit, config.defaultLimit, config.maxLimit);
  const rawEnabled = parseBoolean(options.raw);

  const providedCoin = normalizeCoin(options.coin ? String(options.coin) : null);
  const providedSymbol = normalizeSymbol(options.symbol);
  const fallbackCoin = normalizeCoin(options.fallbackCoin || env.HL_COIN || null);
  const fallbackSymbol = normalizeSymbol(options.fallbackSymbol);

  let coin =
    providedCoin ||
    coinFromSymbol(providedSymbol) ||
    coinFromSymbol(fallbackSymbol) ||
    fallbackCoin ||
    'BTC';

  let symbol = providedSymbol || fallbackSymbol || buildFallbackSymbol(coin);

  if (!coin) {
    coin = 'BTC';
  }
  if (coin !== 'BTC') {
    throw new Error('Only BTC is supported right now');
  }
  if (!symbol) {
    symbol = buildFallbackSymbol(coin);
  }

  const data: Record<string, Kline[]> = {};
  const errors: Record<string, string> = {};
  const raw: Record<string, unknown> = {};

  for (const interval of intervals) {
    const intervalMs = intervalToMs(interval);
    const endTimeInput = parseTime(options.endTime);
    const startTimeInput = parseTime(options.startTime);

    const resolvedEndTime = endTimeInput ?? alignEndTime(Date.now(), intervalMs);
    const resolvedStartTime =
      startTimeInput ?? resolvedEndTime - intervalMs * limit;

    if (!Number.isFinite(resolvedStartTime) || !Number.isFinite(resolvedEndTime)) {
      throw new Error('Invalid time range');
    }
    if (resolvedStartTime >= resolvedEndTime) {
      throw new Error('Start time must be before end time');
    }

    try {
      const candles = await fetchHyperliquidCandles(
        config.infoUrl,
        coin,
        interval,
        resolvedStartTime,
        resolvedEndTime,
        limit
      );
      const normalized = normalizeKlines(candles, intervalMs);
      data[interval] = normalized;
      if (rawEnabled) {
        raw[interval] = candles;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors[interval] = message;
      data[interval] = [];
    }
  }

  const hasData = Object.values(data).some((items) => items.length > 0);
  const response: KlinesResponse = {
    ok: hasData,
    source: 'hyperliquid',
    symbol,
    coin,
    intervals,
    limit,
    updated_at: new Date().toISOString(),
    data,
  };

  if (Object.keys(errors).length > 0) {
    response.errors = errors;
  }

  if (rawEnabled) {
    response.raw = raw;
  }

  return response;
}
