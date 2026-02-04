import { SUPPORTED_INTERVALS } from './klineService';

const VALID_INTERVALS = new Set(SUPPORTED_INTERVALS.map((interval) => interval.toLowerCase()));

export type NormalizedJudgmentPayload = {
  round_id: string;
  direction: 'UP' | 'DOWN' | 'FLAT';
  confidence: number;
  comment: string;
  intervals: string[];
  analysis_start_time: string;
  analysis_end_time: string;
};

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
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

export function normalizeIntervals(input: unknown): string[] {
  let intervals: string[] = [];
  if (Array.isArray(input)) {
    intervals = input.map((item) => String(item));
  } else if (typeof input === 'string') {
    intervals = input.split(',');
  }

  const cleaned = intervals
    .map((interval) => interval.trim().toLowerCase())
    .filter(Boolean);

  if (cleaned.length === 0) {
    throw new Error('Missing intervals');
  }

  for (const interval of cleaned) {
    if (!VALID_INTERVALS.has(interval)) {
      throw new Error(`Invalid interval: ${interval}`);
    }
  }

  return cleaned;
}

export function normalizeTimeRange(start: unknown, end: unknown): {
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
} {
  const startMs = parseTime(start);
  const endMs = parseTime(end);

  if (startMs === null || endMs === null) {
    throw new Error('Missing analysis time range');
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error('Invalid analysis time range');
  }
  if (startMs >= endMs) {
    throw new Error('analysis_start_time must be before analysis_end_time');
  }

  return {
    startMs,
    endMs,
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

export function validateJudgmentPayload(
  payload: Record<string, unknown> | null
): NormalizedJudgmentPayload {
  const roundId = typeof payload?.round_id === 'string' ? payload.round_id.trim() : '';
  const directionRaw = typeof payload?.direction === 'string' ? payload.direction : '';
  const direction = directionRaw.toUpperCase();
  const confidence = parseNumber(payload?.confidence);
  const comment = typeof payload?.comment === 'string' ? payload.comment.trim() : '';

  if (!roundId) {
    throw new Error('Missing round_id');
  }
  if (!['UP', 'DOWN', 'FLAT'].includes(direction)) {
    throw new Error('Invalid direction');
  }
  if (confidence === null || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new Error('Invalid confidence');
  }
  if (!comment || comment.length > 140) {
    throw new Error('Invalid comment');
  }

  const intervals = normalizeIntervals(payload?.intervals);
  const timeRange = normalizeTimeRange(
    payload?.analysis_start_time,
    payload?.analysis_end_time
  );

  return {
    round_id: roundId,
    direction: direction as 'UP' | 'DOWN' | 'FLAT',
    confidence: Math.round(confidence),
    comment,
    intervals,
    analysis_start_time: timeRange.startIso,
    analysis_end_time: timeRange.endIso,
  };
}
