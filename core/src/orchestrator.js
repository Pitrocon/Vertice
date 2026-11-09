import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { RUNTIME_CATALOG, resolveCommand } from './runtimes.js'
import { createTaskMonitor, COMPLETION_INSTRUCTION } from './task-monitor.js'
import { startSession, writeToSession, listActiveSessions } from './sessions.js'
import { assertAllowedCwd, WorkspaceError } from './workspace.js'
import {
  getWorkspaceSnapshot, patchWorkItem, patchAgent, recordEvent,
  getSetting, listAllowedWorkspaces,
} from './db.js'

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
let broadcastFn = () => {}

export function configureOrchestrator({ broadcast }) {
  if (typeof broadcast === 'function') broadcastFn = broadcast
}

export function registerAgentSession(agentId, sessionId) {
  if (agentId && sessionId) agentSessions.set(agentId, sessionId)
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
  const active = snapshot.projects.find((p) => p.active) ?? snapshot.projects[0]
  return active?.path ?? ''
}

// Atividade de saída por sessão: serve para saber quando a CLI terminou de subir e está pronta para
// receber a instrução (digitar antes disso perde ou embaralha o texto).
const sessionActivity = new Map()

function trackedBroadcast(event) {
  if (event?.type === 'output' && event.sessionId) sessionActivity.set(event.sessionId, Date.now())
  else if (event?.type === 'exit' && event.sessionId) sessionActivity.delete(event.sessionId)
  broadcastFn(event)
  feedTaskMonitor(event)
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
  agentSessions.set(agent.id, session.id)
  broadcastFn({ type: 'session-started', ...session })
  return { sessionId: session.id, created: true }
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

/**
 * Despacha um work_item: ao entrar em "doing" com responsavel, garante a sessao real
 * do agente e envia o prompt da tarefa. Marca a tarefa e o agente, emite "task-updated".
 * Retorna { ok, sessionId } ou lanca WorkspaceError (403) / Error.
 */
export async function dispatchWorkItem(workItemId) {
  const snapshot = getWorkspaceSnapshot()
  const item = snapshot.workItems.find((w) => w.id === workItemId)
  if (!item) throw new Error('Tarefa não encontrada.')
  if (!item.assigneeId) throw new Error('A tarefa não tem um responsável atribuído.')

  const agent = snapshot.agents.find((a) => a.id === item.assigneeId)
  if (!agent) throw new Error('Agente responsável não encontrado.')

  const { sessionId, created } = await ensureAgentSession(agent, snapshot)

  // Instrução em UMA linha: num terminal interativo cada quebra de linha viraria um Enter e enviaria
  // o prompt picado, em várias submissões.
  const runtimeId = runtimeIdForAgent(agent)
  // O PowerShell digita a instrução como COMANDO: o pedido do marcador só vale para CLIs de IA.
  const instruction = [agent.prompt, `Tarefa: ${item.title}`, runtimeId === 'powershell' ? '' : COMPLETION_INSTRUCTION]
    .filter(Boolean)
    .join(' ')
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .trim()

  // Sessão nova: espera a CLI terminar de subir antes de digitar.
  if (created) await waitForSessionReady(sessionId)

  const closedMessage = 'A sessão do agente foi encerrada antes de receber a tarefa.'
  if (!writeToSession(sessionId, instruction)) throw new Error(closedMessage)
  // Enter em escrita separada: TUIs tratam "texto + Enter" colados como colagem, não como envio.
  await delay(200)
  // O monitor nasce imediatamente antes do Enter (\r): o eco da digitação já ocorreu nos 200ms acima.
  startTaskMonitor(sessionId, item.id, runtimeId, instruction)
  if (!writeToSession(sessionId, '\r')) { cancelTaskMonitor(sessionId); throw new Error(closedMessage) }

  patchWorkItem(item.id, { status: 'doing' })
  patchAgent(agent.id, { status: 'working', task: item.title })
  recordEvent(agent.id, `Tarefa despachada para sessão real: ${item.title}`, 'delegate')

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
// Chamada pelo usuario (mover o card para "review") ou pela deteccao automatica (E13, acima), que
// passa `auto: true`. A deteccao e heuristica e AINDA NAO foi validada com uma CLI real autenticada.
// Um modo nao interativo (prompt unico + exit code/JSON) seria uma alternativa mais confiavel (F1).
export async function completeWorkItem(workItemId, { result, error, auto = false, reason } = {}) {
  cancelTaskMonitorsFor(workItemId) // conclusão manual (ou automática): para de observar a tarefa
  const status = error ? 'failed' : 'review'
  const updated = patchWorkItem(workItemId, { status, result: result ?? null, error: error ?? null })
  if (!updated) return { ok: false, error: 'Tarefa não encontrada.' }

  // B4: status do agente derivado do real — sem tarefa "doing" ativa, volta a idle.
  const snap = getWorkspaceSnapshot()
  const item = snap.workItems.find((w) => w.id === workItemId)
  if (item?.assigneeId) {
    const stillBusy = snap.workItems.some((w) => w.assigneeId === item.assigneeId && w.status === 'doing')
    if (!stillBusy) patchAgent(item.assigneeId, { status: 'idle', task: '' })
  }

  const snapshot = getWorkspaceSnapshot()
  // `auto` avisa o frontend que foi a IA (e não o usuário) quem concluiu: ele mostra um aviso.
  broadcastFn({ type: 'task-updated', workItemId, snapshot, ...(auto ? { auto: true, reason } : {}) })
  return { ok: true, status }
}

