import type { Agent, AgentConnection, ActivityEvent, Goal, WorkItem, Project } from '@/types/agent'

const BASE = 'http://localhost:7845'

export interface DetectedRuntime {
  id: string
  name: string
  kind: string
  command: string
  status: 'installed' | 'missing'
  version: string | null
  path: string | null
  install: string | null
}

export interface LiveSessionInfo {
  id: string
  agentId: string
  command: string
  cwd: string
  mode: 'pty' | 'pipe'
}

export interface WorkspaceSnapshot {
  projects: Project[]
  agents: Agent[]
  connections: AgentConnection[]
  goals: Goal[]
  workItems: WorkItem[]
  events: ActivityEvent[]
}

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function request<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export const api = {
  async health(): Promise<boolean> {
    const res = await get<{ ok: boolean }>('/api/health')
    return res?.ok === true
  },

  async runtimes(): Promise<DetectedRuntime[] | null> {
    const res = await get<{ runtimes: DetectedRuntime[] }>('/api/runtimes')
    return res?.runtimes ?? null
  },

  async getWorkspace(): Promise<WorkspaceSnapshot | null> {
    return get<WorkspaceSnapshot>('/api/workspace')
  },

  async resetWorkspace(): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', '/api/workspace/reset')
  },

  async createProject(input: { id?: string; name: string; path: string; description: string }): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', '/api/projects', input)
  },

  async activateProject(id: string): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', `/api/projects/${id}/activate`)
  },

  async createAgent(input: Agent & { parentId?: string }): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', '/api/agents', input)
  },

  async batchDelegate(input: {
    agents: Agent[]
    connections: AgentConnection[]
    managerUpdate?: Partial<Agent> & { id: string }
    eventMessage?: string
  }): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', '/api/agents/batch', input)
  },

  async patchAgent(id: string, fields: Partial<Agent>): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('PATCH', `/api/agents/${id}`, fields)
  },

  async deleteAgent(id: string): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('DELETE', `/api/agents/${id}`)
  },

  async createConnection(input: AgentConnection): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', '/api/connections', input)
  },

  async createGoal(input: Goal): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', '/api/goals', input)
  },

  async createWorkItem(input: WorkItem): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('POST', '/api/work-items', input)
  },

  async patchWorkItem(id: string, fields: Partial<WorkItem>): Promise<WorkspaceSnapshot | null> {
    return request<WorkspaceSnapshot>('PATCH', `/api/work-items/${id}`, fields)
  },

  async createSession(input: { agentId: string; runtimeId: string; cwd: string }): Promise<LiveSessionInfo | null> {
    const res = await request<{ session: LiveSessionInfo }>('POST', '/api/sessions', input)
    return res?.session ?? null
  },

  async sendInput(sessionId: string, data: string): Promise<boolean> {
    const res = await request<{ ok: boolean }>('POST', `/api/sessions/${sessionId}/input`, { data })
    return res?.ok === true
  },

  async killSession(sessionId: string): Promise<boolean> {
    const res = await request<{ ok: boolean }>('DELETE', `/api/sessions/${sessionId}`)
    return res?.ok === true
  },
}

export function connectEvents(onEvent: (event: Record<string, unknown>) => void): WebSocket | null {
  try {
    const socket = new WebSocket('ws://localhost:7845/ws')
    socket.onmessage = (raw) => {
      try {
        onEvent(JSON.parse(String(raw.data)))
      } catch { /* ignora */ }
    }
    return socket
  } catch {
    return null
  }
}

export function stripAnsi(text: string): string {
  /* eslint-disable no-control-regex */
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\r/g, '')
  /* eslint-enable no-control-regex */
}
