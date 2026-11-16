import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const V1_APPROVED_RUNTIMES = ['claude', 'codex', 'kimi', 'powershell']
const V5_APPROVED_RUNTIMES = ['claude', 'codex', 'kimi', 'glm', 'antigravity', 'opencode', 'ollama', 'lmstudio', 'powershell']
const DEFAULT_POLICIES = { allowDestructiveCommands: false, allowNetwork: true, allowCredentials: false }

/**
 * Cria um `vertice.db` em `dir` reproduzindo o schema exato de `core/src/db.js`
 * para a versão informada (`1` a `7`), incluindo `meta.schema_version`.
 * Fecha a conexão antes de retornar o caminho do arquivo criado.
 */
export function buildLegacyDb(dir, version) {
  if (!Number.isInteger(version) || version < 1 || version > 7) {
    throw new RangeError(`Versão legada inválida: ${version}. Use um inteiro entre 1 e 7.`)
  }
  mkdirSync(dir, { recursive: true })
  const dbPath = join(dir, 'vertice.db')
  const legacyDb = new DatabaseSync(dbPath)
  try {
    // DDL base (equivalente ao schema inicial antes de v3..v7).
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'worker',
        runtime TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        task TEXT NOT NULL DEFAULT '',
        progress INTEGER NOT NULL DEFAULT 0,
        prompt TEXT NOT NULL DEFAULT '',
        x REAL NOT NULL DEFAULT 0,
        y REAL NOT NULL DEFAULT 0,
        created_by TEXT
      );
      CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        label TEXT,
        active INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        assignee_id TEXT,
        goal_id TEXT,
        priority TEXT NOT NULL DEFAULT 'media'
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS allowed_workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL
      );
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

    const approved = version >= 5 ? V5_APPROVED_RUNTIMES : V1_APPROVED_RUNTIMES
    const insertSetting = legacyDb.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    insertSetting.run('approvedRuntimes', JSON.stringify(approved))
    insertSetting.run('policies', JSON.stringify(DEFAULT_POLICIES))

    if (version >= 3) {
      legacyDb.exec(`
        ALTER TABLE work_items ADD COLUMN parent_task_id TEXT;
        ALTER TABLE work_items ADD COLUMN depends_on TEXT;
        ALTER TABLE work_items ADD COLUMN result TEXT;
        ALTER TABLE work_items ADD COLUMN error TEXT;
        ALTER TABLE work_items ADD COLUMN created_by TEXT;
        ALTER TABLE work_items ADD COLUMN created_at TEXT;
        ALTER TABLE work_items ADD COLUMN updated_at TEXT;
      `)
    }

    if (version >= 4) {
      legacyDb.exec(`
        ALTER TABLE agents ADD COLUMN memory TEXT;
        ALTER TABLE agents ADD COLUMN last_transcript TEXT;
      `)
    }

    if (version >= 5) {
      legacyDb.exec(`
        ALTER TABLE work_items ADD COLUMN description TEXT NOT NULL DEFAULT '';
      `)
    }

    if (version >= 6) {
      legacyDb.exec(`
        ALTER TABLE connections ADD COLUMN source_handle TEXT;
        ALTER TABLE connections ADD COLUMN target_handle TEXT;
      `)
    }

    if (version >= 7) {
      for (const table of ['agents', 'connections', 'goals', 'work_items']) {
        legacyDb.exec(`
          ALTER TABLE ${table} ADD COLUMN project_id TEXT;
          CREATE INDEX IF NOT EXISTS idx_${table}_project ON ${table}(project_id);
        `)
      }
    }

    legacyDb.prepare(`
      INSERT INTO meta (key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(version))
  } finally {
    legacyDb.close()
  }
  return dbPath
}
