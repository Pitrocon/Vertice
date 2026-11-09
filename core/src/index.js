import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import express from 'express'
import { WebSocketServer } from 'ws'
import { detectRuntimes, resolveCommand, RUNTIME_CATALOG } from './runtimes.js'
import { startSession, writeToSession, resizeSession, killSession, listActiveSessions } from './sessions.js'
import { assertAllowedCwd, assertSafeProjectPath, expandEnvVars, WorkspaceError } from './workspace.js'
import { checkRequestOrigin, isFileOrigin, isLocalHost, isLocalOrigin, tokenFromRequest } from './security.js'
import { configureOrchestrator, dispatchWorkItem, canDelegate, completeWorkItem, runtimeIdFromName } from './orchestrator.js'
import {
  listSessions, listEvents, recordEvent,
  getWorkspaceSnapshot, loadDemoData, clearWorkspaceData,
  createProject, activateProject, getProject, allowProjectWorkspace,
  upsertAgent, patchAgent, deleteAgent,
  createConnection, createGoal, createWorkItem, patchWorkItem,
  getSettings, getSetting, setSetting,
  listAllowedWorkspaces, addAllowedWorkspace, removeAllowedWorkspace,
} from './db.js'

const PORT = process.env.PORT ? Number(process.env.PORT) : 7845

const app = express()
app.use(express.json())

// Segurança de origem (ver security.js): CORS só não basta, pois POSTs simples sem corpo
// (ex.: /api/workspace/clear) chegam ao servidor mesmo quando o navegador bloqueia a leitura.
app.use((req, res, next) => {
  const origin = req.headers.origin
  // Defesa contra DNS rebinding: o Host precisa ser o do próprio localhost.
  if (!isLocalHost(req.headers.host)) return res.status(403).json({ error: 'Host não permitido.' })
  if (origin && (isLocalOrigin(origin) || (isFileOrigin(origin) && process.env.VERTICE_API_TOKEN))) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Vertice-Token')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
  }
  // Preflight não carrega o token (cabeçalhos custom não vão no OPTIONS); a checagem vale na requisição real.
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  const verdict = checkRequestOrigin({ origin, host: req.headers.host, token: tokenFromRequest(req) })
  if (!verdict.ok) return res.status(403).json({ error: verdict.reason })
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

app.post('/api/runtimes/:id/install', async (req, res) => {
  const runtime = RUNTIME_CATALOG.find((item) => item.id === req.params.id)
  if (!runtime) return res.status(404).json({ error: 'Runtime não encontrado no catálogo' })

  // Confinamento: so instala runtimes aprovados pelo TI.
  const approved = getSetting('approvedRuntimes') ?? []
  if (!approved.includes(runtime.id)) {
    return res.status(403).json({ error: `O runtime "${runtime.id}" não está aprovado pelo TI.` })
  }
  if (!runtime.install) {
    return res.status(400).json({ error: `Não há comando de instalação oficial para "${runtime.id}".` })
  }

  recordEvent('gerente', `Instalando ${runtime.name}…`, 'system')
  try {
    // Executa APENAS o comando oficial do catalogo, via PowerShell, sem input do usuario.
    await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', runtime.install], { timeout: 180000, windowsHide: true }, (error, stdout, stderr) => {
        if (error) return reject(new Error((stderr || error.message || '').slice(0, 300)))
        resolve(stdout)
      })
    })
  } catch (error) {
    recordEvent('gerente', `Falha ao instalar ${runtime.name}: ${error.message}`, 'system')
    return res.status(500).json({ error: `Falha na instalação: ${error.message}` })
  }

  // Revalida a versao apos instalar.
  const detected = (await detectRuntimes()).find((r) => r.id === runtime.id)
  recordEvent('gerente', `${runtime.name} instalado — versão ${detected?.version ?? 'desconhecida'}`, 'system')
  res.json({ runtime: detected, snapshot: broadcastSnapshot() })
})

app.get('/api/workspace', (_req, res) => {
  res.json(getWorkspaceSnapshot())
})

// Encerra todas as sessões vivas (usado ao trocar/limpar o workspace: os agentes deixam de existir).
function endAllSessions() {
  for (const session of listActiveSessions()) {
    if (killSession(session.id)) broadcast({ type: 'session-ended', sessionId: session.id })
  }
}

// Carrega os dados de DEMONSTRAÇÃO (equipe e projetos de exemplo). Preserva aprovação de CLIs/políticas.
app.post('/api/workspace/reset', (_req, res) => {
  endAllSessions()
  loadDemoData()
  recordEvent(null, 'Dados de demonstração carregados', 'system')
  res.json(broadcastSnapshot())
})

// Operar do zero: apaga projetos, agentes, conexões, metas, tarefas, workspaces e eventos.
// Mantém apenas as configurações das CLIs (settings).
app.post('/api/workspace/clear', (_req, res) => {
  endAllSessions()
  clearWorkspaceData()
  res.json(broadcastSnapshot())
})

// --- Settings (workspaces permitidos, runtimes aprovados, politicas) ------

app.get('/api/settings', (_req, res) => {
  res.json({ settings: getSettings(), allowedWorkspaces: listAllowedWorkspaces() })
})

app.patch('/api/settings', (req, res) => {
  const { approvedRuntimes, policies } = req.body ?? {}
  if (approvedRuntimes !== undefined) {
    if (!Array.isArray(approvedRuntimes)) return res.status(400).json({ error: 'approvedRuntimes deve ser uma lista' })
    setSetting('approvedRuntimes', approvedRuntimes)
  }
  if (policies !== undefined) {
    if (typeof policies !== 'object' || policies === null) return res.status(400).json({ error: 'policies deve ser um objeto' })
    setSetting('policies', policies)
  }
  recordEvent('gerente', 'Políticas/aprovações atualizadas', 'system')
  res.json(broadcastSnapshot())
})

app.post('/api/settings/workspaces', (req, res) => {
  const { id, path } = req.body ?? {}
  if (!path) return res.status(400).json({ error: 'path é obrigatório' })
  addAllowedWorkspace({ id: id || randomUUID(), path })
  recordEvent('gerente', `Workspace permitido adicionado: ${path}`, 'system')
  res.json(broadcastSnapshot())
})

app.delete('/api/settings/workspaces/:id', (req, res) => {
  removeAllowedWorkspace(req.params.id)
  recordEvent('gerente', `Workspace permitido removido: ${req.params.id}`, 'system')
  res.json(broadcastSnapshot())
})

// Criar projeto: o workspace do projeto passa a ser um workspace permitido (após validação de
// segurança do caminho) e o primeiro projeto já nasce ativo.
app.post('/api/projects', (req, res) => {
  const { id, name, path, description } = req.body ?? {}
  if (!name || !path) return res.status(400).json({ error: 'name e path são obrigatórios' })
  let safePath
  try {
    safePath = assertSafeProjectPath(expandEnvVars(String(path).trim()))
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    return res.status(500).json({ error: `Falha ao validar o caminho: ${error.message}` })
  }
  const projectId = id || randomUUID()
  createProject({ id: projectId, name, path: safePath, description: description ?? '' })
  allowProjectWorkspace({ id: projectId, path: safePath })
  recordEvent(null, `Projeto ${name} criado (${safePath})`, 'create')
  res.json(broadcastSnapshot())
})

app.post('/api/projects/:id/activate', (req, res) => {
  const project = getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' })
  try {
    allowProjectWorkspace({ id: project.id, path: assertSafeProjectPath(project.path) })
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    return res.status(500).json({ error: `Falha ao validar o caminho: ${error.message}` })
  }
  activateProject(project.id)
  recordEvent(null, `Projeto ativo alterado para ${project.name}`, 'system')
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

// Resolve o cwd efetivo: o informado, senao o do projeto ativo.
function resolveSessionCwd(requestedCwd) {
  if (requestedCwd && requestedCwd.trim() !== '') return requestedCwd
  const snapshot = getWorkspaceSnapshot()
  const active = snapshot.projects.find((p) => p.active) ?? snapshot.projects[0]
  return active?.path ?? ''
}

// --- Orquestracao real (Bloco B) -----------------------------------------

// B2: despachar uma tarefa para a sessao real do agente responsavel.
app.post('/api/work-items/:id/dispatch', async (req, res) => {
  try {
    const result = await dispatchWorkItem(req.params.id)
    res.json({ ...result, snapshot: getWorkspaceSnapshot() })
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    res.status(400).json({ error: error.message })
  }
})

// B3 (manual por ora): marcar conclusao de uma tarefa (review/failed) com resultado.
app.post('/api/work-items/:id/complete', async (req, res) => {
  const { result, error } = req.body ?? {}
  const out = await completeWorkItem(req.params.id, { result, error })
  res.json({ ...out, snapshot: getWorkspaceSnapshot() })
})

// B5: Gerente real cria subagentes + conexoes + tarefas a partir de um objetivo.
// Espera { managerId, objective, team: [{ name, role, runtime, model, prompt }], maxAgents }.
app.post('/api/orchestrator/delegate', (req, res) => {
  const { managerId = 'gerente', objective, team = [], maxAgents = 12 } = req.body ?? {}
  if (!objective || typeof objective !== 'string') {
    return res.status(400).json({ error: 'objective é obrigatório' })
  }
  const snapshot = getWorkspaceSnapshot()
  const manager = snapshot.agents.find((a) => a.id === managerId)
  // Operação do zero: sem NENHUM gerente, o Gerente padrão é criado (depois de validar o time).
  const needsManager = !manager
  if (needsManager && snapshot.agents.some((a) => a.kind === 'manager')) {
    return res.status(404).json({ error: 'Gerente não encontrado' })
  }

  // Validacao: runtime de cada subagente precisa estar aprovado; respeitar limite.
  const approved = getSetting('approvedRuntimes') ?? []
  const currentWorkers = snapshot.agents.filter((a) => a.kind === 'worker').length
  if (currentWorkers + team.length > maxAgents) {
    return res.status(400).json({ error: `Limite de ${maxAgents} agentes excedido.` })
  }
  for (const member of team) {
    const rid = runtimeIdFromName(member.runtime)
    if (!rid) {
      return res.status(400).json({ error: `Runtime "${member.runtime}" do subagente ${member.name} não existe no catálogo.` })
    }
    if (!approved.includes(rid)) {
      return res.status(403).json({ error: `Runtime "${member.runtime}" do subagente ${member.name} não está aprovado.` })
    }
  }

  if (needsManager) {
    upsertAgent({
      id: managerId, name: 'Gerente', role: 'Orquestrador principal', kind: 'manager',
      runtime: 'Claude Code', model: 'claude-sonnet', status: 'idle', task: 'Aguardando objetivo',
      prompt: 'Coordene a equipe, divida objetivos em tarefas e crie especialistas quando necessário.',
      x: 280, y: 0,
    })
    recordEvent(managerId, 'Gerente criado automaticamente para receber o objetivo', 'create')
  }

  // Cria subagentes reais + conexoes manager->sub + uma tarefa por subagente.
  const stamp = Date.now().toString(36)
  const created = []
  team.forEach((member, index) => {
    const id = `${(member.name || 'agente').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}-${index}`
    upsertAgent({
      id, name: member.name, role: member.role ?? 'Subagente', kind: 'worker',
      runtime: member.runtime, model: member.model ?? 'local/default',
      status: 'idle', task: 'Aguardando despacho', progress: 0,
      prompt: member.prompt ?? `Contribua para o objetivo: ${objective}`,
      x: 40 + ((currentWorkers + index) % 3) * 315, y: 580 + Math.floor((currentWorkers + index) / 3) * 195,
      createdBy: managerId,
    })
    createConnection({ id: randomUUID(), source: managerId, target: id, label: 'delega', active: false })
    const taskId = randomUUID()
    createWorkItem({ id: taskId, title: `${member.role ?? member.name}: ${objective}`, status: 'todo', assigneeId: id, createdBy: managerId })
    created.push({ agentId: id, taskId })
  })
  recordEvent(managerId, `Gerente criou ${team.length} subagente(s) real(is) para: ${objective}`, 'delegate')
  res.json({ ok: true, created, snapshot: broadcastSnapshot() })
})

app.post('/api/sessions', async (req, res) => {
  const { agentId, runtimeId, cwd } = req.body ?? {}
  const runtime = RUNTIME_CATALOG.find((item) => item.id === runtimeId)
  if (!agentId || !runtime) return res.status(400).json({ error: 'agentId e runtimeId válidos são obrigatórios' })

  // Confinamento: runtime precisa estar aprovado.
  const approved = getSetting('approvedRuntimes') ?? []
  if (!approved.includes(runtimeId)) {
    return res.status(403).json({ error: `O runtime "${runtimeId}" não está aprovado pelo TI.` })
  }

  // Confinamento: cwd precisa estar dentro de um workspace permitido.
  let safeCwd
  try {
    const requested = resolveSessionCwd(cwd)
    if (!requested) {
      return res.status(400).json({ error: 'Nenhum projeto ativo. Crie um projeto na aba Projects antes de iniciar uma sessão.' })
    }
    safeCwd = assertAllowedCwd(requested, listAllowedWorkspaces())
    // Cria o diretorio do workspace se ainda nao existir (ja validado como seguro).
    mkdirSync(safeCwd, { recursive: true })
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    return res.status(500).json({ error: `Falha ao validar o diretório: ${error.message}` })
  }

  try {
    const command = await resolveCommand(runtime.command)
    const session = startSession({ agentId, command, args: runtime.sessionArgs, cwd: safeCwd, onEvent: broadcast })
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
// WebSocket não passa por CORS: sem esta checagem, qualquer site aberto no navegador poderia ouvir a
// saída dos terminais (que inclui o id da sessão) e enviar input a elas.
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: (info) => checkRequestOrigin({
    origin: info.origin || undefined,
    host: info.req.headers.host,
    token: tokenFromRequest(info.req),
  }).ok,
})

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

configureOrchestrator({ broadcast })

// Inicia o servidor HTTP+WS. Exportado para o processo main do Electron poder
// subir o core in-process; também é chamado automaticamente no modo standalone
// (node src/index.js) via a checagem de entrypoint abaixo.
export function startCore({ port = PORT } = {}) {
  recordEvent(null, 'Serviço local do Vértice iniciado', 'system')
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[vertice-core] ouvindo em http://localhost:${port} (ws em /ws)`)
      resolve(server)
    })
  })
}

export { server, PORT }

// Auto-start no modo standalone (node src/index.js), mas não quando importado.
const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainEntry) {
  startCore()
}


