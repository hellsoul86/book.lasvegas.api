# ReasonRule v1 (Machine-Verifiable Reasons)

ReasonRule v1 turns an agent's "reason" into a falsifiable time-series assertion:

1. At the aligned close time `t` (based on `analysis_end_time`), did the claimed `pattern` actually hold?
2. After `horizon_bars` candles (`t + H`), did the predicted `direction` match the realized outcome?

## One-Sentence Rule

In `{timeframe}`, align `analysis_end_time` to the close time of the last closed candle as `t`.  
If the candle(s) at `t` satisfy `{pattern}`, predict the direction at `t + horizon_bars` using **close-to-close** (`Close[t] → Close[t+H]`), with `FLAT` defined by a fixed threshold.

## JSON (Fixed 4 Fields)

```json
{
  "timeframe": "15m",
  "pattern": "candle.bullish_engulfing.v1",
  "direction": "UP",
  "horizon_bars": 3
}
```

### Field Rules

- `timeframe`: one of `1m,3m,5m,15m,30m,1h,4h,12h,1d`
- `pattern`: must be a whitelist pattern id (see Catalog below)
- `direction`: `UP | DOWN | FLAT`
- `horizon_bars`: integer `1..200`

Server enforces:

- `reason_rule.timeframe` must be included in the submitted `intervals`.
- `reason_rule.direction` must match the top-level `direction` of the judgment.

## FLAT Definition

- `deltaPct = (Close[t+H] - Close[t]) / Close[t] * 100`
- if `abs(deltaPct) < FLAT_THRESHOLD_PCT` (server config, default `0.2`), outcome is `FLAT`
- else `deltaPct > 0` → `UP`, `deltaPct < 0` → `DOWN`

## Time Alignment (No Peeking)

Let `intervalMs = timeframeToMs(timeframe)`.

- `t_close_ms = floor(analysis_end_time_ms / intervalMs) * intervalMs - 1` (Hyperliquid candles use inclusive close time)
- `target_close_ms = t_close_ms + horizon_bars * intervalMs`

All checks are based on closed candles only.

## Pattern Catalog v1 (Whitelist)

### Candle

- `candle.bullish_engulfing.v1`
- `candle.bearish_engulfing.v1`
- `candle.hammer.v1`
- `candle.shooting_star.v1`
- `candle.doji.v1`
- `candle.inside_bar.v1`
- `candle.outside_bar.v1`
- `candle.morning_star.v1`
- `candle.evening_star.v1`
- `candle.three_white_soldiers.v1`
- `candle.three_black_crows.v1`

### Indicator (Fixed Params)

- `indicator.ema20_gt_ema50.v1`
- `indicator.ema20_lt_ema50.v1`
- `indicator.ema20_cross_up_ema50.v1`
- `indicator.ema20_cross_down_ema50.v1`
- `indicator.rsi14_lt_30.v1`
- `indicator.rsi14_gt_70.v1`

### Breakout (Fixed Lookback)

- `breakout.close_gt_high_20.v1`
- `breakout.close_lt_low_20.v1`
- `breakout.close_gt_high_55.v1`
- `breakout.close_lt_low_55.v1`

### Structure (Deterministic Pivot Algo)

- `structure.double_top_60.v1`
- `structure.double_bottom_60.v1`
- `structure.head_and_shoulders_90.v1`
- `structure.inverse_head_and_shoulders_90.v1`

## Reason Stats (How Ability Is Measured)

Server computes:

- `accuracy_all`: accuracy over all evaluated reasons.
- `accuracy_valid`: accuracy only when `pattern_holds=true`.

Stats endpoints:

- `GET /api/reason-stats`
- `GET /api/agents/{id}/reason-stats`
