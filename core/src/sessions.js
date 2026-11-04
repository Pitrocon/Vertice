import { spawn as spawnPiped } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { recordSession, endSession, recordEvent } from './db.js'

let pty = null
try {
  pty = await import('node-pty')
} catch {
  console.warn('[sessions] node-pty indisponível — usando processos com pipes (sem interatividade completa)')
}

const sessions = new Map()

function safeCwd(cwd) {
  if (cwd && existsSync(cwd)) return cwd
  return homedir()
}

export function startSession({ agentId, command, args = [], cwd, onEvent }) {
  const id = randomUUID()
  const finalCwd = safeCwd(cwd)
  let proc
  let mode

  if (pty) {
    proc = pty.spawn(command, args, {
      name: 'xterm-color',
      cols: 120,
      rows: 30,
      cwd: finalCwd,
      env: process.env,
    })
    mode = 'pty'
    proc.onData((data) => onEvent({ type: 'output', sessionId: id, agentId, data }))
    proc.onExit(({ exitCode }) => {
      sessions.delete(id)
      endSession(id)
      onEvent({ type: 'exit', sessionId: id, agentId, exitCode })
    })
  } else {
    proc = spawnPiped(command, args, { cwd: finalCwd, env: process.env, shell: true })
    mode = 'pipe'
    proc.stdout.on('data', (data) => onEvent({ type: 'output', sessionId: id, agentId, data: data.toString() }))
    proc.stderr.on('data', (data) => onEvent({ type: 'output', sessionId: id, agentId, data: data.toString() }))
    proc.on('exit', (exitCode) => {
      sessions.delete(id)
      endSession(id)
      onEvent({ type: 'exit', sessionId: id, agentId, exitCode })
    })
  }

  const session = { id, agentId, command, args, cwd: finalCwd, mode, proc }
  sessions.set(id, session)
  recordSession({ id, agentId, command: `${command} ${args.join(' ')}`.trim(), cwd: finalCwd })
  recordEvent(agentId, `Sessão real iniciada: ${command} (${finalCwd})`, 'system')
  return { id, agentId, command, cwd: finalCwd, mode }
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
