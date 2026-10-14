import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(directory, 'agentos.db'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY, profile TEXT NOT NULL, title TEXT NOT NULL,
      session_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
      role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id),
      profile TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT NOT NULL REFERENCES messages(id),
      started_at TEXT NOT NULL, ended_at TEXT, error TEXT, task_id TEXT, usage TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, thread_id TEXT,
      type TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      profile TEXT NOT NULL, status TEXT NOT NULL, thread_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id, created_at);
    CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
  `);
  // Owned processes cannot survive an AgentOS restart; never present them as live.
  const now = new Date().toISOString();
  db.prepare("UPDATE runs SET status='interrupted', ended_at=?, error='AgentOS restarted during this run.' WHERE status IN ('running','waiting')").run(now);
  db.prepare("UPDATE tasks SET status='todo' WHERE status='running'").run();
  return {
    db,
    id: randomUUID,
    now: () => new Date().toISOString(),
    getThread: id => db.prepare('SELECT * FROM threads WHERE id=?').get(id),
    getRun: id => db.prepare('SELECT * FROM runs WHERE id=?').get(id),
    threads: () => db.prepare('SELECT * FROM threads ORDER BY updated_at DESC').all(),
    runs: () => db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 200').all(),
    tasks: () => db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all(),
    messages: id => db.prepare('SELECT * FROM messages WHERE thread_id=? ORDER BY rowid').all(id),
    events: id => db.prepare('SELECT * FROM events WHERE thread_id=? ORDER BY id').all(id)
      .map(event => ({ ...event, payload: JSON.parse(event.payload) })),
    event(type, payload, runId = null, threadId = null) {
      const created_at = new Date().toISOString();
      const result = db.prepare('INSERT INTO events(run_id,thread_id,type,payload,created_at) VALUES(?,?,?,?,?)')
        .run(runId, threadId, type, JSON.stringify(payload), created_at);
      return { id: Number(result.lastInsertRowid), type, payload, run_id: runId, thread_id: threadId, created_at };
    },
    close: () => db.close(),
  };
}
