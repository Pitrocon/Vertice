import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data')
mkdirSync(dataDir, { recursive: true })

const db = new DatabaseSync(join(dataDir, 'vertice.db'))

db.exec(`
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

const INITIAL_PROJECTS = [
  { id: 'proj-atlas', name: 'Atlas', path: 'C:\\work\\atlas', description: 'Projeto principal do Vértice — orquestrador local de agentes.', active: 1 },
  { id: 'proj-intranet', name: 'Intranet', path: 'C:\\work\\intranet', description: 'Portal interno da empresa e distribuição da ferramenta.', active: 0 },
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

export function seedInitialData(force = false) {
  if (force) {
    db.exec(`
      DELETE FROM projects;
      DELETE FROM agents;
      DELETE FROM connections;
      DELETE FROM goals;
      DELETE FROM work_items;
    `)
  }
  const projectCount = db.prepare('SELECT COUNT(*) AS count FROM projects').get().count
  if (projectCount === 0) {
    const stmt = db.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
    for (const p of INITIAL_PROJECTS) stmt.run(p.id, p.name, p.path, p.description, p.active)
  }
  const agentCount = db.prepare('SELECT COUNT(*) AS count FROM agents').get().count
  if (agentCount === 0) {
    const stmt = db.prepare('INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const a of INITIAL_AGENTS) stmt.run(a.id, a.name, a.role, a.kind, a.runtime, a.model, a.status, a.task, a.progress, a.prompt, a.x, a.y, a.createdBy)
  }
  const connCount = db.prepare('SELECT COUNT(*) AS count FROM connections').get().count
  if (connCount === 0) {
    const stmt = db.prepare('INSERT INTO connections (id, source, target, label, active) VALUES (?, ?, ?, ?, ?)')
    for (const c of INITIAL_CONNECTIONS) stmt.run(c.id, c.source, c.target, c.label, c.active)
  }
  const goalCount = db.prepare('SELECT COUNT(*) AS count FROM goals').get().count
  if (goalCount === 0) {
    const stmt = db.prepare('INSERT INTO goals (id, title, description) VALUES (?, ?, ?)')
    for (const g of INITIAL_GOALS) stmt.run(g.id, g.title, g.description)
  }
  const wiCount = db.prepare('SELECT COUNT(*) AS count FROM work_items').get().count
  if (wiCount === 0) {
    const stmt = db.prepare('INSERT INTO work_items (id, title, status, assignee_id, goal_id, priority) VALUES (?, ?, ?, ?, ?, ?)')
    for (const w of INITIAL_WORK_ITEMS) stmt.run(w.id, w.title, w.status, w.assigneeId, w.goalId, w.priority)
  }
}

seedInitialData(false)

function mapProject(row) {
  return { id: row.id, name: row.name, path: row.path, description: row.description, active: Boolean(row.active) }
}

function mapAgent(row) {
  return {
    id: row.id, name: row.name, role: row.role, kind: row.kind,
    runtime: row.runtime, model: row.model, status: row.status,
    task: row.task, progress: Number(row.progress), prompt: row.prompt,
    x: Number(row.x), y: Number(row.y),
    ...(row.created_by ? { createdBy: row.created_by } : {}),
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

export function getWorkspaceSnapshot() {
  return {
    projects: db.prepare('SELECT * FROM projects').all().map(mapProject),
    agents: db.prepare('SELECT * FROM agents').all().map(mapAgent),
    connections: db.prepare('SELECT * FROM connections').all().map(mapConnection),
    goals: db.prepare('SELECT * FROM goals').all().map(mapGoal),
    workItems: db.prepare('SELECT * FROM work_items').all().map(mapWorkItem),
    events: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 20').all().map(mapEvent),
  }
}

export function createProject({ id, name, path, description }) {
  db.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, 0)')
    .run(id, name, path, description ?? '')
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
  if (!current || current.kind === 'manager') return false
  db.prepare('DELETE FROM connections WHERE source = ? OR target = ?').run(id, id)
  db.prepare('DELETE FROM agents WHERE id = ?').run(id)
  return true
}

export function createConnection({ id, source, target, label, active }) {
  db.prepare('INSERT OR REPLACE INTO connections (id, source, target, label, active) VALUES (?, ?, ?, ?, ?)')
    .run(id, source, target, label ?? 'vincula', active ? 1 : 0)
}

export function createGoal({ id, title, description }) {
  db.prepare('INSERT INTO goals (id, title, description) VALUES (?, ?, ?)')
    .run(id, title, description ?? '')
}

export function createWorkItem({ id, title, status, assigneeId, goalId, priority }) {
  db.prepare('INSERT INTO work_items (id, title, status, assignee_id, goal_id, priority) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, title, status ?? 'todo', assigneeId ?? null, goalId ?? null, priority ?? 'media')
}

export function patchWorkItem(id, { status, assigneeId, goalId, priority, title }) {
  const current = db.prepare('SELECT * FROM work_items WHERE id = ?').get(id)
  if (!current) return false
  db.prepare(`
    UPDATE work_items
    SET title = ?, status = ?, assignee_id = ?, goal_id = ?, priority = ?
    WHERE id = ?
  `).run(
    title ?? current.title,
    status ?? current.status,
    assigneeId !== undefined ? assigneeId : current.assignee_id,
    goalId !== undefined ? goalId : current.goal_id,
    priority ?? current.priority,
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
