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

async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

  async createSession(input: { agentId: string; runtimeId: string; cwd: string }): Promise<LiveSessionInfo | null> {
    const res = await post<{ session: LiveSessionInfo }>('/api/sessions', input)
    return res?.session ?? null
  },

  async sendInput(sessionId: string, data: string): Promise<boolean> {
    const res = await post<{ ok: boolean }>(`/api/sessions/${sessionId}/input`, { data })
    return res?.ok === true
  },

  async killSession(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE}/api/sessions/${sessionId}`, { method: 'DELETE' })
      return res.ok
    } catch {
      return false
    }
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
  return text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][0-9A-B]/g, '')
    .replace(/\r/g, '')
}
