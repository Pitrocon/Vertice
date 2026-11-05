import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Catálogo de runtimes suportados. Cada entrada descreve como detectar,
// versionar, instalar e iniciar uma sessão interativa da CLI.
export const RUNTIME_CATALOG = [
  { id: 'claude',      name: 'Claude Code',     kind: 'CLI de IA',    command: 'claude',     versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex',       name: 'Codex CLI',       kind: 'CLI de IA',    command: 'codex',      versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @openai/codex' },
  { id: 'kimi',        name: 'Kimi CLI',        kind: 'CLI de IA',    command: 'kimi',       versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @moonshot-ai/kimi-code' },
  { id: 'glm',         name: 'GLM CLI (Z.ai)',  kind: 'CLI de IA',    command: 'zai',        versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g @guizmo-ai/zai-cli' },
  { id: 'antigravity', name: 'Antigravity CLI', kind: 'CLI de IA',    command: 'agy',        versionArgs: ['--version'], sessionArgs: [], install: 'irm https://antigravity.google/cli/install.ps1 | iex' },
  { id: 'opencode',    name: 'OpenCode',        kind: 'CLI de IA',    command: 'opencode',   versionArgs: ['--version'], sessionArgs: [], install: 'npm install -g opencode-ai' },
  { id: 'ollama',      name: 'Ollama',          kind: 'Modelo local', command: 'ollama',     versionArgs: ['--version'], sessionArgs: [], http: 'http://localhost:11434/api/tags', install: 'winget install Ollama.Ollama' },
  { id: 'lmstudio',    name: 'LM Studio',       kind: 'Modelo local', command: 'lms',        versionArgs: ['version'],   sessionArgs: [], http: 'http://localhost:1234/v1/models', install: null },
  { id: 'powershell',  name: 'PowerShell',      kind: 'Shell',        command: 'powershell', versionArgs: ['--version'], sessionArgs: ['-NoLogo'], install: null },
]

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

export async function detectRuntimes() {
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
