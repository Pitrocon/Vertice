import type { DetectedRuntime } from '@/lib/api'
import type { Agent, TerminalLine } from '@/types/agent'

/** Mapeamento entre o nome exibido do runtime no agente e o id do catálogo no core. */
export const RUNTIME_NAME_TO_ID: Record<string, string> = {
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

/** Localiza o item correspondente em `runtimes` a partir do nome ou id configurado no agente. */
export function findDetectedRuntime(runtimes: DetectedRuntime[] | null, agentRuntime?: string): DetectedRuntime | undefined {
  if (!runtimes || !agentRuntime) return undefined
  const mappedId = RUNTIME_NAME_TO_ID[agentRuntime]
  const normalized = agentRuntime.trim().toLowerCase()
  return runtimes.find((runtime) =>
    (mappedId && runtime.id === mappedId)
    || runtime.id.toLowerCase() === normalized
    || runtime.name.toLowerCase() === normalized,
  )
}

// Linhas da conversa anterior restauradas no terminal de cada agente ao reabrir o programa.
export const MAX_RESTORED_LINES = 300
export const RESTORED_MARKER = '— Memória viva carregada · conversa anterior preservada —'

/**
 * Terminais depois de um snapshot novo do core:
 * - descarta linhas de agentes que não existem mais (ex.: linhas de demonstração), mantendo os
 *   terminais de instalação de CLIs (`install-*`);
 * - restaura a conversa anterior (`lastTranscript`) de cada agente que ainda não tem linhas.
 */
export function reconcileTerminalLines(
  current: Record<string, TerminalLine[]>,
  agents: Agent[],
  makeId: () => string = () => crypto.randomUUID(),
): Record<string, TerminalLine[]> {
  const agentIds = new Set(agents.map((agent) => agent.id))
  const next: Record<string, TerminalLine[]> = {}
  for (const [key, lines] of Object.entries(current)) {
    if (agentIds.has(key) || key.startsWith('install-')) next[key] = lines
  }
  for (const agent of agents) {
    if (!agent.lastTranscript || next[agent.id]?.length) continue
    const previous = agent.lastTranscript
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== '')
      .slice(-MAX_RESTORED_LINES)
    if (!previous.length) continue
    next[agent.id] = [
      ...previous.map((text) => ({ id: makeId(), type: 'output' as const, text })),
      { id: makeId(), type: 'muted' as const, text: RESTORED_MARKER },
    ]
  }
  return next
}

/** O próprio agente e todos abaixo dele no organograma: escolher um deles como supervisor criaria um ciclo. */
export function selfAndDescendants(agents: Agent[], id: string): Set<string> {
  const blocked = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const agent of agents) {
      if (agent.createdBy && blocked.has(agent.createdBy) && !blocked.has(agent.id)) {
        blocked.add(agent.id)
        grew = true
      }
    }
  }
  return blocked
}