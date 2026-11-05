import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInside, assertAllowedCwd, WorkspaceError } from '../src/workspace.js'

// Cria um root real temporario para os testes.
const root = mkdtempSync(join(tmpdir(), 'vertice-ws-'))
mkdirSync(join(root, 'sub'), { recursive: true })

test('aceita subdiretorio valido dentro do root', () => {
  const out = resolveInside(root, 'sub')
  assert.ok(out.toLowerCase().startsWith(root.toLowerCase()))
})

test('aceita o proprio root', () => {
  const out = resolveInside(root, '.')
  assert.equal(out.toLowerCase(), root.toLowerCase())
})

test('aceita caminho ainda inexistente dentro do root', () => {
  const out = resolveInside(root, 'nova-pasta/arquivo')
  assert.ok(out.toLowerCase().startsWith(root.toLowerCase()))
})

test('rejeita .. que escapa do root', () => {
  assert.throws(() => resolveInside(root, '..\\..'), WorkspaceError)
})

test('rejeita caminho absoluto fora (C:\\Windows)', () => {
  assert.throws(() => resolveInside(root, 'C:\\Windows'), WorkspaceError)
})

test('rejeita caminho UNC', () => {
  assert.throws(() => resolveInside(root, '\\\\servidor\\share'), WorkspaceError)
})

test('rejeita dispositivo \\\\.\\', () => {
  assert.throws(() => resolveInside(root, '\\\\.\\PhysicalDrive0'), WorkspaceError)
})

test('rejeita prefixo parecido mas fora (root-vizinho)', () => {
  const sibling = root + '-vizinho'
  assert.throws(() => resolveInside(root, sibling), WorkspaceError)
})

test('assertAllowedCwd aceita cwd dentro de um dos workspaces', () => {
  const out = assertAllowedCwd(join(root, 'sub'), [root, 'C:\\outro'])
  assert.ok(out.toLowerCase().startsWith(root.toLowerCase()))
})

test('assertAllowedCwd e case-insensitive no Windows', () => {
  const upper = root.toUpperCase()
  const out = assertAllowedCwd(upper, [root])
  assert.ok(out)
})

test('assertAllowedCwd rejeita cwd fora de todos', () => {
  assert.throws(() => assertAllowedCwd('C:\\Windows', [root]), WorkspaceError)
})

test('assertAllowedCwd rejeita quando nao ha workspaces configurados', () => {
  assert.throws(() => assertAllowedCwd(root, []), WorkspaceError)
})

test('WorkspaceError tem status 403', () => {
  try { resolveInside(root, 'C:\\Windows') } catch (e) { assert.equal(e.status, 403) }
})

test.after(() => { rmSync(root, { recursive: true, force: true }) })
