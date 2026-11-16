import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { RUNTIME_CATALOG, resolveCommand, checkAuth } from './runtimes.js'
import { createTaskMonitor, COMPLETION_INSTRUCTION, stripAnsi } from './task-monitor.js'
import { startSession, writeToSession, listActiveSessions, buildChildEnv } from './sessions.js'
import { resolveExecutionMode, buildHeadlessLaunch, mapHeadlessOutcome, runHeadless, killHeadlessProcess } from './headless.js'
import { assertAllowedCwd, WorkspaceError } from './workspace.js'
import {
  getWorkspaceSnapshot, patchWorkItem, patchAgent, recordEvent,
  getSetting, listAllowedWorkspaces,
  getAgent, getAgentTranscript, setAgentTranscript, appendAgentMemory,
  setConnectionActive, getActiveProjectId, getAgentProjectId, interruptProjectWork,
} from './db.js'
import {
  createTranscriptRecorder, hasPriorContext, buildResumeNote, buildConnectedAgentsHint, buildMemoryMarkdown, writeMemoryFile, formatMemoryEntry,
} from './agent-memory.js'

// Mapeia o "runtime" humano do agente (ex.: "Claude Code") para o id do catalogo.
const RUNTIME_NAME_TO_ID = {
  'Claude Code': 'claude',
  'Codex CLI': 'codex',
  'Kimi CLI': 'kimi',
  'GLM CLI': 'glm',
  'GLM CLI (Z.ai)': 'glm',
  'Antigravity CLI': 'antigravity',
  OpenCode: 'opencode',
  Ollama: 'ollama',
  'LM Studio': 'lmstudio',
  PowerShell: 'powershell',
}

// Registro de sessoes vivas por agente (agentId -> sessionId), compartilhado com o index.
const agentSessions = new Map()
// Execuções headless em andamento: Map<workItemId, { child, agentId }>
const headlessRuns = new Map()
let broadcastFn = () => {}

function createStatusError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

export function configureOrchestrator({ broadcast }) {
  if (typeof broadcast === 'function') broadcastFn = broadcast
}

// Transcrição limpa de cada agente (E14): salva no SQLite com debounce e espelhada em arquivo.
const transcripts = createTranscriptRecorder({
  load: (agentId) => getAgentTranscript(agentId),
  save: (agentId, text) => {
    setAgentTranscript(agentId, text)
    syncMemoryFile(agentId)
  },
})

/** Reescreve <projeto ativo>/.vertice/memory/<agente>.md a partir do banco. Nunca lança erro. */
export function syncMemoryFile(agentId) {
  try {
    const activeId = getActiveProjectId()
    if (!activeId || getAgentProjectId(agentId) !== activeId) return null
    const agent = getAgent(agentId)
    if (!agent) return null
    const snapshot = getWorkspaceSnapshot()
    const projectPath = activeProjectPath(snapshot)
    if (!projectPath) return null
    // O arquivo só é gravado dentro de um workspace permitido (mesma regra de confinamento das sessões).
    const safeDir = assertAllowedCwd(projectPath, listAllowedWorkspaces())
    return writeMemoryFile(safeDir, agentId, buildMemoryMarkdown({
      agent,
      memory: agent.memory,
      transcript: agent.lastTranscript,
      allAgents: snapshot.agents,
      connections: snapshot.connections,
    }))
  } catch (error) {
    console.error('[memoria] não foi possível gravar o arquivo de memória:', error.message)
    return null
  }
}

/** Sincroniza os arquivos .vertice/memory/<id>.md de todos os agentes para manter o mapa de conexões atualizado. */
export function syncAllMemoryFiles() {
  try {
    const snapshot = getWorkspaceSnapshot()
    for (const agent of snapshot.agents) {
      syncMemoryFile(agent.id)
    }
  } catch { /* ignora caso nenhum workspace esteja ativo */ }
}

export function flushTranscripts() { transcripts.flushAll() }
export function forgetAgentTranscript(agentId) { transcripts.forget(agentId) }
export function forgetAllTranscripts() { transcripts.forgetAll() }

function recordTranscript(event) {
  if (!event?.agentId) return
  if (event.type === 'output') transcripts.append(event.agentId, event.data)
  else if (event.type === 'exit') transcripts.flush(event.agentId)
}

// Sessão iniciada ou retomada: espera a CLI subir e a orienta (em UMA linha) a ler a memória viva
// e o mapa de conexões do agente (.vertice/memory/<id>.md).
async function injectResumeContext(agentId, sessionId) {
  try {
    await waitForSessionReady(sessionId)
    if (!listActiveSessions().some((s) => s.id === sessionId)) return
    syncAllMemoryFiles() // garante que o arquivo do agente e dos pares conectados existam ANTES da leitura
    const snapshot = getWorkspaceSnapshot()
    const agent = snapshot.agents.find((a) => a.id === agentId) ?? getAgent(agentId)
    const connectedHint = buildConnectedAgentsHint(agent, snapshot.agents, snapshot.connections)
    const note = [buildResumeNote(agentId, connectedHint), agent?.prompt ? `Sua instrução base (${agent.role}): ${agent.prompt}` : '']
      .filter(Boolean)
      .join(' ')
      .replace(/\s*[\r\n]+\s*/g, ' ')
      .trim()
    markInjectedPrompt(sessionId, note)
    if (!writeToSession(sessionId, note)) return
    await delay(200)
    writeToSession(sessionId, '\r')
    recordEvent(agentId, 'Contexto, memória viva e conexões enviados à sessão', 'system')
  } catch (error) {
    console.error('[memoria] falha ao enviar o contexto de retomada:', error.message)
  }
}

/**
 * Registra a sessão do agente. Retorna `true` se ele já tinha memória/conversa de antes (avaliado ANTES de
 * marcar o início da nova sessão, que altera a transcrição). Com `resume`, a IA é orientada a ler a memória
 * viva e suas conexões assim que a CLI terminar de subir; o despacho de tarefa usa `resume: false` e leva a nota na instrução.
 */
export function registerAgentSession(agentId, sessionId, { runtimeId, resume = true } = {}) {
  if (!agentId || !sessionId) return false
  agentSessions.set(agentId, sessionId)
  const agent = getAgent(agentId)
  const hadContext = agent ? hasPriorContext({ memory: agent.memory, transcript: agent.lastTranscript }) : false
  const snapshot = getWorkspaceSnapshot()
  const hasConnections = snapshot.connections.some((c) => c.source === agentId || c.target === agentId)
  const hasPrompt = Boolean(agent?.prompt?.trim())
  transcripts.markSessionStart(agentId)
  syncAllMemoryFiles()
  ensureHandoffWatcher()
  // O PowerShell digitaria a nota como COMANDO: a injeção de contexto só vale para CLIs de IA.
  if (resume && (hadContext || hasConnections || hasPrompt) && runtimeId !== 'powershell') {
    void injectResumeContext(agentId, sessionId)
  }
  return hadContext
}

export { trackedBroadcast }

// Fonte única do mapeamento nome humano -> id do catálogo. Aceita também o
// próprio id (ex.: "glm"). Retorna null se o runtime não for conhecido.
export function runtimeIdFromName(name) {
  if (typeof name !== 'string') return null
  if (RUNTIME_NAME_TO_ID[name]) return RUNTIME_NAME_TO_ID[name]
  return RUNTIME_CATALOG.some((r) => r.id === name) ? name : null
}

function runtimeIdForAgent(agent) {
  return runtimeIdFromName(agent.runtime) ?? 'powershell'
}

function activeProjectPath(snapshot) {
  const active = snapshot.projects.find((p) => p.active)
  return active?.path ?? ''
}

// Atividade de saída por sessão: serve para saber quando a CLI terminou de subir e está pronta para
// receber a instrução (digitar antes disso perde ou embaralha o texto).
const sessionActivity = new Map()

function trackedBroadcast(event) {
  if (event?.type === 'output' && event.sessionId) sessionActivity.set(event.sessionId, Date.now())
  else if (event?.type === 'exit' && event.sessionId) {
    sessionActivity.delete(event.sessionId)
    agentOutputBuffers.delete(event.sessionId)
    injectedPrompts.delete(event.sessionId)
  }
  broadcastFn(event)
  feedTaskMonitor(event)
  feedMessageTurn(event)
  recordTranscript(event)
  feedInterAgentRouter(event)
}

// --- Roteador de comunicação entre agentes conectados (E15) --------------------
// Permite que um agente envie mensagens diretamente para outro agente conectado:
// 1. Pelo marcador `[PARA: NomeDoAgente] mensagem` ou `[DELEGAR: NomeDoAgente] mensagem` na saída do terminal;
// 2. Por arquivos `.vertice/handoff*.md` criados pelo agente no workspace do projeto ativo;
// 3. Automaticamente ao concluir uma tarefa (`completeWorkItem`) quando houver agentes conectados a jusante.
const agentOutputBuffers = new Map() // sessionId -> partial line string
const injectedPrompts = new Map()    // sessionId -> { text, at }
const recentDeliveries = new Map()   // `${sourceId}->${targetId}:${hash}` -> timestamp
const lastAgentForwardAt = new Map() // sourceAgentId -> timestamp
const seenHandoffFiles = new Map()   // filePath -> mtimeMs
let handoffInterval = null

function markInjectedPrompt(sessionId, text) {
  injectedPrompts.set(sessionId, { text: String(text ?? ''), at: Date.now() })
}

function normalizeAgentKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function resolveTargetAgent(sourceAgentId, rawTarget, snapshot = getWorkspaceSnapshot()) {
  const cleanTarget = String(rawTarget ?? '').trim().replace(/^["'<]+|["'>]+$/g, '')
  const key = normalizeAgentKey(cleanTarget)
  if (!key || ['nomedoagente', 'agente', 'nome', 'alvo', 'destino'].includes(key)) return null

  const outgoingIds = snapshot.connections.filter((c) => c.source === sourceAgentId).map((c) => c.target)
  const incomingIds = snapshot.connections.filter((c) => c.target === sourceAgentId).map((c) => c.source)

  if (['proximo', 'proximoagente', 'subordinado', 'filho', 'downstream'].includes(key)) {
    return snapshot.agents.find((a) => a.id === outgoingIds[0]) ?? null
  }
  if (['supervisor', 'gerente', 'anterior', 'pai', 'upstream'].includes(key)) {
    return snapshot.agents.find((a) => a.id === incomingIds[0]) ?? null
  }

  // Prioriza agentes diretamente conectados (saída ou entrada), depois qualquer agente do workspace.
  const connectedPool = snapshot.agents.filter((a) => outgoingIds.includes(a.id) || incomingIds.includes(a.id))
  for (const pool of [connectedPool, snapshot.agents]) {
    const exact = pool.find((a) => a.id !== sourceAgentId && (normalizeAgentKey(a.name) === key || normalizeAgentKey(a.id) === key))
    if (exact) return exact
    const prefix = pool.find((a) => a.id !== sourceAgentId && (normalizeAgentKey(a.name).startsWith(key) || normalizeAgentKey(a.id).startsWith(key) || key.startsWith(normalizeAgentKey(a.name))))
    if (prefix) return prefix
  }
  return null
}

/**
 * Entrega uma mensagem de `sourceAgentId` diretamente na sessão real de `targetAgentId`.
 * Se a sessão do agente de destino ainda não estiver aberta, abre automaticamente.
 */
export async function sendAgentMessage(sourceAgentId, targetAgentId, rawMessage, { reason = 'message' } = {}) {
  const message = String(rawMessage ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim()
  if (!sourceAgentId || !targetAgentId || sourceAgentId === targetAgentId || !message) return { ok: false }

  const dedupeKey = `${sourceAgentId}->${targetAgentId}:${message.slice(0, 160)}`
  const lastAt = recentDeliveries.get(dedupeKey) ?? 0
  if (Date.now() - lastAt < 15000) return { ok: false, deduplicated: true }
  recentDeliveries.set(dedupeKey, Date.now())
  lastAgentForwardAt.set(sourceAgentId, Date.now())

  try {
    const snapshot = getWorkspaceSnapshot()
    const sourceAgent = snapshot.agents.find((a) => a.id === sourceAgentId)
    const targetAgent = snapshot.agents.find((a) => a.id === targetAgentId)
    if (!sourceAgent || !targetAgent) return { ok: false }

    setLinkActive(sourceAgent.id, targetAgent.id, true)
    syncAllMemoryFiles()
    broadcastFn({ type: 'workspace-updated', snapshot: getWorkspaceSnapshot() })

    const { sessionId, created } = await ensureAgentSession(targetAgent, snapshot)
    const runtimeId = runtimeIdForAgent(targetAgent)
    const connectedHint = buildConnectedAgentsHint(targetAgent, snapshot.agents, snapshot.connections)
    const resumePrefix = created && runtimeId !== 'powershell'
      ? [buildResumeNote(targetAgent.id, connectedHint), targetAgent.prompt ? `Sua função (${targetAgent.role}): ${targetAgent.prompt}.` : ''].filter(Boolean).join(' ')
      : ''

    const payload = runtimeId === 'powershell'
      ? `Write-Output "Mensagem de ${sourceAgent.name}: ${message.replace(/"/g, "'").slice(0, 200)}"`
      : [
          resumePrefix,
          `Mensagem recebida do agente ${sourceAgent.name} (${sourceAgent.role}): "${message.slice(0, 1200)}".`,
          targetAgent.prompt ? `Aplique sua instrução (${targetAgent.prompt}) sobre essa entrega e responda.` : 'Analise a entrega acima e dê continuidade ao trabalho.',
        ].filter(Boolean).join(' ').replace(/\s*[\r\n]+\s*/g, ' ').trim()

    if (created) await waitForSessionReady(sessionId)
    markInjectedPrompt(sessionId, payload)
    if (!writeToSession(sessionId, payload)) {
      recentDeliveries.delete(dedupeKey) // nada foi entregue: pode tentar de novo na hora
      releaseFailedDelivery(sourceAgent.id, targetAgent.id)
      return { ok: false, error: 'A sessão do agente de destino foi encerrada' }
    }
    await delay(200)
    writeToSession(sessionId, '\r')
    startMessageTurn(sessionId, sourceAgent.id, targetAgent.id, runtimeId, payload)

    patchAgent(targetAgent.id, { status: 'working', task: `Recebido de ${sourceAgent.name}: ${message.slice(0, 70)}` })
    recordEvent(sourceAgent.id, `Comunicou com ${targetAgent.name} (${reason}): ${message.slice(0, 120)}`, 'delegate')
    broadcastFn({ type: 'workspace-updated', snapshot: getWorkspaceSnapshot() })
    return { ok: true, sessionId }
  } catch (error) {
    console.error('[orchestrator] falha ao entregar mensagem entre agentes:', error.message)
    recentDeliveries.delete(dedupeKey) // nada foi entregue: pode tentar de novo na hora
    releaseFailedDelivery(sourceAgentId, targetAgentId)
    return { ok: false, error: error.message, status: error.status }
  }
}

// --- Fim do turno de uma mensagem entre agentes (G2) ----------------------------
// Ao entregar uma mensagem, a linha do organograma acende (`active`) e o destino fica "working".
// O fim da resposta do destino é inferido pela mesma heurística das tarefas (task-monitor.js: fim da
// sessão, silêncio depois de uma resposta real, volta do prompt do PowerShell). Ao terminar, a linha
// apaga e o agente volta a "idle" se não tiver tarefa em andamento. Um teto de tempo garante que a
// linha não fique acesa para sempre se a heurística não disparar.
const MESSAGE_TURN_MAX_MS = 10 * 60 * 1000
const messageTurns = new Map() // sessionId -> { monitor, cap, targetId, sources: Set<agentId> }

// A linha pode ter sido desenhada no sentido contrário ao da mensagem; acende/apaga a que existir.
function setLinkActive(sourceId, targetId, active) {
  setConnectionActive(sourceId, targetId, active)
  setConnectionActive(targetId, sourceId, active)
}

function hasTaskInProgress(agentId, snapshot = getWorkspaceSnapshot()) {
  return snapshot.workItems.some((w) => w.assigneeId === agentId && w.status === 'doing')
}

function isAgentBusy(agentId, snapshot = getWorkspaceSnapshot()) {
  return hasTaskInProgress(agentId, snapshot)
    || Array.from(headlessRuns.values()).some((run) => run.agentId === agentId)
    || Array.from(messageTurns.values()).some((turn) => turn.targetId === agentId)
}

function startMessageTurn(sessionId, sourceId, targetId, runtimeId, instruction) {
  const previous = messageTurns.get(sessionId)
  const sources = previous?.sources ?? new Set()
  if (previous) { previous.monitor.cancel(); clearTimeout(previous.cap) }
  sources.add(sourceId)
  const monitor = createTaskMonitor({
    runtimeId,
    instruction,
    idleMs: Number(process.env.VERTICE_IDLE_COMPLETE_MS) || undefined,
    onComplete: ({ reason }) => finishMessageTurn(sessionId, reason),
  })
  const cap = setTimeout(() => finishMessageTurn(sessionId, 'timeout'), MESSAGE_TURN_MAX_MS)
  if (typeof cap.unref === 'function') cap.unref()
  messageTurns.set(sessionId, { monitor, cap, targetId, sources })
}

function finishMessageTurn(sessionId, reason) {
  const entry = messageTurns.get(sessionId)
  if (!entry) return
  messageTurns.delete(sessionId)
  entry.monitor.cancel()
  clearTimeout(entry.cap)
  try {
    for (const sourceId of entry.sources) setLinkActive(sourceId, entry.targetId, false)
    const snapshot = getWorkspaceSnapshot()
    const target = snapshot.agents.find((a) => a.id === entry.targetId)
    if (target && target.status === 'working' && !isAgentBusy(target.id, snapshot)) {
      patchAgent(target.id, { status: 'idle', task: '' })
    }
    if (reason === 'timeout') recordEvent(entry.targetId, 'Resposta à mensagem não detectada em 10 min; conexão apagada', 'system')
    broadcastFn({ type: 'workspace-updated', snapshot: getWorkspaceSnapshot() })
  } catch (error) {
    console.error('[orchestrator] falha ao encerrar o turno da mensagem:', error.message)
  }
}

function feedMessageTurn(event) {
  const entry = event?.sessionId ? messageTurns.get(event.sessionId) : null
  if (!entry) return
  if (event.type === 'output') entry.monitor.feed(String(event.data ?? ''))
  else if (event.type === 'exit') entry.monitor.exit(event.exitCode)
}

// Entrega falhou antes de chegar ao terminal: apaga a linha, a menos que um turno anterior ainda a use.
function releaseFailedDelivery(sourceId, targetId) {
  try {
    const stillUsed = [...messageTurns.values()].some((t) => t.targetId === targetId && t.sources.has(sourceId))
    if (!stillUsed) setLinkActive(sourceId, targetId, false)
    broadcastFn({ type: 'workspace-updated', snapshot: getWorkspaceSnapshot() })
  } catch { /* banco indisponível: nada a desfazer */ }
}

const INTER_AGENT_MARKER_RE = /\[(?:PARA|DELEGAR|HANDOFF|ENVIAR)\s*:\s*([^\]]+)\]\s*(.+)/i

function processAgentOutputLine(agentId, sessionId, rawLine) {
  const line = stripAnsi(rawLine).trim()
  if (!line || line.length < 8) return
  // Ignora linhas que fazem parte do próprio prompt/contexto injetado pelo Vértice.
  if (
    line.includes('Contexto Vértice:') ||
    line.includes('Equipe conectada no Organograma:') ||
    line.includes('Para enviar uma mensagem ou passar resultado diretamente') ||
    line.includes('[PARA: NomeDoAgente]') ||
    line.includes('Mensagem recebida do agente ')
  ) return

  const injected = injectedPrompts.get(sessionId)
  if (injected && Date.now() - injected.at < 4000 && injected.text.includes(line.slice(0, 40))) return

  const match = INTER_AGENT_MARKER_RE.exec(line)
  if (!match) return
  const [, rawTarget, rawMessage] = match
  const message = rawMessage.trim()
  if (!message || message.startsWith('<') || message.toLowerCase().startsWith('sua mensagem')) return

  const targetAgent = resolveTargetAgent(agentId, rawTarget)
  if (!targetAgent) return
  void sendAgentMessage(agentId, targetAgent.id, message, { reason: 'marcador [PARA]' })
}

function feedInterAgentRouter(event) {
  if (!event?.agentId || !event?.sessionId || event.type !== 'output') return
  const prev = agentOutputBuffers.get(event.sessionId) ?? ''
  const combined = (prev + String(event.data ?? '')).slice(-8192)
  const parts = combined.split(/\r?\n|\r/)
  agentOutputBuffers.set(event.sessionId, parts.pop() ?? '')
  for (const part of parts) {
    processAgentOutputLine(event.agentId, event.sessionId, part)
  }
}

function scanHandoffFiles() {
  if (listActiveSessions().length === 0 && agentSessions.size === 0) return
  try {
    const snapshot = getWorkspaceSnapshot()
    const projectPath = activeProjectPath(snapshot)
    if (!projectPath) return
    const safeDir = assertAllowedCwd(projectPath, listAllowedWorkspaces())
    const verticeDir = join(safeDir, '.vertice')
    let entries = []
    try { entries = readdirSync(verticeDir) } catch { return }

    for (const name of entries) {
      if (!/^handoff.*\.md$/i.test(name)) continue
      const fullPath = join(verticeDir, name)
      let stat
      try { stat = statSync(fullPath) } catch { continue }
      const prevMtime = seenHandoffFiles.get(fullPath) ?? 0
      if (stat.mtimeMs <= prevMtime) continue
      seenHandoffFiles.set(fullPath, stat.mtimeMs)

      let content = ''
      try { content = readFileSync(fullPath, 'utf8').trim() } catch { continue }
      if (!content) continue

      // Tenta identificar origem e destino pelo nome `handoff-<origem>-to-<destino>.md` ou pelas conexões ativas.
      const nameMatch = /^handoff-([a-z0-9_-]+?)-to-([a-z0-9_-]+)\.md$/i.exec(name)
      let sourceAgent = null
      let targetAgent = null
      if (nameMatch) {
        const [, rawSrc, rawDst] = nameMatch
        sourceAgent = snapshot.agents.find((a) => normalizeAgentKey(a.name) === normalizeAgentKey(rawSrc) || normalizeAgentKey(a.id).startsWith(normalizeAgentKey(rawSrc))) ?? null
        if (sourceAgent) targetAgent = resolveTargetAgent(sourceAgent.id, rawDst, snapshot)
      }
      if (!sourceAgent || !targetAgent) {
        const firstConn = snapshot.connections[0]
        if (firstConn) {
          sourceAgent = sourceAgent ?? snapshot.agents.find((a) => a.id === firstConn.source) ?? null
          targetAgent = targetAgent ?? snapshot.agents.find((a) => a.id === firstConn.target) ?? null
        }
      }
      if (sourceAgent && targetAgent) {
        const summary = content.replace(/\s*[\r\n]+\s*/g, ' ').slice(0, 900)
        void sendAgentMessage(
          sourceAgent.id,
          targetAgent.id,
          `Arquivo .vertice/${name} entregue por ${sourceAgent.name}: ${summary}`,
          { reason: `arquivo .vertice/${name}` },
        )
      }
    }
  } catch { /* ignora erros de leitura transitórios */ }
}

export function baselineHandoffFiles(explicitProjectPath) {
  seenHandoffFiles.clear()
  // Inicializa o mapa com arquivos já existentes antes da sessão para não reenviar handoffs antigos.
  try {
    const projectPath = explicitProjectPath ?? activeProjectPath(getWorkspaceSnapshot())
    if (projectPath) {
      const safeDir = assertAllowedCwd(projectPath, listAllowedWorkspaces())
      const verticeDir = join(safeDir, '.vertice')
      for (const name of readdirSync(verticeDir)) {
        if (/^handoff.*\.md$/i.test(name)) {
          const fullPath = join(verticeDir, name)
          seenHandoffFiles.set(fullPath, statSync(fullPath).mtimeMs)
        }
      }
    }
  } catch { /* diretório .vertice ainda não existe */ }
}

function ensureHandoffWatcher() {
  if (handoffInterval) return
  baselineHandoffFiles()

  handoffInterval = setInterval(scanHandoffFiles, 2500)
  if (typeof handoffInterval.unref === 'function') handoffInterval.unref()
}

export const PROJECT_SWITCH_ERROR = 'Interrompida: o projeto foi trocado ou excluído e a sessão foi encerrada.'

export function stopHeadlessRuns({ reason, agentId } = {}) {
  for (const [workItemId, run] of headlessRuns) {
    if (agentId && run.agentId !== agentId) continue
    headlessRuns.delete(workItemId)
    killHeadlessProcess(run.child)
    if (reason) {
      try {
        recordEvent(run.agentId ?? null, `${reason} (${workItemId})`, 'system')
      } catch { /* banco pode estar fechado durante o encerramento */ }
    }
  }
}

export function resetForProjectSwitch(oldProjectId, { nextProjectPath } = {}) {
  transcripts.flushAll()

  for (const entry of taskMonitors.values()) {
    entry.monitor.cancel()
  }
  taskMonitors.clear()

  for (const entry of messageTurns.values()) {
    entry.monitor.cancel()
    clearTimeout(entry.cap)
  }
  messageTurns.clear()

  stopHeadlessRuns({ reason: 'Execução automática encerrada na troca ou limpeza do projeto' })

  if (oldProjectId) {
    interruptProjectWork(oldProjectId, PROJECT_SWITCH_ERROR)
  }

  agentSessions.clear()
  agentOutputBuffers.clear()
  injectedPrompts.clear()
  recentDeliveries.clear()
  lastAgentForwardAt.clear()
  sessionActivity.clear()
  seenHandoffFiles.clear()

  baselineHandoffFiles(nextProjectPath)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Espera a saída da sessão "assentar": houve saída e ficou quieta por `quietMs`. Desiste em `maxMs`
// (segue mesmo assim, pois algumas CLIs não imprimem nada) ou se a sessão morrer.
async function waitForSessionReady(sessionId, { quietMs = 800, maxMs = 10000 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < maxMs) {
    if (!listActiveSessions().some((s) => s.id === sessionId)) return false
    const last = sessionActivity.get(sessionId)
    if (last && Date.now() - last >= quietMs) return true
    await delay(100)
  }
  return false
}

// Garante uma sessao real viva para o agente, confinada ao workspace do projeto ativo.
// Retorna { sessionId, created }: `created` indica sessão nova (a CLI ainda está subindo).
async function ensureAgentSession(agent, snapshot) {
  const existingId = agentSessions.get(agent.id)
  if (existingId) {
    const stillAlive = listActiveSessions().some((s) => s.id === existingId)
    if (stillAlive) return { sessionId: existingId, created: false }
    agentSessions.delete(agent.id)
  }

  const runtimeId = runtimeIdForAgent(agent)
  const runtime = RUNTIME_CATALOG.find((r) => r.id === runtimeId)
  if (!runtime) throw new Error(`Runtime "${runtimeId}" não está no catálogo.`)

  // Confinamento: runtime aprovado + cwd dentro de um workspace permitido.
  const approved = getSetting('approvedRuntimes') ?? []
  if (!approved.includes(runtimeId)) {
    throw new WorkspaceError(`O runtime "${runtimeId}" do agente ${agent.name} não está aprovado pelo TI.`)
  }
  const projectPath = activeProjectPath(snapshot)
  if (!projectPath) throw new Error('Nenhum projeto ativo. Crie um projeto na aba Projects antes de despachar tarefas.')
  const safeCwd = assertAllowedCwd(projectPath, listAllowedWorkspaces())
  mkdirSync(safeCwd, { recursive: true })

  const command = await resolveCommand(runtime.command)
  const session = startSession({
    agentId: agent.id,
    command,
    args: runtime.sessionArgs,
    cwd: safeCwd,
    onEvent: trackedBroadcast,
  })
  const hadContext = registerAgentSession(agent.id, session.id, { runtimeId, resume: false })
  broadcastFn({ type: 'session-started', ...session })
  return { sessionId: session.id, created: true, hadContext }
}

// --- Conclusão automática (E13 / B3) ------------------------------------------
// Cada tarefa despachada ganha um monitor (task-monitor.js) que observa a saída da sessão e, quando a
// IA termina, move a tarefa de "doing" para "review" (Aguardando aprovação). É inferência por
// heurística (marcador, fim da sessão, silêncio), não um sinal garantido da CLI.
const taskMonitors = new Map() // sessionId -> { monitor, workItemId }

function startTaskMonitor(sessionId, workItemId, runtimeId, instruction) {
  // Nova tarefa na mesma sessão: a anterior deixa de ser observada (continua "doing" até o usuário decidir).
  taskMonitors.get(sessionId)?.monitor.cancel()
  const monitor = createTaskMonitor({
    runtimeId,
    instruction,
    idleMs: Number(process.env.VERTICE_IDLE_COMPLETE_MS) || undefined,
    onComplete: (outcome) => { void autoCompleteTask(sessionId, workItemId, outcome) },
  })
  taskMonitors.set(sessionId, { monitor, workItemId })
}

function cancelTaskMonitor(sessionId) {
  taskMonitors.get(sessionId)?.monitor.cancel()
  taskMonitors.delete(sessionId)
}

function cancelTaskMonitorsFor(workItemId) {
  for (const [sessionId, entry] of taskMonitors) {
    if (entry.workItemId === workItemId) cancelTaskMonitor(sessionId)
  }
}

function feedTaskMonitor(event) {
  const entry = event?.sessionId ? taskMonitors.get(event.sessionId) : null
  if (!entry) return
  if (event.type === 'output') entry.monitor.feed(String(event.data ?? ''))
  else if (event.type === 'exit') entry.monitor.exit(event.exitCode)
}

async function autoCompleteTask(sessionId, workItemId, { reason, result }) {
  const entry = taskMonitors.get(sessionId)
  if (entry?.workItemId === workItemId) taskMonitors.delete(sessionId)
  try {
    const item = getWorkspaceSnapshot().workItems.find((w) => w.id === workItemId)
    // Se o usuário já moveu ou concluiu a tarefa à mão, não sobrescreve a decisão dele.
    if (!item || item.status !== 'doing') return
    recordEvent(item.assigneeId ?? null, `Tarefa concluída pelo agente e movida para Aguardando aprovação: ${item.title}`, 'complete')
    await completeWorkItem(workItemId, { result, auto: true, reason })
  } catch (error) {
    console.error('[orchestrator] falha ao concluir a tarefa automaticamente:', error)
  }
}

function buildDispatchInstruction({ agent, item, snapshot, runtimeId, includeResumeNote, feedback, multiline }) {
  const connectedHint = runtimeId !== 'powershell'
    ? buildConnectedAgentsHint(agent, snapshot.agents, snapshot.connections)
    : ''
  const resumeNote = includeResumeNote && runtimeId !== 'powershell'
    ? buildResumeNote(agent.id, connectedHint)
    : connectedHint
  const specText = item.description && item.description.trim()
    ? `Especificação da tarefa: ${item.description.trim()}`
    : ''
  const reviewText = feedback
    ? `Revisão do gestor (a entrega anterior foi devolvida): ${feedback} Corrija conforme essa revisão e entregue de novo.`
    : ''
  const completionText = !multiline && runtimeId !== 'powershell' ? COMPLETION_INSTRUCTION : ''
  const parts = [resumeNote, agent.prompt, `Tarefa: ${item.title}`, specText, reviewText, completionText]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
  if (multiline) return parts.join('\n\n').trim()
  return parts.join(' ').replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

function assertNoActiveHeadlessRun(workItemId, agentId) {
  if (headlessRuns.has(workItemId) || Array.from(headlessRuns.values()).some((run) => run.agentId === agentId)) {
    const msg = 'Este agente já possui uma execução automática em andamento.'
    recordEvent(agentId, `Despacho automático recusado: ${msg}`, 'system')
    throw createStatusError(409, msg)
  }
}

async function executeHeadlessRun({ workItemId, workItemTitle, agentId, runtime, command, launch, cwd, instruction }) {
  try {
    const raw = await runHeadless({
      command,
      args: launch.args,
      cwd,
      prompt: instruction,
      timeoutMs: launch.timeoutMs,
      env: buildChildEnv(),
      onChild: (child) => {
        if (!headlessRuns.has(workItemId)) {
          killHeadlessProcess(child)
          return
        }
        headlessRuns.set(workItemId, { child, agentId })
      },
    })
    if (!headlessRuns.has(workItemId)) return
    headlessRuns.delete(workItemId)

    const currentItem = getWorkspaceSnapshot().workItems.find((w) => w.id === workItemId)
    if (!currentItem || currentItem.status !== 'doing') return

    const outcome = mapHeadlessOutcome({
      exitCode: raw.exitCode,
      timedOut: raw.timedOut,
      stdout: raw.stdout,
      stderr: raw.stderr,
      kind: runtime.headless.output,
      runtimeId: runtime.id,
    })

    if (outcome.status === 'failed') {
      recordEvent(agentId, `Execução automática falhou (${workItemTitle}): ${outcome.error}`, 'system')
    } else {
      recordEvent(agentId, `Execução automática concluída e movida para Aguardando aprovação: ${workItemTitle}`, 'complete')
    }

    await completeWorkItem(workItemId, {
      status: outcome.status,
      result: outcome.result,
      error: outcome.error,
      auto: true,
      reason: 'headless',
    })
  } catch (error) {
    if (!headlessRuns.has(workItemId)) return
    headlessRuns.delete(workItemId)
    const errMsg = `Falha na execução automática: ${error.message}`
    try {
      const currentItem = getWorkspaceSnapshot().workItems.find((w) => w.id === workItemId)
      if (!currentItem || currentItem.status !== 'doing') return
      recordEvent(agentId, `${errMsg} (${workItemTitle})`, 'system')
      await completeWorkItem(workItemId, {
        status: 'failed',
        error: errMsg,
        auto: true,
        reason: 'headless',
      })
    } catch (completeError) {
      console.error('[orchestrator] falha ao finalizar execução headless com erro:', completeError)
    }
  }
}

/**
 * Despacha um work_item: ao entrar em "doing" com responsavel, garante a sessao real
 * do agente (ou inicia execução headless quando marcada e suportada) e envia o prompt da tarefa.
 * Marca a tarefa e o agente, emite "task-updated".
 * Retorna { ok, sessionId } ou { ok, mode: 'headless' }, ou lanca WorkspaceError (403) / Error.
 */
// G5: `feedback` = tarefa devolvida pelo gestor; a correção vai junto da instrução, na mesma sessão real.
export async function dispatchWorkItem(workItemId, { feedback } = {}) {
  const snapshot = getWorkspaceSnapshot()
  const item = snapshot.workItems.find((w) => w.id === workItemId)
  if (!item) throw new Error('Tarefa não encontrada.')
  if (!item.assigneeId) throw new Error('A tarefa não tem um responsável atribuído.')

  const agent = snapshot.agents.find((a) => a.id === item.assigneeId)
  if (!agent) throw new Error('Agente responsável não encontrado.')
  const blockers = pendingDependencies(item, snapshot.workItems)
  if (blockers.length) {
    throw new Error(`Esta tarefa depende de "${blockers[0].title}"${blockers.length > 1 ? ` e de mais ${blockers.length - 1}` : ''}, ainda não concluída.`)
  }

  const runtimeId = runtimeIdForAgent(agent)
  const runtime = RUNTIME_CATALOG.find((r) => r.id === runtimeId)
  if (!runtime) throw new Error(`Runtime "${runtimeId}" não está no catálogo.`)

  const mode = resolveExecutionMode(item, runtime)

  if (mode === 'headless') {
    const approved = getSetting('approvedRuntimes') ?? []
    if (!approved.includes(runtimeId)) {
      const msg = `O runtime "${runtimeId}" do agente ${agent.name} não está aprovado pelo TI.`
      recordEvent(agent.id, `Despacho automático recusado: ${msg}`, 'system')
      throw new WorkspaceError(msg)
    }

    const projectPath = activeProjectPath(snapshot)
    if (!projectPath) {
      throw createStatusError(400, 'Nenhum projeto ativo. Crie um projeto na aba Projects antes de despachar tarefas.')
    }
    let safeCwd
    try {
      safeCwd = assertAllowedCwd(projectPath, listAllowedWorkspaces())
    } catch (error) {
      if (error instanceof WorkspaceError) {
        recordEvent(agent.id, `Despacho automático recusado: ${error.message}`, 'system')
      }
      throw error
    }

    if (checkAuth(runtime) === 'not-found') {
      const msg = `Faça o login desta CLI (${runtime.name}) na aba CLI's antes de usar execução automática.`
      recordEvent(agent.id, `Despacho automático recusado: ${msg}`, 'system')
      throw createStatusError(400, msg)
    }

    assertNoActiveHeadlessRun(item.id, agent.id)

    const resolvedCmd = await resolveCommand(runtime.command)
    if (!resolvedCmd || (resolvedCmd === runtime.command && !existsSync(resolvedCmd))) {
      const msg = `CLI não encontrada no sistema: ${runtime.name} (${runtime.command}).`
      recordEvent(agent.id, `Despacho automático recusado: ${msg}`, 'system')
      throw createStatusError(400, msg)
    }
    assertNoActiveHeadlessRun(item.id, agent.id)

    const fullAgent = getAgent(agent.id)
    const hadContext = hasPriorContext({
      memory: fullAgent?.memory ?? agent.memory,
      transcript: fullAgent?.lastTranscript,
    })

    mkdirSync(safeCwd, { recursive: true })
    if (feedback) {
      appendAgentMemory(agent.id, formatMemoryEntry({ title: `Devolvida pelo gestor: ${item.title}`, result: `Feedback: ${feedback}` }))
    }
    syncAllMemoryFiles()

    const connectedHint = buildConnectedAgentsHint(agent, snapshot.agents, snapshot.connections)
    const instruction = buildDispatchInstruction({
      agent,
      item,
      snapshot,
      runtimeId,
      includeResumeNote: hadContext || Boolean(connectedHint),
      feedback,
      multiline: true,
    })

    cancelTaskMonitorsFor(item.id)
    patchWorkItem(item.id, { status: 'doing', ranMode: 'headless', result: null, error: null })
    patchAgent(agent.id, { status: 'working', task: item.title })
    recordEvent(
      agent.id,
      feedback
        ? `Tarefa devolvida com feedback para execução automática: ${item.title}`
        : `Tarefa despachada para execução automática: ${item.title}`,
      'delegate',
    )

    const updated = getWorkspaceSnapshot()
    broadcastFn({ type: 'task-updated', workItemId: item.id, snapshot: updated })

    const launch = buildHeadlessLaunch(runtime)
    headlessRuns.set(item.id, { child: null, agentId: agent.id })
    void executeHeadlessRun({
      workItemId: item.id,
      workItemTitle: item.title,
      agentId: agent.id,
      runtime,
      command: resolvedCmd,
      launch,
      cwd: safeCwd,
      instruction,
    })

    return { ok: true, mode: 'headless' }
  }

  const { sessionId, created, hadContext } = await ensureAgentSession(agent, snapshot)

  // Instrução em UMA linha: num terminal interativo cada quebra de linha viraria um Enter e enviaria
  // o prompt picado, em várias submissões.
  const connectedHint = runtimeId !== 'powershell'
    ? buildConnectedAgentsHint(agent, snapshot.agents, snapshot.connections)
    : ''
  syncAllMemoryFiles()
  const instruction = buildDispatchInstruction({
    agent,
    item,
    snapshot,
    runtimeId,
    includeResumeNote: created && (hadContext || Boolean(connectedHint)),
    feedback,
    multiline: false,
  })

  // Sessão nova: espera a CLI terminar de subir antes de digitar.
  if (created) await waitForSessionReady(sessionId)

  const closedMessage = 'A sessão do agente foi encerrada antes de receber a tarefa.'
  markInjectedPrompt(sessionId, instruction)
  if (!writeToSession(sessionId, instruction)) throw new Error(closedMessage)
  // Enter em escrita separada: TUIs tratam "texto + Enter" colados como colagem, não como envio.
  await delay(200)
  // O monitor nasce imediatamente antes do Enter (\r): o eco da digitação já ocorreu nos 200ms acima.
  startTaskMonitor(sessionId, item.id, runtimeId, instruction)
  if (!writeToSession(sessionId, '\r')) { cancelTaskMonitor(sessionId); throw new Error(closedMessage) }

  // Nova rodada: a entrega/erro anteriores deixam de valer (o gestor verá a nova saída na revisão).
  patchWorkItem(item.id, { status: 'doing', ranMode: 'interactive', result: null, error: null })
  patchAgent(agent.id, { status: 'working', task: item.title })
  if (item.headless) {
    recordEvent(agent.id, `Runtime "${runtime.name}" não possui modo automático; executando "${item.title}" em modo interativo.`, 'system')
  }
  recordEvent(agent.id, feedback ? `Tarefa devolvida com feedback do gestor: ${item.title}` : `Tarefa despachada para sessão real: ${item.title}`, 'delegate')
  if (feedback && appendAgentMemory(agent.id, formatMemoryEntry({ title: `Devolvida pelo gestor: ${item.title}`, result: `Feedback: ${feedback}` }))) syncMemoryFile(agent.id)

  const updated = getWorkspaceSnapshot()
  broadcastFn({ type: 'task-updated', workItemId: item.id, snapshot: updated })
  return { ok: true, sessionId }
}

/**
 * Conexoes do organograma governam quem pode delegar a quem.
 * Retorna true se existe conexao source -> target.
 */
export function canDelegate(sourceId, targetId) {
  const { connections } = getWorkspaceSnapshot()
  return connections.some((c) => c.source === sourceId && c.target === targetId)
}

// --- Conclusao da tarefa ----------------------------------------------------------
// Chamada pelo usuario (mover o card para "review"), pela deteccao automatica (E13, acima) ou pelo
// runner headless (G9), que passa `auto: true`.
export async function completeWorkItem(workItemId, { status: explicitStatus, result, error, auto = false, reason } = {}) {
  cancelTaskMonitorsFor(workItemId) // conclusão manual (ou automática): para de observar a tarefa
  const activeRun = headlessRuns.get(workItemId)
  if (activeRun) {
    headlessRuns.delete(workItemId)
    killHeadlessProcess(activeRun.child)
  }
  const status = explicitStatus === 'failed' || explicitStatus === 'review'
    ? explicitStatus
    : (error ? 'failed' : 'review')
  const updated = patchWorkItem(workItemId, { status, result: result ?? null, error: error ?? null })
  if (!updated) return { ok: false, error: 'Tarefa não encontrada.' }

  // B4: status do agente derivado do real — sem tarefa "doing", turno ou execução ativa, volta a idle.
  const snap = getWorkspaceSnapshot()
  const item = snap.workItems.find((w) => w.id === workItemId)
  if (item?.assigneeId) {
    // E14: a tarefa entra na memória viva do agente (SQLite + arquivo .vertice/memory/<agente>.md).
    if (appendAgentMemory(item.assigneeId, formatMemoryEntry({ title: item.title, result, error }))) syncMemoryFile(item.assigneeId)
    if (!isAgentBusy(item.assigneeId, snap)) patchAgent(item.assigneeId, { status: 'idle', task: '' })

    // E15: se o agente que concluiu a tarefa tem agentes conectados a jusante (source -> target) e
    // ainda não encaminhou mensagem nos últimos 15s, encaminha automaticamente o resultado para revisão/continuidade.
    if (status !== 'failed' && !error && result && Date.now() - (lastAgentForwardAt.get(item.assigneeId) ?? 0) > 15000) {
      const outgoing = snap.connections.filter((c) => c.source === item.assigneeId)
      for (const conn of outgoing) {
        void sendAgentMessage(
          item.assigneeId,
          conn.target,
          `Tarefa concluída ("${item.title}"): ${String(result).slice(0, 600)}`,
          { reason: 'conclusão de tarefa' },
        )
      }
    }
  }

  const snapshot = getWorkspaceSnapshot()
  // `auto` avisa o frontend que foi a IA (e não o usuário) quem concluiu: ele mostra um aviso.
  broadcastFn({ type: 'task-updated', workItemId, snapshot, ...(auto ? { auto: true, reason } : {}) })
  return { ok: true, status }
}

// G5: o gestor aprova a entrega revisada ("Aguardando aprovação" -> "Concluído").
export function approveWorkItem(workItemId) {
  const item = getWorkspaceSnapshot().workItems.find((w) => w.id === workItemId)
  if (!item) return { ok: false, status: 404, error: 'Tarefa não encontrada.' }
  if (item.status !== 'review') return { ok: false, status: 409, error: 'Só tarefas em "Aguardando aprovação" podem ser aprovadas.' }
  patchWorkItem(item.id, { status: 'done' })
  recordEvent(item.assigneeId ?? null, `Entrega aprovada pelo gestor: ${item.title}`, 'complete')
  broadcastFn({ type: 'task-updated', workItemId: item.id, snapshot: getWorkspaceSnapshot() })
  const released = releaseDependents(item.id)
  return { ok: true, released }
}

// --- Cadeia de tarefas (G6) -------------------------------------------------------
// Dependências que ainda não estão "done". Dependência que não existe mais não bloqueia.
export function pendingDependencies(item, workItems) {
  return (item.dependsOn ?? []).map((id) => workItems.find((w) => w.id === id)).filter((dep) => dep && dep.status !== 'done')
}

/**
 * Uma tarefa chegou a "done": inicia as que dependiam dela, estão em "A fazer", têm responsável e não
 * esperam mais nada. Despacha uma de cada vez (duas instruções digitadas ao mesmo tempo no mesmo
 * terminal se embaralhariam). Devolve os ids que serão iniciados.
 */
export function releaseDependents(doneItemId) {
  const { workItems } = getWorkspaceSnapshot()
  const ready = workItems.filter((w) => w.status === 'todo' && w.assigneeId
    && (w.dependsOn ?? []).includes(doneItemId) && pendingDependencies(w, workItems).length === 0)
  if (!ready.length) return []
  void (async () => {
    for (const item of ready) {
      try {
        recordEvent(item.assigneeId, `Dependências concluídas: iniciando "${item.title}" automaticamente`, 'delegate')
        await dispatchWorkItem(item.id)
      } catch (error) {
        recordEvent(item.assigneeId, `Não foi possível iniciar "${item.title}" automaticamente: ${error.message}`, 'system')
        broadcastFn({ type: 'workspace-updated', snapshot: getWorkspaceSnapshot() })
      }
    }
  })()
  return ready.map((w) => w.id)
}

/** Tarefa excluída: para de observá-la, encerra execução headless se ativa e libera o agente (se não houver outra). */
export function onWorkItemRemoved(itemOrId) {
  if (!itemOrId) return
  const itemId = typeof itemOrId === 'string' ? itemOrId : itemOrId.id
  if (!itemId) return
  cancelTaskMonitorsFor(itemId)

  const run = headlessRuns.get(itemId)
  const agentId = (typeof itemOrId === 'object' ? itemOrId.assigneeId : null) ?? run?.agentId ?? null
  const wasDoing = typeof itemOrId === 'object' ? itemOrId.status === 'doing' : Boolean(run)

  if (run) {
    headlessRuns.delete(itemId)
    killHeadlessProcess(run.child)
    recordEvent(run.agentId ?? null, `Execução automática cancelada por remoção da tarefa (${itemId})`, 'system')
  }

  if (agentId && wasDoing) {
    const snap = getWorkspaceSnapshot()
    if (!isAgentBusy(agentId, snap) && snap.agents.some((a) => a.id === agentId)) {
      patchAgent(agentId, { status: 'idle', task: '' })
    }
  }
}

