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
}

export interface AgentConnection {
  id: string
  source: string
  target: string
  label?: string
  active?: boolean
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
export type WorkPriority = 'alta' | 'media' | 'baixa'

export interface Goal {
  id: string
  title: string
  description: string
}

export interface WorkItem {
  id: string
  title: string
  status: WorkStatus
  assigneeId?: string
  goalId?: string
  priority: WorkPriority
  /** Saída resumida da IA ao concluir (preenchida pelo core ao ir para review). */
  result?: string
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
