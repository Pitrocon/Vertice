import { spawn, execFile, ChildProcess } from 'node:child_process'
import { buildChildEnv } from './sessions.js'
import { stripAnsi } from './task-monitor.js'

const DEFAULT_TIMEOUT_MS = 900_000
const MAX_CAPTURE_BYTES = 1024 * 1024
const MAX_ERROR_TAIL_CHARS = 500
const TIMEOUT_GRACE_MS = 300

/**
 * Decide o modo de execução de uma tarefa: 'headless' somente quando a tarefa está
 * marcada e o runtime declara bloco headless válido; caso contrário 'interactive'.
 */
export function resolveExecutionMode(workItem, runtime) {
  if (Boolean(workItem?.headless) && Boolean(runtime?.headless && Array.isArray(runtime.headless.args))) {
    return 'headless'
  }
  return 'interactive'
}

/**
 * Monta argumentos e timeout de lançamento headless a partir do manifesto e das flags
 * de política. Nunca inclui o prompt do usuário nos argumentos do processo.
 */
export function buildHeadlessLaunch(runtime, { policyArgs = [] } = {}) {
  if (!runtime?.headless || !Array.isArray(runtime.headless.args)) {
    throw new Error('Runtime não possui configuração de modo headless.')
  }
  const extra = Array.isArray(policyArgs) ? policyArgs : []
  const timeoutMs = Number.isFinite(runtime.headless.timeoutMs) && runtime.headless.timeoutMs > 0
    ? runtime.headless.timeoutMs
    : DEFAULT_TIMEOUT_MS
  return {
    args: [...runtime.headless.args, ...extra],
    timeoutMs,
  }
}

/**
 * Interpreta a saída capturada no stdout conforme o formato declarado ('claude-json' ou 'text').
 */
export function parseHeadlessOutput(kind, stdout) {
  const format = kind || 'text'
  if (format === 'claude-json') {
    const raw = String(stdout ?? '').trim()
    if (!raw) return { ok: false, reason: 'saída inválida' }
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, reason: 'saída inválida' }
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.result !== 'string') {
      return { ok: false, reason: 'saída inválida' }
    }
    if (parsed.is_error) {
      return { ok: false, reason: parsed.result.trim() || 'saída inválida' }
    }
    return { ok: true, text: parsed.result }
  }
  if (format === 'text') {
    return { ok: true, text: String(stdout ?? '') }
  }
  return { ok: false, reason: 'saída inválida' }
}

function extractErrorTail(stderr, stdout) {
  const cleanErr = stripAnsi(stderr ?? '').trim()
  const cleanOut = stripAnsi(stdout ?? '').trim()
  const source = cleanErr || cleanOut
  if (!source) return ''
  return source.length > MAX_ERROR_TAIL_CHARS
    ? source.slice(-MAX_ERROR_TAIL_CHARS).trimStart()
    : source
}

/**
 * Converte o desfecho bruto da execução headless no status final da tarefa ('review' ou 'failed').
 */
export function mapHeadlessOutcome({ exitCode, timedOut, stdout, stderr, kind, runtimeId } = {}) {
  if (timedOut) {
    return { status: 'failed', error: 'Tempo esgotado na execução automática.' }
  }

  if (exitCode !== 0) {
    const tail = extractErrorTail(stderr, stdout)
    const codeLabel = exitCode ?? 'desconhecido'
    const tempNote = runtimeId === 'kimi' && exitCode === 75 ? ' (falha temporária)' : ''
    return {
      status: 'failed',
      error: `Código de saída ${codeLabel}${tempNote}${tail ? `: ${tail}` : ''}`,
    }
  }

  const parsed = parseHeadlessOutput(kind, stdout)
  if (!parsed.ok) {
    return { status: 'failed', error: `Saída inválida: ${parsed.reason}` }
  }

  const text = parsed.text.trim()
  if (!text) {
    return { status: 'review', result: 'Execução automática concluída sem saída textual capturada.' }
  }
  return { status: 'review', result: text }
}

// Acumulador circular em bytes para stdout/stderr: preserva sempre o final da saída até `maxBytes`.
function createTailBuffer(maxBytes = MAX_CAPTURE_BYTES) {
  const chunks = []
  let totalBytes = 0
  let truncated = false

  return {
    push(chunk) {
      if (chunk === null || chunk === undefined) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      if (buf.length === 0) return

      if (buf.length >= maxBytes) {
        if (buf.length > maxBytes || totalBytes > 0) truncated = true
        chunks.length = 0
        chunks.push(buf.subarray(buf.length - maxBytes))
        totalBytes = maxBytes
        return
      }

      chunks.push(buf)
      totalBytes += buf.length
      while (totalBytes > maxBytes) {
        truncated = true
        const excess = totalBytes - maxBytes
        if (chunks[0].length <= excess) {
          totalBytes -= chunks[0].length
          chunks.shift()
        } else {
          chunks[0] = chunks[0].subarray(excess)
          totalBytes -= excess
        }
      }
    },
    toString() {
      if (totalBytes === 0) return ''
      let combined = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, totalBytes)
      if (truncated) {
        // Descarta eventuais bytes de continuação UTF-8 partidos no corte inicial.
        let offset = 0
        while (offset < combined.length && (combined[offset] & 0xc0) === 0x80) {
          offset += 1
        }
        if (offset > 0) combined = combined.subarray(offset)
      }
      return combined.toString('utf8')
    },
  }
}

/**
 * Encerra o processo filho e sua árvore de processos (no Windows via taskkill /T /F).
 */
export function killHeadlessProcess(child) {
  if (!child) return
  if (process.platform === 'win32' && child.pid && child instanceof ChildProcess) {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
      if (error) {
        try { child.kill?.('SIGKILL') } catch { /* processo já encerrado */ }
      }
    })
    return
  }
  try {
    child.kill?.('SIGKILL')
  } catch { /* processo já encerrado */ }
}

/**
 * Executa uma CLI em modo headless sem shell, enviando o prompt exclusivamente por stdin,
 * capturando stdout e stderr com teto de 1 MB e aplicando timeout com encerramento da árvore.
 */
export function runHeadless({
  command,
  args = [],
  cwd,
  prompt = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env,
  spawnFn = spawn,
  onChild,
} = {}) {
  if (!command || typeof command !== 'string') {
    return Promise.reject(new Error('Comando é obrigatório para execução headless.'))
  }

  const argList = Array.isArray(args) ? args : []
  const isWinBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
  const spawnCmd = isWinBatch ? 'cmd.exe' : command
  const spawnArgs = isWinBatch ? ['/c', command, ...argList] : [...argList]
  const childEnv = env ?? buildChildEnv()
  const effectiveTimeout = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : DEFAULT_TIMEOUT_MS

  return new Promise((resolve, reject) => {
    const outBuf = createTailBuffer(MAX_CAPTURE_BYTES)
    const errBuf = createTailBuffer(MAX_CAPTURE_BYTES)
    let timedOut = false
    let settled = false
    let timeoutTimer = null
    let graceTimer = null
    let exitFallbackTimer = null

    const clearAllTimers = () => {
      if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null }
      if (graceTimer) { clearTimeout(graceTimer); graceTimer = null }
      if (exitFallbackTimer) { clearTimeout(exitFallbackTimer); exitFallbackTimer = null }
    }

    const finish = (exitCode) => {
      if (settled) return
      settled = true
      clearAllTimers()
      resolve({
        exitCode: exitCode ?? null,
        timedOut,
        stdout: outBuf.toString(),
        stderr: errBuf.toString(),
      })
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      clearAllTimers()
      reject(error)
    }

    let child
    try {
      child = spawnFn(spawnCmd, spawnArgs, {
        ...(cwd ? { cwd } : {}),
        env: childEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      })
    } catch (error) {
      fail(error)
      return
    }

    child.stdout?.on('data', (chunk) => outBuf.push(chunk))
    child.stderr?.on('data', (chunk) => errBuf.push(chunk))

    child.on?.('error', (error) => {
      if (timedOut) {
        finish(null)
      } else {
        fail(error)
      }
    })

    child.on?.('close', (code) => {
      finish(code)
    })

    if (!(child instanceof ChildProcess)) {
      child.on?.('exit', (code) => {
        if (settled) return
        exitFallbackTimer = setTimeout(() => finish(code), 20)
        exitFallbackTimer.unref?.()
      })
    }

    timeoutTimer = setTimeout(() => {
      if (settled) return
      timedOut = true
      killHeadlessProcess(child)
      if (!settled) {
        graceTimer = setTimeout(() => finish(null), TIMEOUT_GRACE_MS)
        graceTimer.unref?.()
      }
    }, effectiveTimeout)

    try {
      onChild?.(child)
    } catch (error) {
      killHeadlessProcess(child)
      fail(error)
      return
    }

    if (child.stdin) {
      child.stdin.on?.('error', () => {
        // Ignora EPIPE caso o processo termine antes de ler todo o stdin.
      })
      child.stdin.end?.(String(prompt ?? ''))
    }
  })
}
