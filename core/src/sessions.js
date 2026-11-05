import { spawn as spawnPiped } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { recordSession, endSession, recordEvent } from './db.js'

let pty = null
try {
  pty = await import('node-pty')
} catch {
  console.warn('[sessions] node-pty indisponível — usando processos com pipes (sem interatividade completa)')
}

const sessions = new Map()

// Ambiente filtrado repassado aos processos: remove variaveis internas do Vertice
// para nao vazar segredos/config do core para dentro das CLIs.
function buildChildEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^VERTICE_/i.test(key)) delete env[key]
  }
  return env
}

export function startSession({ agentId, command, args = [], cwd, onEvent }) {
  // cwd DEVE chegar aqui ja validado/confinado pela camada de rota (assertAllowedCwd).
  // Nao ha fallback para homedir(): sem cwd valido, a sessao nao inicia.
  if (!cwd || typeof cwd !== 'string') {
    throw new Error('cwd confinado é obrigatório para iniciar a sessão.')
  }
  const id = randomUUID()
  const childEnv = buildChildEnv()
  let proc
  let mode

  if (pty) {
    // node-pty (CreateProcess) não executa .cmd/.bat diretamente — embrulhar via cmd.exe
    const isBatch = /\.(cmd|bat)$/i.test(command)
    const spawnCmd = isBatch ? 'cmd.exe' : command
    const spawnArgs = isBatch ? ['/c', command, ...args] : args
    proc = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd,
      env: childEnv,
    })
    mode = 'pty'
    proc.onData((data) => onEvent({ type: 'output', sessionId: id, agentId, data }))
    proc.onExit(({ exitCode }) => {
      sessions.delete(id)
      endSession(id)
      onEvent({ type: 'exit', sessionId: id, agentId, exitCode })
    })
  } else {
    proc = spawnPiped(command, args, { cwd, env: childEnv, shell: true })
    mode = 'pipe'
    proc.stdout.on('data', (data) => onEvent({ type: 'output', sessionId: id, agentId, data: data.toString() }))
    proc.stderr.on('data', (data) => onEvent({ type: 'output', sessionId: id, agentId, data: data.toString() }))
    proc.on('exit', (exitCode) => {
      sessions.delete(id)
      endSession(id)
      onEvent({ type: 'exit', sessionId: id, agentId, exitCode })
    })
  }

  const session = { id, agentId, command, args, cwd, mode, proc }
  sessions.set(id, session)
  recordSession({ id, agentId, command: `${command} ${args.join(' ')}`.trim(), cwd })
  recordEvent(agentId, `Sessão real iniciada: ${command} (${cwd})`, 'system')
  return { id, agentId, command, cwd, mode }
}

export function writeToSession(id, data) {
  const session = sessions.get(id)
  if (!session) return false
  if (session.mode === 'pty') session.proc.write(data)
  else session.proc.stdin.write(data)
  return true
}

export function resizeSession(id, cols, rows) {
  const session = sessions.get(id)
  if (!session || session.mode !== 'pty') return false
  session.proc.resize(cols, rows)
  return true
}

export function killSession(id) {
  const session = sessions.get(id)
  if (!session) return false
  try { session.proc.kill() } catch { /* já morto */ }
  sessions.delete(id)
  endSession(id)
  return true
}

export function listActiveSessions() {
  return [...sessions.values()].map(({ id, agentId, command, cwd, mode }) => ({ id, agentId, command, cwd, mode }))
}
