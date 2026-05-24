import Database from 'better-sqlite3';
import { DB_PATH } from '../config.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate();
  }
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mint TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      launchpad TEXT,
      age_sec INTEGER,
      market_cap_usd REAL,
      volume_1m_usd REAL,
      total_fee_sol REAL,
      holder_count INTEGER,
      smart_degen_count INTEGER,
      rug_ratio REAL,
      is_wash_trading INTEGER,
      creator_token_status TEXT,
      liquidity REAL,
      hot_level INTEGER,
      price_usd REAL,
      created_at_ms INTEGER,
      scanned_at_ms INTEGER NOT NULL,
      gates_passed INTEGER DEFAULT 0,
      gates_detail TEXT,
      llm_verdict TEXT,
      llm_confidence INTEGER,
      llm_reason TEXT,
      status TEXT DEFAULT 'scanned',
      raw_data TEXT
    );

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      candidate_id INTEGER REFERENCES candidates(id),
      mint TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      entry_price_usd REAL,
      entry_mcap_usd REAL,
      size_sol REAL,
      token_amount TEXT,
      execution_mode TEXT DEFAULT 'dry_run',
      status TEXT DEFAULT 'open',
      tp1_hit INTEGER DEFAULT 0,
      tp1_done INTEGER DEFAULT 0,
      tp2_hit INTEGER DEFAULT 0,
      tp2_done INTEGER DEFAULT 0,
      sl_hit INTEGER DEFAULT 0,
      high_water_price REAL,
      high_water_mcap REAL,
      trailing_armed INTEGER DEFAULT 0,
      opened_at_ms INTEGER,
      closed_at_ms INTEGER,
      exit_reason TEXT,
      exit_price_usd REAL,
      exit_mcap_usd REAL,
      pnl_percent REAL,
      pnl_sol REAL,
      buy_signature TEXT,
      sell_signature TEXT,
      strategy_id TEXT DEFAULT 'runner'
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER REFERENCES positions(id),
      mint TEXT NOT NULL,
      side TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      price_usd REAL,
      mcap_usd REAL,
      size_sol REAL,
      token_amount TEXT,
      reason TEXT,
      signature TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function setting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}
