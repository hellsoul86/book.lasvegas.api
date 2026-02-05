import test from 'node:test';
import assert from 'node:assert/strict';
import type { Kline } from '../src/types.ts';
import {
  alignCloseTimeMs,
  computeOutcome,
  evaluatePattern,
  getPatternRequiredBars,
  normalizeReasonRule,
} from '../src/services/reasonRuleService.ts';

function klineFrom(ohlc: { o: number; h: number; l: number; c: number }): Kline {
  return {
    open_time: 0,
    close_time: 0,
    open: ohlc.o,
    high: ohlc.h,
    low: ohlc.l,
    close: ohlc.c,
    volume: 0,
    trades_count: 0,
  };
}

test('normalizeReasonRule validates whitelist and constraints', () => {
  const rule = normalizeReasonRule(
    {
      timeframe: '15m',
      pattern: 'candle.doji.v1',
      direction: 'UP',
      horizon_bars: 3,
    },
    { allowedIntervals: ['15m', '1h'], expectedDirection: 'UP' }
  );
  assert.deepEqual(rule, {
    timeframe: '15m',
    pattern: 'candle.doji.v1',
    direction: 'UP',
    horizon_bars: 3,
  });
  assert.throws(
    () =>
      normalizeReasonRule({
        timeframe: '2m',
        pattern: 'candle.doji.v1',
        direction: 'UP',
        horizon_bars: 3,
      }),
    /timeframe/i
  );
  assert.throws(
    () =>
      normalizeReasonRule({
        timeframe: '15m',
        pattern: 'candle.fake.v1',
        direction: 'UP',
        horizon_bars: 3,
      }),
    /pattern/i
  );
  assert.throws(
    () =>
      normalizeReasonRule(
        {
          timeframe: '15m',
          pattern: 'candle.doji.v1',
          direction: 'DOWN',
          horizon_bars: 3,
        },
        { expectedDirection: 'UP' }
      ),
    /match/i
  );
  assert.throws(
    () =>
      normalizeReasonRule(
        {
          timeframe: '15m',
          pattern: 'candle.doji.v1',
          direction: 'UP',
          horizon_bars: 999,
        },
        { expectedDirection: 'UP' }
      ),
    /horizon/i
  );
});

test('alignCloseTimeMs aligns analysis_end_time to last closed candle boundary', () => {
  const ms = Date.parse('2026-02-04T00:01:30Z');
  const aligned = alignCloseTimeMs(ms, '1m');
  assert.equal(new Date(aligned).toISOString(), '2026-02-04T00:00:59.999Z');
});

test('computeOutcome returns FLAT within threshold', () => {
  {
    const result = computeOutcome(100, 100.1, 0.2);
    assert.equal(result.outcome, 'FLAT');
    assert.ok(Math.abs(result.deltaPct - 0.1) < 1e-9);
  }
  assert.equal(computeOutcome(100, 100.3, 0.2).outcome, 'UP');
  assert.equal(computeOutcome(100, 99.6, 0.2).outcome, 'DOWN');
});

test('getPatternRequiredBars covers all patterns', () => {
  assert.equal(getPatternRequiredBars('candle.doji.v1'), 1);
  assert.equal(getPatternRequiredBars('indicator.ema20_cross_up_ema50.v1'), 51);
  assert.equal(getPatternRequiredBars('structure.head_and_shoulders_90.v1'), 94);
});

test('evaluatePattern candle patterns', () => {
  assert.equal(
    evaluatePattern('candle.bullish_engulfing.v1', [
      klineFrom({ o: 10, h: 10, l: 7, c: 8 }),
      klineFrom({ o: 7, h: 12, l: 6, c: 11 }),
    ]),
    true
  );

  assert.equal(
    evaluatePattern('candle.bearish_engulfing.v1', [
      klineFrom({ o: 8, h: 12, l: 7, c: 10 }),
      klineFrom({ o: 11, h: 12, l: 6, c: 7 }),
    ]),
    true
  );

  assert.equal(
    evaluatePattern('candle.hammer.v1', [klineFrom({ o: 10, h: 11.2, l: 6, c: 11 })]),
    true
  );

  assert.equal(
    evaluatePattern('candle.shooting_star.v1', [klineFrom({ o: 10, h: 14, l: 8.8, c: 9 })]),
    true
  );

  assert.equal(
    evaluatePattern('candle.doji.v1', [klineFrom({ o: 10, h: 11, l: 9, c: 10.05 })]),
    true
  );

  assert.equal(
    evaluatePattern('candle.inside_bar.v1', [
      klineFrom({ o: 10, h: 12, l: 8, c: 11 }),
      klineFrom({ o: 11, h: 11, l: 9, c: 10 }),
    ]),
    true
  );

  assert.equal(
    evaluatePattern('candle.outside_bar.v1', [
      klineFrom({ o: 10, h: 11, l: 9, c: 10 }),
      klineFrom({ o: 10, h: 12, l: 8, c: 11 }),
    ]),
    true
  );

  assert.equal(
    evaluatePattern('candle.morning_star.v1', [
      klineFrom({ o: 10, h: 10.5, l: 5.5, c: 6 }),
      klineFrom({ o: 6.4, h: 6.6, l: 6.2, c: 6.5 }),
      klineFrom({ o: 6.5, h: 9.2, l: 6.4, c: 9 }),
    ]),
    true
  );

  assert.equal(
    evaluatePattern('candle.evening_star.v1', [
      klineFrom({ o: 6, h: 10.5, l: 5.5, c: 10 }),
      klineFrom({ o: 9.8, h: 10.0, l: 9.6, c: 9.7 }),
      klineFrom({ o: 9.7, h: 9.8, l: 6.8, c: 7 }),
    ]),
    true
  );

  assert.equal(
    evaluatePattern('candle.three_white_soldiers.v1', [
      klineFrom({ o: 10, h: 11.2, l: 9.8, c: 11 }),
      klineFrom({ o: 10.5, h: 11.7, l: 10.4, c: 11.5 }),
      klineFrom({ o: 11, h: 12.2, l: 10.9, c: 12 }),
    ]),
    true
  );

  assert.equal(
    evaluatePattern('candle.three_black_crows.v1', [
      klineFrom({ o: 12, h: 12.2, l: 10.8, c: 11 }),
      klineFrom({ o: 11.5, h: 11.6, l: 10.2, c: 10.5 }),
      klineFrom({ o: 11, h: 11.1, l: 9.5, c: 9.8 }),
    ]),
    true
  );
});

test('evaluatePattern indicator patterns', () => {
  const base = Array.from({ length: 50 }, () => klineFrom({ o: 100, h: 100, l: 100, c: 100 }));
  const jumpUp = [...base, klineFrom({ o: 100, h: 200, l: 100, c: 200 })];
  assert.equal(evaluatePattern('indicator.ema20_cross_up_ema50.v1', jumpUp), true);
  assert.equal(evaluatePattern('indicator.ema20_gt_ema50.v1', jumpUp), true);

  const jumpDown = [...base, klineFrom({ o: 100, h: 100, l: 0, c: 0 })];
  assert.equal(evaluatePattern('indicator.ema20_cross_down_ema50.v1', jumpDown), true);
  assert.equal(evaluatePattern('indicator.ema20_lt_ema50.v1', jumpDown), true);

  const downSeries = Array.from({ length: 15 }, (_v, i) =>
    klineFrom({ o: 100 - i * 10, h: 100 - i * 10, l: 100 - i * 10, c: 100 - i * 10 })
  );
  assert.equal(evaluatePattern('indicator.rsi14_lt_30.v1', downSeries), true);

  const upSeries = Array.from({ length: 15 }, (_v, i) =>
    klineFrom({ o: 100 + i * 10, h: 100 + i * 10, l: 100 + i * 10, c: 100 + i * 10 })
  );
  assert.equal(evaluatePattern('indicator.rsi14_gt_70.v1', upSeries), true);
});

test('evaluatePattern breakout patterns', () => {
  const prev20 = Array.from({ length: 20 }, () => klineFrom({ o: 100, h: 100, l: 90, c: 95 }));
  const up = [...prev20, klineFrom({ o: 99, h: 102, l: 98, c: 101 })];
  assert.equal(evaluatePattern('breakout.close_gt_high_20.v1', up), true);

  const down = [...prev20, klineFrom({ o: 92, h: 93, l: 88, c: 89 })];
  assert.equal(evaluatePattern('breakout.close_lt_low_20.v1', down), true);

  const prev55 = Array.from({ length: 55 }, () => klineFrom({ o: 100, h: 100, l: 90, c: 95 }));
  const up55 = [...prev55, klineFrom({ o: 99, h: 105, l: 98, c: 101 })];
  assert.equal(evaluatePattern('breakout.close_gt_high_55.v1', up55), true);

  const down55 = [...prev55, klineFrom({ o: 92, h: 93, l: 80, c: 85 })];
  assert.equal(evaluatePattern('breakout.close_lt_low_55.v1', down55), true);
});

test('evaluatePattern structure patterns', () => {
  const series64: Kline[] = Array.from({ length: 64 }, () =>
    klineFrom({ o: 100, h: 100, l: 100, c: 100 })
  );

  // Double top: peaks at 20 and 40, neckline low at 30, confirm close below neckline.
  series64[18] = klineFrom({ o: 105, h: 110, l: 98, c: 104 });
  series64[19] = klineFrom({ o: 106, h: 115, l: 98, c: 105 });
  series64[20] = klineFrom({ o: 107, h: 120, l: 99, c: 108 }); // pivot high
  series64[21] = klineFrom({ o: 106, h: 114, l: 97, c: 105 });
  series64[22] = klineFrom({ o: 105, h: 111, l: 96, c: 104 });
  series64[30] = klineFrom({ o: 95, h: 98, l: 90, c: 94 }); // neckline low
  series64[38] = klineFrom({ o: 106, h: 112, l: 98, c: 105 });
  series64[39] = klineFrom({ o: 107, h: 118, l: 98, c: 106 });
  series64[40] = klineFrom({ o: 108, h: 121, l: 99, c: 109 }); // pivot high
  series64[41] = klineFrom({ o: 107, h: 117, l: 97, c: 106 });
  series64[42] = klineFrom({ o: 106, h: 113, l: 96, c: 105 });
  series64[63] = klineFrom({ o: 90, h: 91, l: 88, c: 89 }); // confirm
  assert.equal(evaluatePattern('structure.double_top_60.v1', series64), true);

  const series64b: Kline[] = Array.from({ length: 64 }, () =>
    klineFrom({ o: 100, h: 100, l: 100, c: 100 })
  );
  // Double bottom: troughs at 20 and 40, neckline high at 30, confirm close above neckline.
  series64b[18] = klineFrom({ o: 95, h: 102, l: 86, c: 96 });
  series64b[19] = klineFrom({ o: 94, h: 101, l: 83, c: 95 });
  series64b[20] = klineFrom({ o: 93, h: 100, l: 80, c: 92 }); // pivot low
  series64b[21] = klineFrom({ o: 94, h: 101, l: 82, c: 95 });
  series64b[22] = klineFrom({ o: 95, h: 102, l: 85, c: 96 });
  series64b[30] = klineFrom({ o: 105, h: 110, l: 104, c: 108 }); // neckline high
  series64b[38] = klineFrom({ o: 95, h: 103, l: 86, c: 96 });
  series64b[39] = klineFrom({ o: 94, h: 101, l: 83, c: 95 });
  series64b[40] = klineFrom({ o: 93, h: 100, l: 80.5, c: 92 }); // pivot low
  series64b[41] = klineFrom({ o: 94, h: 101, l: 82, c: 95 });
  series64b[42] = klineFrom({ o: 95, h: 102, l: 85, c: 96 });
  series64b[63] = klineFrom({ o: 110, h: 112, l: 109, c: 111 }); // confirm
  assert.equal(evaluatePattern('structure.double_bottom_60.v1', series64b), true);

  const series94: Kline[] = Array.from({ length: 94 }, () =>
    klineFrom({ o: 100, h: 100, l: 100, c: 100 })
  );
  // Head and shoulders: LS 30, Head 45, RS 60; trough lows 37 and 52; confirm below neckline.
  series94[28] = klineFrom({ o: 106, h: 112, l: 98, c: 105 });
  series94[29] = klineFrom({ o: 107, h: 118, l: 98, c: 106 });
  series94[30] = klineFrom({ o: 108, h: 120, l: 99, c: 109 }); // LS pivot high
  series94[31] = klineFrom({ o: 107, h: 117, l: 97, c: 106 });
  series94[32] = klineFrom({ o: 106, h: 113, l: 96, c: 105 });
  series94[35] = klineFrom({ o: 98, h: 102, l: 96, c: 99 });
  series94[36] = klineFrom({ o: 97, h: 101, l: 95, c: 98 });
  series94[37] = klineFrom({ o: 96, h: 100, l: 90, c: 95 }); // trough pivot low
  series94[38] = klineFrom({ o: 97, h: 101, l: 94, c: 98 });
  series94[39] = klineFrom({ o: 98, h: 102, l: 95, c: 99 });
  series94[43] = klineFrom({ o: 110, h: 120, l: 100, c: 112 });
  series94[44] = klineFrom({ o: 112, h: 126, l: 101, c: 113 });
  series94[45] = klineFrom({ o: 114, h: 130, l: 103, c: 115 }); // Head pivot high
  series94[46] = klineFrom({ o: 112, h: 125, l: 100, c: 111 });
  series94[47] = klineFrom({ o: 111, h: 121, l: 99, c: 110 });
  series94[50] = klineFrom({ o: 98, h: 102, l: 95, c: 99 });
  series94[51] = klineFrom({ o: 97, h: 101, l: 94, c: 98 });
  series94[52] = klineFrom({ o: 96, h: 100, l: 92, c: 95 }); // trough pivot low
  series94[53] = klineFrom({ o: 97, h: 101, l: 94, c: 98 });
  series94[54] = klineFrom({ o: 98, h: 102, l: 95, c: 99 });
  series94[58] = klineFrom({ o: 106, h: 112, l: 98, c: 105 });
  series94[59] = klineFrom({ o: 107, h: 118, l: 98, c: 106 });
  series94[60] = klineFrom({ o: 108, h: 121, l: 99, c: 109 }); // RS pivot high
  series94[61] = klineFrom({ o: 107, h: 117, l: 97, c: 106 });
  series94[62] = klineFrom({ o: 106, h: 113, l: 96, c: 105 });
  series94[93] = klineFrom({ o: 92, h: 93, l: 89, c: 90 }); // confirm
  assert.equal(evaluatePattern('structure.head_and_shoulders_90.v1', series94), true);

  const series94i: Kline[] = Array.from({ length: 94 }, () =>
    klineFrom({ o: 100, h: 100, l: 100, c: 100 })
  );
  // Inverse head and shoulders: LS 30, Head 45, RS 60; peaks 37 and 52; confirm above neckline.
  series94i[28] = klineFrom({ o: 96, h: 102, l: 88, c: 95 });
  series94i[29] = klineFrom({ o: 95, h: 101, l: 84, c: 94 });
  series94i[30] = klineFrom({ o: 94, h: 100, l: 80, c: 93 }); // LS pivot low
  series94i[31] = klineFrom({ o: 95, h: 101, l: 82, c: 96 });
  series94i[32] = klineFrom({ o: 96, h: 102, l: 85, c: 97 });
  series94i[35] = klineFrom({ o: 101, h: 108, l: 99, c: 102 });
  series94i[36] = klineFrom({ o: 102, h: 109, l: 100, c: 103 });
  series94i[37] = klineFrom({ o: 103, h: 112, l: 101, c: 104 }); // peak pivot high
  series94i[38] = klineFrom({ o: 102, h: 109, l: 100, c: 103 });
  series94i[39] = klineFrom({ o: 101, h: 108, l: 99, c: 102 });
  series94i[43] = klineFrom({ o: 96, h: 100, l: 78, c: 95 });
  series94i[44] = klineFrom({ o: 95, h: 99, l: 74, c: 94 });
  series94i[45] = klineFrom({ o: 94, h: 98, l: 70, c: 93 }); // Head pivot low
  series94i[46] = klineFrom({ o: 95, h: 99, l: 73, c: 96 });
  series94i[47] = klineFrom({ o: 96, h: 100, l: 76, c: 97 });
  series94i[50] = klineFrom({ o: 101, h: 108, l: 99, c: 102 });
  series94i[51] = klineFrom({ o: 102, h: 109, l: 100, c: 103 });
  series94i[52] = klineFrom({ o: 103, h: 111, l: 101, c: 104 }); // peak pivot high
  series94i[53] = klineFrom({ o: 102, h: 109, l: 100, c: 103 });
  series94i[54] = klineFrom({ o: 101, h: 108, l: 99, c: 102 });
  series94i[58] = klineFrom({ o: 96, h: 102, l: 88, c: 95 });
  series94i[59] = klineFrom({ o: 95, h: 101, l: 84, c: 94 });
  series94i[60] = klineFrom({ o: 94, h: 100, l: 80.5, c: 93 }); // RS pivot low
  series94i[61] = klineFrom({ o: 95, h: 101, l: 82, c: 96 });
  series94i[62] = klineFrom({ o: 96, h: 102, l: 85, c: 97 });
  series94i[93] = klineFrom({ o: 112, h: 115, l: 110, c: 114 }); // confirm above neckline
  assert.equal(evaluatePattern('structure.inverse_head_and_shoulders_90.v1', series94i), true);
});
