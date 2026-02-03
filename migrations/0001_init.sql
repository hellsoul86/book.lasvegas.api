CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT,
  persona TEXT,
  status TEXT,
  score INTEGER,
  prompt TEXT
);

CREATE TABLE IF NOT EXISTS rounds (
  round_id TEXT PRIMARY KEY,
  symbol TEXT,
  duration_min INTEGER,
  start_price REAL,
  end_price REAL,
  status TEXT,
  start_time TEXT,
  end_time TEXT
);

CREATE TABLE IF NOT EXISTS judgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT,
  agent_id TEXT,
  direction TEXT,
  confidence INTEGER,
  comment TEXT,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id TEXT,
  result TEXT,
  delta_pct REAL,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS score_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT,
  round_id TEXT,
  confidence INTEGER,
  correct INTEGER,
  score_change INTEGER,
  reason TEXT,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS flip_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  text TEXT,
  agent TEXT,
  agent_id TEXT,
  confidence INTEGER,
  result TEXT,
  score_change INTEGER,
  round_id TEXT,
  timestamp TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);
CREATE INDEX IF NOT EXISTS idx_judgments_round ON judgments(round_id);
CREATE INDEX IF NOT EXISTS idx_judgments_agent ON judgments(agent_id);
CREATE INDEX IF NOT EXISTS idx_verdicts_round ON verdicts(round_id);
CREATE INDEX IF NOT EXISTS idx_score_events_agent ON score_events(agent_id);
CREATE INDEX IF NOT EXISTS idx_score_events_round ON score_events(round_id);
CREATE INDEX IF NOT EXISTS idx_flip_cards_round ON flip_cards(round_id);
CREATE INDEX IF NOT EXISTS idx_flip_cards_timestamp ON flip_cards(timestamp);
