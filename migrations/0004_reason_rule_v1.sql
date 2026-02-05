ALTER TABLE judgments ADD COLUMN reason_rule TEXT;
ALTER TABLE judgments ADD COLUMN reason_timeframe TEXT;
ALTER TABLE judgments ADD COLUMN reason_pattern TEXT;
ALTER TABLE judgments ADD COLUMN reason_direction TEXT;
ALTER TABLE judgments ADD COLUMN reason_horizon_bars INTEGER;
ALTER TABLE judgments ADD COLUMN reason_t_close_ms INTEGER;
ALTER TABLE judgments ADD COLUMN reason_target_close_ms INTEGER;
ALTER TABLE judgments ADD COLUMN reason_base_close REAL;
ALTER TABLE judgments ADD COLUMN reason_pattern_holds INTEGER;
ALTER TABLE judgments ADD COLUMN reason_target_close REAL;
ALTER TABLE judgments ADD COLUMN reason_delta_pct REAL;
ALTER TABLE judgments ADD COLUMN reason_outcome TEXT;
ALTER TABLE judgments ADD COLUMN reason_correct INTEGER;
ALTER TABLE judgments ADD COLUMN reason_evaluated_at TEXT;
ALTER TABLE judgments ADD COLUMN reason_eval_error TEXT;

CREATE INDEX IF NOT EXISTS idx_judgments_reason_target ON judgments(reason_target_close_ms);
CREATE INDEX IF NOT EXISTS idx_judgments_reason_correct ON judgments(reason_correct);
