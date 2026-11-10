import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

// Diretório de dados do SQLite. No modo empacotado (Electron), o processo main
// aponta VERTICE_DATA_DIR para app.getPath('userData') para que o banco fique
// em %APPDATA%\Vertice e não dentro dos arquivos de programa (read-only).
const dataDir = process.env.VERTICE_DATA_DIR
  ? process.env.VERTICE_DATA_DIR
  : join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'vertice.db'))

// Workspace padrao realista e criavel (substitui o antigo C:\work\atlas inexistente).
// Resolvido em runtime a partir do perfil do usuario, nunca hardcode de um usuario especifico.
const DEFAULT_WORKSPACE_ROOT = join(homedir(), 'vertice-workspaces')
const DEFAULT_ATLAS_PATH = join(DEFAULT_WORKSPACE_ROOT, 'atlas')
const DEFAULT_INTRANET_PATH = join(DEFAULT_WORKSPACE_ROOT, 'intranet')

db.exec(`
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

// ---------------------------------------------------------------------------
// Migracoes idempotentes baseadas em meta.schema_version. Nunca apagam dados.
// ---------------------------------------------------------------------------
const SCHEMA_VERSION = 4

function getSchemaVersion() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()
  return row ? Number(row.value) : 0
}

function setSchemaVersion(version) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(version))
}

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  return cols.some((c) => c.name === column)
}

const DEFAULT_SETTINGS = {
  approvedRuntimes: ['claude', 'codex', 'kimi', 'powershell'],
  policies: { allowDestructiveCommands: false, allowNetwork: true, allowCredentials: false },
}

// Garante APENAS as configurações das CLIs (runtimes aprovados e políticas).
// Um banco novo começa LIMPO: nenhum projeto, agente, tarefa nem workspace permitido.
function seedSettings() {
  const settingsCount = db.prepare('SELECT COUNT(*) AS count FROM settings').get().count
  if (settingsCount === 0) {
    const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    stmt.run('approvedRuntimes', JSON.stringify(DEFAULT_SETTINGS.approvedRuntimes))
    stmt.run('policies', JSON.stringify(DEFAULT_SETTINGS.policies))
  }
}

function runMigrations() {
  const current = getSchemaVersion()

  // v1 -> introducao das tabelas settings e allowed_workspaces + seed.
  if (current < 1) {
    seedSettings()
  }

  // v2 -> corrigir projetos legados que ainda apontam para C:\work\* inexistente.
  if (current < 2) {
    const legacy = db.prepare("SELECT id, path FROM projects WHERE path LIKE 'C:\\work\\%'").all()
    for (const proj of legacy) {
      const fixed = proj.id === 'proj-intranet' ? DEFAULT_INTRANET_PATH : DEFAULT_ATLAS_PATH
      db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(fixed, proj.id)
    }
  }

  // v3 (Bloco B1) -> expandir work_items para orquestracao real (sem perda de dados).
  if (current < 3) {
    const newCols = [
      ['parent_task_id', 'TEXT'],
      ['depends_on', 'TEXT'],
      ['result', 'TEXT'],
      ['error', 'TEXT'],
      ['created_by', 'TEXT'],
      ['created_at', 'TEXT'],
      ['updated_at', 'TEXT'],
    ]
    for (const [name, type] of newCols) {
      if (!columnExists('work_items', name)) {
        db.exec(`ALTER TABLE work_items ADD COLUMN ${name} ${type}`)
      }
    }
  }

  // v4 (E14) -> memória viva dos agentes: resumo acumulado e última conversa do terminal.
  if (current < 4) {
    for (const [name, type] of [['memory', 'TEXT'], ['last_transcript', 'TEXT']]) {
      if (!columnExists('agents', name)) db.exec(`ALTER TABLE agents ADD COLUMN ${name} ${type}`)
    }
  }

  if (current < SCHEMA_VERSION) setSchemaVersion(SCHEMA_VERSION)
}

const INITIAL_PROJECTS = [
  { id: 'proj-atlas', name: 'Atlas', path: DEFAULT_ATLAS_PATH, description: 'Projeto principal do Vértice — orquestrador local de agentes.', active: 1 },
  { id: 'proj-intranet', name: 'Intranet', path: DEFAULT_INTRANET_PATH, description: 'Portal interno da empresa e distribuição da ferramenta.', active: 0 },
]

const INITIAL_AGENTS = [
  {
    id: 'gerente', name: 'Gerente', role: 'Orquestrador principal', kind: 'manager',
    runtime: 'Claude Code', model: 'claude-sonnet', status: 'working',
    task: 'Coordenando a entrega do MVP', progress: 68,
    prompt: 'Coordene a equipe, divida objetivos em tarefas e crie especialistas quando necessário. Mantenha o contexto do workspace sincronizado.',
    x: 280, y: 0, createdBy: null,
  },
  {
    id: 'pesquisador', name: 'Pesquisador', role: 'Inteligência e referências', kind: 'worker',
    runtime: 'Ollama', model: 'qwen3:14b', status: 'idle',
    task: 'Mapeamento de referências concluído', progress: 100,
    prompt: 'Pesquise referências, compare abordagens e entregue sínteses objetivas com fontes.',
    x: 0, y: 215, createdBy: 'gerente',
  },
  {
    id: 'arquiteto', name: 'Arquiteto', role: 'Sistemas e especificação', kind: 'worker',
    runtime: 'Codex CLI', model: 'gpt-codex', status: 'working',
    task: 'Definindo contratos do orquestrador', progress: 44,
    prompt: 'Transforme objetivos em arquitetura técnica, contratos e decisões implementáveis.',
    x: 280, y: 230, createdBy: 'gerente',
  },
  {
    id: 'desenvolvedor', name: 'Desenvolvedor', role: 'Implementação', kind: 'worker',
    runtime: 'OpenCode', model: 'local/default', status: 'working',
    task: 'Implementando o shell do terminal', progress: 72,
    prompt: 'Implemente as especificações no workspace, valide o código e reporte mudanças ao Gerente.',
    x: 560, y: 215, createdBy: 'gerente',
  },
  {
    id: 'revisor', name: 'Revisor', role: 'Qualidade e verificação', kind: 'worker',
    runtime: 'Claude Code', model: 'claude-sonnet', status: 'queued',
    task: 'Aguardando pacote de implementação', progress: 12,
    prompt: 'Revise alterações, procure regressões e valide os critérios de aceite antes da entrega.',
    x: 560, y: 425, createdBy: 'gerente',
  },
]

const INITIAL_CONNECTIONS = [
  { id: 'e-g-p', source: 'gerente', target: 'pesquisador', label: 'delega', active: 0 },
  { id: 'e-g-a', source: 'gerente', target: 'arquiteto', label: 'delega', active: 1 },
  { id: 'e-g-d', source: 'gerente', target: 'desenvolvedor', label: 'delega', active: 1 },
  { id: 'e-d-r', source: 'desenvolvedor', target: 'revisor', label: 'revisa', active: 0 },
]

const INITIAL_GOALS = [
  { id: 'goal-mvp', title: 'Lançar o MVP do Vértice', description: 'Primeira versão utilizável do orquestrador local para o time de TI.' },
  { id: 'goal-onboarding', title: 'Preparar o onboarding da empresa', description: 'Materiais e políticas para os funcionários instalarem e usarem o Vértice.' },
]

const INITIAL_WORK_ITEMS = [
  { id: 'wi-1', title: 'Especificar contratos do orquestrador', status: 'doing', assigneeId: 'arquiteto', goalId: 'goal-mvp', priority: 'alta' },
  { id: 'wi-2', title: 'Implementar o shell do terminal', status: 'doing', assigneeId: 'desenvolvedor', goalId: 'goal-mvp', priority: 'alta' },
  { id: 'wi-3', title: 'Mapear referências de orquestração', status: 'done', assigneeId: 'pesquisador', goalId: 'goal-mvp', priority: 'media' },
  { id: 'wi-4', title: 'Revisar pacote de implementação', status: 'review', assigneeId: 'revisor', goalId: 'goal-mvp', priority: 'alta' },
  { id: 'wi-5', title: 'Definir política de workspaces permitidos', status: 'todo', assigneeId: 'arquiteto', goalId: 'goal-onboarding', priority: 'media' },
  { id: 'wi-6', title: 'Escrever guia de instalação das CLIs', status: 'todo', assigneeId: 'pesquisador', goalId: 'goal-onboarding', priority: 'baixa' },
]

function setWorkspaceMode(mode) {
  db.prepare(`
    INSERT INTO meta (key, value) VALUES ('workspace_mode', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(mode)
}

export function getWorkspaceMode() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'workspace_mode'").get()
  return row ? row.value : null
}

// Apaga TODOS os dados de trabalho (projetos, agentes, conexões, metas, tarefas, workspaces
// permitidos, eventos e histórico de sessões). NUNCA toca em `settings`: aprovação de CLIs e
// políticas da aba CLI's são preservadas.
export function clearWorkspaceData() {
  db.exec(`
    DELETE FROM projects;
    DELETE FROM agents;
    DELETE FROM connections;
    DELETE FROM goals;
    DELETE FROM work_items;
    DELETE FROM allowed_workspaces;
    DELETE FROM events;
    DELETE FROM sessions;
  `)
  setWorkspaceMode('clean')
}

// Carrega os dados de DEMONSTRAÇÃO (equipe, projetos, metas e tarefas de exemplo). Só roda sob
// pedido explícito (POST /api/workspace/reset). Substitui os dados de trabalho; preserva `settings`.
export function loadDemoData() {
  clearWorkspaceData()
  const projectStmt = db.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
  for (const p of INITIAL_PROJECTS) projectStmt.run(p.id, p.name, p.path, p.description, p.active)
  const agentStmt = db.prepare('INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const a of INITIAL_AGENTS) agentStmt.run(a.id, a.name, a.role, a.kind, a.runtime, a.model, a.status, a.task, a.progress, a.prompt, a.x, a.y, a.createdBy)
  const connStmt = db.prepare('INSERT INTO connections (id, source, target, label, active) VALUES (?, ?, ?, ?, ?)')
  for (const c of INITIAL_CONNECTIONS) connStmt.run(c.id, c.source, c.target, c.label, c.active)
  const goalStmt = db.prepare('INSERT INTO goals (id, title, description) VALUES (?, ?, ?)')
  for (const g of INITIAL_GOALS) goalStmt.run(g.id, g.title, g.description)
  const wiStmt = db.prepare('INSERT INTO work_items (id, title, status, assignee_id, goal_id, priority) VALUES (?, ?, ?, ?, ?, ?)')
  for (const w of INITIAL_WORK_ITEMS) wiStmt.run(w.id, w.title, w.status, w.assigneeId, w.goalId, w.priority)
  const wsStmt = db.prepare('INSERT INTO allowed_workspaces (id, path) VALUES (?, ?)')
  wsStmt.run('ws-atlas', DEFAULT_ATLAS_PATH)
  wsStmt.run('ws-intranet', DEFAULT_INTRANET_PATH)
  setWorkspaceMode('demo')
}

// Processos PTY não sobrevivem ao fechamento do programa. Se ele foi fechado com agentes trabalhando,
// o banco ainda os mostraria como "working" e sessões como "running", sem nenhum processo por trás.
function recoverFromUnexpectedShutdown() {
  db.prepare("UPDATE agents SET status = 'idle', task = '' WHERE status = 'working'").run()
  db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE status = 'running'").run(new Date().toISOString())
}

// Boot: NÃO repovoa dados de demonstração. Só garante as configurações das CLIs.
runMigrations()
recoverFromUnexpectedShutdown()
seedSettings()
if (getWorkspaceMode() === null) {
  // Banco criado por versão anterior: classifica pelo conteúdo, sem alterar nenhum dado.
  const hasData = db.prepare('SELECT COUNT(*) AS count FROM projects').get().count > 0
    || db.prepare('SELECT COUNT(*) AS count FROM agents').get().count > 0
  setWorkspaceMode(hasData ? 'demo' : 'clean')
}

function mapProject(row) {
  return { id: row.id, name: row.name, path: row.path, description: row.description, active: Boolean(row.active) }
}

// `transcript`: inclui a última conversa do terminal (até ~15 mil caracteres por agente). Só vai no
// GET /api/workspace; os broadcasts de snapshot a omitem para não reenviar centenas de KB a cada mutação.
function mapAgent(row, { transcript = false } = {}) {
  return {
    id: row.id, name: row.name, role: row.role, kind: row.kind,
    runtime: row.runtime, model: row.model, status: row.status,
    task: row.task, progress: Number(row.progress), prompt: row.prompt,
    x: Number(row.x), y: Number(row.y),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    ...(row.memory ? { memory: row.memory } : {}),
    ...(transcript && row.last_transcript ? { lastTranscript: row.last_transcript } : {}),
  }
}

function mapConnection(row) {
  return {
    id: row.id, source: row.source, target: row.target,
    ...(row.label ? { label: row.label } : {}),
    active: Boolean(row.active),
  }
}

function mapGoal(row) {
  return { id: row.id, title: row.title, description: row.description }
}

function mapWorkItem(row) {
  return {
    id: row.id, title: row.title, status: row.status, priority: row.priority,
    ...(row.assignee_id ? { assigneeId: row.assignee_id } : {}),
    ...(row.goal_id ? { goalId: row.goal_id } : {}),
    ...(row.parent_task_id ? { parentTaskId: row.parent_task_id } : {}),
    ...(row.depends_on ? { dependsOn: JSON.parse(row.depends_on) } : {}),
    ...(row.result ? { result: row.result } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
    ...(row.created_at ? { createdAt: row.created_at } : {}),
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
  }
}

function mapEvent(row) {
  return {
    id: String(row.id),
    agentId: row.agent_id ?? 'gerente',
    message: row.message,
    time: new Date(row.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    type: row.type,
  }
}

// --- Settings e allowed_workspaces ---------------------------------------

function parseSettingValue(raw) {
  try { return JSON.parse(raw) } catch { return raw }
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? parseSettingValue(row.value) : null
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const out = {}
  for (const row of rows) out[row.key] = parseSettingValue(row.value)
  return out
}

export function setSetting(key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, serialized)
}

export function listAllowedWorkspaces() {
  return db.prepare('SELECT id, path FROM allowed_workspaces').all().map((row) => ({ id: row.id, path: row.path }))
}

export function addAllowedWorkspace({ id, path }) {
  db.prepare('INSERT OR REPLACE INTO allowed_workspaces (id, path) VALUES (?, ?)').run(id, path)
}

export function removeAllowedWorkspace(id) {
  db.prepare('DELETE FROM allowed_workspaces WHERE id = ?').run(id)
}

export function getWorkspaceSnapshot({ transcripts = false } = {}) {
  return {
    projects: db.prepare('SELECT * FROM projects').all().map(mapProject),
    agents: db.prepare('SELECT * FROM agents').all().map((row) => mapAgent(row, { transcript: transcripts })),
    connections: db.prepare('SELECT * FROM connections').all().map(mapConnection),
    goals: db.prepare('SELECT * FROM goals').all().map(mapGoal),
    workItems: db.prepare('SELECT * FROM work_items').all().map(mapWorkItem),
    events: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 20').all().map(mapEvent),
    settings: getSettings(),
    allowedWorkspaces: listAllowedWorkspaces(),
  }
}

// O primeiro projeto criado (quando não há nenhum ativo) já nasce ativo.
export function createProject({ id, name, path, description }) {
  const hasActive = db.prepare('SELECT COUNT(*) AS count FROM projects WHERE active = 1').get().count > 0
  db.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
    .run(id, name, path, description ?? '', hasActive ? 0 : 1)
}

export function getProject(id) {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  return row ? mapProject(row) : null
}

// Registra o path do projeto em allowed_workspaces (idempotente) para o confinamento
// (assertAllowedCwd) autorizar o diretório. O CHAMADOR deve validar o path antes.
export function allowProjectWorkspace({ id, path }) {
  const norm = (p) => p.replace(/[\\/]+$/, '').toLowerCase()
  if (listAllowedWorkspaces().some((w) => norm(w.path) === norm(path))) return false
  addAllowedWorkspace({ id: `ws-${id}`, path })
  return true
}

export function activateProject(id) {
  db.prepare('UPDATE projects SET active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id)
}

export function upsertAgent(agent) {
  db.prepare(`
    INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      role = excluded.role,
      kind = excluded.kind,
      runtime = excluded.runtime,
      model = excluded.model,
      status = excluded.status,
      task = excluded.task,
      progress = excluded.progress,
      prompt = excluded.prompt,
      x = excluded.x,
      y = excluded.y,
      created_by = excluded.created_by
  `).run(
    agent.id, agent.name, agent.role, agent.kind ?? 'worker',
    agent.runtime, agent.model, agent.status ?? 'idle',
    agent.task ?? '', agent.progress ?? 0, agent.prompt ?? '',
    agent.x ?? 0, agent.y ?? 0, agent.createdBy ?? null
  )
}

export function patchAgent(id, fields) {
  const current = db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
  if (!current) return false
  const merged = { ...mapAgent(current), ...fields }
  upsertAgent(merged)
  return true
}

export function deleteAgent(id) {
  const current = db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
  if (!current) return false
  db.prepare('DELETE FROM connections WHERE source = ? OR target = ?').run(id, id)
  // Quem era subordinado fica sem supervisor; tarefas do agente ficam sem responsável (não somem).
  db.prepare('UPDATE agents SET created_by = NULL WHERE created_by = ?').run(id)
  db.prepare('UPDATE work_items SET assignee_id = NULL WHERE assignee_id = ?').run(id)
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  return true
}

// --- E14: memória viva, edição e exclusão ---------------------------------------------------------

const MAX_MEMORY_CHARS = 8000

export function getAgent(id, { transcript = true } = {}) {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id)
  return row ? mapAgent(row, { transcript }) : null
}

export function getAgentTranscript(id) {
  const row = db.prepare('SELECT last_transcript FROM agents WHERE id = ?').get(id)
  return row ? (row.last_transcript ?? '') : null
}

export function setAgentTranscript(id, text) {
  db.prepare('UPDATE agents SET last_transcript = ? WHERE id = ?').run(text ?? '', id)
}

export function setAgentMemory(id, text) {
  const value = String(text ?? '').slice(-MAX_MEMORY_CHARS)
  return db.prepare('UPDATE agents SET memory = ? WHERE id = ?').run(value, id).changes > 0
}

export function appendAgentMemory(id, entry) {
  const row = db.prepare('SELECT memory FROM agents WHERE id = ?').get(id)
  if (!row) return false
  const next = ((row.memory ? row.memory + '\n' : '') + entry).slice(-MAX_MEMORY_CHARS)
  db.prepare('UPDATE agents SET memory = ? WHERE id = ?').run(next, id)
  return true
}

export function clearAgentMemory(id) {
  return db.prepare("UPDATE agents SET memory = '', last_transcript = '' WHERE id = ?").run(id).changes > 0
}

// Trocar o supervisor sem criar ciclo no organograma (um agente nunca pode ficar abaixo de si mesmo).
export function wouldCreateCycle(agentId, parentId) {
  let cursor = parentId
  for (let steps = 0; cursor && steps < 100; steps += 1) {
    if (cursor === agentId) return true
    cursor = db.prepare('SELECT created_by FROM agents WHERE id = ?').get(cursor)?.created_by
  }
  return false
}

export function setAgentParent(agentId, parentId, connectionId) {
  const current = db.prepare('SELECT created_by FROM agents WHERE id = ?').get(agentId)
  if (!current) return false
  if (current.created_by) {
    db.prepare('DELETE FROM connections WHERE source = ? AND target = ?').run(current.created_by, agentId)
  }
  db.prepare('UPDATE agents SET created_by = ? WHERE id = ?').run(parentId || null, agentId)
  if (parentId) {
    db.prepare('INSERT OR REPLACE INTO connections (id, source, target, label, active) VALUES (?, ?, ?, ?, 0)')
      .run(connectionId, parentId, agentId, 'delega')
  }
  return true
}

export function deleteWorkItem(id) {
  db.prepare('UPDATE work_items SET parent_task_id = NULL WHERE parent_task_id = ?').run(id)
  return db.prepare('DELETE FROM work_items WHERE id = ?').run(id).changes > 0
}

export function patchGoal(id, { title, description }) {
  const current = db.prepare('SELECT * FROM goals WHERE id = ?').get(id)
  if (!current) return false
  db.prepare('UPDATE goals SET title = ?, description = ? WHERE id = ?')
    .run(title ?? current.title, description ?? current.description, id)
  return true
}

// Excluir uma meta não apaga as tarefas dela: elas só deixam de ter meta.
export function deleteGoal(id) {
  db.prepare('UPDATE work_items SET goal_id = NULL WHERE goal_id = ?').run(id)
  return db.prepare('DELETE FROM goals WHERE id = ?').run(id).changes > 0
}

export function patchProject(id, { name, path, description }) {
  const current = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!current) return false
  db.prepare('UPDATE projects SET name = ?, path = ?, description = ? WHERE id = ?')
    .run(name ?? current.name, path ?? current.path, description ?? current.description, id)
  return true
}

// Remove o projeto (os ARQUIVOS no disco não são tocados). Se era o ativo e sobrou outro, ativa o primeiro.
export function deleteProject(id) {
  const current = db.prepare('SELECT * FROM projects WHERE id = ?').get(id)
  if (!current) return false
  db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  if (current.active) {
    const next = db.prepare('SELECT id FROM projects ORDER BY rowid LIMIT 1').get()
    if (next) db.prepare('UPDATE projects SET active = CASE WHEN id = ? THEN 1 ELSE 0 END').run(next.id)
  }
  return true
}

// Libera o workspace permitido que ESTE projeto criou (ws-<id>). Entradas criadas pela TI na aba CLI's
// ou usadas por outro projeto não são tocadas.
export function releaseProjectWorkspace(projectId) {
  db.prepare('DELETE FROM allowed_workspaces WHERE id = ?').run(`ws-${projectId}`)
}

export function createConnection({ id, source, target, label, active }) {
  db.prepare('INSERT OR REPLACE INTO connections (id, source, target, label, active) VALUES (?, ?, ?, ?, ?)')
    .run(id, source, target, label ?? 'vincula', active ? 1 : 0)
}

export function createGoal({ id, title, description }) {
  db.prepare('INSERT INTO goals (id, title, description) VALUES (?, ?, ?)')
    .run(id, title, description ?? '')
}

export function createWorkItem({ id, title, status, assigneeId, goalId, priority, parentTaskId, dependsOn, createdBy }) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO work_items (id, title, status, assignee_id, goal_id, priority, parent_task_id, depends_on, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title, status ?? 'todo', assigneeId ?? null, goalId ?? null, priority ?? 'media',
    parentTaskId ?? null,
    dependsOn ? JSON.stringify(dependsOn) : null,
    createdBy ?? null, now, now
  )
}

export function patchWorkItem(id, { status, assigneeId, goalId, priority, title, result, error }) {
  const current = db.prepare('SELECT * FROM work_items WHERE id = ?').get(id)
  if (!current) return false
  db.prepare(`
    UPDATE work_items
    SET title = ?, status = ?, assignee_id = ?, goal_id = ?, priority = ?, result = ?, error = ?, updated_at = ?
    WHERE id = ?
  `).run(
    title ?? current.title,
    status ?? current.status,
    assigneeId !== undefined ? assigneeId : current.assignee_id,
    goalId !== undefined ? goalId : current.goal_id,
    priority ?? current.priority,
    result !== undefined ? result : current.result,
    error !== undefined ? error : current.error,
    new Date().toISOString(),
    id
  )
  return true
}

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



