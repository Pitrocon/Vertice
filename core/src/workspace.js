import { resolve, sep, isAbsolute, parse as parsePath } from 'node:path'
import { realpathSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'

// Confinamento de workspace — garantia TECNICA no core/, nunca no prompt nem no frontend.
// Principio: o agente tem autonomia total DENTRO do workspace configurado e NENHUMA fora dele.

export class WorkspaceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WorkspaceError'
    this.status = 403
  }
}

const isWindows = process.platform === 'win32'

// Normaliza para comparacao: no Windows o filesystem e case-insensitive.
function normalizeForCompare(p) {
  return isWindows ? p.toLowerCase() : p
}

// Resolve symlinks/junctions do ancestral existente mais proximo e reaplica o
// restante do caminho. Necessario porque um workspace pode ainda nao existir no disco.
function realpathNearest(absPath) {
  let current = absPath
  const suffix = []
  // Sobe ate achar um ancestral que exista (ou a raiz).
  while (!existsSync(current)) {
    const parent = resolve(current, '..')
    if (parent === current) break // chegou na raiz
    const { base } = parsePath(current)
    suffix.unshift(base)
    current = parent
  }
  let realBase
  try {
    realBase = realpathSync.native(current)
  } catch {
    realBase = current
  }
  return suffix.length ? resolve(realBase, ...suffix) : realBase
}

// Rejeita caminhos perigosos antes de qualquer resolucao.
function assertNotDangerous(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new WorkspaceError('Caminho ausente ou inválido.')
  }
  // Caminhos UNC (\\servidor\share) e de dispositivo (\\.\  \\?\).
  if (/^\\\\/.test(rawPath)) {
    throw new WorkspaceError('Caminhos de rede (UNC) ou de dispositivo não são permitidos.')
  }
  // Sequencias de "subir" explicitas.
  if (/(^|[\\/])\.\.([\\/]|$)/.test(rawPath)) {
    throw new WorkspaceError('O caminho não pode conter "..".')
  }
}

// Expande variáveis no formato %NOME% (ex.: %USERPROFILE%\vertice-workspaces\app).
// Variável inexistente é mantida como está (e depois falha na validação de caminho absoluto).
export function expandEnvVars(p) {
  if (typeof p !== 'string') return p
  return p.replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match)
}

function stripTrailingSep(p) {
  return p.length > 3 ? p.replace(/[\\/]+$/, '') : p
}

/**
 * Valida um caminho escolhido pelo usuário para ser um WORKSPACE DE PROJETO (que passa a ser
 * automaticamente um workspace permitido). Como isso concede autonomia total ao agente dentro
 * do diretório, recusa: caminho relativo, UNC/dispositivo, ".."; raiz de unidade (C:\);
 * diretórios do sistema (Windows, Program Files, ProgramData) e tudo dentro deles; e a pasta
 * pessoal inteira (um subdiretório dela é permitido). Retorna o caminho absoluto normalizado.
 */
export function assertSafeProjectPath(rawPath) {
  assertNotDangerous(rawPath)
  if (!isAbsolute(rawPath)) {
    throw new WorkspaceError('Informe um caminho absoluto para o workspace do projeto (ex.: C:\\Users\\voce\\projetos\\meu-projeto).')
  }
  const abs = stripTrailingSep(resolve(rawPath))
  const real = stripTrailingSep(realpathNearest(abs))
  const { root } = parsePath(abs)

  for (const candidate of [abs, real]) {
    const cmp = normalizeForCompare(candidate)
    if (cmp === normalizeForCompare(stripTrailingSep(root)) || cmp === normalizeForCompare(root)) {
      throw new WorkspaceError('A raiz de uma unidade não pode ser um workspace de projeto.')
    }
    if (cmp === normalizeForCompare(stripTrailingSep(homedir()))) {
      throw new WorkspaceError('A pasta pessoal inteira não pode ser um workspace; escolha uma subpasta dedicada ao projeto.')
    }
    const systemDirs = [process.env.SystemRoot, process.env.windir, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]
      .filter(Boolean)
      .map((d) => normalizeForCompare(stripTrailingSep(resolve(d))))
    for (const dir of systemDirs) {
      if (cmp === dir || cmp.startsWith(dir + sep)) {
        throw new WorkspaceError('Diretórios do sistema (Windows, Program Files, ProgramData) não podem ser workspace de projeto.')
      }
    }
  }
  return abs
}

/**
 * Resolve `p` relativo a `root` e garante que o resultado esta DENTRO de `root`.
 * Retorna o caminho absoluto resolvido (com symlinks/junctions resolvidos).
 * Lanca WorkspaceError (status 403) se estiver fora.
 */
export function resolveInside(root, p) {
  assertNotDangerous(root)
  assertNotDangerous(p)

  const realRoot = realpathNearest(resolve(root))
  const target = realpathNearest(resolve(realRoot, p))

  const rootCmp = normalizeForCompare(realRoot)
  const targetCmp = normalizeForCompare(target)

  // Igual ao root OU comeca com root + separador (evita que /foo-bar passe por /foo).
  const inside = targetCmp === rootCmp || targetCmp.startsWith(rootCmp + sep)
  if (!inside) {
    throw new WorkspaceError(`O caminho "${p}" está fora do workspace permitido.`)
  }
  return target
}

/**
 * Garante que `cwd` esta dentro de ALGUM dos workspaces permitidos.
 * `allowedWorkspaces` e um array de strings (paths) ou de objetos { path }.
 * NUNCA cai silenciosamente para homedir(): lanca WorkspaceError (403) se nao casar.
 * Retorna o caminho absoluto resolvido.
 */
export function assertAllowedCwd(cwd, allowedWorkspaces) {
  assertNotDangerous(cwd)
  const roots = (allowedWorkspaces ?? [])
    .map((w) => (typeof w === 'string' ? w : w?.path))
    .filter((w) => typeof w === 'string' && w.trim() !== '')

  if (roots.length === 0) {
    throw new WorkspaceError('Nenhum workspace permitido está configurado.')
  }

  for (const root of roots) {
    try {
      return resolveInside(root, cwd)
    } catch (err) {
      if (!(err instanceof WorkspaceError)) throw err
      // tenta o proximo root
    }
  }
  throw new WorkspaceError(`O diretório "${cwd}" não está dentro de nenhum workspace permitido.`)
}
