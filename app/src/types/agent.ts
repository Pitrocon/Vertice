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

export const statusLabels: Record<AgentStatus, string> = {
  working: 'Executando',
  idle: 'Disponível',
  paused: 'Pausado',
  queued: 'Na fila',
}
