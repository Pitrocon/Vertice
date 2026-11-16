import { testDir, cleanup } from './helpers/env.js'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkAuth,
  validateHeadlessBlock,
  validatePolicyFlags,
  loadCatalog,
  planUserPathSync,
  buildPersistScript,
  syncUserCliPath,
  EXTRA_BIN_DIRS,
} from '../src/runtimes.js'

after(() => {
  cleanup()
})

function withMutedWarn(fn) {
  const original = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    return { result: fn(), warnings }
  } finally {
    console.warn = original
  }
}

test('checkAuth retorna null, unknown, not-found e found via env e arquivos temporários', () => {
  assert.equal(checkAuth({ authenticates: false }), null)
  assert.equal(checkAuth({ authenticates: true }), 'unknown')
  assert.equal(checkAuth({ authenticates: true, authCheck: null }), 'unknown')

  const prevApiKey = process.env.VERTICE_TEST_API_KEY
  const prevCredDir = process.env.VERTICE_TEST_CRED_DIR
  try {
    delete process.env.VERTICE_TEST_API_KEY
    delete process.env.VERTICE_TEST_CRED_DIR

    const runtimeEnv = {
      authenticates: true,
      authCheck: { env: ['VERTICE_TEST_API_KEY'], files: [] },
    }
    assert.equal(checkAuth(runtimeEnv), 'not-found')

    process.env.VERTICE_TEST_API_KEY = '   '
    assert.equal(checkAuth(runtimeEnv), 'not-found')

    process.env.VERTICE_TEST_API_KEY = 'sk-test-123'
    assert.equal(checkAuth(runtimeEnv), 'found')

    delete process.env.VERTICE_TEST_API_KEY
    const credDir = join(testDir, 'creds')
    mkdirSync(credDir, { recursive: true })
    const runtimeFile = {
      authenticates: true,
      authCheck: { env: ['VERTICE_TEST_API_KEY'], files: ['%VERTICE_TEST_CRED_DIR%\\auth.json'] },
    }

    // Variável não resolvida -> not-found
    assert.equal(checkAuth(runtimeFile), 'not-found')

    // Variável resolvida, mas arquivo inexistente -> not-found
    process.env.VERTICE_TEST_CRED_DIR = credDir
    assert.equal(checkAuth(runtimeFile), 'not-found')

    // Arquivo existente -> found
    writeFileSync(join(credDir, 'auth.json'), '{"ok":true}', 'utf8')
    assert.equal(checkAuth(runtimeFile), 'found')
  } finally {
    if (prevApiKey === undefined) delete process.env.VERTICE_TEST_API_KEY
    else process.env.VERTICE_TEST_API_KEY = prevApiKey
    if (prevCredDir === undefined) delete process.env.VERTICE_TEST_CRED_DIR
    else process.env.VERTICE_TEST_CRED_DIR = prevCredDir
  }
})

test('validateHeadlessBlock normaliza blocos válidos e rejeita inválidos', () => {
  const valid = {
    args: ['-p', '--output-format', 'json'],
    prompt: 'stdin',
    output: 'claude-json',
    timeoutMs: 900_000,
    sources: ['https://code.claude.com/docs/en/headless'],
  }
  const normalized = validateHeadlessBlock(valid)
  assert.deepEqual(normalized, valid)
  assert.notEqual(normalized.args, valid.args)
  assert.notEqual(normalized.sources, valid.sources)

  assert.ok(validateHeadlessBlock({ ...valid, output: 'text', timeoutMs: 60_000 }))
  assert.ok(validateHeadlessBlock({ ...valid, output: 'text', timeoutMs: 3_600_000 }))

  assert.equal(validateHeadlessBlock(null), null)
  assert.equal(validateHeadlessBlock('str'), null)
  assert.equal(validateHeadlessBlock({ ...valid, prompt: 'arg' }), null)
  assert.equal(validateHeadlessBlock({ ...valid, output: 'jsonl' }), null)
  assert.equal(validateHeadlessBlock({ ...valid, timeoutMs: 59_999 }), null)
  assert.equal(validateHeadlessBlock({ ...valid, timeoutMs: 3_600_001 }), null)
  assert.equal(validateHeadlessBlock({ ...valid, args: ['  '] }), null)
  assert.equal(validateHeadlessBlock({ ...valid, sources: ['http://insecure.example'] }), null)
})

test('validatePolicyFlags valida entradas, ignora inválidas com aviso e preserva entradas válidas', () => {
  assert.equal(validatePolicyFlags(null, 'test'), null)

  const badType = withMutedWarn(() => validatePolicyFlags([], 'bad-type'))
  assert.equal(badType.result, null)
  assert.equal(badType.warnings.length, 1)

  const mixed = withMutedWarn(() => validatePolicyFlags({
    unknownKey: { whenOff: ['--x'], effect: 'directive', source: 'https://example.com' },
    allowCredentials: { whenOff: [], effect: 'directive', source: 'https://example.com' },
    allowDestructiveCommands: { whenOff: ['--safe'], effect: 'magic', source: 'https://example.com' },
    allowNetwork: {
      whenOff: ['--sandbox', 'workspace-write'],
      effect: 'technical',
      source: 'https://developers.openai.com/codex/sandbox',
    },
  }, 'mixed.json'))

  assert.equal(mixed.warnings.length, 3)
  assert.deepEqual(mixed.result, {
    allowNetwork: {
      whenOff: ['--sandbox', 'workspace-write'],
      effect: 'technical',
      source: 'https://developers.openai.com/codex/sandbox',
    },
  })
})

test('loadCatalog lê manifestos de pasta temporária, valida blocos e cai no fallback quando ausente/vazia', () => {
  const missingDir = join(testDir, 'manifests-inexistentes')
  const fromMissing = withMutedWarn(() => loadCatalog(missingDir))
  assert.equal(fromMissing.result.length, 9)
  assert.ok(fromMissing.warnings.some((w) => w.includes('ausente')))

  const emptyDir = join(testDir, 'manifests-vazios')
  mkdirSync(emptyDir, { recursive: true })
  const fromEmpty = withMutedWarn(() => loadCatalog(emptyDir))
  assert.equal(fromEmpty.result.length, 9)
  assert.ok(fromEmpty.warnings.some((w) => w.includes('Nenhum manifesto válido')))

  const customDir = join(testDir, 'manifests-custom')
  mkdirSync(customDir, { recursive: true })

  writeFileSync(join(customDir, 'broken.json'), '{not-json', 'utf8')
  writeFileSync(join(customDir, 'incomplete.json'), JSON.stringify({ id: 'incomplete', name: 'Incompleto' }), 'utf8')
  writeFileSync(join(customDir, 'segundo.json'), JSON.stringify({
    id: 'rt-b',
    name: 'Runtime B',
    kind: 'CLI de IA',
    command: 'rtb',
    versionArgs: ['--version'],
    sessionArgs: [],
    order: 2,
    headless: {
      args: ['run'],
      prompt: 'arg',
      output: 'text',
      timeoutMs: 120000,
      sources: ['https://example.com/docs'],
    },
    policyFlags: {
      allowNetwork: { whenOff: ['--no-net'], effect: 'invalid-kind', source: 'https://example.com' },
    },
  }), 'utf8')
  writeFileSync(join(customDir, 'primeiro.json'), JSON.stringify({
    id: 'rt-a',
    name: 'Runtime A',
    kind: 'CLI de IA',
    command: 'rta',
    versionArgs: ['--version'],
    sessionArgs: ['--quiet'],
    authenticates: true,
    authCheck: { env: ['RTA_KEY'], files: ['%USERPROFILE%\\.rta.json'] },
    order: 1,
    headless: {
      args: ['exec', '-'],
      prompt: 'stdin',
      output: 'text',
      timeoutMs: 120000,
      sources: ['https://example.com/headless'],
    },
    policyFlags: {
      allowNetwork: {
        whenOff: ['--sandbox', 'workspace-write'],
        effect: 'technical',
        source: 'https://example.com/sandbox',
      },
    },
  }), 'utf8')

  const loaded = withMutedWarn(() => loadCatalog(customDir))
  assert.equal(loaded.result.length, 2)
  assert.deepEqual(loaded.result.map((r) => r.id), ['rt-a', 'rt-b'])
  assert.ok(loaded.warnings.some((w) => w.includes('broken.json')))
  assert.ok(loaded.warnings.some((w) => w.includes('incomplete.json')))
  assert.ok(loaded.warnings.some((w) => w.includes('segundo.json')))

  const rtA = loaded.result[0]
  assert.equal(rtA.headless.output, 'text')
  assert.equal(rtA.policyEffects.allowNetwork.kind, 'technical')
  assert.equal(rtA.policyEffects.allowDestructiveCommands.kind, 'directive')

  const rtB = loaded.result[1]
  assert.equal(rtB.headless, null)
  assert.equal(rtB.policyFlags, null)
  assert.equal(rtB.policyEffects.allowNetwork.kind, 'directive')
})

test('planUserPathSync e buildPersistScript são puros e syncUserCliPath respeita VERTICE_SKIP_PATH_SYNC=1', () => {
  const existing = new Set(['C:\\Tools\\Node', 'C:\\Users\\V\\bin', 'C:\\User\'s\\cli'])
  const existsStub = (dir) => existing.has(dir)

  const plan = planUserPathSync(
    ['C:\\Tools\\Node', 'C:\\Missing\\Dir', 'C:\\Users\\V\\bin', 'C:\\tools\\node\\'],
    'C:\\Windows\\System32;c:\\tools\\node\\;',
    existsStub,
  )

  assert.deepEqual(plan.existingDirs, ['C:\\Tools\\Node', 'C:\\Users\\V\\bin'])
  assert.deepEqual(plan.toAdd, ['C:\\Users\\V\\bin'])
  assert.equal(plan.nextPath, 'C:\\Windows\\System32;c:\\tools\\node\\;C:\\Users\\V\\bin')

  const fromEmpty = planUserPathSync(['C:\\Users\\V\\bin'], '', existsStub)
  assert.equal(fromEmpty.nextPath, 'C:\\Users\\V\\bin')

  const alreadyPresent = planUserPathSync(['C:\\Tools\\Node'], 'C:\\Tools\\Node', existsStub)
  assert.deepEqual(alreadyPresent.toAdd, [])
  assert.equal(alreadyPresent.nextPath, 'C:\\Tools\\Node')

  assert.equal(buildPersistScript([]), '')
  const script = buildPersistScript(['C:\\Tools\\Node', "C:\\User's\\cli"])
  assert.ok(script.includes("$dirs = @('C:\\Tools\\Node','C:\\User''s\\cli')"))
  assert.ok(script.includes('[Environment]::GetEnvironmentVariable("Path", "User")'))
  assert.ok(script.includes('[Environment]::SetEnvironmentVariable("Path", ($parts -join ";"), "User")'))

  // Mesmo se um diretório de EXTRA_BIN_DIRS existir, VERTICE_SKIP_PATH_SYNC=1 impede alterar o PATH ou chamar PowerShell
  const existingBin = EXTRA_BIN_DIRS[0]
  if (existingBin) mkdirSync(existingBin, { recursive: true })
  const beforePath = process.env.Path
  assert.equal(process.env.VERTICE_SKIP_PATH_SYNC, '1')
  assert.equal(syncUserCliPath(), undefined)
  assert.equal(process.env.Path, beforePath)
})
