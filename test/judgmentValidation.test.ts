import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeIntervals,
  normalizeTimeRange,
  validateJudgmentPayload,
} from '../src/services/judgmentValidation.ts';

test('normalizeIntervals accepts string and array inputs', () => {
  assert.deepEqual(normalizeIntervals('1m,5m'), ['1m', '5m']);
  assert.deepEqual(normalizeIntervals(['1h', '4h']), ['1h', '4h']);
});

test('normalizeIntervals rejects invalid interval', () => {
  assert.throws(() => normalizeIntervals('2m'), /Invalid interval/);
});

test('normalizeTimeRange accepts ms and ISO inputs', () => {
  const startMs = 1700000000000;
  const endMs = 1700000060000;
  const numeric = normalizeTimeRange(startMs, endMs);
  assert.equal(numeric.startIso, new Date(startMs).toISOString());
  assert.equal(numeric.endIso, new Date(endMs).toISOString());

  const iso = normalizeTimeRange('2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z');
  assert.equal(iso.startIso, '2024-01-01T00:00:00.000Z');
  assert.equal(iso.endIso, '2024-01-01T01:00:00.000Z');
});

test('validateJudgmentPayload requires intervals and time range', () => {
  assert.throws(
    () =>
      validateJudgmentPayload({
        round_id: 'r1',
        direction: 'UP',
        confidence: 80,
        comment: 'test',
      }),
    /intervals|analysis/i
  );
});
