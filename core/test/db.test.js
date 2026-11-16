import { testDir, cleanup } from './helpers/env.js'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import fc from 'fast-check'
import { buildLegacyDb } from './helpers/legacy-db.js'

after(() => {
  cleanup()
})

let caseSeq = 0

async function runInDbDir(dir, label, fn) {
  const prevDir = process.env.VERTICE_DATA_DIR
  process.env.VERTICE_DATA_DIR = dir
  const seq = ++caseSeq
  let mod
  try {
    mod = await import(`../src/db.js?caso=${seq}-${label}`)
    return await fn(mod, dir)
  } finally {
    try { mod?.closeDatabase?.() } catch { /* já fechado */ }
    process.env.VERTICE_DATA_DIR = prevDir
  }
}

async function withIsolatedDb(label, prepareFn, testFn) {
  const caseDir = join(testDir, `db-case-${++caseSeq}-${label}`)
  mkdirSync(caseDir, { recursive: true })
  if (prepareFn) prepareFn(caseDir)
  try {
    return await runInDbDir(caseDir, label, testFn)
  } finally {
    try {
      rmSync(caseDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    } catch { /* fallback no cleanup() do after */ }
  }
}

function getColumnNames(sqliteDb, table) {
  return sqliteDb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
}

function getIndexNames(sqliteDb, table) {
  return sqliteDb.prepare(`PRAGMA index_list(${table})`).all().map((i) => i.name)
}

test('migrações legadas v1 até v8 preservam dados (projects, agents, connections, goals, work_items, sessions, events), elevam SCHEMA_VERSION para 8 e são idempotentes', async () => {
  for (let version = 1; version <= 8; version += 1) {
    const legacyDir = join(testDir, `legacy-v${version}-${++caseSeq}`)
    const proj1Path = join(legacyDir, 'proj1')
    const proj2Path = join(legacyDir, 'proj2')
    mkdirSync(proj1Path, { recursive: true })
    mkdirSync(proj2Path, { recursive: true })

    buildLegacyDb(legacyDir, version)
    {
      const raw = new DatabaseSync(join(legacyDir, 'vertice.db'))
      try {
        raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
          .run('p-1', 'Projeto Um', proj1Path, 'Principal', 1)
        raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
          .run('p-2', 'Projeto Dois', proj2Path, 'Secundário', 0)

        if (version >= 7) {
          raw.prepare(`
            INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by, memory, last_transcript, project_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('ag-1', 'Líder', 'Coordenação', 'manager', 'Claude Code', 'claude-sonnet', 'idle', '', 10, 'Coordene', 10, 20, null, 'mem-1', 'trans-1', 'p-1')
          raw.prepare(`
            INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by, memory, last_transcript, project_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('ag-2', 'Dev', 'Implementação', 'worker', 'Codex CLI', 'gpt-codex', 'queued', 'Fila', 25, 'Implemente', 30, 40, 'ag-1', 'mem-2', 'trans-2', 'p-1')
        } else if (version >= 4) {
          raw.prepare(`
            INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by, memory, last_transcript)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('ag-1', 'Líder', 'Coordenação', 'manager', 'Claude Code', 'claude-sonnet', 'idle', '', 10, 'Coordene', 10, 20, null, 'mem-1', 'trans-1')
          raw.prepare(`
            INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by, memory, last_transcript)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('ag-2', 'Dev', 'Implementação', 'worker', 'Codex CLI', 'gpt-codex', 'queued', 'Fila', 25, 'Implemente', 30, 40, 'ag-1', 'mem-2', 'trans-2')
        } else {
          raw.prepare(`
            INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('ag-1', 'Líder', 'Coordenação', 'manager', 'Claude Code', 'claude-sonnet', 'idle', '', 10, 'Coordene', 10, 20, null)
          raw.prepare(`
            INSERT INTO agents (id, name, role, kind, runtime, model, status, task, progress, prompt, x, y, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('ag-2', 'Dev', 'Implementação', 'worker', 'Codex CLI', 'gpt-codex', 'queued', 'Fila', 25, 'Implemente', 30, 40, 'ag-1')
        }

        if (version >= 7) {
          raw.prepare('INSERT INTO connections (id, source, target, label, active, source_handle, target_handle, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run('c-1', 'ag-1', 'ag-2', 'delega', 0, 'right', 'left', 'p-1')
          raw.prepare('INSERT INTO goals (id, title, description, project_id) VALUES (?, ?, ?, ?)')
            .run('g-1', 'Meta Legada', 'Descrição da meta', 'p-1')
        } else if (version >= 6) {
          raw.prepare('INSERT INTO connections (id, source, target, label, active, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?, ?)')
            .run('c-1', 'ag-1', 'ag-2', 'delega', 0, 'right', 'left')
          raw.prepare('INSERT INTO goals (id, title, description) VALUES (?, ?, ?)')
            .run('g-1', 'Meta Legada', 'Descrição da meta')
        } else {
          raw.prepare('INSERT INTO connections (id, source, target, label, active) VALUES (?, ?, ?, ?, ?)')
            .run('c-1', 'ag-1', 'ag-2', 'delega', 0)
          raw.prepare('INSERT INTO goals (id, title, description) VALUES (?, ?, ?)')
            .run('g-1', 'Meta Legada', 'Descrição da meta')
        }

        if (version >= 8) {
          raw.prepare(`
            INSERT INTO work_items (id, title, description, status, assignee_id, goal_id, priority, parent_task_id, depends_on, result, error, created_by, created_at, updated_at, project_id, headless, ran_mode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('w-1', 'Tarefa Legada', 'Especificação v8', 'done', 'ag-2', 'g-1', 'alta', null, null, 'Feito', null, 'ag-1', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', 'p-1', 1, 'headless')
        } else if (version >= 7) {
          raw.prepare(`
            INSERT INTO work_items (id, title, description, status, assignee_id, goal_id, priority, parent_task_id, depends_on, result, error, created_by, created_at, updated_at, project_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('w-1', 'Tarefa Legada', 'Especificação v7', 'done', 'ag-2', 'g-1', 'alta', null, null, 'Feito', null, 'ag-1', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z', 'p-1')
        } else if (version >= 5) {
          raw.prepare(`
            INSERT INTO work_items (id, title, description, status, assignee_id, goal_id, priority, parent_task_id, depends_on, result, error, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('w-1', 'Tarefa Legada', `Especificação v${version}`, 'done', 'ag-2', 'g-1', 'alta', null, null, 'Feito', null, 'ag-1', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z')
        } else if (version >= 3) {
          raw.prepare(`
            INSERT INTO work_items (id, title, status, assignee_id, goal_id, priority, parent_task_id, depends_on, result, error, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run('w-1', 'Tarefa Legada', 'done', 'ag-2', 'g-1', 'alta', null, null, 'Feito', null, 'ag-1', '2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z')
        } else {
          raw.prepare('INSERT INTO work_items (id, title, status, assignee_id, goal_id, priority) VALUES (?, ?, ?, ?, ?, ?)')
            .run('w-1', 'Tarefa Legada', 'done', 'ag-2', 'g-1', 'alta')
        }

        raw.prepare('INSERT INTO sessions (id, agent_id, command, cwd, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run('s-ended', 'ag-1', 'claude', proj1Path, 'ended', '2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z')
        raw.prepare('INSERT INTO sessions (id, agent_id, command, cwd, status, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run('s-running', 'ag-2', 'codex', proj1Path, 'running', '2026-01-01T00:10:00.000Z', null)

        raw.prepare('INSERT INTO events (agent_id, message, type, created_at) VALUES (?, ?, ?, ?)')
          .run('ag-1', `Evento v${version}`, 'system', '2026-01-01T00:00:00.000Z')
      } finally {
        raw.close()
      }
    }

    try {
      let snapFirstRun
      await runInDbDir(legacyDir, `mig-v${version}-first`, (mod) => {
        snapFirstRun = mod.getWorkspaceSnapshot({ transcripts: true })
        assert.equal(snapFirstRun.projects.length, 2)
        assert.equal(snapFirstRun.agents.length, 2)
        assert.equal(snapFirstRun.connections.length, 1)
        assert.equal(snapFirstRun.goals.length, 1)
        assert.equal(snapFirstRun.workItems.length, 1)

        const ag1 = snapFirstRun.agents.find((a) => a.id === 'ag-1')
        const ag2 = snapFirstRun.agents.find((a) => a.id === 'ag-2')
        assert.equal(ag1.name, 'Líder')
        assert.equal(ag2.status, 'queued')
        assert.equal(mod.getAgentProjectId('ag-1'), 'p-1')
        assert.equal(mod.getAgentProjectId('ag-2'), 'p-1')
        if (version >= 4) {
          assert.equal(ag1.memory, 'mem-1')
          assert.equal(ag1.lastTranscript, 'trans-1')
        }

        const conn = snapFirstRun.connections[0]
        assert.equal(conn.label, 'delega')
        if (version >= 6) {
          assert.equal(conn.sourceHandle, 'right')
          assert.equal(conn.targetHandle, 'left')
        }

        const wi = snapFirstRun.workItems[0]
        assert.equal(wi.title, 'Tarefa Legada')
        if (version >= 5) assert.equal(wi.description, `Especificação v${version}`)
        if (version === 8) {
          assert.equal(wi.headless, true)
          assert.equal(wi.ranMode, 'headless')
        } else {
          assert.equal(wi.headless, false)
          assert.equal(wi.ranMode, null)
        }

        const sessions = mod.listSessions()
        assert.equal(sessions.length, 2)
        assert.ok(sessions.some((s) => s.id === 's-ended' && s.status === 'ended'))
        assert.ok(sessions.some((s) => s.id === 's-running' && s.status === 'ended'))

        const events = mod.listEvents()
        assert.ok(events.some((e) => e.message === `Evento v${version}` && e.agent_id === 'ag-1'))

        const approved = mod.getSetting('approvedRuntimes')
        for (const rt of ['claude', 'codex', 'kimi', 'glm', 'antigravity', 'opencode', 'ollama', 'lmstudio', 'powershell']) {
          assert.ok(approved.includes(rt), `v${version} deve aprovar ${rt}`)
        }
      })

      // Verifica schema físico e versão 8 no SQLite
      {
        const checkRaw = new DatabaseSync(join(legacyDir, 'vertice.db'))
        try {
          assert.equal(checkRaw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '8')
          for (const table of ['agents', 'connections', 'goals', 'work_items']) {
            assert.ok(getColumnNames(checkRaw, table).includes('project_id'))
            assert.ok(getIndexNames(checkRaw, table).includes(`idx_${table}_project`))
          }
          assert.ok(getColumnNames(checkRaw, 'agents').includes('memory'))
          assert.ok(getColumnNames(checkRaw, 'agents').includes('last_transcript'))
          assert.ok(getColumnNames(checkRaw, 'connections').includes('source_handle'))
          assert.ok(getColumnNames(checkRaw, 'connections').includes('target_handle'))
          const wiCols = getColumnNames(checkRaw, 'work_items')
          for (const col of ['description', 'parent_task_id', 'depends_on', 'result', 'error', 'created_by', 'created_at', 'updated_at', 'headless', 'ran_mode']) {
            assert.ok(wiCols.includes(col), `work_items deve ter ${col}`)
          }
        } finally {
          checkRaw.close()
        }
      }

      // Idempotência: reabrir sobre v8 preserva tudo exatamente igual
      await runInDbDir(legacyDir, `mig-v${version}-idempotent`, (mod) => {
        const snapSecondRun = mod.getWorkspaceSnapshot({ transcripts: true })
        assert.deepEqual(snapSecondRun, snapFirstRun)
        assert.equal(mod.listSessions().length, 2)
        assert.equal(mod.listEvents().length, 1)
      })
    } finally {
      try {
        rmSync(legacyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      } catch { /* fallback no cleanup() do after */ }
    }
  }
})

test('migração v1 -> v2 corrige caminhos legados C:\\work\\* em projects', async () => {
  await withIsolatedDb(
    'v1-c-work',
    (dir) => {
      buildLegacyDb(dir, 1)
      const raw = new DatabaseSync(join(dir, 'vertice.db'))
      try {
        raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
          .run('proj-atlas', 'Atlas', 'C:\\work\\atlas', '', 1)
        raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
          .run('proj-intranet', 'Intranet', 'C:\\work\\intranet', '', 0)
      } finally {
        raw.close()
      }
    },
    (mod) => {
      const atlas = mod.getProject('proj-atlas')
      const intranet = mod.getProject('proj-intranet')
      assert.equal(atlas.path.startsWith('C:\\work\\'), false)
      assert.equal(intranet.path.startsWith('C:\\work\\'), false)
      assert.ok(atlas.path.endsWith('atlas'))
      assert.ok(intranet.path.endsWith('intranet'))
    },
  )
})

test('Property 1: A migração v7 preserva os dados, vincula ao projeto certo e é idempotente', async () => {
  // Feature: bloco-g-fechamento, Property 1: A migração v7 preserva os dados, vincula ao projeto certo e é idempotente
  const projectSpecArb = fc.array(
    fc.record({ active: fc.boolean(), name: fc.string({ minLength: 1, maxLength: 16 }) }),
    { minLength: 0, maxLength: 4 },
  )
  const countsArb = fc.record({
    agents: fc.integer({ min: 0, max: 6 }),
    connections: fc.integer({ min: 0, max: 6 }),
    goals: fc.integer({ min: 0, max: 6 }),
    workItems: fc.integer({ min: 0, max: 6 }),
  })

  await fc.assert(
    fc.asyncProperty(projectSpecArb, countsArb, async (projectSpecs, counts) => {
      const legacyDir = join(testDir, `prop1-${++caseSeq}`)
      mkdirSync(legacyDir, { recursive: true })
      buildLegacyDb(legacyDir, 6)

      // Garante no máximo um projeto ativo como ocorre na tabela projects real
      let foundActive = false
      const projects = projectSpecs.map((p, idx) => {
        const isActive = p.active && !foundActive
        if (isActive) foundActive = true
        return {
          id: `p-${idx}`,
          name: p.name,
          path: join(legacyDir, `ws-${idx}`),
          active: isActive ? 1 : 0,
        }
      })

      {
        const raw = new DatabaseSync(join(legacyDir, 'vertice.db'))
        try {
          raw.exec('BEGIN')
          for (const p of projects) {
            raw.prepare('INSERT INTO projects (id, name, path, description, active) VALUES (?, ?, ?, ?, ?)')
              .run(p.id, p.name, p.path, '', p.active)
          }
          for (let i = 0; i < counts.agents; i += 1) {
            raw.prepare("INSERT INTO agents (id, name, role, kind, runtime, model, status) VALUES (?, ?, 'Dev', 'worker', 'PowerShell', 'ps', 'idle')")
              .run(`ag-${i}`, `Agente ${i}`)
          }
          for (let i = 0; i < counts.connections; i += 1) {
            const src = counts.agents > 0 ? `ag-${i % counts.agents}` : `ext-src-${i}`
            const dst = counts.agents > 0 ? `ag-${(i + 1) % counts.agents}` : `ext-dst-${i}`
            raw.prepare('INSERT INTO connections (id, source, target, label, source_handle, target_handle) VALUES (?, ?, ?, ?, ?, ?)')
              .run(`conn-${i}`, src, dst, 'delega', 'right', 'left')
          }
          for (let i = 0; i < counts.goals; i += 1) {
            raw.prepare('INSERT INTO goals (id, title, description) VALUES (?, ?, ?)')
              .run(`goal-${i}`, `Meta ${i}`, 'Desc')
          }
          for (let i = 0; i < counts.workItems; i += 1) {
            raw.prepare('INSERT INTO work_items (id, title, description, status) VALUES (?, ?, ?, ?)')
              .run(`wi-${i}`, `Tarefa ${i}`, `Spec ${i}`, 'todo')
          }
          raw.exec('COMMIT')
        } finally {
          raw.close()
        }
      }

      const expectedProjectId = projects.find((p) => p.active === 1)?.id ?? projects[0]?.id ?? null

      try {
        await runInDbDir(legacyDir, `prop1-first-${caseSeq}`, () => {})

        let firstState
        {
          const checkRaw = new DatabaseSync(join(legacyDir, 'vertice.db'))
          try {
            assert.equal(checkRaw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '8')
            for (const table of ['agents', 'connections', 'goals', 'work_items']) {
              assert.ok(getColumnNames(checkRaw, table).includes('project_id'))
            }
            const rowsByTable = {
              agents: checkRaw.prepare('SELECT id, name, project_id FROM agents ORDER BY rowid').all(),
              connections: checkRaw.prepare('SELECT id, source, target, label, source_handle, target_handle, project_id FROM connections ORDER BY rowid').all(),
              goals: checkRaw.prepare('SELECT id, title, project_id FROM goals ORDER BY rowid').all(),
              workItems: checkRaw.prepare('SELECT id, title, description, project_id FROM work_items ORDER BY rowid').all(),
            }
            assert.equal(rowsByTable.agents.length, counts.agents)
            assert.equal(rowsByTable.connections.length, counts.connections)
            assert.equal(rowsByTable.goals.length, counts.goals)
            assert.equal(rowsByTable.workItems.length, counts.workItems)
            for (const list of Object.values(rowsByTable)) {
              for (const row of list) {
                assert.equal(row.project_id ?? null, expectedProjectId)
              }
            }
            firstState = rowsByTable
          } finally {
            checkRaw.close()
          }
        }

        // Segunda abertura sobre o mesmo banco (idempotência)
        await runInDbDir(legacyDir, `prop1-second-${caseSeq}`, () => {})
        {
          const checkRaw2 = new DatabaseSync(join(legacyDir, 'vertice.db'))
          try {
            assert.equal(checkRaw2.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '8')
            const secondState = {
              agents: checkRaw2.prepare('SELECT id, name, project_id FROM agents ORDER BY rowid').all(),
              connections: checkRaw2.prepare('SELECT id, source, target, label, source_handle, target_handle, project_id FROM connections ORDER BY rowid').all(),
              goals: checkRaw2.prepare('SELECT id, title, project_id FROM goals ORDER BY rowid').all(),
              workItems: checkRaw2.prepare('SELECT id, title, description, project_id FROM work_items ORDER BY rowid').all(),
            }
            assert.deepEqual(secondState, firstState)
          } finally {
            checkRaw2.close()
          }
        }
      } finally {
        try {
          rmSync(legacyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
        } catch { /* fallback no cleanup() */ }
      }
    }),
    { numRuns: 100 },
  )
})

test('connections preserva source_handle, target_handle, label e lança CrossProjectError entre projetos distintos', async () => {
  await withIsolatedDb('connections', null, (mod, dir) => {
    mod.createProject({ id: 'p1', name: 'P1', path: join(dir, 'p1') })
    mod.createProject({ id: 'p2', name: 'P2', path: join(dir, 'p2') })

    mod.upsertAgent({ id: 'a1', name: 'A1', role: 'Líder', kind: 'manager', runtime: 'Claude Code', model: 'claude-sonnet', projectId: 'p1' })
    mod.upsertAgent({ id: 'a2', name: 'A2', role: 'Dev', kind: 'worker', runtime: 'Codex CLI', model: 'gpt-codex', projectId: 'p1' })
    mod.upsertAgent({ id: 'b1', name: 'B1', role: 'QA', kind: 'worker', runtime: 'PowerShell', model: 'ps', projectId: 'p2' })

    mod.createConnection({
      id: 'c1',
      source: 'a1',
      target: 'a2',
      label: 'delega',
      active: true,
      sourceHandle: 'bottom',
      targetHandle: 'top',
    })

    const created = mod.getConnection('c1')
    assert.deepEqual(created, {
      id: 'c1',
      source: 'a1',
      target: 'a2',
      label: 'delega',
      sourceHandle: 'bottom',
      targetHandle: 'top',
      active: true,
    })
    assert.equal(mod.getAgent('a2').createdBy, 'a1')

    assert.equal(mod.patchConnection('c1', { label: 'revisa', sourceHandle: 'right', targetHandle: null }), true)
    assert.deepEqual(mod.getConnection('c1'), {
      id: 'c1',
      source: 'a1',
      target: 'a2',
      label: 'revisa',
      sourceHandle: 'right',
      active: true,
    })
    assert.equal(mod.patchConnection('nao-existe', { label: 'x' }), false)

    mod.setConnectionActive('a1', 'a2', false)
    assert.equal(mod.getConnection('c1').active, false)

    assert.throws(
      () => mod.createConnection({ id: 'c-cross', source: 'a1', target: 'b1', label: 'cruzada' }),
      (err) => err instanceof mod.CrossProjectError && err.status === 400,
    )
    assert.throws(
      () => mod.createConnection({ id: 'c-missing', source: 'a1', target: 'inexistente' }),
      (err) => err instanceof mod.CrossProjectError && err.status === 400,
    )
    assert.throws(
      () => mod.setAgentParent('a2', 'b1', 'c-parent-cross'),
      (err) => err instanceof mod.CrossProjectError && err.status === 400,
    )

    assert.equal(mod.deleteConnection('c1'), true)
    assert.equal(mod.getConnection('c1'), null)
    assert.equal(mod.getAgent('a2').createdBy, undefined)
  })
})

test('work_items suporta description, headless e ran_mode na criação, leitura e edição', async () => {
  await withIsolatedDb('work-items-cols', null, (mod, dir) => {
    mod.createProject({ id: 'p1', name: 'P1', path: join(dir, 'p1') })
    mod.upsertAgent({ id: 'a1', name: 'Dev', role: 'Dev', runtime: 'Claude Code', model: 'claude-sonnet', projectId: 'p1' })
    mod.createGoal({ id: 'g1', title: 'Meta', projectId: 'p1' })

    mod.createWorkItem({ id: 'w-default', title: 'Padrão', projectId: 'p1' })
    const defItem = mod.getWorkItem('w-default')
    assert.equal(defItem.description, undefined)
    assert.equal(defItem.headless, false)
    assert.equal(defItem.ranMode, null)

    mod.createWorkItem({
      id: 'w-full',
      title: 'Completa',
      description: 'Especificação detalhada da tarefa',
      status: 'doing',
      assigneeId: 'a1',
      goalId: 'g1',
      priority: 'alta',
      headless: true,
      ranMode: 'headless',
      projectId: 'p1',
    })

    const fullItem = mod.getWorkItem('w-full')
    assert.equal(fullItem.description, 'Especificação detalhada da tarefa')
    assert.equal(fullItem.headless, true)
    assert.equal(fullItem.ranMode, 'headless')

    mod.patchWorkItem('w-full', {
      description: 'Especificação revisada',
      headless: false,
      ranMode: 'interactive',
      status: 'review',
    })
    const updated = mod.getWorkItem('w-full')
    assert.equal(updated.description, 'Especificação revisada')
    assert.equal(updated.headless, false)
    assert.equal(updated.ranMode, 'interactive')
    assert.equal(updated.status, 'review')

    // Valor inválido de ranMode é normalizado para null
    mod.patchWorkItem('w-full', { ranMode: 'desconhecido' })
    assert.equal(mod.getWorkItem('w-full').ranMode, null)

    const listed = mod.listWorkItemsForProject('p1')
    assert.equal(listed.length, 2)
    assert.equal(mod.listWorkItemsForProject(null).length, 0)
  })
})

const distributionArb = fc.record({
  projectCount: fc.integer({ min: 1, max: 4 }),
  activeIndex: fc.integer({ min: -1, max: 3 }), // -1 = nenhum ativo
  agents: fc.array(
    fc.record({
      projIdx: fc.integer({ min: 0, max: 3 }),
      name: fc.string({ minLength: 1, maxLength: 14 }),
      status: fc.constantFrom('idle', 'queued'),
    }),
    { maxLength: 12 },
  ),
  connections: fc.array(
    fc.record({
      projIdx: fc.integer({ min: 0, max: 3 }),
      label: fc.constantFrom('delega', 'revisa', 'apoia'),
      sourceHandle: fc.option(fc.constantFrom('top', 'right', 'bottom', 'left'), { nil: null }),
      targetHandle: fc.option(fc.constantFrom('top', 'right', 'bottom', 'left'), { nil: null }),
    }),
    { maxLength: 12 },
  ),
  goals: fc.array(
    fc.record({
      projIdx: fc.integer({ min: 0, max: 3 }),
      title: fc.string({ minLength: 1, maxLength: 20 }),
    }),
    { maxLength: 12 },
  ),
  workItems: fc.array(
    fc.record({
      projIdx: fc.integer({ min: 0, max: 3 }),
      title: fc.string({ minLength: 1, maxLength: 20 }),
      status: fc.constantFrom('todo', 'doing', 'review', 'failed', 'done'),
      headless: fc.boolean(),
    }),
    { maxLength: 12 },
  ),
})

function seedDistribution(mod, baseDir, dist) {
  return mod.withTransaction(() => {
    const projectIds = []
    for (let i = 0; i < dist.projectCount; i += 1) {
      const pid = `proj-${i}`
      projectIds.push(pid)
      mod.createProject({ id: pid, name: `Projeto ${i}`, path: join(baseDir, pid) })
    }

    const projectAgents = new Map(projectIds.map((pid) => [pid, []]))
    dist.agents.forEach((a, idx) => {
      const pid = projectIds[a.projIdx % projectIds.length]
      const id = `ag-${idx}`
      mod.upsertAgent({
        id,
        name: a.name,
        role: 'Especialista',
        runtime: 'PowerShell',
        model: 'ps',
        status: a.status,
        projectId: pid,
      })
      projectAgents.get(pid).push(id)
    })

    const expectedConns = []
    dist.connections.forEach((c, idx) => {
      const pid = projectIds[c.projIdx % projectIds.length]
      const agentsInProj = projectAgents.get(pid)
      if (agentsInProj.length === 0) return
      const source = agentsInProj[idx % agentsInProj.length]
      const target = agentsInProj[(idx + 1) % agentsInProj.length]
      const cid = `conn-${idx}`
      mod.createConnection({
        id: cid,
        source,
        target,
        label: c.label,
        sourceHandle: c.sourceHandle,
        targetHandle: c.targetHandle,
      })
      expectedConns.push({ id: cid, projectId: pid })
    })

    const expectedGoals = []
    dist.goals.forEach((g, idx) => {
      const pid = projectIds[g.projIdx % projectIds.length]
      const gid = `goal-${idx}`
      mod.createGoal({ id: gid, title: g.title, projectId: pid })
      expectedGoals.push({ id: gid, projectId: pid })
    })

    const expectedWorkItems = []
    dist.workItems.forEach((w, idx) => {
      const pid = projectIds[w.projIdx % projectIds.length]
      const wid = `wi-${idx}`
      mod.createWorkItem({
        id: wid,
        title: w.title,
        status: w.status,
        headless: w.headless,
        projectId: pid,
      })
      expectedWorkItems.push({ id: wid, projectId: pid, status: w.status })
    })

    let activeId = null
    if (dist.activeIndex >= 0) {
      activeId = projectIds[dist.activeIndex % projectIds.length]
      mod.activateProject(activeId)
    } else {
      // Caso sem nenhum projeto ativo
      mod.activateProject('__nenhum__')
    }

    return { projectIds, activeId, projectAgents, expectedConns, expectedGoals, expectedWorkItems }
  })
}

test('Property 2: O snapshot nunca mistura projetos', async () => {
  // Feature: bloco-g-fechamento, Property 2: O snapshot nunca mistura projetos
  await fc.assert(
    fc.asyncProperty(distributionArb, async (dist) => {
      await withIsolatedDb('prop2', null, (mod, dir) => {
        const seeded = seedDistribution(mod, dir, dist)
        const snap = mod.getWorkspaceSnapshot()

        assert.equal(snap.projects.length, seeded.projectIds.length)
        if (!seeded.activeId) {
          assert.deepEqual(snap.agents, [])
          assert.deepEqual(snap.connections, [])
          assert.deepEqual(snap.goals, [])
          assert.deepEqual(snap.workItems, [])
          return
        }

        const expectedAgentIds = new Set(seeded.projectAgents.get(seeded.activeId))
        const expectedConnIds = new Set(seeded.expectedConns.filter((c) => c.projectId === seeded.activeId).map((c) => c.id))
        const expectedGoalIds = new Set(seeded.expectedGoals.filter((g) => g.projectId === seeded.activeId).map((g) => g.id))
        const expectedWiIds = new Set(seeded.expectedWorkItems.filter((w) => w.projectId === seeded.activeId).map((w) => w.id))

        assert.deepEqual(new Set(snap.agents.map((a) => a.id)), expectedAgentIds)
        assert.deepEqual(new Set(snap.connections.map((c) => c.id)), expectedConnIds)
        assert.deepEqual(new Set(snap.goals.map((g) => g.id)), expectedGoalIds)
        assert.deepEqual(new Set(snap.workItems.map((w) => w.id)), expectedWiIds)
      })
    }),
    { numRuns: 100 },
  )
})

test('Property 3: As contagens por projeto batem com as linhas reais', async () => {
  // Feature: bloco-g-fechamento, Property 3: As contagens por projeto batem com as linhas reais
  await fc.assert(
    fc.asyncProperty(distributionArb, async (dist) => {
      await withIsolatedDb('prop3', null, (mod, dir) => {
        const seeded = seedDistribution(mod, dir, dist)
        const snap = mod.getWorkspaceSnapshot()

        for (const pid of seeded.projectIds) {
          const expected = {
            agents: seeded.projectAgents.get(pid).length,
            connections: seeded.expectedConns.filter((c) => c.projectId === pid).length,
            goals: seeded.expectedGoals.filter((g) => g.projectId === pid).length,
            tasks: seeded.expectedWorkItems.filter((w) => w.projectId === pid).length,
            openTasks: seeded.expectedWorkItems.filter((w) => w.projectId === pid && w.status !== 'done').length,
          }
          const snapProj = snap.projects.find((p) => p.id === pid)
          assert.deepEqual(snapProj.counts, expected)
          assert.deepEqual(mod.getProjectCounts(pid), expected)
        }
      })
    }),
    { numRuns: 100 },
  )
})

test('Property 9: A equipe clonada é isomorfa à original, limpa e sem metas nem tarefas', async () => {
  // Feature: bloco-g-fechamento, Property 9: A equipe clonada é isomorfa à original, limpa e sem metas nem tarefas
  const teamArb = fc.record({
    agents: fc.array(
      fc.record({
        name: fc.constantFrom('Gerente', 'Arquiteto', 'Dev Backend', 'Revisor QA', 'Pesquisador'),
        role: fc.string({ minLength: 1, maxLength: 18 }),
        kind: fc.constantFrom('manager', 'worker'),
        status: fc.constantFrom('idle', 'working', 'queued'),
        task: fc.string({ minLength: 1, maxLength: 20 }),
        progress: fc.integer({ min: 1, max: 100 }),
        prompt: fc.string({ maxLength: 30 }),
        memory: fc.string({ minLength: 1, maxLength: 30 }),
        transcript: fc.string({ minLength: 1, maxLength: 30 }),
        parentOffset: fc.option(fc.integer({ min: 1, max: 6 }), { nil: null }),
      }),
      { minLength: 0, maxLength: 8 },
    ),
    connections: fc.array(
      fc.record({
        srcIdx: fc.integer({ min: 0, max: 7 }),
        dstIdx: fc.integer({ min: 0, max: 7 }),
        label: fc.constantFrom('delega', 'revisa', 'consulta'),
        sourceHandle: fc.option(fc.constantFrom('top', 'right', 'bottom', 'left'), { nil: null }),
        targetHandle: fc.option(fc.constantFrom('top', 'right', 'bottom', 'left'), { nil: null }),
        active: fc.boolean(),
      }),
      { maxLength: 8 },
    ),
    goalCount: fc.integer({ min: 0, max: 4 }),
    workItemCount: fc.integer({ min: 0, max: 4 }),
  })

  await fc.assert(
    fc.asyncProperty(teamArb, async (team) => {
      await withIsolatedDb('prop9', null, (mod, dir) => {
        mod.withTransaction(() => {
          mod.createProject({ id: 'src', name: 'Origem', path: join(dir, 'src') })

          // Insere agentes em árvore (createdBy sempre aponta para índice menor)
          const srcAgentIds = []
          team.agents.forEach((a, idx) => {
            const id = `src-ag-${idx}`
            const createdBy = idx > 0 && a.parentOffset !== null ? srcAgentIds[idx - ((a.parentOffset % idx) + 1)] : null
            srcAgentIds.push(id)
            mod.upsertAgent({
              id,
              name: a.name,
              role: a.role,
              kind: a.kind,
              runtime: 'Claude Code',
              model: 'claude-sonnet',
              status: a.status,
              task: a.task,
              progress: a.progress,
              prompt: a.prompt,
              x: idx * 50,
              y: idx * 30,
              createdBy,
              projectId: 'src',
            })
            mod.setAgentMemory(id, a.memory)
            mod.setAgentTranscript(id, a.transcript)
          })

          // Conexões internas válidas
          if (srcAgentIds.length > 0) {
            team.connections.forEach((c, idx) => {
              const source = srcAgentIds[c.srcIdx % srcAgentIds.length]
              const target = srcAgentIds[c.dstIdx % srcAgentIds.length]
              const cid = `src-conn-${idx}`
              mod.createConnection({
                id: cid,
                source,
                target,
                label: c.label,
                active: c.active,
                sourceHandle: c.sourceHandle,
                targetHandle: c.targetHandle,
              })
            })
          }

          for (let i = 0; i < team.goalCount; i += 1) {
            mod.createGoal({ id: `src-g-${i}`, title: `Meta ${i}`, projectId: 'src' })
          }
          for (let i = 0; i < team.workItemCount; i += 1) {
            mod.createWorkItem({ id: `src-w-${i}`, title: `Task ${i}`, projectId: 'src' })
          }
        })

        const sourceBefore = mod.getWorkspaceSnapshot({ transcripts: true })

        // Clone via createProject({ copyTeamFromProjectId })
        mod.createProject({
          id: 'dst',
          name: 'Destino',
          path: join(dir, 'dst'),
          copyTeamFromProjectId: 'src',
        })

        // Origem inexistente deve falhar com status 404 sem criar projeto
        assert.throws(
          () => mod.createProject({ id: 'ghost', name: 'Ghost', path: join(dir, 'ghost'), copyTeamFromProjectId: 'missing' }),
          (err) => err.status === 404,
        )
        assert.equal(mod.getProject('ghost'), null)

        // Origem intacta
        const sourceAfter = mod.getWorkspaceSnapshot({ transcripts: true })
        assert.deepEqual(sourceAfter.agents, sourceBefore.agents)
        assert.deepEqual(sourceAfter.connections, sourceBefore.connections)
        assert.deepEqual(sourceAfter.goals, sourceBefore.goals)
        assert.deepEqual(sourceAfter.workItems, sourceBefore.workItems)

        // Ativa destino e verifica isomorfismo e limpeza
        mod.activateProject('dst')
        const cloned = mod.getWorkspaceSnapshot({ transcripts: true })
        assert.equal(cloned.agents.length, sourceBefore.agents.length)
        assert.equal(cloned.connections.length, sourceBefore.connections.length)
        assert.deepEqual(cloned.goals, [])
        assert.deepEqual(cloned.workItems, [])

        const srcIdSet = new Set(sourceBefore.agents.map((a) => a.id))
        const dstIdSet = new Set(cloned.agents.map((a) => a.id))
        assert.equal(dstIdSet.size, cloned.agents.length)
        for (const id of dstIdSet) assert.equal(srcIdSet.has(id), false)

        const srcConnIdSet = new Set(sourceBefore.connections.map((c) => c.id))
        const dstConnIdSet = new Set(cloned.connections.map((c) => c.id))
        assert.equal(dstConnIdSet.size, cloned.connections.length)
        for (const id of dstConnIdSet) assert.equal(srcConnIdSet.has(id), false)

        // Mapeia bijeção por ordem de criação (ORDER BY rowid)
        const idMap = new Map()
        sourceBefore.agents.forEach((srcAg, idx) => {
          const dstAg = cloned.agents[idx]
          idMap.set(srcAg.id, dstAg.id)
          assert.equal(dstAg.name, srcAg.name)
          assert.equal(dstAg.role, srcAg.role)
          assert.equal(dstAg.kind, srcAg.kind)
          assert.equal(dstAg.prompt, srcAg.prompt)
          assert.equal(dstAg.status, 'idle')
          assert.equal(dstAg.task, '')
          assert.equal(dstAg.progress, 0)
          assert.equal(dstAg.memory, undefined)
          assert.equal(dstAg.lastTranscript, undefined)
          assert.equal(mod.getAgentTranscript(dstAg.id), '')
        })

        sourceBefore.agents.forEach((srcAg, idx) => {
          const dstAg = cloned.agents[idx]
          const expectedCreatedBy = srcAg.createdBy ? idMap.get(srcAg.createdBy) : undefined
          assert.equal(dstAg.createdBy, expectedCreatedBy)
        })

        sourceBefore.connections.forEach((srcConn, idx) => {
          const dstConn = cloned.connections[idx]
          assert.equal(dstConn.source, idMap.get(srcConn.source))
          assert.equal(dstConn.target, idMap.get(srcConn.target))
          assert.equal(dstConn.label, srcConn.label)
          assert.equal(dstConn.sourceHandle, srcConn.sourceHandle)
          assert.equal(dstConn.targetHandle, srcConn.targetHandle)
          assert.equal(dstConn.active, false)
        })
      })
    }),
    { numRuns: 100 },
  )
})

test('Property 7: Excluir um projeto remove exatamente o que é dele', async () => {
  // Feature: bloco-g-fechamento, Property 7: Excluir um projeto remove exatamente o que é dele
  await fc.assert(
    fc.asyncProperty(
      distributionArb,
      fc.integer({ min: 0, max: 3 }),
      async (dist, deleteIndexRaw) => {
        await withIsolatedDb('prop7', null, (mod, dir) => {
          const seeded = seedDistribution(mod, dir, dist)
          const targetId = seeded.projectIds[deleteIndexRaw % seeded.projectIds.length]
          const wasActive = seeded.activeId === targetId

          mod.recordSession({ id: 'sess-keep', agentId: 'ag-0', command: 'pwsh', cwd: dir })
          mod.recordEvent('ag-0', 'Evento preservado', 'system')

          const beforeCounts = mod.getProjectCounts(targetId)
          const res = mod.deleteProjectCascade(targetId)
          assert.ok(res)
          assert.deepEqual(res.counts, beforeCounts)
          assert.equal(res.wasActive, wasActive)
          assert.deepEqual(new Set(res.agentIds), new Set(seeded.projectAgents.get(targetId)))

          const remainingIds = seeded.projectIds.filter((id) => id !== targetId)
          if (wasActive) {
            assert.equal(res.nextActiveId, remainingIds[0] ?? null)
            assert.equal(mod.getActiveProjectId(), remainingIds[0] ?? null)
          } else {
            assert.equal(res.nextActiveId, null)
          }

          assert.equal(mod.getProject(targetId), null)
          assert.deepEqual(mod.getProjectCounts(targetId), { agents: 0, connections: 0, goals: 0, tasks: 0, openTasks: 0 })

          // Outros projetos mantêm exatamente suas contagens e entidades
          for (const otherId of remainingIds) {
            mod.activateProject(otherId)
            const snap = mod.getWorkspaceSnapshot()
            assert.equal(snap.agents.length, seeded.projectAgents.get(otherId).length)
            assert.equal(snap.connections.length, seeded.expectedConns.filter((c) => c.projectId === otherId).length)
            assert.equal(snap.goals.length, seeded.expectedGoals.filter((g) => g.projectId === otherId).length)
            assert.equal(snap.workItems.length, seeded.expectedWorkItems.filter((w) => w.projectId === otherId).length)
          }

          // Sessões e eventos são preservados
          assert.equal(mod.listSessions().length, 1)
          assert.equal(mod.listEvents().length, 1)
          assert.equal(mod.deleteProjectCascade('inexistente'), null)
        })
      },
    ),
    { numRuns: 100 },
  )
})

test('adoção de linhas nulas ocorre apenas ao criar o primeiro projeto', async () => {
  await withIsolatedDb(
    'adopt-null',
    (dir) => {
      buildLegacyDb(dir, 6)
      const raw = new DatabaseSync(join(dir, 'vertice.db'))
      try {
        raw.prepare("INSERT INTO agents (id, name, role, kind, runtime, model) VALUES ('ag-o1', 'Órfão 1', 'Dev', 'worker', 'PowerShell', 'ps')").run()
        raw.prepare("INSERT INTO agents (id, name, role, kind, runtime, model) VALUES ('ag-o2', 'Órfão 2', 'QA', 'worker', 'PowerShell', 'ps')").run()
        raw.prepare("INSERT INTO connections (id, source, target, label) VALUES ('c-o', 'ag-o1', 'ag-o2', 'delega')").run()
        raw.prepare("INSERT INTO goals (id, title, description) VALUES ('g-o', 'Meta órfã', '')").run()
        raw.prepare("INSERT INTO work_items (id, title, description, status) VALUES ('w-o', 'Tarefa órfã', 'Spec', 'todo')").run()
      } finally {
        raw.close()
      }
    },
    (mod, dir) => {
      assert.equal(mod.getActiveProjectId(), null)
      assert.equal(mod.getAgentProjectId('ag-o1'), null)
      const beforeSnap = mod.getWorkspaceSnapshot()
      assert.deepEqual(beforeSnap.agents, [])
      assert.deepEqual(beforeSnap.connections, [])
      assert.deepEqual(beforeSnap.goals, [])
      assert.deepEqual(beforeSnap.workItems, [])

      const first = mod.createProject({ id: 'p-first', name: 'Primeiro', path: join(dir, 'first') })
      assert.equal(first.active, true)
      assert.equal(mod.getAgentProjectId('ag-o1'), 'p-first')
      assert.equal(mod.getGoalProjectId('g-o'), 'p-first')
      assert.equal(mod.getWorkItemProjectId('w-o'), 'p-first')

      const afterSnap = mod.getWorkspaceSnapshot()
      assert.equal(afterSnap.agents.length, 2)
      assert.equal(afterSnap.connections.length, 1)
      assert.equal(afterSnap.goals.length, 1)
      assert.equal(afterSnap.workItems.length, 1)

      // Segundo projeto nasce inativo e sem roubar entidades do primeiro
      const second = mod.createProject({ id: 'p-second', name: 'Segundo', path: join(dir, 'second') })
      assert.equal(second.active, false)
      assert.deepEqual(mod.getProjectCounts('p-second'), { agents: 0, connections: 0, goals: 0, tasks: 0, openTasks: 0 })
      assert.equal(mod.getAgentProjectId('ag-o1'), 'p-first')
    },
  )
})

test('Property 10: Alternar projetos reproduz o mesmo snapshot (round trip)', async () => {
  // Feature: bloco-g-fechamento, Property 10: Alternar projetos reproduz o mesmo snapshot (round trip)
  const twoProjectDistArb = distributionArb.map((d) => ({ ...d, projectCount: Math.max(2, d.projectCount) }))

  await fc.assert(
    fc.asyncProperty(twoProjectDistArb, async (dist) => {
      await withIsolatedDb('prop10', null, (mod, dir) => {
        seedDistribution(mod, dir, dist)

        mod.activateProject('proj-0')
        const snapA1 = mod.getWorkspaceSnapshot()

        mod.activateProject('proj-1')
        const snapB = mod.getWorkspaceSnapshot()
        assert.equal(snapB.projects.find((p) => p.id === 'proj-1').active, true)

        mod.activateProject('proj-0')
        const snapA2 = mod.getWorkspaceSnapshot()

        assert.deepEqual(snapA2.agents, snapA1.agents)
        assert.deepEqual(snapA2.connections, snapA1.connections)
        assert.deepEqual(snapA2.goals, snapA1.goals)
        assert.deepEqual(snapA2.workItems, snapA1.workItems)
      })
    }),
    { numRuns: 100 },
  )
})
