import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'vertice.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    command TEXT NOT NULL,
    cwd TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT,
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'system',
    created_at TEXT NOT NULL
  );
`)

export function recordSession(session) {
  db.prepare('INSERT INTO sessions (id, agent_id, command, cwd, status, started_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(session.id, session.agentId, session.command, session.cwd, 'running', new Date().toISOString())
}

export function endSession(id) {
  db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id)
}

export function listSessions() {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT 50').all()
}

export function recordEvent(agentId, message, type = 'system') {
  db.prepare('INSERT INTO events (agent_id, message, type, created_at) VALUES (?, ?, ?, ?)')
    .run(agentId, message, type, new Date().toISOString())
}

export function listEvents() {
  return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 50').all()
}
