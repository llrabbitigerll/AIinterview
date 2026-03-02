import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

const DB_PATH = path.join(app.getPath('userData'), 'interview.db');

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL'); // better concurrent read perf
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();

  d.exec(`
    -- 面试会话
    CREATE TABLE IF NOT EXISTS interviews (
      id            TEXT PRIMARY KEY,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      status        TEXT NOT NULL DEFAULT 'pending',   -- pending | active | completed | cancelled
      company       TEXT,
      business_unit TEXT,
      team          TEXT,
      position      TEXT,
      round         INTEGER NOT NULL DEFAULT 1,        -- 1=一面 2=二面 3=三面
      resume_id     TEXT,
      config_json   TEXT,                              -- 面试配置（JSON）
      report_json   TEXT                               -- 面试报告（JSON）
    );

    -- 结构化简历
    CREATE TABLE IF NOT EXISTS resumes (
      id             TEXT PRIMARY KEY,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      raw_text       TEXT,
      structured_json TEXT,                            -- 解析后的结构化数据
      confirmed      INTEGER NOT NULL DEFAULT 0        -- 用户确认标记
    );

    -- 对话历史
    CREATE TABLE IF NOT EXISTS messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      interview_id  TEXT NOT NULL,
      role          TEXT NOT NULL,                      -- user | agent_b | agent_c | agent_a | system
      content       TEXT NOT NULL,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
      fluency_json  TEXT,                              -- 该条消息的流畅度指标
      metadata_json TEXT,                              -- 额外元数据
      FOREIGN KEY (interview_id) REFERENCES interviews(id)
    );

    -- 流畅度指标快照
    CREATE TABLE IF NOT EXISTS fluency_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      interview_id  TEXT NOT NULL,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
      speech_rate   REAL,                              -- 词/分钟
      pause_count   INTEGER,
      filler_count  INTEGER,
      gap_durations TEXT,                              -- JSON array of gap ms values
      overall_score REAL,
      details_json  TEXT,
      FOREIGN KEY (interview_id) REFERENCES interviews(id)
    );

    -- 创建索引
    CREATE INDEX IF NOT EXISTS idx_messages_interview ON messages(interview_id);
    CREATE INDEX IF NOT EXISTS idx_fluency_interview ON fluency_snapshots(interview_id);
  `);
}

/** Run a read query, return rows */
export function query(sql: string, params?: unknown[]): unknown[] {
  const stmt = getDb().prepare(sql);
  return params ? stmt.all(...params) : stmt.all();
}

/** Run a write statement, return { changes, lastInsertRowid } */
export function run(
  sql: string,
  params?: unknown[]
): { changes: number; lastInsertRowid: number | bigint } {
  const stmt = getDb().prepare(sql);
  const result = params ? stmt.run(...params) : stmt.run();
  return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
}

/** Graceful shutdown */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
