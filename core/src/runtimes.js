import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// Diretório de manifestos declarativos: vertice/runtimes/<id>.json
// (a partir de core/src/runtimes.js sobe dois níveis até a raiz do projeto).
// No modo empacotado (Electron), o processo main aponta VERTICE_RUNTIMES_DIR
// para a pasta de manifestos embarcada nos resources do app.
const MANIFESTS_DIR = process.env.VERTICE_RUNTIMES_DIR
  ? process.env.VERTICE_RUNTIMES_DIR
  : join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'runtimes')

// Fallback embutido — usado apenas se a pasta de manifestos não existir ou
// estiver vazia (ex.: build empacotado antes de copiar os assets). Mantém a
// detecção honesta funcionando em qualquer cenário.
const FALLBACK_CATALOG = [
  { id: 'claude',      name: 'Claude Code',     kind: 'CLI de IA',    command: 'claude',     versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @anthropic-ai/claude-code', http: null, authenticates: true,  order: 1 },
  { id: 'codex',       name: 'Codex CLI',       kind: 'CLI de IA',    command: 'codex',      versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @openai/codex',          http: null, authenticates: true,  order: 2 },
  { id: 'kimi',        name: 'Kimi CLI',        kind: 'CLI de IA',    command: 'kimi',       versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @moonshot-ai/kimi-code',  http: null, authenticates: true,  order: 3 },
  { id: 'glm',         name: 'GLM CLI (Z.ai)',  kind: 'CLI de IA',    command: 'zai',        versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @guizmo-ai/zai-cli',      http: null, authenticates: true,  order: 4 },
  { id: 'antigravity', name: 'Antigravity CLI', kind: 'CLI de IA',    command: 'agy',        versionArgs: ['--version'], sessionArgs: [], install: 'irm https://antigravity.google/cli/install.ps1 | iex', http: null, authenticates: true, order: 5 },
  { id: 'opencode',    name: 'OpenCode',        kind: 'CLI de IA',    command: 'opencode',   versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g opencode-ai',            http: null, authenticates: true,  order: 6 },
  { id: 'ollama',      name: 'Ollama',          kind: 'Modelo local', command: 'ollama',     versionArgs: ['--version'], sessionArgs: [], install: 'winget install Ollama.Ollama',          http: 'http://localhost:11434/api/tags', authenticates: false, order: 7 },
  { id: 'lmstudio',    name: 'LM Studio',       kind: 'Modelo local', command: 'lms',        versionArgs: ['version'],   sessionArgs: [], install: null,                                    http: 'http://localhost:1234/v1/models', authenticates: false, order: 8 },
  { id: 'powershell',  name: 'PowerShell',      kind: 'Shell',        command: 'powershell', versionArgs: ['--version'], sessionArgs: ['-NoLogo'], install: null,                           http: null, authenticates: false, order: 9 },
]

const REQUIRED_FIELDS = ['id', 'name', 'kind', 'command', 'versionArgs', 'sessionArgs']

// Lê e valida os manifestos declarativos. Entradas malformadas são ignoradas
// com aviso; se nenhum manifesto válido for encontrado, usa o fallback embutido.
function loadCatalog() {
  if (!existsSync(MANIFESTS_DIR)) {
    console.warn(`[runtimes] Pasta de manifestos ausente (${MANIFESTS_DIR}); usando catálogo embutido.`)
    return [...FALLBACK_CATALOG]
  }

  const files = readdirSync(MANIFESTS_DIR).filter((f) => f.toLowerCase().endsWith('.json'))
  const catalog = []
  for (const file of files) {
    try {
      const manifest = JSON.parse(readFileSync(join(MANIFESTS_DIR, file), 'utf8'))
      const missing = REQUIRED_FIELDS.filter((field) => manifest[field] === undefined || manifest[field] === null)
      if (missing.length) {
        console.warn(`[runtimes] Manifesto "${file}" ignorado — campos ausentes: ${missing.join(', ')}.`)
        continue
      }
      catalog.push({
        id: manifest.id,
        name: manifest.name,
        kind: manifest.kind,
        command: manifest.command,
        versionArgs: manifest.versionArgs,
        sessionArgs: manifest.sessionArgs,
        install: manifest.install ?? null,
        http: manifest.http ?? null,
        authenticates: manifest.authenticates ?? false,
        order: typeof manifest.order === 'number' ? manifest.order : 999,
      })
    } catch (error) {
      console.warn(`[runtimes] Falha ao ler manifesto "${file}": ${error.message}`)
    }
  }

  if (!catalog.length) {
    console.warn('[runtimes] Nenhum manifesto válido encontrado; usando catálogo embutido.')
    return [...FALLBACK_CATALOG]
  }

  return catalog.sort((a, b) => a.order - b.order)
}

// Catálogo de runtimes suportados, carregado dos manifestos declarativos em
// vertice/runtimes/<id>.json. Cada entrada descreve como detectar, versionar,
// instalar e iniciar uma sessão interativa da CLI.
export const RUNTIME_CATALOG = loadCatalog()

const EXTRA_BIN_DIRS = [
  process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
  process.env.APPDATA ? join(process.env.APPDATA, 'kimi-desktop', 'daimon-share', 'daimon', 'npm-global') : null,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'agy', 'bin') : null,
  join(homedir(), '.kimi-code', 'bin'),
  join(homedir(), '.local', 'bin'),
].filter(Boolean)

function run(cmd, args, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const isBatch = /\.(cmd|bat)$/i.test(cmd)
    const execCmd = isBatch ? 'cmd.exe' : cmd
    const execArgs = isBatch ? ['/c', cmd, ...args] : args
    execFile(execCmd, execArgs, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) return resolve(null)
      resolve((stdout || stderr || '').trim())
    })
  })
}

async function where(command) {
  const out = await run('where', [command])
  if (out) {
    const candidates = out.split('\n').map((line) => line.trim()).filter(Boolean)
    const executable = candidates.find((candidate) => /\.(exe|cmd|bat)$/i.test(candidate))
    if (executable ?? candidates[0]) return executable ?? candidates[0]
  }
  for (const dir of EXTRA_BIN_DIRS) {
    for (const ext of ['.exe', '.cmd', '.bat']) {
      const candidate = join(dir, `${command}${ext}`)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

async function httpCheck(url, timeoutMs = 2500) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

// A detecção dispara dezenas de processos (where + --version) e leva segundos. Cache curto +
// deduplicação de chamadas simultâneas evitam repetir tudo a cada atualização da tela.
const DETECTION_TTL_MS = 20000
let detectionCache = { at: 0, value: null, inflight: null }

export async function detectRuntimes({ force = false } = {}) {
  if (!force && detectionCache.value && Date.now() - detectionCache.at < DETECTION_TTL_MS) return detectionCache.value
  if (detectionCache.inflight) return detectionCache.inflight
  detectionCache.inflight = runDetection().then(
    (value) => { detectionCache = { at: Date.now(), value, inflight: null }; return value },
    (error) => { detectionCache.inflight = null; throw error },
  )
  return detectionCache.inflight
}

async function runDetection() {
  const results = await Promise.all(RUNTIME_CATALOG.map(async (runtime) => {
    const path = await where(runtime.command)
    if (!path) {
      // Modelos locais podem estar rodando como serviço mesmo sem CLI no PATH
      if (runtime.http && await httpCheck(runtime.http)) {
        return { ...runtime, status: 'installed', version: null, path: null, via: 'http' }
      }
      return { ...runtime, status: 'missing', version: null, path: null }
    }
    let version = null
    const versionOut = await run(path, runtime.versionArgs)
    if (versionOut) {
      const match = versionOut.match(/\d+\.\d+(\.\d+)?/)
      version = match ? match[0] : versionOut.split('\n')[0].slice(0, 60)
    }
    return { ...runtime, status: 'installed', version, path }
  }))
  return results
}

// Resolve o caminho executável real. `where` pode retornar shims sem extensão
// (ex.: scripts bash do npm) — o Windows precisa de .exe/.cmd/.bat.
export async function resolveCommand(command) {
  return (await where(command)) ?? command
}
