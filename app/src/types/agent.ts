export type AgentStatus = 'working' | 'idle' | 'paused' | 'queued'
export type AgentKind = 'manager' | 'worker'

export interface Agent {
  id: string
  name: string
  role: string
  kind: AgentKind
  runtime: string
  model: string
  status: AgentStatus
  task: string
  progress: number
  prompt: string
  x: number
  y: number
  createdBy?: string
  /** Memória viva: uma linha por tarefa concluída (vem do core). */
  memory?: string
  /** Última conversa do terminal; só vem no carregamento inicial (GET /api/workspace). */
  lastTranscript?: string
}

/** Ponto de conexão de um agente no organograma (ids dos <Handle> do AgentNode). */
export type ConnectionHandle = 'top' | 'right' | 'bottom' | 'left'

export interface AgentConnection {
  id: string
  source: string
  target: string
  label?: string
  active?: boolean
  /** Ponto de saída no agente de origem; ausente = ponto automático. */
  sourceHandle?: ConnectionHandle
  /** Ponto de chegada no agente de destino; ausente = ponto automático. */
  targetHandle?: ConnectionHandle
}

export interface ActivityEvent {
  id: string
  agentId: string
  message: string
  time: string
  type: 'create' | 'delegate' | 'complete' | 'system'
}

export interface TerminalLine {
  id: string
  type: 'command' | 'output' | 'success' | 'muted'
  text: string
}

export type WorkStatus = 'todo' | 'doing' | 'review' | 'done'
/** Status gravado da tarefa: as 4 colunas do quadro + "failed" (exibida em Aguardando aprovação). */
export type WorkItemStatus = WorkStatus | 'failed'
export type WorkPriority = 'alta' | 'media' | 'baixa'

export interface Goal {
  id: string
  title: string
  description: string
}

export interface WorkItem {
  id: string
  title: string
  /** Especificação detalhada da tarefa (instruções e critérios de aceite). */
  description?: string
  status: WorkItemStatus
  assigneeId?: string
  goalId?: string
  priority: WorkPriority
  /** Saída da IA ao concluir (preenchida pelo core ao ir para review). */
  result?: string
  /** Motivo da falha quando `status` é "failed". */
  error?: string
  /** G6: ids das tarefas que precisam estar concluídas antes desta começar. */
  dependsOn?: string[]
  parentTaskId?: string
  createdAt?: string
  updatedAt?: string
}

export interface Project {
  id: string
  name: string
  path: string
  description: string
  active?: boolean
}

export type CliStatus = 'installed' | 'missing' | 'checking' | 'installing'

export interface CliRuntime {
  id: string
  name: string
  kind: 'CLI de IA' | 'Modelo local'
  command: string
  version?: string
  status: CliStatus
  approved: boolean
}

export const statusLabels: Record<AgentStatus, string> = {
  working: 'Executando',
  idle: 'Disponível',
  paused: 'Pausado',
  queued: 'Na fila',
}

export const workStatusLabels: Record<WorkStatus, string> = {
  todo: 'A fazer',
  doing: 'Em andamento',
  review: 'Aguardando aprovação',
  done: 'Concluído',
}

export const workStatusOrder: WorkStatus[] = ['todo', 'doing', 'review', 'done']

export const priorityLabels: Record<WorkPriority, string> = {
  alta: 'Alta',
  media: 'Média',
  baixa: 'Baixa',
}
