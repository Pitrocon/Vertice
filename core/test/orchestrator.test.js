import { testDir, cleanup } from './helpers/env.js'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFakeSessions } from './helpers/fake-sessions.js'
import {
  createProject,
  activateProject,
  allowProjectWorkspace,
  upsertAgent,
  createConnection,
  createWorkItem,
  getWorkItem,
  getAgent,
  getWorkspaceSnapshot,
  closeDatabase,
} from '../src/db.js'
import {
  configureOrchestrator,
  launchAgentSession,
  dispatchWorkItem,
  completeWorkItem,
  approveWorkItem,
  sendAgentMessage,
  resetForProjectSwitch,
  syncMemoryFile,
  stopHandoffWatcher,
  flushTranscripts,
  PROJECT_SWITCH_ERROR,
} from '../src/orchestrator.js'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(predicate, timeoutMs = 6000, stepMs = 50) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true
    await delay(stepMs)
  }
  return Boolean(predicate())
}

const fake = createFakeSessions()
const broadcasts = []

const pathA = join(testDir, 'proj-a')
const pathB = join(testDir, 'proj-b')

before(() => {
  mkdirSync(pathA, { recursive: true })
  mkdirSync(pathB, { recursive: true })
  configureOrchestrator({
    broadcast: (event) => broadcasts.push(event),
    sessionApi: fake.sessionApi,
  })

  createProject({ id: 'proj-a', name: 'Projeto A', path: pathA })
  allowProjectWorkspace({ id: 'proj-a', path: pathA })

  upsertAgent({
    id: 'ag-gerente',
    name: 'Gerente',
    role: 'Líder',
    kind: 'manager',
    runtime: 'Claude Code',
    model: 'claude-sonnet',
    prompt: 'Coordene a equipe.',
    projectId: 'proj-a',
  })
  upsertAgent({
    id: 'ag-dev',
    name: 'Executor',
    role: 'Dev',
    kind: 'worker',
    runtime: 'Codex CLI',
    model: 'gpt-codex',
    prompt: 'Implemente a solução.',
    projectId: 'proj-a',
  })
  upsertAgent({
    id: 'ag-qa',
    name: 'Revisor',
    role: 'QA',
    kind: 'worker',
    runtime: 'Claude Code',
    model: 'claude-sonnet',
    prompt: 'Revise a entrega.',
    projectId: 'proj-a',
  })

  createConnection({ id: 'conn-1', source: 'ag-gerente', target: 'ag-dev', label: 'delega' })
  createConnection({ id: 'conn-2', source: 'ag-dev', target: 'ag-qa', label: 'revisa' })
})

after(() => {
  resetForProjectSwitch(null)
  stopHandoffWatcher()
  flushTranscripts()
  fake.reset()
  closeDatabase()
  cleanup()
})

test('roteador [PARA: Nome] entrega ao agente conectado e ignora eco e repetição em 15s', async () => {
  const { session: gerenteSession } = await launchAgentSession({
    agent: getAgent('ag-gerente', { transcript: false }),
    runtimeId: 'claude',
    cwd: pathA,
    resume: false,
  })

  // Linhas de contexto e placeholders devem ser ignoradas
  fake.emitOutput(gerenteSession.id, 'Contexto Vértice: [PARA: Executor] não encaminhar\n')
  fake.emitOutput(gerenteSession.id, '[PARA: NomeDoAgente] sua mensagem aqui\n')
  await delay(150)
  assert.equal(fake.writesForAgent('ag-dev').length, 0)

  // Marcador real entrega na sessão do agente conectado (abrindo a sessão falsa automaticamente)
  fake.emitOutput(gerenteSession.id, '[PARA: Executor] Implementar login seguro\n')
  const delivered = await waitFor(() =>
    fake.writesForAgent('ag-dev').some((w) => w.includes('Implementar login seguro'))
    && fake.writesForAgent('ag-dev').includes('\r'),
  )
  assert.equal(delivered, true)
  assert.equal(getAgent('ag-dev', { transcript: false }).status, 'working')
  assert.equal(getWorkspaceSnapshot().connections.find((c) => c.id === 'conn-1').active, true)

  // Repetição em menos de 15s é ignorada pela deduplicação
  const countBeforeRepeat = fake.writesForAgent('ag-dev').length
  fake.emitOutput(gerenteSession.id, '[PARA: Executor] Implementar login seguro\n')
  const directRepeat = await sendAgentMessage('ag-gerente', 'ag-dev', 'Implementar login seguro')
  assert.deepEqual(directRepeat, { ok: false, deduplicated: true })
  await delay(250)
  assert.equal(fake.writesForAgent('ag-dev').length, countBeforeRepeat)

  // Eco do prompt recém-injetado (janela de 4s) não reencaminha marcador
  createWorkItem({
    id: 'wi-eco',
    title: 'Checar [PARA: Revisor] eco-do-prompt',
    assigneeId: 'ag-dev',
    status: 'todo',
    projectId: 'proj-a',
  })
  await dispatchWorkItem('wi-eco')
  const devSession = fake.sessionForAgent('ag-dev')
  assert.ok(devSession)
  fake.emitOutput(devSession.id, 'Tarefa: Checar [PARA: Revisor] eco-do-prompt\n')
  await delay(300)
  assert.equal(fake.writesForAgent('ag-qa').length, 0)
  await completeWorkItem('wi-eco', { result: 'Eco testado' })
})

test('entrega de arquivo .vertice/handoff*.md encaminha conteúdo ao agente conectado', async () => {
  const verticeDir = join(pathA, '.vertice')
  mkdirSync(verticeDir, { recursive: true })
  writeFileSync(
    join(verticeDir, 'handoff-executor-to-revisor.md'),
    'Pacote validado e pronto para QA.',
    'utf8',
  )

  const delivered = await waitFor(() =>
    fake.writesForAgent('ag-qa').some(
      (w) => w.includes('handoff-executor-to-revisor.md') && w.includes('Pacote validado e pronto para QA.'),
    ) && fake.writesForAgent('ag-qa').includes('\r'),
    6000,
  )
  assert.equal(delivered, true)
})

test('dependsOn bloqueia despacho, approveWorkItem libera dependente e devolução com feedback reenvia na sessão', async () => {
  createWorkItem({
    id: 'wi-1',
    title: 'Base de dados',
    assigneeId: 'ag-dev',
    status: 'todo',
    projectId: 'proj-a',
  })
  createWorkItem({
    id: 'wi-2',
    title: 'Endpoints REST',
    assigneeId: 'ag-qa',
    status: 'todo',
    dependsOn: ['wi-1'],
    projectId: 'proj-a',
  })

  // Dependente bloqueado enquanto wi-1 está todo
  await assert.rejects(() => dispatchWorkItem('wi-2'), /depende de "Base de dados"/)
  assert.equal(getWorkItem('wi-2').status, 'todo')

  // Despacha e conclui wi-1 (vai para review)
  const d1 = await dispatchWorkItem('wi-1')
  assert.equal(d1.ok, true)
  assert.equal(getWorkItem('wi-1').status, 'doing')
  await completeWorkItem('wi-1', { result: 'Schema criado' })
  assert.equal(getWorkItem('wi-1').status, 'review')

  // Ainda bloqueado em review até aprovação
  await assert.rejects(() => dispatchWorkItem('wi-2'), /depende de "Base de dados"/)

  // Aprovação libera e despacha wi-2 automaticamente
  const approved = approveWorkItem('wi-1')
  assert.equal(approved.ok, true)
  assert.deepEqual(approved.released, ['wi-2'])
  assert.equal(getWorkItem('wi-1').status, 'done')

  const released = await waitFor(() =>
    getWorkItem('wi-2').status === 'doing'
    && fake.writesForAgent('ag-qa').some((w) => w.includes('Tarefa: Endpoints REST')),
    5000,
  )
  assert.equal(released, true)

  // Conclui wi-2 e devolve com feedback
  await completeWorkItem('wi-2', { result: 'Primeira entrega' })
  assert.equal(getWorkItem('wi-2').status, 'review')

  const rejected = await dispatchWorkItem('wi-2', { feedback: 'Faltou paginação na listagem' })
  assert.equal(rejected.ok, true)
  const wi2After = getWorkItem('wi-2')
  assert.equal(wi2After.status, 'doing')
  assert.equal(wi2After.result, undefined)
  assert.equal(wi2After.error, undefined)
  assert.ok(fake.writesForAgent('ag-qa').some((w) => w.includes('Faltou paginação na listagem')))
  assert.ok(getAgent('ag-qa', { transcript: false }).memory.includes('Faltou paginação na listagem'))
})

test('resetForProjectSwitch cancela monitores, marca doing como failed, refaz linha de base dos handoffs e syncMemoryFile isola projetos', async () => {
  const verticeB = join(pathB, '.vertice')
  mkdirSync(verticeB, { recursive: true })
  writeFileSync(join(verticeB, 'handoff-alpha-to-beta.md'), 'Handoff antigo de B', 'utf8')

  createProject({ id: 'proj-b', name: 'Projeto B', path: pathB })
  allowProjectWorkspace({ id: 'proj-b', path: pathB })

  const qaSession = fake.sessionForAgent('ag-qa')
  assert.ok(qaSession)
  assert.equal(getWorkItem('wi-2').status, 'doing')

  // Troca de projeto: cancela monitores antes do exit das sessões
  resetForProjectSwitch('proj-a', { nextProjectPath: pathB })
  fake.emitExit(qaSession.id, 0)
  await delay(100)

  const wi2Failed = getWorkItem('wi-2')
  assert.equal(wi2Failed.status, 'failed')
  assert.equal(wi2Failed.error, PROJECT_SWITCH_ERROR)
  assert.equal(getAgent('ag-qa', { transcript: false }).status, 'idle')
  assert.equal(getAgent('ag-qa', { transcript: false }).task, '')

  // Ativa projeto B e cria equipe em B
  activateProject('proj-b')
  upsertAgent({
    id: 'ag-b1',
    name: 'Alpha',
    role: 'Dev',
    kind: 'worker',
    runtime: 'Claude Code',
    model: 'claude-sonnet',
    projectId: 'proj-b',
  })
  upsertAgent({
    id: 'ag-b2',
    name: 'Beta',
    role: 'QA',
    kind: 'worker',
    runtime: 'Claude Code',
    model: 'claude-sonnet',
    projectId: 'proj-b',
  })
  createConnection({ id: 'conn-b', source: 'ag-b1', target: 'ag-b2', label: 'entrega' })

  // syncMemoryFile ignora agente do projeto anterior e grava agente do projeto ativo
  assert.equal(syncMemoryFile('ag-qa'), null)
  assert.equal(existsSync(join(pathB, '.vertice', 'memory', 'ag-qa.md')), false)
  assert.ok(syncMemoryFile('ag-b1'))
  assert.equal(existsSync(join(pathB, '.vertice', 'memory', 'ag-b1.md')), true)

  // Inicia sessão em B: o handoff pré-existente em B (baselined) não pode ser reenviado
  await launchAgentSession({
    agent: getAgent('ag-b1', { transcript: false }),
    runtimeId: 'claude',
    cwd: pathB,
    resume: false,
  })
  await delay(2800)
  assert.equal(fake.writesForAgent('ag-b2').length, 0)

  // Novo handoff criado após a linha de base deve ser entregue normalmente
  writeFileSync(join(verticeB, 'handoff-alpha-to-beta-novo.md'), 'Novo handoff de B', 'utf8')
  const deliveredNew = await waitFor(() =>
    fake.writesForAgent('ag-b2').some((w) => w.includes('Novo handoff de B'))
    && fake.writesForAgent('ag-b2').includes('\r')
    && getAgent('ag-b2', { transcript: false }).status === 'working',
    6000,
  )
  assert.equal(deliveredNew, true)
})
