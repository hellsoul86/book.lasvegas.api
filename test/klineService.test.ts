import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKlinesResponse } from '../src/services/klineService.ts';
import type { Env } from '../src/types.ts';

const baseEnv = {
  HL_INFO_URL: 'https://api.hyperliquid.xyz/info',
  HL_COIN: 'BTC',
  KLINE_DEFAULT_INTERVALS: '1m,5m,1h',
  KLINE_DEFAULT_LIMIT: '2',
  KLINE_MAX_LIMIT: '5',
  KLINE_CACHE_SEC: '15',
} satisfies Partial<Env>;

test('buildKlinesResponse returns normalized klines for default intervals', async () => {
  const calls: Array<{ interval: string; coin: string }> = [];
  const sample = [
    { t: 1700000000000, o: '100', h: '110', l: '90', c: '105', v: '12.5', n: 4 },
    { t: 1700000006000, o: '105', h: '112', l: '104', c: '111', v: '8.2' },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ interval: body?.req?.interval, coin: body?.req?.coin });
    return {
      ok: true,
      json: async () => sample,
      text: async () => JSON.stringify(sample),
    } as Response;
  }) as typeof fetch;

  try {
    const response = await buildKlinesResponse(baseEnv as Env, {});
    assert.equal(response.ok, true);
    assert.equal(response.coin, 'BTC');
    assert.deepEqual(response.intervals, ['1m', '5m', '1h']);
    assert.equal(Object.keys(response.data).length, 3);
    assert.ok(response.data['1m'].length > 0);
    assert.equal(response.data['1m'][0].open, 100);
    assert.equal(response.data['1m'][1].trades_count, 0);
    assert.deepEqual(
      calls.map((c) => c.interval).sort(),
      ['1m', '1h', '5m'].sort()
    );
    assert.ok(calls.every((c) => c.coin === 'BTC'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildKlinesResponse rejects non-BTC symbol', async () => {
  await assert.rejects(
    () => buildKlinesResponse(baseEnv as Env, { symbol: 'ETHUSDT' }),
    /Only BTC/,
  );
});

test('buildKlinesResponse rejects limit above max', async () => {
  await assert.rejects(
    () => buildKlinesResponse(baseEnv as Env, { limit: 1000 }),
    /Limit exceeds max/,
  );
});

test('buildKlinesResponse includes raw payload when requested', async () => {
  const sample = [
    { t: 1700000000000, o: '100', h: '110', l: '90', c: '105', v: '12.5', n: 4 },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: true,
      json: async () => sample,
      text: async () => JSON.stringify(sample),
    } as Response;
  }) as typeof fetch;

  try {
    const response = await buildKlinesResponse(baseEnv as Env, { raw: true, intervals: '1m' });
    assert.ok(response.raw);
    assert.ok(response.raw?.['1m']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('buildKlinesResponse accepts supported intervals list', async () => {
  const calls: string[] = [];
  const sample = [{ t: 1700000000000, o: '100', h: '110', l: '90', c: '105', v: '12.5' }];
  const supported = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '12h', '1d'];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(body?.req?.interval);
    return {
      ok: true,
      json: async () => sample,
      text: async () => JSON.stringify(sample),
    } as Response;
  }) as typeof fetch;

  try {
    const response = await buildKlinesResponse(baseEnv as Env, {
      intervals: supported.join(','),
    });
    assert.equal(response.ok, true);
    assert.deepEqual(response.intervals, supported);
    assert.deepEqual(calls.sort(), supported.sort());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const interval of ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '12h', '1d']) {
  test(`buildKlinesResponse accepts interval ${interval}`, async () => {
    const sample = [{ t: 1700000000000, o: '100', h: '110', l: '90', c: '105', v: '12.5' }];
    const originalFetch = globalThis.fetch;
    let called = '';

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      called = body?.req?.interval;
      return {
        ok: true,
        json: async () => sample,
        text: async () => JSON.stringify(sample),
      } as Response;
    }) as typeof fetch;

    try {
      const response = await buildKlinesResponse(baseEnv as Env, { intervals: interval });
      assert.equal(response.ok, true);
      assert.deepEqual(response.intervals, [interval]);
      assert.equal(called, interval);
      assert.equal(response.data[interval].length, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
