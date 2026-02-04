ALTER TABLE agents ADD COLUMN claim_token TEXT;
ALTER TABLE agents ADD COLUMN verification_code TEXT;
ALTER TABLE agents ADD COLUMN claimed_at TEXT;

ALTER TABLE judgments ADD COLUMN intervals TEXT;
ALTER TABLE judgments ADD COLUMN analysis_start_time TEXT;
ALTER TABLE judgments ADD COLUMN analysis_end_time TEXT;
