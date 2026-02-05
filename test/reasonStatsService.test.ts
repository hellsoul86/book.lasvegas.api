import test from 'node:test';
import assert from 'node:assert/strict';
import { getReasonStats } from '../src/services/reasonStatsService.ts';
import type { Env } from '../src/types.ts';

type MockResult = { first?: any; all?: any[] };

class MockStatement {
  constructor(private result: MockResult) {}
  bind(..._args: any[]) {
    return this;
  }
  async first<T>() {
    return (this.result.first ?? null) as T;
  }
  async all<T>() {
    return { results: (this.result.all ?? []) as T[] };
  }
}

class MockDB {
  constructor(private mapper: (sql: string) => MockResult) {}
  prepare(sql: string) {
    return new MockStatement(this.mapper(sql));
  }
}

const baseEnv = (mapper: (sql: string) => MockResult): Env =>
  ({
    DB: new MockDB(mapper),
    PRICE_FEED: {} as any,
  }) as Env;

test('getReasonStats returns summary and breakdowns', async () => {
  const env = baseEnv((sql) => {
    if (sql.includes('avg_abs_delta_pct')) {
      return {
        first: {
          total_evaluated: '100',
          total_valid: '60',
          accuracy_all: '0.55',
          accuracy_valid: '0.6',
          avg_delta_pct: '0.18',
          avg_abs_delta_pct: '0.42',
        },
      };
    }
    if (sql.includes('GROUP BY timeframe')) {
      return {
        all: [
          {
            timeframe: '15m',
            total_evaluated: 40,
            total_valid: 20,
            accuracy_all: 0.5,
            accuracy_valid: 0.6,
          },
        ],
      };
    }
    if (sql.includes('GROUP BY pattern')) {
      return {
        all: [
          {
            pattern: 'candle.doji.v1',
            total_evaluated: 10,
            total_valid: 5,
            accuracy_all: 0.4,
            accuracy_valid: 0.5,
          },
        ],
      };
    }
    return { first: null, all: [] };
  });

  const result = await getReasonStats(env, {
    scope: 'global',
    since: '2026-02-01T00:00:00Z',
    until: '2026-02-05T00:00:00Z',
    limit: 1000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.total_evaluated, 100);
  assert.equal(result.total_valid, 60);
  assert.equal(result.accuracy_all, 0.55);
  assert.equal(result.accuracy_valid, 0.6);
  assert.equal(result.avg_delta_pct, 0.18);
  assert.equal(result.avg_abs_delta_pct, 0.42);
  assert.equal(result.by_timeframe[0].timeframe, '15m');
  assert.equal(result.by_pattern[0].pattern, 'candle.doji.v1');
});

test('getReasonStats uses default 30d window when missing', async () => {
  const nowMs = Date.parse('2026-02-05T00:00:00Z');
  const env = baseEnv((sql) => {
    if (sql.includes('avg_abs_delta_pct')) {
      return { first: { total_evaluated: 0 } };
    }
    return { all: [] };
  });

  const result = await getReasonStats(env, {
    scope: 'global',
    nowMs,
  });

  assert.equal(result.until, '2026-02-05T00:00:00.000Z');
  assert.equal(result.since, '2026-01-06T00:00:00.000Z');
});

test('getReasonStats rejects invalid limit', async () => {
  const env = baseEnv(() => ({ first: { total_evaluated: 0 }, all: [] }));
  await assert.rejects(
    () =>
      getReasonStats(env, {
        scope: 'global',
        limit: 0,
      }),
    /Invalid limit/
  );
});

