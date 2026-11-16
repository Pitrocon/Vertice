import { execFile } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { POLICY_KEYS, describePolicyEffects } from './policies.js'

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
  {
    id: 'claude',
    name: 'Claude Code',
    kind: 'CLI de IA',
    command: 'claude',
    versionArgs: ['--version'],
    sessionArgs: [],
    install: 'npm install -g @anthropic-ai/claude-code',
    http: null,
    authenticates: true,
    order: 1,
    authCheck: { files: ['%USERPROFILE%\\.claude\\.credentials.json'], env: ['ANTHROPIC_API_KEY'] },
    headless: {
      args: ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits'],
      prompt: 'stdin',
      output: 'claude-json',
      timeoutMs: 900000,
      sources: [
        'https://code.claude.com/docs/en/headless',
        'https://code.claude.com/docs/en/permission-modes',
      ],
    },
    policyFlags: {
      allowNetwork: {
        whenOff: ['--disallowedTools', 'WebFetch', 'WebSearch'],
        effect: 'directive',
        source: 'https://code.claude.com/docs/en/cli-reference',
      },
    },
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    kind: 'CLI de IA',
    command: 'codex',
    versionArgs: ['--version'],
    sessionArgs: [],
    install: 'npm install -g @openai/codex',
    http: null,
    authenticates: true,
    order: 2,
    authCheck: { files: ['%CODEX_HOME%\\auth.json', '%USERPROFILE%\\.codex\\auth.json'], env: [] },
    headless: {
      args: ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-'],
      prompt: 'stdin',
      output: 'text',
      timeoutMs: 900000,
      sources: [
        'https://learn.chatgpt.com/docs/non-interactive-mode',
      ],
    },
    policyFlags: {
      allowNetwork: {
        whenOff: ['--sandbox', 'workspace-write'],
        effect: 'technical',
        source: 'https://developers.openai.com/codex/sandbox',
      },
    },
  },
  { id: 'kimi',        name: 'Kimi CLI',        kind: 'CLI de IA',    command: 'kimi',       versionArgs: ['--version'], sessionArgs: [], install: 'irm https://code.kimi.com/install.ps1 | iex',  http: null, authenticates: true,  order: 3, headless: null, policyFlags: null },
  { id: 'glm',         name: 'GLM CLI (Z.ai)',  kind: 'CLI de IA',    command: 'zai',        versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @guizmo-ai/zai-cli',      http: null, authenticates: true,  order: 4, headless: null, policyFlags: null },
  { id: 'antigravity', name: 'Antigravity CLI', kind: 'CLI de IA',    command: 'agy',        versionArgs: ['--version'], sessionArgs: [], install: 'irm https://antigravity.google/cli/install.ps1 | iex', http: null, authenticates: true, order: 5, headless: null, policyFlags: null },
  { id: 'opencode',    name: 'OpenCode',        kind: 'CLI de IA',    command: 'opencode',   versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g opencode-ai',            http: null, authenticates: true,  order: 6, headless: null, policyFlags: null },
  { id: 'ollama',      name: 'Ollama',          kind: 'Modelo local', command: 'ollama',     versionArgs: ['--version'], sessionArgs: [], install: 'winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements',          http: 'http://localhost:11434/api/tags', authenticates: false, order: 7, headless: null, policyFlags: null },
  { id: 'lmstudio',    name: 'LM Studio',       kind: 'Modelo local', command: 'lms',        versionArgs: ['version'],   sessionArgs: [], install: null,                                    http: 'http://localhost:1234/v1/models', authenticates: false, order: 8, headless: null, policyFlags: null },
  { id: 'powershell',  name: 'PowerShell',      kind: 'Shell',        command: 'powershell', versionArgs: ['--version'], sessionArgs: ['-NoLogo'], install: null,                           http: null, authenticates: false, order: 9, headless: null, policyFlags: null },
]

const REQUIRED_FIELDS = ['id', 'name', 'kind', 'command', 'versionArgs', 'sessionArgs']
const HEADLESS_OUTPUT_FORMATS = new Set(['claude-json', 'text'])
const HEADLESS_MIN_TIMEOUT_MS = 60_000
const HEADLESS_MAX_TIMEOUT_MS = 3_600_000
const POLICY_EFFECT_KINDS = new Set(['technical', 'directive'])

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * G9: valida e normaliza o bloco opcional `headless` de um manifesto.
 * Retorna `null` quando ausente ou inválido, sem emitir avisos diretos.
 */
export function validateHeadlessBlock(block) {
  if (block == null) return null
  if (!isPlainObject(block)) return null

  if (!Array.isArray(block.args)) return null
  if (!block.args.every((item) => typeof item === 'string' && item.trim().length > 0)) return null

  if (block.prompt !== 'stdin') return null
  if (!HEADLESS_OUTPUT_FORMATS.has(block.output)) return null

  if (!Number.isInteger(block.timeoutMs) || block.timeoutMs < HEADLESS_MIN_TIMEOUT_MS || block.timeoutMs > HEADLESS_MAX_TIMEOUT_MS) {
    return null
  }

  if (!Array.isArray(block.sources)) return null
  if (!block.sources.every((item) => typeof item === 'string' && item.trim().length > 0)) return null
  if (!block.sources.some((item) => item.startsWith('https://') && item.slice(8).trim().length > 0)) return null

  return {
    args: [...block.args],
    prompt: 'stdin',
    output: block.output,
    timeoutMs: block.timeoutMs,
    sources: [...block.sources],
  }
}

/**
 * G11: valida e normaliza o bloco opcional `policyFlags` de um manifesto.
 * Ignora entradas inválidas com `console.warn` sem derrubar o catálogo.
 */
export function validatePolicyFlags(raw, manifestName = 'manifesto') {
  if (raw == null) return null
  if (!isPlainObject(raw)) {
    console.warn(`[runtimes] Bloco "policyFlags" inválido em ${manifestName}; ignorando flags de política.`)
    return null
  }

  const out = {}
  for (const [key, entry] of Object.entries(raw)) {
    if (!POLICY_KEYS.includes(key)) {
      console.warn(`[runtimes] Chave de política desconhecida "${key}" em policyFlags de ${manifestName}; ignorada.`)
      continue
    }
    if (!isPlainObject(entry)) {
      console.warn(`[runtimes] Entrada inválida para "${key}" em policyFlags de ${manifestName}; ignorada.`)
      continue
    }
    const validWhenOff = Array.isArray(entry.whenOff)
      && entry.whenOff.length > 0
      && entry.whenOff.every((item) => typeof item === 'string' && item.trim().length > 0)
    const validEffect = POLICY_EFFECT_KINDS.has(entry.effect)
    const validSource = typeof entry.source === 'string'
      && entry.source.startsWith('https://')
      && entry.source.slice(8).trim().length > 0

    if (!validWhenOff || !validEffect || !validSource) {
      console.warn(`[runtimes] Configuração inválida para "${key}" em policyFlags de ${manifestName}; ignorada.`)
      continue
    }

    out[key] = {
      whenOff: [...entry.whenOff],
      effect: entry.effect,
      source: entry.source,
    }
  }

  return Object.keys(out).length > 0 ? out : null
}

// G3: `authCheck` opcional do manifesto: arquivos de credencial (com %VARIAVEL%) e variáveis de ambiente
// que indicam login feito. Só confere se EXISTEM; não lê o conteúdo nem valida o token.
function normalizeAuthCheck(value) {
  if (!value || typeof value !== 'object') return null
  const strings = (list) => (Array.isArray(list) ? list.filter((item) => typeof item === 'string' && item.trim()) : [])
  const files = strings(value.files)
  const env = strings(value.env)
  return files.length || env.length ? { files, env } : null
}

function cloneFallbackCatalog() {
  return FALLBACK_CATALOG.map((entry) => {
    const policyFlags = validatePolicyFlags(entry.policyFlags, entry.id)
    const runtime = {
      ...entry,
      versionArgs: [...entry.versionArgs],
      sessionArgs: [...entry.sessionArgs],
      authCheck: normalizeAuthCheck(entry.authCheck),
      headless: validateHeadlessBlock(entry.headless),
      policyFlags,
    }
    return {
      ...runtime,
      policyEffects: describePolicyEffects(runtime),
    }
  })
}

// Lê e valida os manifestos declarativos. Entradas malformadas são ignoradas
// com aviso; se nenhum manifesto válido for encontrado, usa o fallback embutido.
export function loadCatalog(manifestsDir = MANIFESTS_DIR) {
  if (!existsSync(manifestsDir)) {
    console.warn(`[runtimes] Pasta de manifestos ausente (${manifestsDir}); usando catálogo embutido.`)
    return cloneFallbackCatalog()
  }

  const files = readdirSync(manifestsDir).filter((f) => f.toLowerCase().endsWith('.json'))
  const catalog = []
  for (const file of files) {
    try {
      const manifest = JSON.parse(readFileSync(join(manifestsDir, file), 'utf8'))
      const missing = REQUIRED_FIELDS.filter((field) => manifest[field] === undefined || manifest[field] === null)
      if (missing.length) {
        console.warn(`[runtimes] Manifesto "${file}" ignorado — campos ausentes: ${missing.join(', ')}.`)
        continue
      }
      const headless = validateHeadlessBlock(manifest.headless)
      if (manifest.headless != null && !headless) {
        console.warn(`[runtimes] Bloco "headless" inválido no manifesto "${file}"; mantendo modo interativo.`)
      }
      const policyFlags = validatePolicyFlags(manifest.policyFlags, `"${file}"`)
      const runtime = {
        id: manifest.id,
        name: manifest.name,
        kind: manifest.kind,
        command: manifest.command,
        versionArgs: manifest.versionArgs,
        sessionArgs: manifest.sessionArgs,
        install: manifest.install ?? null,
        http: manifest.http ?? null,
        authenticates: manifest.authenticates ?? false,
        authCheck: normalizeAuthCheck(manifest.authCheck),
        headless,
        policyFlags,
        order: typeof manifest.order === 'number' ? manifest.order : 999,
      }
      runtime.policyEffects = describePolicyEffects(runtime)
      catalog.push(runtime)
    } catch (error) {
      console.warn(`[runtimes] Falha ao ler manifesto "${file}": ${error.message}`)
    }
  }

  if (!catalog.length) {
    console.warn('[runtimes] Nenhum manifesto válido encontrado; usando catálogo embutido.')
    return cloneFallbackCatalog()
  }

  return catalog.sort((a, b) => a.order - b.order)
}

// Catálogo de runtimes suportados, carregado dos manifestos declarativos em
// vertice/runtimes/<id>.json. Cada entrada descreve como detectar, versionar,
// instalar e iniciar uma sessão interativa da CLI.
export const RUNTIME_CATALOG = loadCatalog()

export const EXTRA_BIN_DIRS = [
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'nodejs') : null,
  process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs') : null,
  process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null,
  process.env.APPDATA ? join(process.env.APPDATA, 'kimi-desktop', 'daimon-share', 'daimon', 'npm-global') : null,
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'agy', 'bin') : null,
  join(homedir(), '.kimi-code', 'bin'),
  join(homedir(), '.local', 'bin'),
].filter(Boolean)

// Garante que as pastas de CLIs instaladas para o usuário façam parte tanto do PATH atual do Vértice
// quanto do PATH persistente do Usuário no Windows (para funcionarem também no PowerShell/CMD fora do app).
export function syncUserCliPath() {
  if (process.env.VERTICE_SKIP_PATH_SYNC === '1') return
  const existingDirs = EXTRA_BIN_DIRS.filter((dir) => existsSync(dir))
  if (!existingDirs.length) return
  const currentPath = process.env.Path || process.env.PATH || ''
  const lowerCurrent = currentPath.split(';').map((p) => p.trim().toLowerCase())
  const toAddInProcess = existingDirs.filter((dir) => !lowerCurrent.includes(dir.toLowerCase()))
  if (toAddInProcess.length) {
    process.env.Path = `${currentPath};${toAddInProcess.join(';')}`
    process.env.PATH = process.env.Path
  }
  if (process.platform === 'win32') {
    const dirsLiteral = existingDirs.map((d) => `'${d.replace(/'/g, "''")}'`).join(',')
    const ps = [
      `$dirs = @(${dirsLiteral})`,
      '$userPath = [Environment]::GetEnvironmentVariable("Path", "User")',
      'if (-not $userPath) { $userPath = "" }',
      '$parts = $userPath -split ";" | Where-Object { $_.Trim() -ne "" }',
      '$changed = $false',
      'foreach ($d in $dirs) {',
      '  if ((Test-Path $d) -and -not ($parts | Where-Object { $_.TrimEnd("\\").ToLower() -eq $d.TrimEnd("\\").ToLower() })) {',
      '    $parts += $d',
      '    $changed = $true',
      '  }',
      '}',
      'if ($changed) { [Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User") }',
    ].join('; ')
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { timeout: 10000, windowsHide: true }, () => {})
  }
}

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
    const base = {
      ...runtime,
      headless: Boolean(runtime.headless),
      policyEffects: runtime.policyEffects ?? describePolicyEffects(runtime),
    }
    const path = await where(runtime.command)
    if (!path) {
      // Modelos locais podem estar rodando como serviço mesmo sem CLI no PATH
      if (runtime.http && await httpCheck(runtime.http)) {
        return { ...base, status: 'installed', version: null, path: null, via: 'http' }
      }
      return { ...base, status: 'missing', version: null, path: null }
    }
    let version = null
    const versionOut = await run(path, runtime.versionArgs)
    if (versionOut) {
      const match = versionOut.match(/\d+\.\d+(\.\d+)?/)
      version = match ? match[0] : versionOut.split('\n')[0].slice(0, 60)
    }
    return { ...base, status: 'installed', version, path, auth: checkAuth(runtime) }
  }))
  return results
}

// Troca %VARIAVEL% pelo valor; se alguma não existir, o caminho não vale (null).
function expandWindowsVars(value) {
  let unresolved = false
  const out = value.replace(/%([^%]+)%/g, (_match, name) => {
    const resolved = process.env[name]
    if (!resolved) unresolved = true
    return resolved ?? ''
  })
  return unresolved ? null : out
}

/**
 * G3: estado do login de uma CLI que exige autenticação.
 *  - 'found': há credencial (arquivo do manifesto ou variável de ambiente). Não garante que ainda é válida.
 *  - 'not-found': nada encontrado nos locais conhecidos.
 *  - 'unknown': o manifesto não diz onde a CLI guarda o login.
 *  - null: a CLI não exige login.
 */
export function checkAuth(runtime) {
  if (!runtime.authenticates) return null
  const check = runtime.authCheck
  if (!check) return 'unknown'
  if (check.env.some((name) => (process.env[name] ?? '').trim())) return 'found'
  if (check.files.some((file) => { const path = expandWindowsVars(file); return Boolean(path && existsSync(path)) })) return 'found'
  return 'not-found'
}

// Resolve o caminho executável real. `where` pode retornar shims sem extensão
// (ex.: scripts bash do npm) — o Windows precisa de .exe/.cmd/.bat.
export async function resolveCommand(command) {
  return (await where(command)) ?? command
}
