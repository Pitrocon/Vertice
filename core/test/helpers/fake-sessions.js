/**
 * Camada de sessões falsa para testes do orquestrador sem abrir node-pty nem executar CLIs reais.
 * Compatível com `configureOrchestrator({ broadcast, sessionApi })`.
 */
export function createFakeSessions({
  autoReady = true,
  readyBanner = 'CLI pronta\n',
  missingCommands = [],
} = {}) {
  let seq = 0
  const activeSessions = new Map()
  const allSessions = new Map()
  const started = []
  const writes = []
  const missing = new Set(missingCommands)

  async function resolveCommand(command) {
    if (missing.has(command)) return command
    return `C:\\fake-bin\\${command}.exe`
  }

  function startSession({ agentId, runtimeId, command, args = [], cwd, cols, rows, onEvent = () => {} }) {
    seq += 1
    const id = `fake-session-${seq}`
    const summary = { id, agentId, command, cwd, mode: 'fake' }
    const record = {
      ...summary,
      runtimeId,
      args: [...args],
      cols,
      rows,
      onEvent,
      writes: [],
    }
    activeSessions.set(id, record)
    allSessions.set(id, record)
    started.push({ ...summary, runtimeId, args: [...args] })

    if (autoReady) {
      queueMicrotask(() => {
        if (activeSessions.has(id)) {
          onEvent({ type: 'output', sessionId: id, agentId, data: readyBanner })
        }
      })
    }

    return summary
  }

  function writeToSession(sessionId, data) {
    const session = activeSessions.get(sessionId)
    if (!session) return false
    const text = String(data ?? '')
    writes.push({ sessionId, agentId: session.agentId, data: text })
    session.writes.push(text)
    return true
  }

  function listActiveSessions() {
    return [...activeSessions.values()].map(({ id, agentId, command, cwd, mode }) => ({
      id,
      agentId,
      command,
      cwd,
      mode,
    }))
  }

  function killSession(sessionId) {
    if (!activeSessions.has(sessionId)) return false
    activeSessions.delete(sessionId)
    return true
  }

  function emitOutput(sessionId, data) {
    const session = activeSessions.get(sessionId) ?? allSessions.get(sessionId)
    if (!session) return false
    session.onEvent({ type: 'output', sessionId, agentId: session.agentId, data: String(data ?? '') })
    return true
  }

  function emitExit(sessionId, exitCode = 0) {
    const session = activeSessions.get(sessionId) ?? allSessions.get(sessionId)
    if (!session) return false
    activeSessions.delete(sessionId)
    session.onEvent({ type: 'exit', sessionId, agentId: session.agentId, exitCode })
    return true
  }

  return {
    sessionApi: {
      startSession,
      writeToSession,
      listActiveSessions,
      resolveCommand,
      killSession,
    },
    writes,
    started,
    activeSessions,
    writesFor(sessionId) {
      return writes.filter((w) => w.sessionId === sessionId).map((w) => w.data)
    },
    writesForAgent(agentId) {
      return writes.filter((w) => w.agentId === agentId).map((w) => w.data)
    },
    sessionForAgent(agentId) {
      return [...activeSessions.values()].find((s) => s.agentId === agentId) ?? null
    },
    setMissingCommand(command, isMissing = true) {
      if (isMissing) missing.add(command)
      else missing.delete(command)
    },
    emitOutput,
    emitExit,
    reset() {
      seq = 0
      activeSessions.clear()
      allSessions.clear()
      started.length = 0
      writes.length = 0
      missing.clear()
    },
  }
}
