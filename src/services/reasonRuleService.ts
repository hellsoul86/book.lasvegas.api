import type { Env, Kline, ReasonRule } from '../types';
import type { RuntimeConfig } from '../config';
import { fetchKlines, intervalToMs, SUPPORTED_INTERVALS } from './klineService';

const VALID_TIMEFRAMES = new Set(SUPPORTED_INTERVALS.map((value) => value.toLowerCase()));

export const REASON_RULE_PATTERNS = [
  'candle.bullish_engulfing.v1',
  'candle.bearish_engulfing.v1',
  'candle.hammer.v1',
  'candle.shooting_star.v1',
  'candle.doji.v1',
  'candle.inside_bar.v1',
  'candle.outside_bar.v1',
  'candle.morning_star.v1',
  'candle.evening_star.v1',
  'candle.three_white_soldiers.v1',
  'candle.three_black_crows.v1',
  'indicator.ema20_gt_ema50.v1',
  'indicator.ema20_lt_ema50.v1',
  'indicator.ema20_cross_up_ema50.v1',
  'indicator.ema20_cross_down_ema50.v1',
  'indicator.rsi14_lt_30.v1',
  'indicator.rsi14_gt_70.v1',
  'breakout.close_gt_high_20.v1',
  'breakout.close_lt_low_20.v1',
  'breakout.close_gt_high_55.v1',
  'breakout.close_lt_low_55.v1',
  'structure.double_top_60.v1',
  'structure.double_bottom_60.v1',
  'structure.head_and_shoulders_90.v1',
  'structure.inverse_head_and_shoulders_90.v1',
] as const;

const VALID_PATTERNS = new Set<string>(REASON_RULE_PATTERNS);

const PIVOT_SPAN = 2;

export function normalizeReasonRule(
  input: unknown,
  options: { allowedIntervals?: string[]; expectedDirection?: string } = {}
): ReasonRule {
  if (!input || typeof input !== 'object') {
    throw new Error('Missing reason_rule');
  }
  const raw = input as Record<string, unknown>;

  const timeframe = typeof raw.timeframe === 'string' ? raw.timeframe.trim().toLowerCase() : '';
  if (!timeframe || !VALID_TIMEFRAMES.has(timeframe)) {
    throw new Error('Invalid reason_rule.timeframe');
  }
  if (options.allowedIntervals && !options.allowedIntervals.includes(timeframe)) {
    throw new Error('reason_rule.timeframe must be included in intervals');
  }

  const pattern = typeof raw.pattern === 'string' ? raw.pattern.trim() : '';
  if (!pattern || !VALID_PATTERNS.has(pattern)) {
    throw new Error('Invalid reason_rule.pattern');
  }

  const directionRaw = typeof raw.direction === 'string' ? raw.direction.trim().toUpperCase() : '';
  if (!['UP', 'DOWN', 'FLAT'].includes(directionRaw)) {
    throw new Error('Invalid reason_rule.direction');
  }
  if (options.expectedDirection && directionRaw !== options.expectedDirection) {
    throw new Error('reason_rule.direction must match direction');
  }

  const horizonInput = raw.horizon_bars;
  const horizon =
    typeof horizonInput === 'number'
      ? horizonInput
      : typeof horizonInput === 'string'
        ? Number(horizonInput)
        : NaN;
  const horizonBars = Math.floor(horizon);
  if (!Number.isFinite(horizonBars) || horizonBars < 1 || horizonBars > 200) {
    throw new Error('Invalid reason_rule.horizon_bars');
  }

  return {
    timeframe,
    pattern,
    direction: directionRaw as 'UP' | 'DOWN' | 'FLAT',
    horizon_bars: horizonBars,
  };
}

export function alignCloseTimeMs(analysisEndTimeMs: number, timeframe: string): number {
  const intervalMs = intervalToMs(timeframe);
  // Hyperliquid candles use inclusive close time: close = open + intervalMs - 1.
  return Math.floor(analysisEndTimeMs / intervalMs) * intervalMs - 1;
}

export function computeOutcome(
  baseClose: number,
  targetClose: number,
  flatThresholdPct: number
): { outcome: 'UP' | 'DOWN' | 'FLAT'; deltaPct: number } {
  const deltaPct = ((targetClose - baseClose) / baseClose) * 100;
  if (Math.abs(deltaPct) < flatThresholdPct) {
    return { outcome: 'FLAT', deltaPct };
  }
  return { outcome: deltaPct > 0 ? 'UP' : 'DOWN', deltaPct };
}

type Ohlc = { open: number; high: number; low: number; close: number };

function body(bar: Ohlc): number {
  return Math.abs(bar.close - bar.open);
}

function range(bar: Ohlc): number {
  return bar.high - bar.low;
}

function upper(bar: Ohlc): number {
  return bar.high - Math.max(bar.open, bar.close);
}

function lower(bar: Ohlc): number {
  return Math.min(bar.open, bar.close) - bar.low;
}

function clampSlice(bars: Ohlc[], count: number): Ohlc[] {
  return count >= bars.length ? bars : bars.slice(bars.length - count);
}

function atRel(bars: Ohlc[], rel: number): Ohlc | null {
  const idx = bars.length - 1 + rel;
  if (idx < 0 || idx >= bars.length) return null;
  return bars[idx];
}

function isBetween(value: number, a: number, b: number): boolean {
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  return value >= min && value <= max;
}

function computeEma(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(Number.NaN);
  if (closes.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i += 1) sum += closes[i];
  let emaPrev = sum / period;
  out[period - 1] = emaPrev;

  const alpha = 2 / (period + 1);
  for (let i = period; i < closes.length; i += 1) {
    emaPrev = alpha * closes[i] + (1 - alpha) * emaPrev;
    out[i] = emaPrev;
  }
  return out;
}

function computeRsi(closes: number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(Number.NaN);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const delta = closes[i] - closes[i - 1];
    if (delta >= 0) gainSum += delta;
    else lossSum -= delta;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const toRsi = (g: number, l: number) => {
    if (l === 0) return 100;
    if (g === 0) return 0;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  };

  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i += 1) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }

  return out;
}

type Pivot = { idx: number; price: number };

function findPivots(
  bars: Ohlc[],
  lookbackBars: number
): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  const startIdx = Math.max(PIVOT_SPAN, bars.length - lookbackBars);
  const endExclusive = bars.length - PIVOT_SPAN;

  for (let i = startIdx; i < endExclusive; i += 1) {
    const currentHigh = bars[i].high;
    const currentLow = bars[i].low;

    let isHigh = true;
    let isLow = true;
    for (let offset = 1; offset <= PIVOT_SPAN; offset += 1) {
      if (currentHigh <= bars[i - offset].high || currentHigh <= bars[i + offset].high) {
        isHigh = false;
      }
      if (currentLow >= bars[i - offset].low || currentLow >= bars[i + offset].low) {
        isLow = false;
      }
    }

    if (isHigh) highs.push({ idx: i, price: currentHigh });
    if (isLow) lows.push({ idx: i, price: currentLow });
  }

  return { highs, lows };
}

function evaluateStructureDoubleTop(bars: Ohlc[], lookback: number): boolean {
  const { highs } = findPivots(bars, lookback);
  if (highs.length < 2) return false;

  const p2 = highs[highs.length - 1];
  let p1: Pivot | null = null;
  for (let i = highs.length - 2; i >= 0; i -= 1) {
    if (p2.idx - highs[i].idx >= 5) {
      p1 = highs[i];
      break;
    }
  }
  if (!p1) return false;

  const avg = (p1.price + p2.price) / 2;
  if (avg <= 0) return false;
  if (Math.abs(p2.price - p1.price) / avg > 0.01) return false;

  if (p2.idx - p1.idx < 2) return false;
  let neckline = Number.POSITIVE_INFINITY;
  for (let i = p1.idx + 1; i < p2.idx; i += 1) {
    neckline = Math.min(neckline, bars[i].low);
  }
  if (!Number.isFinite(neckline)) return false;
  const currentClose = bars[bars.length - 1].close;
  return currentClose < neckline;
}

function evaluateStructureDoubleBottom(bars: Ohlc[], lookback: number): boolean {
  const { lows } = findPivots(bars, lookback);
  if (lows.length < 2) return false;

  const p2 = lows[lows.length - 1];
  let p1: Pivot | null = null;
  for (let i = lows.length - 2; i >= 0; i -= 1) {
    if (p2.idx - lows[i].idx >= 5) {
      p1 = lows[i];
      break;
    }
  }
  if (!p1) return false;

  const avg = (p1.price + p2.price) / 2;
  if (avg <= 0) return false;
  if (Math.abs(p2.price - p1.price) / avg > 0.01) return false;

  if (p2.idx - p1.idx < 2) return false;
  let neckline = Number.NEGATIVE_INFINITY;
  for (let i = p1.idx + 1; i < p2.idx; i += 1) {
    neckline = Math.max(neckline, bars[i].high);
  }
  if (!Number.isFinite(neckline)) return false;
  const currentClose = bars[bars.length - 1].close;
  return currentClose > neckline;
}

function evaluateStructureHeadAndShoulders(bars: Ohlc[], lookback: number): boolean {
  const { highs, lows } = findPivots(bars, lookback);
  if (highs.length < 3) return false;

  const currentClose = bars[bars.length - 1].close;

  const findMostRecentLowBetween = (startIdx: number, endIdx: number): Pivot | null => {
    for (let i = lows.length - 1; i >= 0; i -= 1) {
      const pivot = lows[i];
      if (pivot.idx > startIdx && pivot.idx < endIdx) return pivot;
    }
    return null;
  };

  // Pick the most-recent valid pattern (RS as late as possible) within the pivot set.
  for (let rsPos = highs.length - 1; rsPos >= 2; rsPos -= 1) {
    const rs = highs[rsPos];
    for (let headPos = rsPos - 1; headPos >= 1; headPos -= 1) {
      const head = highs[headPos];
      if (head.idx >= rs.idx) continue;
      for (let lsPos = headPos - 1; lsPos >= 0; lsPos -= 1) {
        const ls = highs[lsPos];
        if (ls.idx >= head.idx) continue;

        const shoulderAvg = (ls.price + rs.price) / 2;
        if (shoulderAvg <= 0) continue;
        if (Math.abs(ls.price - rs.price) / shoulderAvg > 0.01) continue;
        if (head.price < Math.max(ls.price, rs.price) * 1.01) continue;

        const trough1 = findMostRecentLowBetween(ls.idx, head.idx);
        const trough2 = findMostRecentLowBetween(head.idx, rs.idx);
        if (!trough1 || !trough2) continue;

        const neckline = (trough1.price + trough2.price) / 2;
        if (currentClose < neckline) return true;
      }
    }
  }

  return false;
}

function evaluateStructureInverseHeadAndShoulders(bars: Ohlc[], lookback: number): boolean {
  const { highs, lows } = findPivots(bars, lookback);
  if (lows.length < 3) return false;

  const currentClose = bars[bars.length - 1].close;

  const findMostRecentHighBetween = (startIdx: number, endIdx: number): Pivot | null => {
    for (let i = highs.length - 1; i >= 0; i -= 1) {
      const pivot = highs[i];
      if (pivot.idx > startIdx && pivot.idx < endIdx) return pivot;
    }
    return null;
  };

  for (let rsPos = lows.length - 1; rsPos >= 2; rsPos -= 1) {
    const rs = lows[rsPos];
    for (let headPos = rsPos - 1; headPos >= 1; headPos -= 1) {
      const head = lows[headPos];
      if (head.idx >= rs.idx) continue;
      for (let lsPos = headPos - 1; lsPos >= 0; lsPos -= 1) {
        const ls = lows[lsPos];
        if (ls.idx >= head.idx) continue;

        const shoulderAvg = (ls.price + rs.price) / 2;
        if (shoulderAvg <= 0) continue;
        if (Math.abs(ls.price - rs.price) / shoulderAvg > 0.01) continue;
        if (head.price > Math.min(ls.price, rs.price) * 0.99) continue;

        const peak1 = findMostRecentHighBetween(ls.idx, head.idx);
        const peak2 = findMostRecentHighBetween(head.idx, rs.idx);
        if (!peak1 || !peak2) continue;

        const neckline = (peak1.price + peak2.price) / 2;
        if (currentClose > neckline) return true;
      }
    }
  }

  return false;
}

export function getPatternRequiredBars(patternId: string): number {
  switch (patternId) {
    case 'candle.bullish_engulfing.v1':
    case 'candle.bearish_engulfing.v1':
    case 'candle.inside_bar.v1':
    case 'candle.outside_bar.v1':
      return 2;
    case 'candle.morning_star.v1':
    case 'candle.evening_star.v1':
    case 'candle.three_white_soldiers.v1':
    case 'candle.three_black_crows.v1':
      return 3;
    case 'candle.hammer.v1':
    case 'candle.shooting_star.v1':
    case 'candle.doji.v1':
      return 1;
    case 'indicator.ema20_gt_ema50.v1':
    case 'indicator.ema20_lt_ema50.v1':
      return 50;
    case 'indicator.ema20_cross_up_ema50.v1':
    case 'indicator.ema20_cross_down_ema50.v1':
      return 51;
    case 'indicator.rsi14_lt_30.v1':
    case 'indicator.rsi14_gt_70.v1':
      return 15;
    case 'breakout.close_gt_high_20.v1':
    case 'breakout.close_lt_low_20.v1':
      return 21;
    case 'breakout.close_gt_high_55.v1':
    case 'breakout.close_lt_low_55.v1':
      return 56;
    case 'structure.double_top_60.v1':
    case 'structure.double_bottom_60.v1':
      return 60 + PIVOT_SPAN * 2;
    case 'structure.head_and_shoulders_90.v1':
    case 'structure.inverse_head_and_shoulders_90.v1':
      return 90 + PIVOT_SPAN * 2;
    default:
      throw new Error(`Unsupported pattern: ${patternId}`);
  }
}

export function evaluatePattern(patternId: string, klines: Kline[]): boolean {
  const bars: Ohlc[] = klines.map((kline) => ({
    open: kline.open,
    high: kline.high,
    low: kline.low,
    close: kline.close,
  }));

  const current = atRel(bars, 0);
  if (!current) return false;

  switch (patternId) {
    case 'candle.bullish_engulfing.v1': {
      const prev = atRel(bars, -1);
      if (!prev) return false;
      return (
        prev.close < prev.open &&
        current.close > current.open &&
        current.open <= prev.close &&
        current.close >= prev.open
      );
    }
    case 'candle.bearish_engulfing.v1': {
      const prev = atRel(bars, -1);
      if (!prev) return false;
      return (
        prev.close > prev.open &&
        current.close < current.open &&
        current.open >= prev.close &&
        current.close <= prev.open
      );
    }
    case 'candle.hammer.v1': {
      const r = range(current);
      if (r <= 0) return false;
      const b = body(current);
      return b / r <= 0.3 && lower(current) >= 2 * b && upper(current) <= 0.25 * r;
    }
    case 'candle.shooting_star.v1': {
      const r = range(current);
      if (r <= 0) return false;
      const b = body(current);
      return b / r <= 0.3 && upper(current) >= 2 * b && lower(current) <= 0.25 * r;
    }
    case 'candle.doji.v1': {
      const r = range(current);
      if (r <= 0) return false;
      return body(current) / r <= 0.1;
    }
    case 'candle.inside_bar.v1': {
      const prev = atRel(bars, -1);
      if (!prev) return false;
      return current.high <= prev.high && current.low >= prev.low;
    }
    case 'candle.outside_bar.v1': {
      const prev = atRel(bars, -1);
      if (!prev) return false;
      return current.high >= prev.high && current.low <= prev.low;
    }
    case 'candle.morning_star.v1': {
      const b2 = atRel(bars, -2);
      const b1 = atRel(bars, -1);
      if (!b2 || !b1) return false;
      const r2 = range(b2);
      const r1 = range(b1);
      if (r2 <= 0 || r1 <= 0) return false;
      return (
        b2.close < b2.open &&
        body(b2) / r2 >= 0.5 &&
        body(b1) / r1 <= 0.3 &&
        current.close > current.open &&
        current.close >= (b2.open + b2.close) / 2
      );
    }
    case 'candle.evening_star.v1': {
      const b2 = atRel(bars, -2);
      const b1 = atRel(bars, -1);
      if (!b2 || !b1) return false;
      const r2 = range(b2);
      const r1 = range(b1);
      if (r2 <= 0 || r1 <= 0) return false;
      return (
        b2.close > b2.open &&
        body(b2) / r2 >= 0.5 &&
        body(b1) / r1 <= 0.3 &&
        current.close < current.open &&
        current.close <= (b2.open + b2.close) / 2
      );
    }
    case 'candle.three_white_soldiers.v1': {
      const b2 = atRel(bars, -2);
      const b1 = atRel(bars, -1);
      if (!b2 || !b1) return false;
      const body2Low = Math.min(b2.open, b2.close);
      const body2High = Math.max(b2.open, b2.close);
      const body1Low = Math.min(b1.open, b1.close);
      const body1High = Math.max(b1.open, b1.close);
      return (
        b2.close > b2.open &&
        b1.close > b1.open &&
        current.close > current.open &&
        b1.close > b2.close &&
        current.close > b1.close &&
        isBetween(b1.open, body2Low, body2High) &&
        isBetween(current.open, body1Low, body1High)
      );
    }
    case 'candle.three_black_crows.v1': {
      const b2 = atRel(bars, -2);
      const b1 = atRel(bars, -1);
      if (!b2 || !b1) return false;
      const body2Low = Math.min(b2.open, b2.close);
      const body2High = Math.max(b2.open, b2.close);
      const body1Low = Math.min(b1.open, b1.close);
      const body1High = Math.max(b1.open, b1.close);
      return (
        b2.close < b2.open &&
        b1.close < b1.open &&
        current.close < current.open &&
        b1.close < b2.close &&
        current.close < b1.close &&
        isBetween(b1.open, body2Low, body2High) &&
        isBetween(current.open, body1Low, body1High)
      );
    }
    case 'indicator.ema20_gt_ema50.v1':
    case 'indicator.ema20_lt_ema50.v1':
    case 'indicator.ema20_cross_up_ema50.v1':
    case 'indicator.ema20_cross_down_ema50.v1': {
      const closes = bars.map((bar) => bar.close);
      const ema20 = computeEma(closes, 20);
      const ema50 = computeEma(closes, 50);
      const last = closes.length - 1;
      const prev = last - 1;

      const e20 = ema20[last];
      const e50 = ema50[last];
      if (!Number.isFinite(e20) || !Number.isFinite(e50)) return false;

      if (patternId === 'indicator.ema20_gt_ema50.v1') return e20 > e50;
      if (patternId === 'indicator.ema20_lt_ema50.v1') return e20 < e50;

      const e20Prev = ema20[prev];
      const e50Prev = ema50[prev];
      if (!Number.isFinite(e20Prev) || !Number.isFinite(e50Prev)) return false;

      if (patternId === 'indicator.ema20_cross_up_ema50.v1') {
        return e20Prev <= e50Prev && e20 > e50;
      }
      return e20Prev >= e50Prev && e20 < e50;
    }
    case 'indicator.rsi14_lt_30.v1':
    case 'indicator.rsi14_gt_70.v1': {
      const closes = bars.map((bar) => bar.close);
      const rsi = computeRsi(closes, 14);
      const last = closes.length - 1;
      const value = rsi[last];
      if (!Number.isFinite(value)) return false;
      if (patternId === 'indicator.rsi14_lt_30.v1') return value < 30;
      return value > 70;
    }
    case 'breakout.close_gt_high_20.v1': {
      if (bars.length < 21) return false;
      const window = clampSlice(bars, 21);
      const prevHigh = Math.max(...window.slice(0, -1).map((bar) => bar.high));
      return current.close > prevHigh;
    }
    case 'breakout.close_lt_low_20.v1': {
      if (bars.length < 21) return false;
      const window = clampSlice(bars, 21);
      const prevLow = Math.min(...window.slice(0, -1).map((bar) => bar.low));
      return current.close < prevLow;
    }
    case 'breakout.close_gt_high_55.v1': {
      if (bars.length < 56) return false;
      const window = clampSlice(bars, 56);
      const prevHigh = Math.max(...window.slice(0, -1).map((bar) => bar.high));
      return current.close > prevHigh;
    }
    case 'breakout.close_lt_low_55.v1': {
      if (bars.length < 56) return false;
      const window = clampSlice(bars, 56);
      const prevLow = Math.min(...window.slice(0, -1).map((bar) => bar.low));
      return current.close < prevLow;
    }
    case 'structure.double_top_60.v1':
      return evaluateStructureDoubleTop(bars, 60);
    case 'structure.double_bottom_60.v1':
      return evaluateStructureDoubleBottom(bars, 60);
    case 'structure.head_and_shoulders_90.v1':
      return evaluateStructureHeadAndShoulders(bars, 90);
    case 'structure.inverse_head_and_shoulders_90.v1':
      return evaluateStructureInverseHeadAndShoulders(bars, 90);
    default:
      throw new Error(`Unsupported pattern: ${patternId}`);
  }
}

export type ReasonRuleSubmitEvaluation = {
  t_close_ms: number;
  target_close_ms: number;
  base_close: number;
  pattern_holds: boolean;
};

export async function evaluateReasonRuleOnSubmit(
  env: Env,
  rule: ReasonRule,
  analysisEndTimeIso: string
): Promise<ReasonRuleSubmitEvaluation> {
  const analysisEndMs = Date.parse(analysisEndTimeIso);
  if (!Number.isFinite(analysisEndMs)) {
    throw new Error('Invalid analysis_end_time');
  }

  const intervalMs = intervalToMs(rule.timeframe);
  // Hyperliquid candles use inclusive close time: close = open + intervalMs - 1.
  const tCloseMs = Math.floor(analysisEndMs / intervalMs) * intervalMs - 1;
  const targetCloseMs = tCloseMs + rule.horizon_bars * intervalMs;

  const requiredBars = getPatternRequiredBars(rule.pattern);
  const fetchLimit = Math.min(500, requiredBars + 10);
  const startTime = tCloseMs - intervalMs * fetchLimit;

  const klines = await fetchKlines(env, {
    coin: 'BTC',
    interval: rule.timeframe,
    startTime,
    endTime: tCloseMs,
    limit: fetchLimit,
  });

  const closed = klines
    .filter((kline) => kline.close_time <= tCloseMs)
    .sort((a, b) => a.close_time - b.close_time);

  const tIndex = closed.findIndex((kline) => kline.close_time === tCloseMs);
  if (tIndex === -1) {
    throw new Error('Unable to align analysis_end_time to a closed candle');
  }
  const baseClose = closed[tIndex].close;

  const window = closed.slice(0, tIndex + 1).slice(-requiredBars);
  if (window.length < requiredBars) {
    throw new Error('Insufficient candle history for pattern');
  }
  const patternHolds = evaluatePattern(rule.pattern, window);

  return {
    t_close_ms: tCloseMs,
    target_close_ms: targetCloseMs,
    base_close: baseClose,
    pattern_holds: patternHolds,
  };
}

async function fetchCloseAt(
  env: Env,
  timeframe: string,
  closeTimeMs: number
): Promise<number | null> {
  const intervalMs = intervalToMs(timeframe);
  const limit = 50;
  const startTime = closeTimeMs - intervalMs * limit;
  const klines = await fetchKlines(env, {
    coin: 'BTC',
    interval: timeframe,
    startTime,
    endTime: closeTimeMs,
    limit,
  });

  const closed = klines
    .filter((kline) => kline.close_time <= closeTimeMs)
    .sort((a, b) => a.close_time - b.close_time);
  const match = closed.find((kline) => kline.close_time === closeTimeMs);
  return match ? match.close : null;
}

export async function evaluatePendingReasonRules(
  env: Env,
  config: RuntimeConfig,
  options: { maxRows?: number } = {}
): Promise<{ evaluated: number; errors: number }> {
  const maxRows = options.maxRows ?? 50;
  const nowMs = Date.now();

  const pending = await env.DB.prepare(
    `SELECT id, reason_timeframe, reason_direction, reason_target_close_ms, reason_base_close
     FROM judgments
     WHERE reason_target_close_ms IS NOT NULL
       AND reason_target_close_ms <= ?
       AND reason_correct IS NULL
       AND reason_timeframe IS NOT NULL
       AND reason_direction IS NOT NULL
       AND reason_base_close IS NOT NULL
     ORDER BY reason_target_close_ms ASC
     LIMIT ?`
  )
    .bind(nowMs, maxRows)
    .all<{
      id: number;
      reason_timeframe: string;
      reason_direction: string;
      reason_target_close_ms: number;
      reason_base_close: number;
    }>();

  let evaluated = 0;
  let errors = 0;

  for (const row of pending.results ?? []) {
    try {
      const targetClose = await fetchCloseAt(env, row.reason_timeframe, row.reason_target_close_ms);
      if (targetClose === null) {
        continue;
      }
      const { outcome, deltaPct } = computeOutcome(
        row.reason_base_close,
        targetClose,
        config.flatThresholdPct
      );
      const predicted = row.reason_direction.toUpperCase();
      const correct = predicted === outcome;
      const nowIso = new Date().toISOString();

      await env.DB.prepare(
        `UPDATE judgments
         SET reason_target_close = ?,
             reason_delta_pct = ?,
             reason_outcome = ?,
             reason_correct = ?,
             reason_evaluated_at = ?,
             reason_eval_error = NULL
         WHERE id = ?`
      )
        .bind(
          Number(targetClose),
          Number(deltaPct.toFixed(6)),
          outcome,
          correct ? 1 : 0,
          nowIso,
          row.id
        )
        .run();

      evaluated += 1;
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : 'Unknown error';
      await env.DB.prepare(
        `UPDATE judgments SET reason_eval_error = ? WHERE id = ?`
      )
        .bind(message, row.id)
        .run();
    }
  }

  return { evaluated, errors };
}
