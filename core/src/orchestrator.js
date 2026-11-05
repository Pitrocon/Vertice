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

function runtimeIdForAgent(agent) {
  return RUNTIME_NAME_TO_ID[agent.runtime] ?? 'powershell'
}

function activeProjectPath(snapshot) {
  const active = snapshot.projects.find((p) => p.active) ?? snapshot.projects[0]
  return active?.path ?? ''
}

// Garante uma sessao real viva para o agente, confinada ao workspace do projeto ativo.
async function ensureAgentSession(agent, snapshot) {
  const existingId = agentSessions.get(agent.id)
  if (existingId) {
    const stillAlive = listActiveSessions().some((s) => s.id === existingId)
    if (stillAlive) return existingId
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
  const safeCwd = assertAllowedCwd(activeProjectPath(snapshot), listAllowedWorkspaces())
  mkdirSync(safeCwd, { recursive: true })

  const command = await resolveCommand(runtime.command)
  const session = startSession({
    agentId: agent.id,
    command,
    args: runtime.sessionArgs,
    cwd: safeCwd,
    onEvent: broadcastFn,
  })
  agentSessions.set(agent.id, session.id)
  broadcastFn({ type: 'session-started', ...session })
  return session.id
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

  const sessionId = await ensureAgentSession(agent, snapshot)

  // Monta a instrucao da tarefa a partir do prompt do agente + titulo da tarefa.
  const instruction = `${agent.prompt ? agent.prompt + '\n\n' : ''}Tarefa: ${item.title}`
  writeToSession(sessionId, `${instruction}\r`)

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
  patchWorkItem(workItemId, { status, result: result ?? null, error: error ?? null })

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

