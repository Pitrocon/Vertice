import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { RUNTIME_CATALOG, resolveCommand } from './runtimes.js'
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
  const instruction = [agent.prompt, `Tarefa: ${item.title}`]
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
  if (!writeToSession(sessionId, '\r')) throw new Error(closedMessage)

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

// --- B3 (PREPARADO, DESATIVADO) ------------------------------------------
// Deteccao automatica de conclusao via modo nao interativo da CLI.
// Requer a CLI instalada E AUTENTICADA (ex.: claude login). Nesta maquina as
// CLIs de IA ainda nao estao autenticadas, entao a conclusao continua sendo
// marcada manualmente (mover o card para "review"/"done" na UI). Quando o login
// estiver disponivel, implementar aqui a execucao com prompt unico + exit code/JSON
// e chamar completeWorkItem() com result/error. NAO apresentar como real ate validar.
export async function completeWorkItem(workItemId, { result, error } = {}) {
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
  broadcastFn({ type: 'task-updated', workItemId, snapshot })
  return { ok: true, status }
}

