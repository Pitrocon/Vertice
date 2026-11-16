import { testDir, cleanup } from './helpers/env.js'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buildLegacyDb } from './helpers/legacy-db.js'
import { startCore, server } from '../src/index.js'
import {
  closeDatabase,
  getProjectCounts,
  setAgentMemory,
  setAgentTranscript,
  patchConnection,
  upsertAgent,
  deleteAgent,
} from '../src/db.js'

const BASE = 'http://localhost:7899'

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  return { status: res.status, data }
}

before(async () => {
  await startCore({ port: 7899 })
})

after(async () => {
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(resolve))
  closeDatabase()
  cleanup()
})

test('409 ao criar agente, batch, meta ou tarefa sem projeto ativo e nada é gravado', async () => {
  const initial = await api('GET', '/api/workspace')
  assert.equal(initial.status, 200)
  assert.equal(initial.data.projects.length, 0)

  const expectedError = 'Crie ou ative um projeto antes de criar agentes, metas ou tarefas.'

  const r1 = await api('POST', '/api/agents', { id: 'ag-0', name: 'Zero', role: 'Dev', runtime: 'PowerShell', model: 'ps' })
  assert.equal(r1.status, 409)
  assert.equal(r1.data.error, expectedError)

  const r2 = await api('POST', '/api/agents/batch', { agents: [{ id: 'ag-b', name: 'Batch', role: 'Dev', runtime: 'PowerShell', model: 'ps' }] })
  assert.equal(r2.status, 409)
  assert.equal(r2.data.error, expectedError)

  const r3 = await api('POST', '/api/goals', { id: 'goal-0', title: 'Meta impossível' })
  assert.equal(r3.status, 409)
  assert.equal(r3.data.error, expectedError)

  const r4 = await api('POST', '/api/work-items', { id: 'wi-0', title: 'Tarefa impossível' })
  assert.equal(r4.status, 409)
  assert.equal(r4.data.error, expectedError)

  const afterCheck = await api('GET', '/api/workspace')
  assert.deepEqual(afterCheck.data.agents, [])
  assert.deepEqual(afterCheck.data.goals, [])
  assert.deepEqual(afterCheck.data.workItems, [])
})

test('G10: POST /api/agents/:id/session/restart sem projeto ativo devolve 400 sem abrir sessão', async () => {
  upsertAgent({ id: 'ag-sem-proj', name: 'Sem Projeto', role: 'Dev', runtime: 'PowerShell', model: 'ps' })
  try {
    const res = await api('POST', '/api/agents/ag-sem-proj/session/restart')
    assert.equal(res.status, 400)
    assert.equal(res.data.error, 'Crie ou ative um projeto antes de reiniciar a sessão.')
    const sessions = await api('GET', '/api/sessions')
    assert.equal(sessions.status, 200)
    assert.deepEqual(sessions.data.active, [])
  } finally {
    deleteAgent('ag-sem-proj')
  }
})

test('isolamento entre projetos, 400 para conexão/vínculo cross-project e 404 preservando ativo', async () => {
  const pathA = join(testDir, 'proj-a')
  const pathB = join(testDir, 'proj-b')
  mkdirSync(pathA, { recursive: true })
  mkdirSync(pathB, { recursive: true })

  // Cria projeto A (nasce ativo) e suas entidades
  const createA = await api('POST', '/api/projects', { id: 'proj-a', name: 'Projeto A', path: pathA, description: 'A' })
  assert.equal(createA.status, 200)
  assert.equal(createA.data.projects.find((p) => p.id === 'proj-a').active, true)

  assert.equal((await api('POST', '/api/agents', { id: 'ag-a1', name: 'Gerente A', role: 'Líder', kind: 'manager', runtime: 'Claude Code', model: 'claude-sonnet' })).status, 200)
  assert.equal((await api('POST', '/api/agents', { id: 'ag-a2', name: 'Worker A', role: 'Dev', runtime: 'Codex CLI', model: 'gpt-codex', parentId: 'ag-a1' })).status, 200)
  assert.equal((await api('POST', '/api/goals', { id: 'goal-a1', title: 'Meta A' })).status, 200)
  const wiA = await api('POST', '/api/work-items', { id: 'wi-a1', title: 'Tarefa A', assigneeId: 'ag-a2', goalId: 'goal-a1', priority: 'alta' })
  assert.equal(wiA.status, 200)

  // Cria projeto B (nasce inativo)
  const createB = await api('POST', '/api/projects', { id: 'proj-b', name: 'Projeto B', path: pathB, description: 'B' })
  assert.equal(createB.status, 200)
  const projA = createB.data.projects.find((p) => p.id === 'proj-a')
  const projB = createB.data.projects.find((p) => p.id === 'proj-b')
  assert.equal(projA.active, true)
  assert.equal(projB.active, false)
  assert.deepEqual(projA.counts, { agents: 2, connections: 1, goals: 1, tasks: 1, openTasks: 1 })
  assert.deepEqual(projB.counts, { agents: 0, connections: 0, goals: 0, tasks: 0, openTasks: 0 })

  // Ativa projeto B e cria entidades em B
  const actB = await api('POST', '/api/projects/proj-b/activate')
  assert.equal(actB.status, 200)
  assert.deepEqual(actB.data.agents, [])
  assert.deepEqual(actB.data.connections, [])
  assert.deepEqual(actB.data.goals, [])
  assert.deepEqual(actB.data.workItems, [])

  assert.equal((await api('POST', '/api/agents', { id: 'ag-b1', name: 'Worker B', role: 'QA', runtime: 'PowerShell', model: 'ps' })).status, 200)
  assert.equal((await api('POST', '/api/goals', { id: 'goal-b1', title: 'Meta B' })).status, 200)

  // 400 conexão entre projetos diferentes (A <-> B)
  const cross1 = await api('POST', '/api/connections', { source: 'ag-a1', target: 'ag-b1', label: 'cruzada' })
  assert.equal(cross1.status, 400)
  assert.equal(cross1.data.error, 'Os dois agentes precisam ser do mesmo projeto.')

  const cross2 = await api('POST', '/api/connections', { source: 'ag-b1', target: 'ag-a1' })
  assert.equal(cross2.status, 400)
  assert.equal(cross2.data.error, 'Os dois agentes precisam ser do mesmo projeto.')

  // 400 supervisor/responsável/meta de outro projeto
  assert.equal((await api('PATCH', '/api/agents/ag-b1', { parentId: 'ag-a1' })).status, 400)
  assert.equal((await api('POST', '/api/work-items', { id: 'wi-cross', title: 'Cross', assigneeId: 'ag-a1' })).status, 400)
  assert.equal((await api('POST', '/api/work-items', { id: 'wi-cross2', title: 'Cross', goalId: 'goal-a1' })).status, 400)
  assert.equal((await api('PATCH', '/api/work-items/wi-a1', { assigneeId: 'ag-b1' })).status, 400)

  // 404 ao ativar ou clonar projeto inexistente preserva ativo (proj-b)
  const actMissing = await api('POST', '/api/projects/nao-existe/activate')
  assert.equal(actMissing.status, 404)

  const cloneMissing = await api('POST', '/api/projects', {
    name: 'Fantasma',
    path: join(testDir, 'fantasma'),
    copyTeamFromProjectId: 'nao-existe',
  })
  assert.equal(cloneMissing.status, 404)

  const snapNow = await api('GET', '/api/workspace')
  assert.equal(snapNow.data.projects.find((p) => p.id === 'proj-b').active, true)
  assert.equal(snapNow.data.projects.some((p) => p.name === 'Fantasma'), false)
  assert.equal(snapNow.data.connections.length, 0)
})

test('ativação A -> B marca tarefa doing de A como failed com o motivo e round-trip A -> B -> A preserva snapshot', async () => {
  // Volta para A e coloca wi-a1 em doing + ag-a2 em working + conexão ativa
  const actA1 = await api('POST', '/api/projects/proj-a/activate')
  assert.equal(actA1.status, 200)
  assert.equal((await api('PATCH', '/api/work-items/wi-a1', { status: 'doing' })).status, 200)
  assert.equal((await api('PATCH', '/api/agents/ag-a2', { status: 'working', task: 'Implementando' })).status, 200)

  // Troca A -> B: deve interromper a tarefa doing de A e limpar working/active
  const actB = await api('POST', '/api/projects/proj-b/activate')
  assert.equal(actB.status, 200)

  // Memória viva de B gravada no workspace de B e NÃO de A
  assert.equal(existsSync(join(testDir, 'proj-b', '.vertice', 'memory', 'ag-b1.md')), true)
  assert.equal(existsSync(join(testDir, 'proj-b', '.vertice', 'memory', 'ag-a1.md')), false)

  // Volta para A: confere que wi-a1 virou failed com o motivo e ag-a2 voltou a idle
  const actA2 = await api('POST', '/api/projects/proj-a/activate')
  assert.equal(actA2.status, 200)
  const wiA1 = actA2.data.workItems.find((w) => w.id === 'wi-a1')
  const agA2 = actA2.data.agents.find((a) => a.id === 'ag-a2')
  assert.equal(wiA1.status, 'failed')
  assert.equal(wiA1.error, 'Interrompida: o projeto foi trocado ou excluído e a sessão foi encerrada.')
  assert.equal(agA2.status, 'idle')
  assert.equal(agA2.task, '')
  assert.ok(actA2.data.connections.every((c) => c.active === false))

  // Round-trip A -> B -> A em estado estável
  const beforeRoundTrip = {
    agents: actA2.data.agents,
    connections: actA2.data.connections,
    goals: actA2.data.goals,
    workItems: actA2.data.workItems,
  }
  // Ativar o já ativo mantém tudo intacto
  const sameA = await api('POST', '/api/projects/proj-a/activate')
  assert.equal(sameA.status, 200)
  assert.deepEqual(
    {
      agents: sameA.data.agents,
      connections: sameA.data.connections,
      goals: sameA.data.goals,
      workItems: sameA.data.workItems,
    },
    beforeRoundTrip,
  )

  await api('POST', '/api/projects/proj-b/activate')
  const backToA = await api('POST', '/api/projects/proj-a/activate')
  assert.deepEqual(
    {
      agents: backToA.data.agents,
      connections: backToA.data.connections,
      goals: backToA.data.goals,
      workItems: backToA.data.workItems,
    },
    beforeRoundTrip,
  )
})

test('clonagem de equipe preserva estrutura/handles/label, limpa estado e não copia metas nem tarefas', async () => {
  await api('POST', '/api/projects/proj-a/activate')
  setAgentMemory('ag-a2', 'Memória confidencial do projeto A')
  setAgentTranscript('ag-a2', 'Conversa anterior no terminal de A')
  await api('PATCH', '/api/agents/ag-a2', { status: 'working', task: 'Executando em A' })

  const snapA = (await api('GET', '/api/workspace')).data
  const connA = snapA.connections[0]
  assert.ok(connA)
  patchConnection(connA.id, { label: 'supervisiona', sourceHandle: 'right', targetHandle: 'left' })

  const pathC = join(testDir, 'proj-c')
  mkdirSync(pathC, { recursive: true })
  writeFileSync(join(pathC, 'nao-apagar.txt'), 'arquivo do usuario', 'utf8')

  const createC = await api('POST', '/api/projects', {
    id: 'proj-c',
    name: 'Projeto C',
    path: pathC,
    copyTeamFromProjectId: 'proj-a',
  })
  assert.equal(createC.status, 200)

  // Projeto A continua intacto
  const snapAAfter = (await api('GET', '/api/workspace')).data
  assert.equal(snapAAfter.goals.length, 1)
  assert.equal(snapAAfter.workItems.length, 1)
  assert.equal(snapAAfter.agents.find((a) => a.id === 'ag-a2').memory, 'Memória confidencial do projeto A')

  // Ativa C e valida a equipe clonada
  const actC = await api('POST', '/api/projects/proj-c/activate')
  assert.equal(actC.status, 200)
  const snapC = (await api('GET', '/api/workspace')).data

  assert.equal(snapC.agents.length, 2)
  assert.equal(snapC.connections.length, 1)
  assert.deepEqual(snapC.goals, [])
  assert.deepEqual(snapC.workItems, [])

  const idsA = new Set(['ag-a1', 'ag-a2', connA.id])
  for (const ag of snapC.agents) {
    assert.equal(idsA.has(ag.id), false)
    assert.equal(ag.status, 'idle')
    assert.equal(ag.task, '')
    assert.equal(ag.progress, 0)
    assert.equal(ag.memory, undefined)
    assert.equal(ag.lastTranscript, undefined)
  }

  const gerenteC = snapC.agents.find((a) => a.name === 'Gerente A')
  const workerC = snapC.agents.find((a) => a.name === 'Worker A')
  assert.ok(gerenteC.id.startsWith('gerente-a-'))
  assert.ok(workerC.id.startsWith('worker-a-'))
  assert.equal(workerC.createdBy, gerenteC.id)

  const connC = snapC.connections[0]
  assert.equal(idsA.has(connC.id), false)
  assert.equal(connC.source, gerenteC.id)
  assert.equal(connC.target, workerC.id)
  assert.equal(connC.label, 'supervisiona')
  assert.equal(connC.sourceHandle, 'right')
  assert.equal(connC.targetHandle, 'left')
  assert.equal(connC.active, false)
})

test('exclusão sem ?confirm=true devolve 409 com counts e ?confirm=true apaga cascata preservando pasta no disco', async () => {
  const noConfirm = await api('DELETE', '/api/projects/proj-c')
  assert.equal(noConfirm.status, 409)
  assert.equal(noConfirm.data.error, 'Confirme a exclusão do projeto.')
  assert.deepEqual(noConfirm.data.counts, { agents: 2, connections: 1, goals: 0, tasks: 0, openTasks: 0 })

  const stillThere = await api('GET', '/api/workspace')
  assert.equal(stillThere.data.projects.some((p) => p.id === 'proj-c'), true)
  assert.equal(stillThere.data.agents.length, 2)

  const confirmed = await api('DELETE', '/api/projects/proj-c?confirm=true')
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.data.projects.some((p) => p.id === 'proj-c'), false)
  assert.equal(confirmed.data.projects.find((p) => p.id === 'proj-a').active, true)
  assert.deepEqual(getProjectCounts('proj-c'), { agents: 0, connections: 0, goals: 0, tasks: 0, openTasks: 0 })

  // Pasta e arquivos em disco NÃO são removidos
  assert.equal(existsSync(join(testDir, 'proj-c', 'nao-apagar.txt')), true)
})

test('migração v6 -> v7 preserva dados, vincula ao projeto ativo/primeiro ou mantém NULL sem projeto', async () => {
  const prevDataDir = process.env.VERTICE_DATA_DIR
  const legacyDirActive = join(testDir, 'legacy-v6-active')
  const legacyDirFirst = join(testDir, 'legacy-v6-first')
  const legacyDirEmpty = join(testDir, 'legacy-v6-empty')

  buildLegacyDb(legacyDirActive, 6)
  {
    const raw = new DatabaseSync(join(legacyDirActive, 'vertice.db'))
    raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)').run('p1', 'Um', join(testDir, 'p1'), '', 0)
    raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)').run('p2', 'Dois', join(testDir, 'p2'), '', 1)
    raw.prepare("INSERT INTO agents (id, name, role, kind, runtime, model) VALUES ('a1', 'Ag1', 'Dev', 'worker', 'Claude Code', 'claude-sonnet')").run()
    raw.prepare("INSERT INTO connections (id, source, target, label, source_handle, target_handle) VALUES ('c1', 'a1', 'a1', 'loop', 'top', 'bottom')").run()
    raw.prepare("INSERT INTO goals (id, title, description) VALUES ('g1', 'Meta', 'Desc')").run()
    raw.prepare("INSERT INTO work_items (id, title, description, status) VALUES ('w1', 'Task', 'Spec', 'todo')").run()
    raw.close()
  }

  buildLegacyDb(legacyDirFirst, 6)
  {
    const raw = new DatabaseSync(join(legacyDirFirst, 'vertice.db'))
    raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)').run('p-first', 'Primeiro', join(testDir, 'pf'), '', 0)
    raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)').run('p-second', 'Segundo', join(testDir, 'ps'), '', 0)
    raw.prepare("INSERT INTO agents (id, name, role, kind, runtime, model) VALUES ('a-first', 'Ag', 'Dev', 'worker', 'PowerShell', 'ps')").run()
    raw.close()
  }

  buildLegacyDb(legacyDirEmpty, 6)
  {
    const raw = new DatabaseSync(join(legacyDirEmpty, 'vertice.db'))
    raw.prepare("INSERT INTO agents (id, name, role, kind, runtime, model) VALUES ('a-orphan', 'Orfao', 'Dev', 'worker', 'PowerShell', 'ps')").run()
    raw.close()
  }

  const legacyDirV1 = join(testDir, 'legacy-v1')
  buildLegacyDb(legacyDirV1, 1)
  {
    const raw = new DatabaseSync(join(legacyDirV1, 'vertice.db'))
    raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)').run('p-v1', 'Legado v1', join(testDir, 'pv1'), '', 1)
    raw.prepare("INSERT INTO agents (id, name, role, kind, runtime, model) VALUES ('a-v1', 'AgV1', 'Dev', 'worker', 'PowerShell', 'ps')").run()
    raw.prepare("INSERT INTO work_items (id, title, status) VALUES ('w-v1', 'Task v1', 'todo')").run()
    raw.close()
  }

  const legacyDirV7 = join(testDir, 'legacy-v7')
  buildLegacyDb(legacyDirV7, 7)
  {
    const raw = new DatabaseSync(join(legacyDirV7, 'vertice.db'))
    raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)').run('p-v7', 'Projeto v7', join(testDir, 'pv7'), '', 1)
    raw.prepare("INSERT INTO work_items (id, title, status, project_id) VALUES ('w-v7', 'Task v7', 'todo', 'p-v7')").run()
    raw.close()
  }

  try {
    // Caso 0: migração completa v1 -> v8 mantém dados legados
    process.env.VERTICE_DATA_DIR = legacyDirV1
    const modV1 = await import(`../src/db.js?caso=mig-v1-${Date.now()}`)
    const snapV1 = modV1.getWorkspaceSnapshot()
    assert.equal(snapV1.agents.length, 1)
    assert.equal(snapV1.workItems.length, 1)
    assert.equal(snapV1.workItems[0].headless, false)
    assert.equal(snapV1.workItems[0].ranMode, null)
    assert.equal(modV1.getAgentProjectId('a-v1'), 'p-v1')
    modV1.closeDatabase()

    // Caso 1: vincula ao projeto ativo (p2) e é idempotente
    process.env.VERTICE_DATA_DIR = legacyDirActive
    const modActive = await import(`../src/db.js?caso=mig-active-${Date.now()}`)
    const snap1 = modActive.getWorkspaceSnapshot()
    assert.equal(snap1.agents.length, 1)
    assert.equal(snap1.connections[0].sourceHandle, 'top')
    assert.equal(snap1.connections[0].targetHandle, 'bottom')
    assert.equal(snap1.goals.length, 1)
    assert.equal(snap1.workItems[0].description, 'Spec')
    assert.equal(snap1.workItems[0].headless, false)
    assert.equal(snap1.workItems[0].ranMode, null)
    assert.equal(modActive.getAgentProjectId('a1'), 'p2')
    modActive.closeDatabase()

    // Reexecução sobre v8 não altera nada
    const modActive2 = await import(`../src/db.js?caso=mig-idempotent-${Date.now()}`)
    assert.equal(modActive2.getAgentProjectId('a1'), 'p2')
    modActive2.closeDatabase()

    const checkRaw = new DatabaseSync(join(legacyDirActive, 'vertice.db'))
    assert.equal(checkRaw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '8')
    const workItemCols = checkRaw.prepare('PRAGMA table_info(work_items)').all().map((c) => c.name)
    assert.ok(workItemCols.includes('headless'))
    assert.ok(workItemCols.includes('ran_mode'))
    checkRaw.close()

    // Caso 1b: migração v7 -> v8 preserva work_items existentes e adiciona headless / ran_mode
    process.env.VERTICE_DATA_DIR = legacyDirV7
    const modV7 = await import(`../src/db.js?caso=mig-v7-${Date.now()}`)
    const snapV7 = modV7.getWorkspaceSnapshot()
    assert.equal(snapV7.workItems.length, 1)
    assert.equal(snapV7.workItems[0].id, 'w-v7')
    assert.equal(snapV7.workItems[0].headless, false)
    assert.equal(snapV7.workItems[0].ranMode, null)
    modV7.closeDatabase()

    // Caso 2: sem projeto ativo, vincula ao primeiro cadastrado
    process.env.VERTICE_DATA_DIR = legacyDirFirst
    const modFirst = await import(`../src/db.js?caso=mig-first-${Date.now()}`)
    assert.equal(modFirst.getAgentProjectId('a-first'), 'p-first')
    modFirst.closeDatabase()

    // Caso 3: sem projetos, mantém NULL e adota ao criar o primeiro projeto
    process.env.VERTICE_DATA_DIR = legacyDirEmpty
    const modEmpty = await import(`../src/db.js?caso=mig-empty-${Date.now()}`)
    assert.equal(modEmpty.getAgentProjectId('a-orphan'), null)
    assert.deepEqual(modEmpty.getWorkspaceSnapshot().agents, [])
    modEmpty.createProject({ id: 'novo-1', name: 'Novo', path: join(testDir, 'novo-1') })
    assert.equal(modEmpty.getAgentProjectId('a-orphan'), 'novo-1')
    assert.equal(modEmpty.getWorkspaceSnapshot().agents.length, 1)
    modEmpty.closeDatabase()
  } finally {
    process.env.VERTICE_DATA_DIR = prevDataDir
  }
})

test('G9: catálogo/runtimes expõem headless, POST/PATCH persistem headless e dispatch recusa 403/400 sem execução', async () => {
  const catalogRes = await api('GET', '/api/catalog')
  assert.equal(catalogRes.status, 200)
  const catalog = catalogRes.data.catalog
  assert.equal(catalog.find((r) => r.id === 'claude').headless, true)
  assert.equal(catalog.find((r) => r.id === 'codex').headless, true)
  assert.ok(catalog.find((r) => r.id === 'claude').headlessSources.some((u) => u.startsWith('https://')))
  assert.ok(catalog.find((r) => r.id === 'codex').headlessSources.some((u) => u.startsWith('https://')))
  for (const id of ['kimi', 'glm', 'antigravity', 'opencode', 'ollama', 'lmstudio', 'powershell']) {
    assert.equal(catalog.find((r) => r.id === id).headless, false)
  }

  const runtimesRes = await api('GET', '/api/runtimes')
  assert.equal(runtimesRes.status, 200)
  const runtimes = runtimesRes.data.runtimes
  assert.equal(runtimes.find((r) => r.id === 'claude').headless, true)
  assert.equal(runtimes.find((r) => r.id === 'codex').headless, true)
  for (const id of ['kimi', 'glm', 'antigravity', 'opencode', 'ollama', 'lmstudio', 'powershell']) {
    assert.equal(runtimes.find((r) => r.id === id).headless, false)
  }

  // Garante proj-a ativo (ag-a1 = Claude Code, ag-a2 = Codex CLI)
  await api('POST', '/api/projects/proj-a/activate')

  // POST e PATCH persistem headless: true (e recusam não booleano com 400)
  const badCreate = await api('POST', '/api/work-items', { id: 'wi-bad', title: 'Bad', headless: 'sim' })
  assert.equal(badCreate.status, 400)

  const createdCodex = await api('POST', '/api/work-items', {
    id: 'wi-headless-codex',
    title: 'Tarefa Codex automática',
    assigneeId: 'ag-a2',
    headless: true,
  })
  assert.equal(createdCodex.status, 200)
  assert.equal(createdCodex.data.workItems.find((w) => w.id === 'wi-headless-codex').headless, true)
  assert.equal(createdCodex.data.workItems.find((w) => w.id === 'wi-headless-codex').ranMode, null)

  const createdClaude = await api('POST', '/api/work-items', {
    id: 'wi-headless-claude',
    title: 'Tarefa Claude automática',
    assigneeId: 'ag-a1',
  })
  assert.equal(createdClaude.status, 200)
  assert.equal(createdClaude.data.workItems.find((w) => w.id === 'wi-headless-claude').headless, false)

  const badPatch = await api('PATCH', '/api/work-items/wi-headless-claude', { headless: 1 })
  assert.equal(badPatch.status, 400)

  const patchedClaude = await api('PATCH', '/api/work-items/wi-headless-claude', { headless: true })
  assert.equal(patchedClaude.status, 200)
  assert.equal(patchedClaude.data.workItems.find((w) => w.id === 'wi-headless-claude').headless, true)

  const snapCheck = await api('GET', '/api/workspace')
  assert.equal(snapCheck.data.workItems.find((w) => w.id === 'wi-headless-codex').headless, true)
  assert.equal(snapCheck.data.workItems.find((w) => w.id === 'wi-headless-claude').headless, true)

  const settingsRes = await api('GET', '/api/settings')
  const originalApproved = settingsRes.data.settings.approvedRuntimes
  const prevAnthropicKey = process.env.ANTHROPIC_API_KEY

  try {
    // 403 quando codex é removido de approvedRuntimes
    const withoutCodex = originalApproved.filter((id) => id !== 'codex')
    assert.equal((await api('PATCH', '/api/settings', { approvedRuntimes: withoutCodex })).status, 200)
    const deniedCodex = await api('POST', '/api/work-items/wi-headless-codex/dispatch')
    assert.equal(deniedCodex.status, 403)

    const afterCodexRefusal = await api('GET', '/api/workspace')
    assert.equal(afterCodexRefusal.data.workItems.find((w) => w.id === 'wi-headless-codex').status, 'todo')
    assert.equal(afterCodexRefusal.data.workItems.find((w) => w.id === 'wi-headless-codex').ranMode, null)

    // 400 quando claude não tem credencial (sem ANTHROPIC_API_KEY nem .credentials.json no perfil temporário)
    delete process.env.ANTHROPIC_API_KEY
    const deniedClaude = await api('POST', '/api/work-items/wi-headless-claude/dispatch')
    assert.equal(deniedClaude.status, 400)
    assert.match(deniedClaude.data.error, /login/i)

    const afterClaudeRefusal = await api('GET', '/api/workspace')
    assert.equal(afterClaudeRefusal.data.workItems.find((w) => w.id === 'wi-headless-claude').status, 'todo')
    assert.equal(afterClaudeRefusal.data.workItems.find((w) => w.id === 'wi-headless-claude').ranMode, null)

    // 403 quando o workspace do projeto ativo não está autorizado em allowedWorkspaces
    const projAPath = afterClaudeRefusal.data.projects.find((p) => p.id === 'proj-a').path
    const wsEntry = afterClaudeRefusal.data.allowedWorkspaces.find((w) => w.path.toLowerCase() === projAPath.toLowerCase())
    assert.ok(wsEntry)
    assert.equal((await api('DELETE', `/api/settings/workspaces/${wsEntry.id}`)).status, 200)
    try {
      const deniedWorkspace = await api('POST', '/api/work-items/wi-headless-claude/dispatch')
      assert.equal(deniedWorkspace.status, 403)
    } finally {
      await api('POST', '/api/settings/workspaces', { id: wsEntry.id, path: wsEntry.path })
    }
  } finally {
    if (prevAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prevAnthropicKey
    await api('PATCH', '/api/settings', { approvedRuntimes: originalApproved })
  }
})

test('G10: POST /api/agents/:id/session/restart e POST /api/sessions recusam 404/400/403 sem abrir PTY', async () => {
  await api('POST', '/api/projects/proj-a/activate')

  // 1. Agente inexistente -> 404
  const missing = await api('POST', '/api/agents/agente-inexistente/session/restart')
  assert.equal(missing.status, 404)
  assert.equal(missing.data.error, 'Agente não encontrado.')
  assert.deepEqual((await api('GET', '/api/sessions')).data.active, [])

  // Cria agente com Ollama no projeto ativo
  const createOllama = await api('POST', '/api/agents', {
    id: 'ag-ollama-restart',
    name: 'Ollama Restart',
    role: 'Analista',
    runtime: 'Ollama',
    model: 'llama3',
  })
  assert.equal(createOllama.status, 200)

  const settingsRes = await api('GET', '/api/settings')
  const originalApproved = settingsRes.data.settings.approvedRuntimes
  const snapBefore = (await api('GET', '/api/workspace')).data
  const projAPath = snapBefore.projects.find((p) => p.id === 'proj-a').path
  const wsEntry = snapBefore.allowedWorkspaces.find((w) => w.path.toLowerCase() === projAPath.toLowerCase())
  assert.ok(wsEntry)

  try {
    // 2. Runtime não aprovado (ollama fora de approvedRuntimes) -> 403, sem nenhuma sessão aberta
    const withoutOllama = originalApproved.filter((id) => id !== 'ollama')
    assert.equal((await api('PATCH', '/api/settings', { approvedRuntimes: withoutOllama })).status, 200)

    const deniedRuntime = await api('POST', '/api/agents/ag-ollama-restart/session/restart')
    assert.equal(deniedRuntime.status, 403)
    assert.match(deniedRuntime.data.error, /aprovado/i)
    assert.deepEqual((await api('GET', '/api/sessions')).data.active, [])

    const deniedSessionRuntime = await api('POST', '/api/sessions', {
      agentId: 'ag-ollama-restart',
      runtimeId: 'ollama',
    })
    assert.equal(deniedSessionRuntime.status, 403)
    assert.deepEqual((await api('GET', '/api/sessions')).data.active, [])

    // 3. Pasta fora dos workspaces permitidos -> 403, sem nenhuma sessão aberta
    assert.equal((await api('DELETE', `/api/settings/workspaces/${wsEntry.id}`)).status, 200)
    try {
      const deniedWorkspace = await api('POST', '/api/agents/ag-a1/session/restart')
      assert.equal(deniedWorkspace.status, 403)
      assert.deepEqual((await api('GET', '/api/sessions')).data.active, [])
    } finally {
      await api('POST', '/api/settings/workspaces', { id: wsEntry.id, path: wsEntry.path })
    }

    // 4. POST /api/sessions com runtime desconhecido -> 400 e cwd fora -> 403
    const unknownRuntime = await api('POST', '/api/sessions', {
      agentId: 'ag-a1',
      runtimeId: 'nao-existe',
    })
    assert.equal(unknownRuntime.status, 400)

    const outsideCwd = await api('POST', '/api/sessions', {
      agentId: 'ag-a1',
      runtimeId: 'claude',
      cwd: 'C:\\Windows',
    })
    assert.equal(outsideCwd.status, 403)
    assert.deepEqual((await api('GET', '/api/sessions')).data.active, [])
  } finally {
    await api('PATCH', '/api/settings', { approvedRuntimes: originalApproved })
    await api('DELETE', '/api/agents/ag-ollama-restart')
  }
})
