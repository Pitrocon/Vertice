import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { WebSocketServer } from 'ws'
import { detectRuntimes, resolveCommand, RUNTIME_CATALOG } from './runtimes.js'
import { startSession, writeToSession, resizeSession, killSession, listActiveSessions } from './sessions.js'
import {
  listSessions, listEvents, recordEvent,
  getWorkspaceSnapshot, seedInitialData,
  createProject, activateProject,
  upsertAgent, patchAgent, deleteAgent,
  createConnection, createGoal, createWorkItem, patchWorkItem,
} from './db.js'

const PORT = process.env.PORT ? Number(process.env.PORT) : 7845

const app = express()
app.use(express.json())

// CORS restrito a origens locais (frontend Vite / build)
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function broadcastSnapshot() {
  const snapshot = getWorkspaceSnapshot()
  broadcast({ type: 'workspace-updated', snapshot })
  return snapshot
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'vertice-core', version: '0.1.0' })
})

app.get('/api/runtimes', async (_req, res) => {
  res.json({ runtimes: await detectRuntimes() })
})

app.get('/api/catalog', (_req, res) => {
  res.json({ catalog: RUNTIME_CATALOG })
})

app.get('/api/workspace', (_req, res) => {
  res.json(getWorkspaceSnapshot())
})

app.post('/api/workspace/reset', (_req, res) => {
  seedInitialData(true)
  recordEvent('gerente', 'Dados iniciais restaurados no SQLite', 'system')
  res.json(broadcastSnapshot())
})

app.post('/api/projects', (req, res) => {
  const { id, name, path, description } = req.body ?? {}
  if (!name || !path) return res.status(400).json({ error: 'name e path são obrigatórios' })
  createProject({ id: id || randomUUID(), name, path, description: description ?? '' })
  recordEvent('gerente', `Projeto ${name} criado (${path})`, 'create')
  res.json(broadcastSnapshot())
})

app.post('/api/projects/:id/activate', (req, res) => {
  activateProject(req.params.id)
  recordEvent('gerente', `Projeto ativo alterado para ${req.params.id}`, 'system')
  res.json(broadcastSnapshot())
})

app.post('/api/agents', (req, res) => {
  const agent = req.body ?? {}
  if (!agent.id || !agent.name || !agent.runtime) {
    return res.status(400).json({ error: 'id, name e runtime são obrigatórios' })
  }
  upsertAgent(agent)
  if (agent.parentId) {
    createConnection({ id: randomUUID(), source: agent.parentId, target: agent.id, label: 'delega', active: false })
  }
  recordEvent(agent.parentId ?? agent.id, `${agent.name} adicionado e persistido no SQLite`, 'create')
  res.json(broadcastSnapshot())
})

app.post('/api/agents/batch', (req, res) => {
  const { agents = [], connections = [], managerUpdate, eventMessage } = req.body ?? {}
  if (managerUpdate?.id) {
    patchAgent(managerUpdate.id, managerUpdate)
  }
  for (const agent of agents) {
    if (agent.id && agent.name) upsertAgent(agent)
  }
  for (const conn of connections) {
    if (conn.source && conn.target) {
      createConnection({ id: conn.id || randomUUID(), source: conn.source, target: conn.target, label: conn.label ?? 'delega', active: Boolean(conn.active) })
    }
  }
  if (eventMessage) {
    recordEvent(managerUpdate?.id ?? 'gerente', eventMessage, 'delegate')
  }
  res.json(broadcastSnapshot())
})

app.patch('/api/agents/:id', (req, res) => {
  const ok = patchAgent(req.params.id, req.body ?? {})
  if (!ok) return res.status(404).json({ error: 'Agente não encontrado' })
  res.json(broadcastSnapshot())
})

app.delete('/api/agents/:id', (req, res) => {
  const ok = deleteAgent(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Agente não encontrado ou não pode ser removido' })
  recordEvent('gerente', `Agente ${req.params.id} removido da equipe`, 'system')
  res.json(broadcastSnapshot())
})

app.post('/api/connections', (req, res) => {
  const { id, source, target, label, active } = req.body ?? {}
  if (!source || !target) return res.status(400).json({ error: 'source e target são obrigatórios' })
  createConnection({ id: id || randomUUID(), source, target, label, active })
  recordEvent(source, `Nova conexão com ${target}`, 'system')
  res.json(broadcastSnapshot())
})

app.post('/api/goals', (req, res) => {
  const { id, title, description } = req.body ?? {}
  if (!title) return res.status(400).json({ error: 'title é obrigatório' })
  createGoal({ id: id || randomUUID(), title, description: description ?? '' })
  recordEvent('gerente', `Meta criada: ${title}`, 'create')
  res.json(broadcastSnapshot())
})

app.post('/api/work-items', (req, res) => {
  const { id, title, status, assigneeId, goalId, priority } = req.body ?? {}
  if (!title) return res.status(400).json({ error: 'title é obrigatório' })
  createWorkItem({ id: id || randomUUID(), title, status: status ?? 'todo', assigneeId, goalId, priority: priority ?? 'media' })
  recordEvent(assigneeId ?? 'gerente', `Tarefa criada: ${title}`, 'create')
  res.json(broadcastSnapshot())
})

app.patch('/api/work-items/:id', (req, res) => {
  const ok = patchWorkItem(req.params.id, req.body ?? {})
  if (!ok) return res.status(404).json({ error: 'Tarefa não encontrada' })
  res.json(broadcastSnapshot())
})

app.post('/api/sessions', async (req, res) => {
  const { agentId, runtimeId, cwd } = req.body ?? {}
  const runtime = RUNTIME_CATALOG.find((item) => item.id === runtimeId)
  if (!agentId || !runtime) return res.status(400).json({ error: 'agentId e runtimeId válidos são obrigatórios' })
  try {
    const command = await resolveCommand(runtime.command)
    const session = startSession({ agentId, command, args: runtime.sessionArgs, cwd, onEvent: broadcast })
    broadcast({ type: 'session-started', ...session })
    res.json({ session })
  } catch (error) {
    res.status(500).json({ error: `Falha ao iniciar sessão: ${error.message}` })
  }
})

app.get('/api/sessions', (_req, res) => {
  res.json({ active: listActiveSessions(), history: listSessions() })
})

app.post('/api/sessions/:id/input', (req, res) => {
  const ok = writeToSession(req.params.id, String(req.body?.data ?? ''))
  res.status(ok ? 200 : 404).json({ ok })
})

app.post('/api/sessions/:id/resize', (req, res) => {
  const ok = resizeSession(req.params.id, Number(req.body?.cols) || 120, Number(req.body?.rows) || 30)
  res.status(ok ? 200 : 404).json({ ok })
})

app.delete('/api/sessions/:id', (req, res) => {
  const ok = killSession(req.params.id)
  if (ok) broadcast({ type: 'session-ended', sessionId: req.params.id })
  res.status(ok ? 200 : 404).json({ ok })
})

app.get('/api/events', (_req, res) => {
  res.json({ events: listEvents() })
})

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function broadcast(event) {
  const payload = JSON.stringify(event)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload)
  }
}

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'hello', service: 'vertice-core', version: '0.1.0' }))
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'input' && msg.sessionId) writeToSession(msg.sessionId, String(msg.data ?? ''))
      if (msg.type === 'resize' && msg.sessionId) resizeSession(msg.sessionId, msg.cols, msg.rows)
    } catch { /* ignora mensagens inválidas */ }
  })
})

recordEvent(null, 'Serviço local do Vértice iniciado', 'system')

server.listen(PORT, () => {
  console.log(`[vertice-core] ouvindo em http://localhost:${PORT} (ws em /ws)`)
})
