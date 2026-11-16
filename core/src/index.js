import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import express from 'express'
import { WebSocketServer } from 'ws'
import { detectRuntimes, RUNTIME_CATALOG, syncUserCliPath } from './runtimes.js'
import { writeToSession, resizeSession, killSession, listActiveSessions } from './sessions.js'
import { assertSafeProjectPath, expandEnvVars, WorkspaceError } from './workspace.js'
import { checkRequestOrigin, isFileOrigin, isLocalHost, isLocalOrigin, tokenFromRequest } from './security.js'
import { describePolicyEffects, mergePolicyPatch } from './policies.js'
import {
  configureOrchestrator, dispatchWorkItem, completeWorkItem, runtimeIdFromName,
  launchAgentSession, flushAgentTranscript, clearAgentSession,
  syncMemoryFile, syncAllMemoryFiles, flushTranscripts, forgetAgentTranscript, forgetAllTranscripts, onWorkItemRemoved, sendAgentMessage, approveWorkItem, releaseDependents,
  resetForProjectSwitch, baselineHandoffFiles, stopHeadlessRuns, stopHandoffWatcher,
} from './orchestrator.js'
import {
  listSessions, listEvents, recordEvent,
  getWorkspaceSnapshot, loadDemoData, clearWorkspaceData,
  createProject, activateProject, getProject, allowProjectWorkspace,
  getActiveProjectId, getAgentProjectId, getGoalProjectId, getWorkItem, getWorkItemProjectId, listWorkItemsForProject,
  getProjectCounts, deleteProjectCascade, CrossProjectError,
  upsertAgent, patchAgent, deleteAgent,
  getAgent, setAgentMemory, clearAgentMemory, wouldCreateCycle, setAgentParent,
  deleteWorkItem, patchGoal, deleteGoal, patchProject, releaseProjectWorkspace,
  createConnection, getConnection, patchConnection, deleteConnection, createGoal, createWorkItem, patchWorkItem,
  getSettings, getSetting, setSetting, getPolicies,
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

app.get('/api/runtimes', async (req, res) => {
  // ?refresh=1 ignora o cache (botão Verificar); sem isso reaproveita a detecção recente.
  res.json({ runtimes: await detectRuntimes({ force: req.query.refresh === '1' }) })
})

app.get('/api/catalog', (_req, res) => {
  res.json({
    catalog: RUNTIME_CATALOG.map((runtime) => ({
      ...runtime,
      headless: Boolean(runtime.headless),
      headlessSources: runtime.headless?.sources ?? [],
      sources: runtime.headless?.sources ?? [],
      policyEffects: runtime.policyEffects ?? describePolicyEffects(runtime),
    })),
  })
})

app.post('/api/runtimes/:id/install', async (req, res) => {
  const runtime = RUNTIME_CATALOG.find((item) => item.id === req.params.id)
  if (!runtime) return res.status(404).json({ error: 'Runtime não encontrado no catálogo' })

  if (!runtime.install) {
    return res.status(400).json({ error: `Não há comando de instalação oficial para "${runtime.id}".` })
  }
  if (installsInProgress.has(runtime.id)) return res.status(409).json({ error: `${runtime.name} já está sendo instalado` })

  // Ao clicar em Instalar na aba CLI's, aprova automaticamente o runtime caso ainda não esteja na lista.
  const approved = getSetting('approvedRuntimes') ?? []
  if (!approved.includes(runtime.id)) {
    setSetting('approvedRuntimes', [...approved, runtime.id])
  }

  // Prepara o script PowerShell: garante TLS 1.2, recarrega o PATH do sistema/usuário e, se o comando
  // exigir `npm` em uma máquina que ainda não tem Node.js instalado, baixa o binário portátil oficial
  // do Node.js LTS em escopo do USUÁRIO (%LOCALAPPDATA%\Programs\nodejs) sem pedir permissão de Administrador (UAC).
  const needsNpm = /^\s*npm\s+/i.test(runtime.install)
  const psScript = [
    '$ErrorActionPreference = "Stop"',
    // Saída em UTF-8 para o log ao vivo (o padrão do console é a página de código OEM e quebra acentos).
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$ProgressPreference = "SilentlyContinue"',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    '$userNodeDir = Join-Path $env:LOCALAPPDATA "Programs\\nodejs"',
    '$userNpmDir = Join-Path $env:APPDATA "npm"',
    '$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User") + ";$userNodeDir;$env:ProgramFiles\\nodejs;$userNpmDir"',
    ...(needsNpm ? [
      'if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {',
      '  $nodeVer = "v22.14.0"',
      '  Write-Output "Node.js não encontrado: baixando a versão portátil $nodeVer (sem pedir permissão de administrador)..."',
      '  $zipPath = Join-Path $env:TEMP "node-$nodeVer-win-x64.zip"',
      '  $extractRoot = Join-Path $env:TEMP "node-extract-$nodeVer"',
      '  Invoke-WebRequest -Uri "https://nodejs.org/dist/$nodeVer/node-$nodeVer-win-x64.zip" -OutFile $zipPath -UseBasicParsing',
      '  if (Test-Path $extractRoot) { Remove-Item $extractRoot -Recurse -Force }',
      '  Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force',
      '  if (Test-Path $userNodeDir) { Remove-Item $userNodeDir -Recurse -Force }',
      '  New-Item -ItemType Directory -Force -Path (Split-Path $userNodeDir) | Out-Null',
      '  Move-Item -Path (Join-Path $extractRoot "node-$nodeVer-win-x64") -Destination $userNodeDir -Force',
      '  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue',
      '  Remove-Item $extractRoot -Recurse -Force -ErrorAction SilentlyContinue',
      '  New-Item -ItemType Directory -Force -Path $userNpmDir | Out-Null',
      '  $env:Path = "$userNodeDir;$userNpmDir;" + $env:Path',
      '  & "$userNodeDir\\npm.cmd" config set prefix $userNpmDir --location=user',
      '  Write-Output "Node.js preparado em $userNodeDir"',
      '}',
      'if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue) -and -not (Get-Command npm -ErrorAction SilentlyContinue)) {',
      '  throw "Node.js (npm) não pôde ser preparado automaticamente no perfil do usuário."',
      '}',
    ] : []),
    `Write-Output ${JSON.stringify(`Executando o instalador oficial de ${runtime.name} (pode ficar alguns minutos sem mostrar nada)...`)}`,
    runtime.install,
  ].join('; ')

  recordEvent('gerente', `Instalando ${runtime.name}…`, 'system')
  installsInProgress.add(runtime.id)
  broadcast({ type: 'install-output', runtimeId: runtime.id, phase: 'start', data: `$ ${runtime.install}\n` })
  try {
    // Executa APENAS o comando oficial do catalogo, via PowerShell (-ExecutionPolicy Bypass), sem input do usuario.
    // G3: a saída vai ao vivo para a aba CLI's (evento WebSocket "install-output").
    await runInstallScript(runtime.id, psScript)
  } catch (error) {
    recordEvent('gerente', `Falha ao instalar ${runtime.name}: ${error.message}`, 'system')
    broadcast({ type: 'install-output', runtimeId: runtime.id, phase: 'end', ok: false, data: `\nFalha: ${error.message}\n` })
    return res.status(500).json({ error: `Falha ao instalar ${runtime.name}: ${error.message}` })
  } finally {
    installsInProgress.delete(runtime.id)
  }

  // Persiste os diretórios de CLIs no PATH do Usuário do Windows para funcionarem também no PowerShell externo.
  await syncUserCliPath()

  // Revalida a versao apos instalar.
  const detected = (await detectRuntimes({ force: true })).find((r) => r.id === runtime.id)
  recordEvent('gerente', `${runtime.name} instalado — versão ${detected?.version ?? 'desconhecida'}`, 'system')
  broadcast({ type: 'install-output', runtimeId: runtime.id, phase: 'end', ok: true, data: `\n${runtime.name} instalado — versão ${detected?.version ?? 'desconhecida'}\n` })
  res.json({ runtime: detected, snapshot: broadcastSnapshot() })
})

// G3: abre uma janela própria do PowerShell (fora do Vértice) já rodando a CLI, para o usuário fazer o
// login dela (ex.: /login). Só CLIs do catálogo que exigem login e estão instaladas; a pasta é a do
// projeto ativo (ou a pasta pessoal, se não houver projeto). O Vértice não vê nem guarda a credencial.
app.post('/api/runtimes/:id/login-terminal', async (req, res) => {
  const runtime = RUNTIME_CATALOG.find((item) => item.id === req.params.id)
  if (!runtime) return res.status(404).json({ error: 'Runtime não encontrado no catálogo' })
  if (!runtime.authenticates) return res.status(400).json({ error: `${runtime.name} não precisa de login` })
  const detected = (await detectRuntimes()).find((item) => item.id === runtime.id)
  if (detected?.status !== 'installed' || !detected.path) return res.status(400).json({ error: `${runtime.name} não está instalado nesta máquina` })
  const snapshot = getWorkspaceSnapshot()
  const project = snapshot.projects.find((p) => p.active) ?? snapshot.projects[0]
  const cwd = project?.path && existsSync(project.path) ? project.path : homedir()
  const quote = (value) => `'${String(value).replace(/'/g, "''")}'`
  const script = [
    `$Host.UI.RawUI.WindowTitle = ${quote(`Vértice · login · ${runtime.name}`)}`,
    `Write-Host ${quote(`Faça o login do ${runtime.name} nesta janela (em geral com /login). Quando terminar, feche a janela e clique em "Verificar agora" no Vértice.`)} -ForegroundColor Cyan`,
    `& ${quote(detected.path)}`,
  ].join('; ')
  try {
    // detached no Windows = a janela ganha console próprio e continua aberta mesmo se o Vértice fechar.
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', script], { cwd, detached: true, stdio: 'ignore' })
    child.on('error', (error) => console.error('[vertice-core] falha ao abrir terminal de login:', error.message))
    child.unref()
  } catch (error) {
    return res.status(500).json({ error: `Não foi possível abrir o terminal: ${error.message}` })
  }
  recordEvent('gerente', `Terminal de login aberto para ${runtime.name}`, 'system')
  res.json({ ok: true, cwd })
})

// G3: roda o script de instalação transmitindo stdout/stderr pelo WebSocket. Rejeita com o final da
// saída se o PowerShell terminar com erro, e encerra após 5 minutos.
const INSTALL_TIMEOUT_MS = 300000
const installsInProgress = new Set()
function runInstallScript(runtimeId, psScript) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { windowsHide: true })
    let tail = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise()
    }
    const forward = (stream) => (chunk) => {
      const data = chunk.toString('utf8')
      tail = (tail + data).slice(-4000)
      broadcast({ type: 'install-output', runtimeId, stream, data })
    }
    child.stdout.on('data', forward('stdout'))
    child.stderr.on('data', forward('stderr'))
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('a instalação passou de 5 minutos e foi interrompida'))
    }, INSTALL_TIMEOUT_MS)
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (code === 0) return finish()
      finish(new Error(tail.trim().slice(-300) || `o PowerShell terminou com código ${code}`))
    })
  })
}

// Só o carregamento inicial traz a última conversa de cada agente (até ~15 mil caracteres cada);
// os broadcasts de snapshot a omitem para não reenviá-la a cada mutação.
app.get('/api/workspace', (_req, res) => {
  res.json(getWorkspaceSnapshot({ transcripts: true }))
})

// Valores aceitos pela API (evita gravar status/prioridade inválidos que a interface não sabe exibir).
const AGENT_STATUSES = ['idle', 'working', 'paused', 'queued']
const WORK_STATUSES = ['todo', 'doing', 'review', 'done', 'failed']
const PRIORITIES = ['alta', 'media', 'baixa']
const isFilledText = (value) => typeof value === 'string' && value.trim() !== ''
const NO_ACTIVE_PROJECT_ERROR = 'Crie ou ative um projeto antes de criar agentes, metas ou tarefas.'

// Encerra todas as sessões vivas (usado ao trocar/limpar o workspace: os agentes deixam de existir).
function endAllSessions() {
  for (const session of listActiveSessions()) {
    if (killSession(session.id)) broadcast({ type: 'session-ended', sessionId: session.id })
  }
}

// Carrega os dados de DEMONSTRAÇÃO (equipe e projetos de exemplo). Preserva aprovação de CLIs/políticas.
app.post('/api/workspace/reset', (_req, res) => {
  flushTranscripts()
  resetForProjectSwitch(null)
  endAllSessions()
  forgetAllTranscripts()
  loadDemoData()
  recordEvent(null, 'Dados de demonstração carregados', 'system')
  res.json(broadcastSnapshot())
})

// Operar do zero: apaga projetos, agentes, conexões, metas, tarefas, workspaces e eventos.
// Mantém apenas as configurações das CLIs (settings).
app.post('/api/workspace/clear', (_req, res) => {
  flushTranscripts()
  resetForProjectSwitch(null)
  endAllSessions()
  forgetAllTranscripts()
  clearWorkspaceData()
  res.json(broadcastSnapshot())
})

// --- Settings (workspaces permitidos, runtimes aprovados, politicas) ------

app.get('/api/settings', (_req, res) => {
  res.json({ settings: getSettings(), allowedWorkspaces: listAllowedWorkspaces() })
})

app.patch('/api/settings', (req, res) => {
  const { approvedRuntimes, policies, promptTemplates } = req.body ?? {}
  if (approvedRuntimes !== undefined && !Array.isArray(approvedRuntimes)) {
    return res.status(400).json({ error: 'approvedRuntimes deve ser uma lista' })
  }

  let nextPolicies = null
  if (policies !== undefined) {
    const current = getPolicies({ recordOnInvalid: false })
    const merged = mergePolicyPatch(current, policies)
    if (merged.error) return res.status(400).json({ error: merged.error })
    nextPolicies = merged.policies
  }

  // Biblioteca de prompts salvos: fica em `settings`, então sobrevive a "Limpar workspace".
  let cleanedTemplates = null
  if (promptTemplates !== undefined) {
    if (!Array.isArray(promptTemplates) || promptTemplates.length > 100) {
      return res.status(400).json({ error: 'promptTemplates deve ser uma lista com até 100 itens' })
    }
    cleanedTemplates = []
    for (const template of promptTemplates) {
      if (!template || !isFilledText(template.name) || !isFilledText(template.prompt)) {
        return res.status(400).json({ error: 'Cada prompt salvo precisa de nome e texto' })
      }
      cleanedTemplates.push({
        id: typeof template.id === 'string' && template.id ? template.id : randomUUID(),
        name: template.name.trim().slice(0, 80),
        prompt: template.prompt.slice(0, 8000),
      })
    }
  }

  if (approvedRuntimes !== undefined) setSetting('approvedRuntimes', approvedRuntimes)
  if (nextPolicies !== null) {
    setSetting('policies', nextPolicies)
    syncAllMemoryFiles()
  }
  if (cleanedTemplates !== null) setSetting('promptTemplates', cleanedTemplates)

  recordEvent(null, promptTemplates !== undefined && approvedRuntimes === undefined && policies === undefined ? 'Biblioteca de prompts atualizada' : 'Políticas/aprovações atualizadas', 'system')
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
  const { id, name, path, description, copyTeamFromProjectId } = req.body ?? {}
  if (!name || !path) return res.status(400).json({ error: 'name e path são obrigatórios' })
  if (copyTeamFromProjectId && !getProject(copyTeamFromProjectId)) {
    return res.status(404).json({ error: 'Projeto de origem para copiar equipe não encontrado' })
  }
  let safePath
  try {
    safePath = assertSafeProjectPath(expandEnvVars(String(path).trim()))
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    return res.status(500).json({ error: `Falha ao validar o caminho: ${error.message}` })
  }
  const projectId = id || randomUUID()
  try {
    createProject({ id: projectId, name, path: safePath, description: description ?? '', copyTeamFromProjectId })
  } catch (error) {
    if (error.status === 404) return res.status(404).json({ error: error.message })
    return res.status(500).json({ error: `Falha ao criar o projeto: ${error.message}` })
  }
  allowProjectWorkspace({ id: projectId, path: safePath })
  if (getActiveProjectId() === projectId) syncAllMemoryFiles()
  recordEvent(null, `Projeto ${name} criado (${safePath})`, 'create')
  res.json(broadcastSnapshot())
})

app.post('/api/projects/:id/activate', (req, res) => {
  const project = getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' })
  let safePath
  try {
    safePath = assertSafeProjectPath(project.path)
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    return res.status(500).json({ error: `Falha ao validar o caminho: ${error.message}` })
  }
  const oldActiveId = getActiveProjectId()
  if (oldActiveId === project.id) {
    allowProjectWorkspace({ id: project.id, path: safePath })
    return res.json(getWorkspaceSnapshot())
  }
  flushTranscripts()
  resetForProjectSwitch(oldActiveId, { nextProjectPath: safePath })
  endAllSessions()
  forgetAllTranscripts()
  allowProjectWorkspace({ id: project.id, path: safePath })
  activateProject(project.id)
  baselineHandoffFiles()
  syncAllMemoryFiles()
  recordEvent(null, `Projeto ativo alterado para ${project.name}`, 'system')
  res.json(broadcastSnapshot())
})

// Editar projeto: nome, descrição e/ou pasta. A nova pasta passa pela mesma validação de segurança da criação.
app.patch('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' })
  const { name, path, description } = req.body ?? {}
  const fields = {}
  if (name !== undefined) {
    if (!isFilledText(name)) return res.status(400).json({ error: 'O nome do projeto não pode ficar vazio' })
    fields.name = name.trim()
  }
  if (description !== undefined) {
    if (typeof description !== 'string') return res.status(400).json({ error: 'description deve ser texto' })
    fields.description = description
  }
  if (path !== undefined) {
    try {
      fields.path = assertSafeProjectPath(expandEnvVars(String(path).trim()))
    } catch (error) {
      if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
      return res.status(500).json({ error: `Falha ao validar o caminho: ${error.message}` })
    }
  }
  patchProject(project.id, fields)
  if (fields.path && fields.path.toLowerCase() !== project.path.toLowerCase()) {
    releaseProjectWorkspace(project.id)
    allowProjectWorkspace({ id: project.id, path: fields.path })
    if (project.active) {
      baselineHandoffFiles()
      syncAllMemoryFiles()
    }
  }
  recordEvent(null, `Projeto ${fields.name ?? project.name} atualizado`, 'system')
  res.json(broadcastSnapshot())
})

// Excluir projeto: só tira do Vértice após confirmação explícita (?confirm=true).
// Os ARQUIVOS da pasta no disco NUNCA são apagados.
app.delete('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id)
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' })
  if (req.query.confirm !== 'true') {
    return res.status(409).json({
      error: 'Confirme a exclusão do projeto.',
      counts: getProjectCounts(project.id),
    })
  }
  if (project.active) {
    flushTranscripts()
    resetForProjectSwitch(project.id)
    endAllSessions()
  }
  const deleted = deleteProjectCascade(project.id)
  if (!deleted) return res.status(404).json({ error: 'Projeto não encontrado' })
  for (const agentId of deleted.agentIds) {
    forgetAgentTranscript(agentId)
  }
  releaseProjectWorkspace(project.id)
  if (deleted.nextActiveId) {
    const nextProject = getProject(deleted.nextActiveId)
    if (nextProject) {
      try {
        allowProjectWorkspace({ id: nextProject.id, path: assertSafeProjectPath(nextProject.path) })
      } catch { /* mantém permissão existente se falhar */ }
    }
    baselineHandoffFiles()
    syncAllMemoryFiles()
  }
  recordEvent(null, `Projeto ${project.name} excluído (a pasta no disco foi mantida)`, 'system')
  res.json(broadcastSnapshot())
})

app.post('/api/agents', (req, res) => {
  const activeProjectId = getActiveProjectId()
  if (!activeProjectId) return res.status(409).json({ error: NO_ACTIVE_PROJECT_ERROR })
  const agent = req.body ?? {}
  if (!agent.id || !agent.name || !agent.runtime) {
    return res.status(400).json({ error: 'id, name e runtime são obrigatórios' })
  }
  // O supervisor vive em dois lugares: `createdBy` (usado para trocar supervisor e detectar ciclos) e a
  // conexão do organograma. Aceita `parentId` ou `createdBy` e grava os dois de forma consistente.
  const parentId = agent.parentId || agent.createdBy || ''
  if (parentId) {
    if (parentId === agent.id || !getAgent(parentId, { transcript: false })) {
      return res.status(400).json({ error: 'Supervisor inválido' })
    }
    if (getAgentProjectId(parentId) !== activeProjectId) {
      return res.status(400).json({ error: 'O supervisor precisa pertencer ao projeto ativo' })
    }
  }
  upsertAgent({ ...agent, createdBy: parentId || null, projectId: activeProjectId })
  if (parentId) {
    createConnection({ id: randomUUID(), source: parentId, target: agent.id, label: 'delega', active: false })
  }
  syncAllMemoryFiles()
  recordEvent(agent.parentId ?? agent.id, `${agent.name} adicionado e persistido no SQLite`, 'create')
  res.json(broadcastSnapshot())
})

app.post('/api/agents/batch', (req, res) => {
  const activeProjectId = getActiveProjectId()
  if (!activeProjectId) return res.status(409).json({ error: NO_ACTIVE_PROJECT_ERROR })
  const { agents = [], connections = [], managerUpdate, eventMessage } = req.body ?? {}
  if (managerUpdate?.id) {
    if (!getAgent(managerUpdate.id, { transcript: false }) || getAgentProjectId(managerUpdate.id) !== activeProjectId) {
      return res.status(400).json({ error: 'Agente gerente não pertence ao projeto ativo' })
    }
  }
  const batchIds = new Set(agents.filter((a) => a?.id && a?.name).map((a) => a.id))
  for (const agent of agents) {
    if (!agent?.id || !agent?.name) continue
    const parentId = agent.parentId || agent.createdBy || ''
    if (!parentId) continue
    if (parentId === agent.id) return res.status(400).json({ error: 'Supervisor inválido' })
    if (!batchIds.has(parentId) && (!getAgent(parentId, { transcript: false }) || getAgentProjectId(parentId) !== activeProjectId)) {
      return res.status(400).json({ error: 'O supervisor precisa pertencer ao projeto ativo' })
    }
  }
  for (const conn of connections) {
    if (!conn?.source || !conn?.target) continue
    if (conn.source === conn.target) return res.status(400).json({ error: 'Um agente não pode conectar a si mesmo' })
    for (const endpoint of [conn.source, conn.target]) {
      if (!batchIds.has(endpoint) && (!getAgent(endpoint, { transcript: false }) || getAgentProjectId(endpoint) !== activeProjectId)) {
        return res.status(400).json({ error: 'Os dois agentes precisam ser do mesmo projeto.' })
      }
    }
  }
  if (managerUpdate?.id) {
    patchAgent(managerUpdate.id, managerUpdate)
  }
  for (const agent of agents) {
    if (agent.id && agent.name) upsertAgent({ ...agent, projectId: activeProjectId })
  }
  for (const conn of connections) {
    if (conn.source && conn.target) {
      createConnection({ id: conn.id || randomUUID(), source: conn.source, target: conn.target, label: conn.label ?? 'delega', active: Boolean(conn.active) })
    }
  }
  syncAllMemoryFiles()
  if (eventMessage) {
    recordEvent(managerUpdate?.id ?? 'gerente', eventMessage, 'delegate')
  }
  res.json(broadcastSnapshot())
})

// Editar agente (nome, função, runtime, modelo, instrução, supervisor) e também posição/estado.
// Campos fora da lista são ignorados (ex.: `id` e `kind` não mudam por aqui).
app.patch('/api/agents/:id', (req, res) => {
  const id = req.params.id
  const current = getAgent(id, { transcript: false })
  if (!current) return res.status(404).json({ error: 'Agente não encontrado' })
  const agentProjectId = getAgentProjectId(id)
  const body = req.body ?? {}
  const fields = {}
  for (const key of ['name', 'role', 'runtime', 'model', 'prompt', 'task']) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'string') return res.status(400).json({ error: `${key} deve ser texto` })
    fields[key] = body[key]
  }
  for (const key of ['name', 'role', 'runtime', 'model']) {
    if (key in fields && !fields[key].trim()) return res.status(400).json({ error: `${key} não pode ficar vazio` })
  }
  if (fields.runtime !== undefined && !runtimeIdFromName(fields.runtime)) {
    return res.status(400).json({ error: `Runtime "${fields.runtime}" não existe no catálogo` })
  }
  if (body.status !== undefined) {
    if (!AGENT_STATUSES.includes(body.status)) return res.status(400).json({ error: 'status inválido' })
    fields.status = body.status
  }
  for (const key of ['x', 'y', 'progress']) {
    if (body[key] === undefined) continue
    if (!Number.isFinite(body[key])) return res.status(400).json({ error: `${key} deve ser um número` })
    fields[key] = body[key]
  }
  if (body.parentId !== undefined) {
    const parentId = body.parentId || ''
    if (parentId) {
      if (parentId === id || !getAgent(parentId, { transcript: false })) return res.status(400).json({ error: 'Supervisor inválido' })
      if (getAgentProjectId(parentId) !== agentProjectId) return res.status(400).json({ error: 'O supervisor precisa pertencer ao mesmo projeto do agente' })
      if (wouldCreateCycle(id, parentId)) return res.status(400).json({ error: 'Esse supervisor criaria um ciclo no organograma' })
    }
    if ((current.createdBy ?? '') !== parentId) setAgentParent(id, parentId, randomUUID())
  }
  patchAgent(id, fields)
  if (body.name !== undefined || body.role !== undefined || body.prompt !== undefined || body.parentId !== undefined) {
    syncAllMemoryFiles()
  }
  res.json(broadcastSnapshot())
})

// Excluir agente (inclusive o gerente): encerra as sessões dele; subordinados ficam sem supervisor e as
// tarefas dele ficam sem responsável (não são apagadas).
app.delete('/api/agents/:id', (req, res) => {
  const current = getAgent(req.params.id, { transcript: false })
  if (!current) return res.status(404).json({ error: 'Agente não encontrado' })
  stopHeadlessRuns({ agentId: current.id, reason: 'Execução automática cancelada por remoção do agente' })
  for (const session of listActiveSessions()) {
    if (session.agentId === current.id && killSession(session.id)) broadcast({ type: 'session-ended', sessionId: session.id })
  }
  forgetAgentTranscript(current.id)
  deleteAgent(current.id)
  syncAllMemoryFiles()
  recordEvent(null, `Agente ${current.name} removido da equipe`, 'system')
  res.json(broadcastSnapshot())
})

// Memória viva: editar o texto acumulado ({ memory }) ou limpar memória + última conversa ({ clear: true }).
app.post('/api/agents/:id/memory', (req, res) => {
  const agent = getAgent(req.params.id, { transcript: false })
  if (!agent) return res.status(404).json({ error: 'Agente não encontrado' })
  const { memory, clear } = req.body ?? {}
  if (clear === true) {
    forgetAgentTranscript(agent.id) // antes de limpar: um flush pendente regravaria o texto antigo
    clearAgentMemory(agent.id)
  } else if (typeof memory === 'string') {
    setAgentMemory(agent.id, memory)
  } else {
    return res.status(400).json({ error: 'Informe { memory: "texto" } ou { clear: true }' })
  }
  syncMemoryFile(agent.id)
  recordEvent(agent.id, clear === true ? 'Memória viva limpa' : 'Memória viva editada', 'system')
  res.json(broadcastSnapshot())
})

// Mensagem manual (Inspector): o agente :id fala com um agente LIGADO a ele no organograma (em qualquer
// sentido). Entrega no terminal real do destino, abrindo a sessão se preciso; a linha acende até a resposta.
const MAX_AGENT_MESSAGE = 2000
app.post('/api/agents/:id/message', async (req, res) => {
  const { targetId, message } = req.body ?? {}
  const source = getAgent(req.params.id, { transcript: false })
  if (!source) return res.status(404).json({ error: 'Agente não encontrado' })
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'Escreva a mensagem' })
  if (message.length > MAX_AGENT_MESSAGE) return res.status(400).json({ error: `A mensagem pode ter até ${MAX_AGENT_MESSAGE} caracteres` })
  if (!targetId || targetId === source.id || !getAgent(targetId, { transcript: false })) {
    return res.status(400).json({ error: 'Agente de destino inválido' })
  }
  const linked = getWorkspaceSnapshot().connections.some((c) =>
    (c.source === source.id && c.target === targetId) || (c.source === targetId && c.target === source.id))
  if (!linked) return res.status(403).json({ error: 'Os dois agentes precisam estar ligados no organograma' })

  const result = await sendAgentMessage(source.id, targetId, message, { reason: 'envio manual' })
  if (result.deduplicated) return res.status(409).json({ error: 'A mesma mensagem foi enviada há menos de 15 segundos' })
  if (!result.ok) return res.status(result.status === 403 ? 403 : 400).json({ error: result.error || 'Não foi possível entregar a mensagem' })
  res.json(getWorkspaceSnapshot())
})

// Pontos de conexão de cada agente no organograma (iguais aos ids dos <Handle> do AgentNode).
const CONNECTION_HANDLES = ['top', 'right', 'bottom', 'left']
const MAX_CONNECTION_LABEL = 60

// Valida rótulo e pinos de uma conexão. Retorna { fields } ou { error }. Campos ausentes ficam de fora.
function readConnectionFields(body) {
  const fields = {}
  if (body.label !== undefined) {
    if (typeof body.label !== 'string') return { error: 'label deve ser texto' }
    const label = body.label.trim()
    if (label.length > MAX_CONNECTION_LABEL) return { error: `O rótulo pode ter até ${MAX_CONNECTION_LABEL} caracteres` }
    fields.label = label || null
  }
  for (const key of ['sourceHandle', 'targetHandle']) {
    if (body[key] === undefined) continue
    if (body[key] === null || body[key] === '') { fields[key] = null; continue }
    if (!CONNECTION_HANDLES.includes(body[key])) return { error: `${key} inválido (use top, right, bottom ou left)` }
    fields[key] = body[key]
  }
  return { fields }
}

app.post('/api/connections', (req, res) => {
  const { id, source, target, active } = req.body ?? {}
  if (!source || !target) return res.status(400).json({ error: 'source e target são obrigatórios' })
  if (source === target) return res.status(400).json({ error: 'Um agente não pode conectar a si mesmo' })
  const { fields, error } = readConnectionFields(req.body ?? {})
  if (error) return res.status(400).json({ error })
  if (!getAgent(source, { transcript: false }) || !getAgent(target, { transcript: false })) {
    return res.status(400).json({ error: 'Os dois agentes da conexão precisam existir' })
  }
  if (getAgentProjectId(source) !== getAgentProjectId(target)) {
    return res.status(400).json({ error: 'Os dois agentes precisam ser do mesmo projeto.' })
  }
  try {
    createConnection({ id: id || randomUUID(), source, target, active, label: fields.label ?? undefined, sourceHandle: fields.sourceHandle, targetHandle: fields.targetHandle })
  } catch (err) {
    if (err instanceof CrossProjectError || err.status === 400) return res.status(400).json({ error: err.message })
    throw err
  }
  syncAllMemoryFiles()
  recordEvent(source, `Nova conexão com ${target}`, 'system')
  res.json(broadcastSnapshot())
})

// Editar rótulo e/ou pontos de conexão de uma linha do organograma.
app.patch('/api/connections/:id', (req, res) => {
  if (!getConnection(req.params.id)) return res.status(404).json({ error: 'Conexão não encontrada' })
  const { fields, error } = readConnectionFields(req.body ?? {})
  if (error) return res.status(400).json({ error })
  patchConnection(req.params.id, fields)
  if (fields.label !== undefined) syncAllMemoryFiles() // o mapa de conexões da memória viva é regravado
  res.json(broadcastSnapshot())
})

app.delete('/api/connections/:id', (req, res) => {
  const ok = deleteConnection(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Conexão não encontrada' })
  syncAllMemoryFiles()
  recordEvent(null, 'Conexão removida do organograma', 'system')
  res.json(broadcastSnapshot())
})

app.post('/api/goals', (req, res) => {
  const activeProjectId = getActiveProjectId()
  if (!activeProjectId) return res.status(409).json({ error: NO_ACTIVE_PROJECT_ERROR })
  const { id, title, description } = req.body ?? {}
  if (!title) return res.status(400).json({ error: 'title é obrigatório' })
  createGoal({ id: id || randomUUID(), title, description: description ?? '', projectId: activeProjectId })
  recordEvent('gerente', `Meta criada: ${title}`, 'create')
  res.json(broadcastSnapshot())
})

app.patch('/api/goals/:id', (req, res) => {
  const { title, description } = req.body ?? {}
  if (title !== undefined && !isFilledText(title)) return res.status(400).json({ error: 'O título da meta não pode ficar vazio' })
  if (description !== undefined && typeof description !== 'string') return res.status(400).json({ error: 'description deve ser texto' })
  const ok = patchGoal(req.params.id, { title: title?.trim(), description })
  if (!ok) return res.status(404).json({ error: 'Meta não encontrada' })
  res.json(broadcastSnapshot())
})

// Excluir meta: as tarefas dela continuam existindo, só ficam sem meta.
app.delete('/api/goals/:id', (req, res) => {
  const ok = deleteGoal(req.params.id)
  if (!ok) return res.status(404).json({ error: 'Meta não encontrada' })
  res.json(broadcastSnapshot())
})

// G6: valida `dependsOn` (lista de ids de tarefas) e `parentTaskId`. Recusa a própria tarefa, ids que não
// existem e ciclos (A espera B que espera A nunca andaria). Retorna { fields } ou { error }.
const MAX_DEPENDENCIES = 20
function readDependencyFields(body, selfId, projectId = getActiveProjectId()) {
  const fields = {}
  const byId = new Map(listWorkItemsForProject(projectId).map((w) => [w.id, w]))
  const dependsOnReaches = (start, target) => {
    const seen = new Set()
    const stack = [start]
    while (stack.length) {
      const id = stack.pop()
      if (id === target) return true
      if (seen.has(id)) continue
      seen.add(id)
      stack.push(...(byId.get(id)?.dependsOn ?? []))
    }
    return false
  }
  if (body.dependsOn !== undefined) {
    if (body.dependsOn !== null && !Array.isArray(body.dependsOn)) return { error: 'dependsOn deve ser uma lista de tarefas' }
    const raw = body.dependsOn ?? []
    if (raw.some((dep) => typeof dep !== 'string' || !dep)) return { error: 'dependsOn deve conter ids de tarefas' }
    const list = [...new Set(raw)]
    if (list.length > MAX_DEPENDENCIES) return { error: `Uma tarefa pode depender de até ${MAX_DEPENDENCIES} tarefas` }
    if (selfId && list.includes(selfId)) return { error: 'Uma tarefa não pode depender de si mesma' }
    if (list.some((dep) => !byId.has(dep))) return { error: 'Tarefa da dependência não encontrada' }
    if (selfId && list.some((dep) => dependsOnReaches(dep, selfId))) {
      return { error: 'Essa dependência criaria um ciclo: as tarefas ficariam esperando uma pela outra' }
    }
    fields.dependsOn = list.length ? list : null
  }
  if (body.parentTaskId !== undefined) {
    const parent = body.parentTaskId || null
    if (parent !== null && typeof parent !== 'string') return { error: 'parentTaskId deve ser o id de uma tarefa' }
    if (parent && parent === selfId) return { error: 'Uma tarefa não pode ser a principal de si mesma' }
    if (parent && !byId.has(parent)) return { error: 'Tarefa principal não encontrada' }
    if (parent && selfId) {
      for (let cursor = byId.get(parent), steps = 0; cursor && steps < 1000; cursor = byId.get(cursor.parentTaskId), steps++) {
        if (cursor.id === selfId) return { error: 'Essa tarefa principal criaria um ciclo' }
        if (!cursor.parentTaskId) break
      }
    }
    fields.parentTaskId = parent
  }
  return { fields }
}

app.post('/api/work-items', (req, res) => {
  const activeProjectId = getActiveProjectId()
  if (!activeProjectId) return res.status(409).json({ error: NO_ACTIVE_PROJECT_ERROR })
  const { id, title, description, status, assigneeId, goalId, priority, headless } = req.body ?? {}
  if (!title) return res.status(400).json({ error: 'title é obrigatório' })
  if (headless !== undefined && typeof headless !== 'boolean') {
    return res.status(400).json({ error: 'headless deve ser booleano' })
  }
  if (assigneeId !== undefined && assigneeId !== null && assigneeId !== '') {
    if (!getAgent(assigneeId, { transcript: false }) || getAgentProjectId(assigneeId) !== activeProjectId) {
      return res.status(400).json({ error: 'Responsável não encontrado no projeto ativo' })
    }
  }
  if (goalId !== undefined && goalId !== null && goalId !== '') {
    if (getGoalProjectId(goalId) !== activeProjectId) {
      return res.status(400).json({ error: 'Meta não encontrada no projeto ativo' })
    }
  }
  const deps = readDependencyFields(req.body ?? {}, null, activeProjectId)
  if (deps.error) return res.status(400).json({ error: deps.error })
  createWorkItem({
    id: id || randomUUID(),
    title,
    description: typeof description === 'string' ? description : '',
    status: status ?? 'todo',
    assigneeId: assigneeId || null,
    goalId: goalId || null,
    priority: priority ?? 'media',
    parentTaskId: deps.fields.parentTaskId ?? undefined,
    dependsOn: deps.fields.dependsOn ?? undefined,
    headless: Boolean(headless),
    projectId: activeProjectId,
  })
  recordEvent(assigneeId ?? 'gerente', `Tarefa criada: ${title}`, 'create')
  res.json(broadcastSnapshot())
})

// Editar tarefa. `assigneeId`/`goalId` vazios removem o responsável/a meta. O resultado só é gravado
// pelas rotas de conclusão, nunca por aqui.
app.patch('/api/work-items/:id', (req, res) => {
  const previous = getWorkItem(req.params.id)
  if (!previous) return res.status(404).json({ error: 'Tarefa não encontrada' })
  const itemProjectId = getWorkItemProjectId(previous.id)
  const body = req.body ?? {}
  const fields = {}
  if (body.title !== undefined) {
    if (!isFilledText(body.title)) return res.status(400).json({ error: 'O título da tarefa não pode ficar vazio' })
    fields.title = body.title.trim()
  }
  if (body.description !== undefined) {
    if (typeof body.description !== 'string') return res.status(400).json({ error: 'description deve ser texto' })
    fields.description = body.description
  }
  if (body.status !== undefined) {
    if (!WORK_STATUSES.includes(body.status)) return res.status(400).json({ error: 'status inválido' })
    fields.status = body.status
  }
  if (body.priority !== undefined) {
    if (!PRIORITIES.includes(body.priority)) return res.status(400).json({ error: 'priority inválida' })
    fields.priority = body.priority
  }
  if (body.headless !== undefined) {
    if (typeof body.headless !== 'boolean') return res.status(400).json({ error: 'headless deve ser booleano' })
    fields.headless = body.headless
  }
  if (body.assigneeId !== undefined) {
    fields.assigneeId = body.assigneeId || null
    if (fields.assigneeId && (!getAgent(fields.assigneeId, { transcript: false }) || getAgentProjectId(fields.assigneeId) !== itemProjectId)) {
      return res.status(400).json({ error: 'Responsável não encontrado no projeto da tarefa' })
    }
  }
  if (body.goalId !== undefined) {
    fields.goalId = body.goalId || null
    if (fields.goalId && getGoalProjectId(fields.goalId) !== itemProjectId) {
      return res.status(400).json({ error: 'Meta não encontrada no projeto da tarefa' })
    }
  }
  const deps = readDependencyFields(body, previous.id, itemProjectId)
  if (deps.error) return res.status(400).json({ error: deps.error })
  Object.assign(fields, deps.fields)
  patchWorkItem(previous.id, fields)
  // G6: chegou a "Concluído" por aqui (mover o card ou editar): libera as tarefas que dependiam dela.
  if (fields.status === 'done' && previous.status !== 'done' && itemProjectId === getActiveProjectId()) {
    releaseDependents(previous.id)
  }
  res.json(broadcastSnapshot())
})

app.delete('/api/work-items/:id', (req, res) => {
  const item = getWorkspaceSnapshot().workItems.find((w) => w.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Tarefa não encontrada' })
  deleteWorkItem(item.id)
  onWorkItemRemoved(item)
  recordEvent(item.assigneeId ?? null, `Tarefa excluída: ${item.title}`, 'system')
  res.json(broadcastSnapshot())
})

// Resolve o cwd efetivo: o informado, senao o do projeto ativo.
function resolveSessionCwd(requestedCwd) {
  if (requestedCwd && requestedCwd.trim() !== '') return requestedCwd
  const snapshot = getWorkspaceSnapshot()
  const active = snapshot.projects.find((p) => p.active)
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
    const status = Number.isInteger(error?.status) ? error.status : 400
    res.status(status).json({ error: error.message })
  }
})

// B3 (manual por ora): marcar conclusao de uma tarefa (review/failed) com resultado.
app.post('/api/work-items/:id/complete', async (req, res) => {
  const { result, error } = req.body ?? {}
  const out = await completeWorkItem(req.params.id, { result, error })
  if (!out.ok) return res.status(404).json({ error: out.error })
  res.json({ ...out, snapshot: getWorkspaceSnapshot() })
})

// G5: aprovar a entrega ("Aguardando aprovação" -> "Concluído").
app.post('/api/work-items/:id/approve', (req, res) => {
  const out = approveWorkItem(req.params.id)
  if (!out.ok) return res.status(out.status).json({ error: out.error })
  res.json(getWorkspaceSnapshot())
})

// G5: devolver com feedback. A tarefa volta para "Em andamento" e o feedback é digitado na sessão real
// do responsável junto com a tarefa (também vale para "Falhou").
const MAX_FEEDBACK = 2000
app.post('/api/work-items/:id/reject', async (req, res) => {
  const { feedback } = req.body ?? {}
  const item = getWorkspaceSnapshot().workItems.find((w) => w.id === req.params.id)
  if (!item) return res.status(404).json({ error: 'Tarefa não encontrada' })
  if (typeof feedback !== 'string' || !feedback.trim()) return res.status(400).json({ error: 'Escreva o que precisa ser corrigido' })
  if (feedback.length > MAX_FEEDBACK) return res.status(400).json({ error: `O feedback pode ter até ${MAX_FEEDBACK} caracteres` })
  if (!['review', 'failed'].includes(item.status)) return res.status(409).json({ error: 'Só tarefas em "Aguardando aprovação" ou que falharam podem ser devolvidas' })
  if (!item.assigneeId) return res.status(400).json({ error: 'A tarefa não tem um responsável atribuído' })
  try {
    await dispatchWorkItem(item.id, { feedback: feedback.replace(/\s*[\r\n]+\s*/g, ' ').trim() })
    res.json(getWorkspaceSnapshot())
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    const status = Number.isInteger(error?.status) ? error.status : 400
    res.status(status).json({ error: error.message })
  }
})

app.post('/api/sessions', async (req, res) => {
  const { agentId, runtimeId, cwd, cols, rows } = req.body ?? {}
  if (!isFilledText(agentId) || !isFilledText(runtimeId)) {
    return res.status(400).json({ error: 'agentId e runtimeId válidos são obrigatórios' })
  }
  const agent = getAgent(agentId, { transcript: false }) ?? { id: agentId, name: agentId }
  try {
    const { session } = await launchAgentSession({
      agent,
      runtimeId,
      cwd: resolveSessionCwd(cwd),
      resume: true,
      cols,
      rows,
    })
    res.json({ session })
  } catch (error) {
    if (error instanceof WorkspaceError) return res.status(403).json({ error: error.message })
    if (Number.isInteger(error?.status)) return res.status(error.status).json({ error: error.message })
    res.status(500).json({ error: `Falha ao iniciar sessão: ${error.message}` })
  }
})

// G10: reinicia a sessão do agente mantendo pasta, runtime e memória viva.
app.post('/api/agents/:id/session/restart', async (req, res) => {
  const agent = getAgent(req.params.id, { transcript: false })
  if (!agent) return res.status(404).json({ error: 'Agente não encontrado.' })

  const activeForAgent = listActiveSessions().filter((s) => s.agentId === agent.id)
  const live = activeForAgent.at(-1) ?? null
  const activeProject = getWorkspaceSnapshot().projects.find((p) => p.active) ?? null
  const cwd = live?.cwd || activeProject?.path || ''
  if (!cwd) {
    return res.status(400).json({ error: 'Crie ou ative um projeto antes de reiniciar a sessão.' })
  }
  if (!live && activeProject && getAgentProjectId(agent.id) && getAgentProjectId(agent.id) !== activeProject.id) {
    return res.status(409).json({ error: 'Este agente pertence a outro projeto; ative o projeto dele antes de reiniciar a sessão.' })
  }

  if (activeForAgent.length > 0) {
    flushAgentTranscript(agent.id)
    for (const s of activeForAgent) {
      if (killSession(s.id)) broadcast({ type: 'session-ended', sessionId: s.id })
      clearAgentSession(agent.id, s.id)
    }
  }

  const runtimeId = runtimeIdFromName(agent.runtime)
  const { cols, rows } = req.body ?? {}
  try {
    const { session } = await launchAgentSession({
      agent,
      runtimeId,
      cwd,
      resume: true,
      cols,
      rows,
    })
    res.json({ session, snapshot: broadcastSnapshot() })
  } catch (error) {
    const message = error?.message || 'Falha ao reiniciar a sessão.'
    if (error instanceof WorkspaceError) return res.status(403).json({ error: message })
    if (Number.isInteger(error?.status)) return res.status(error.status).json({ error: message })
    res.status(500).json({ error: message })
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

wss.on('error', (error) => {
  // Erros de bind do servidor HTTP (ex.: EADDRINUSE) já são tratados pela Promise de startCore().
  if (server.listening) console.error('[vertice-core] erro no WebSocket:', error.message)
})

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
  return new Promise((resolve, reject) => {
    const cleanupListeners = () => {
      server.off('error', onError)
      server.off('listening', onListening)
    }
    const onError = (error) => {
      cleanupListeners()
      reject(error)
    }
    const onListening = () => {
      cleanupListeners()
      recordEvent(null, 'Serviço local do Vértice iniciado', 'system')
      void syncUserCliPath()
      syncAllMemoryFiles()
      console.log(`[vertice-core] ouvindo em http://localhost:${port} (ws em /ws)`)
      resolve(server)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    try {
      server.listen(port)
    } catch (error) {
      cleanupListeners()
      reject(error)
    }
  })
}

server.on('close', () => {
  stopHandoffWatcher()
  stopHeadlessRuns()
})

// Grava a conversa pendente de cada agente e encerra execuções headless ativas antes de sair.
export function shutdownCore() {
  stopHandoffWatcher()
  stopHeadlessRuns()
  flushTranscripts()
}

export { server, PORT }

// Auto-start no modo standalone (node src/index.js), mas não quando importado.
const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainEntry) {
  startCore().catch((error) => {
    console.error('[vertice-core] falha ao iniciar o serviço:', error?.message ?? error)
    process.exit(1)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { shutdownCore(); process.exit(0) })
  }
}


