const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ORDER_COLUMNS = {
  rounds: 'start_time',
  judgments: 'timestamp',
  verdicts: 'timestamp',
  score_events: 'timestamp',
  flip_cards: 'timestamp',
};

function ensureDataDir(dbPath) {
  if (dbPath === ':memory:') return;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function openDb(dbPath) {
  ensureDataDir(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initSchema(db) {
  db.exec(`
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
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rounds_status ON rounds(status);
    CREATE INDEX IF NOT EXISTS idx_judgments_round ON judgments(round_id);
    CREATE INDEX IF NOT EXISTS idx_judgments_agent ON judgments(agent_id);
    CREATE INDEX IF NOT EXISTS idx_verdicts_round ON verdicts(round_id);
    CREATE INDEX IF NOT EXISTS idx_score_events_agent ON score_events(agent_id);
    CREATE INDEX IF NOT EXISTS idx_score_events_round ON score_events(round_id);
    CREATE INDEX IF NOT EXISTS idx_flip_cards_round ON flip_cards(round_id);
    CREATE INDEX IF NOT EXISTS idx_flip_cards_timestamp ON flip_cards(timestamp);
  `);
}

function seedAgents(db, agents) {
  const select = db.prepare('SELECT id, score, status FROM agents WHERE id = ?');
  const insert = db.prepare(
    'INSERT INTO agents (id, name, persona, status, score, prompt) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const update = db.prepare(
    'UPDATE agents SET name = ?, persona = ?, prompt = ?, score = COALESCE(score, ?), status = COALESCE(status, ?) WHERE id = ?'
  );

  const tx = db.transaction(() => {
    agents.forEach((agent) => {
      const row = select.get(agent.id);
      if (!row) {
        insert.run(
          agent.id,
          agent.name,
          agent.persona,
          agent.status || 'active',
          agent.score,
          agent.prompt
        );
        return;
      }

      update.run(
        agent.name,
        agent.persona,
        agent.prompt,
        agent.score,
        agent.status || 'active',
        agent.id
      );
    });
  });

  tx();
}

function trimTable(db, table, limit, orderBy) {
  if (!limit || limit <= 0) return;
  if (!Object.prototype.hasOwnProperty.call(ORDER_COLUMNS, table)) {
    throw new Error(`Unknown table for trim: ${table}`);
  }
  const column = orderBy || ORDER_COLUMNS[table];
  const stmt = db.prepare(
    `DELETE FROM ${table} WHERE rowid NOT IN (SELECT rowid FROM ${table} ORDER BY ${column} DESC LIMIT ?)`
  );
  stmt.run(limit);
}

module.exports = {
  ensureDataDir,
  openDb,
  initSchema,
  seedAgents,
  trimTable,
};
