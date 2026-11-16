import { testDir, cleanup } from './helpers/env.js'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { validateHeadlessBlock } from '../src/runtimes.js'
import {
  resolveExecutionMode,
  buildHeadlessLaunch,
  parseHeadlessOutput,
  mapHeadlessOutcome,
  runHeadless,
} from '../src/headless.js'
import {
  createProject,
  allowProjectWorkspace,
  upsertAgent,
  createWorkItem,
  getWorkItem,
  getAgent,
} from '../src/db.js'
import { configureOrchestrator, completeWorkItem, onWorkItemRemoved, stopHeadlessRuns } from '../src/orchestrator.js'

after(() => {
  cleanup()
})

function createFakeSpawn(behavior) {
  const calls = []
  const spawnFn = (command, args, options) => {
    const child = new EventEmitter()
    child.pid = 42424
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const stdinChunks = []
    child.stdin = new EventEmitter()
    child.stdin.write = (chunk) => {
      stdinChunks.push(String(chunk ?? ''))
      return true
    }
    child.stdin.end = (chunk) => {
      if (chunk !== undefined) stdinChunks.push(String(chunk ?? ''))
      queueMicrotask(() => {
        behavior({ child, command, args, options, getStdin: () => stdinChunks.join('') })
      })
    }
    child.killCalls = []
    child.kill = (signal) => {
      child.killCalls.push(signal)
    }
    calls.push({ command, args, options, child, getStdin: () => stdinChunks.join('') })
    return child
  }
  return { spawnFn, calls }
}

test('validateHeadlessBlock aceita bloco válido e rejeita entradas inválidas', () => {
  const valid = {
    args: ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits'],
    prompt: 'stdin',
    output: 'claude-json',
    timeoutMs: 900_000,
    sources: ['https://code.claude.com/docs/en/headless'],
  }

  const normalized = validateHeadlessBlock(valid)
  assert.deepEqual(normalized, valid)
  assert.notEqual(normalized.args, valid.args)
  assert.notEqual(normalized.sources, valid.sources)

  // Limites válidos de timeoutMs (60s..3600s)
  assert.ok(validateHeadlessBlock({ ...valid, timeoutMs: 60_000, output: 'text' }))
  assert.ok(validateHeadlessBlock({ ...valid, timeoutMs: 3_600_000, output: 'text' }))

  // Rejeições obrigatórias
  assert.equal(validateHeadlessBlock(null), null)
  assert.equal(validateHeadlessBlock([]), null)
  assert.equal(validateHeadlessBlock({ ...valid, prompt: 'arg' }), null)
  assert.equal(validateHeadlessBlock({ ...valid, prompt: undefined }), null)
  assert.equal(validateHeadlessBlock({ ...valid, sources: [] }), null)
  assert.equal(validateHeadlessBlock({ ...valid, sources: ['http://code.claude.com/docs'] }), null)
  assert.equal(validateHeadlessBlock({ ...valid, sources: ['https://   '] }), null)
  assert.equal(validateHeadlessBlock({ ...valid, timeoutMs: 59_999 }), null)
  assert.equal(validateHeadlessBlock({ ...valid, timeoutMs: 3_600_001 }), null)
  assert.equal(validateHeadlessBlock({ ...valid, timeoutMs: 120_000.5 }), null)
  assert.equal(validateHeadlessBlock({ ...valid, args: ['-p', 42] }), null)
  assert.equal(validateHeadlessBlock({ ...valid, args: ['   '] }), null)
  assert.equal(validateHeadlessBlock({ ...valid, args: 'nao-lista' }), null)
  assert.equal(validateHeadlessBlock({ ...valid, output: 'stream-json' }), null)
})

test('resolveExecutionMode cobre todas as combinações de workItem.headless × runtime.headless', () => {
  const headlessRuntime = { id: 'claude', headless: { args: ['-p'], prompt: 'stdin', output: 'claude-json', timeoutMs: 900_000 } }
  const interactiveRuntime = { id: 'kimi', headless: null }

  assert.equal(resolveExecutionMode({ headless: true }, headlessRuntime), 'headless')
  assert.equal(resolveExecutionMode({ headless: true }, interactiveRuntime), 'interactive')
  assert.equal(resolveExecutionMode({ headless: true }, null), 'interactive')
  assert.equal(resolveExecutionMode({ headless: false }, headlessRuntime), 'interactive')
  assert.equal(resolveExecutionMode({ headless: false }, interactiveRuntime), 'interactive')
  assert.equal(resolveExecutionMode({}, headlessRuntime), 'interactive')
  assert.equal(resolveExecutionMode(null, headlessRuntime), 'interactive')
})

test('buildHeadlessLaunch preserva argumentos constantes sem carregar texto do prompt', () => {
  const runtime = {
    id: 'codex',
    headless: {
      args: ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-'],
      prompt: 'stdin',
      output: 'text',
      timeoutMs: 600_000,
    },
  }
  const promptText = 'Não deve aparecer nos args & | > ^ % " \' \n linha 2'
  const launch = buildHeadlessLaunch(runtime, { policyArgs: ['--extra'], prompt: promptText })

  assert.deepEqual(launch.args, ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-', '--extra'])
  assert.equal(launch.timeoutMs, 600_000)
  assert.equal(launch.args.some((arg) => arg.includes('Não deve aparecer')), false)
  assert.deepEqual(runtime.headless.args, ['exec', '--sandbox', 'workspace-write', '--skip-git-repo-check', '-'])

  assert.throws(() => buildHeadlessLaunch({ id: 'kimi', headless: null }), /headless/i)
})

test('parseHeadlessOutput interpreta claude-json válido, inválido, sem result, is_error e text', () => {
  assert.deepEqual(
    parseHeadlessOutput('claude-json', JSON.stringify({ type: 'result', result: 'Entrega final', session_id: 's1' })),
    { ok: true, text: 'Entrega final' },
  )
  assert.deepEqual(parseHeadlessOutput('claude-json', ''), { ok: false, reason: 'saída inválida' })
  assert.deepEqual(parseHeadlessOutput('claude-json', '{json quebrado'), { ok: false, reason: 'saída inválida' })
  assert.deepEqual(parseHeadlessOutput('claude-json', JSON.stringify({ session_id: 's1' })), { ok: false, reason: 'saída inválida' })
  assert.deepEqual(parseHeadlessOutput('claude-json', JSON.stringify({ result: 123 })), { ok: false, reason: 'saída inválida' })
  assert.deepEqual(
    parseHeadlessOutput('claude-json', JSON.stringify({ is_error: true, result: 'Falha na autenticação' })),
    { ok: false, reason: 'Falha na autenticação' },
  )
  assert.deepEqual(
    parseHeadlessOutput('claude-json', JSON.stringify({ is_error: true, result: '   ' })),
    { ok: false, reason: 'saída inválida' },
  )
  assert.deepEqual(parseHeadlessOutput('text', 'Saída em texto puro\nlinha 2'), { ok: true, text: 'Saída em texto puro\nlinha 2' })
})

test('mapHeadlessOutcome mapeia sucesso, vazio, erro != 0, Kimi 75 e timeout', () => {
  assert.deepEqual(
    mapHeadlessOutcome({
      exitCode: 0,
      timedOut: false,
      stdout: JSON.stringify({ result: '  Implementado com sucesso  ' }),
      stderr: '',
      kind: 'claude-json',
    }),
    { status: 'review', result: 'Implementado com sucesso' },
  )

  assert.deepEqual(
    mapHeadlessOutcome({
      exitCode: 0,
      timedOut: false,
      stdout: '   \n  ',
      stderr: '',
      kind: 'text',
    }),
    { status: 'review', result: 'Execução automática concluída sem saída textual capturada.' },
  )

  assert.deepEqual(
    mapHeadlessOutcome({
      exitCode: 0,
      timedOut: false,
      stdout: '{"sem_result": true}',
      stderr: '',
      kind: 'claude-json',
    }),
    { status: 'failed', error: 'Saída inválida: saída inválida' },
  )

  const longStderr = 'inicio ' + 'x'.repeat(600) + ' detalhe-final-do-erro'
  const nonZero = mapHeadlessOutcome({
    exitCode: 2,
    timedOut: false,
    stdout: '',
    stderr: `\x1b[31m${longStderr}\x1b[0m`,
    kind: 'text',
  })
  assert.equal(nonZero.status, 'failed')
  assert.ok(nonZero.error.startsWith('Código de saída 2: '))
  assert.ok(nonZero.error.endsWith('detalhe-final-do-erro'))
  assert.equal(nonZero.error.includes('\x1b'), false)

  const kimi75 = mapHeadlessOutcome({
    exitCode: 75,
    timedOut: false,
    stdout: '',
    stderr: '429 Too Many Requests',
    kind: 'text',
    runtimeId: 'kimi',
  })
  assert.deepEqual(kimi75, {
    status: 'failed',
    error: 'Código de saída 75 (falha temporária): 429 Too Many Requests',
  })

  assert.deepEqual(
    mapHeadlessOutcome({ exitCode: null, timedOut: true, stdout: '', stderr: '', kind: 'text' }),
    { status: 'failed', error: 'Tempo esgotado na execução automática.' },
  )
})

test('runHeadless envia prompt só por stdin (incluindo metacaracteres e quebras de linha) e respeita shell: false', async () => {
  const prompt = 'Linha 1 com & | > ^ % " \'\nLinha 2\r\nLinha 3 $(nao-executa) `echo nao`'
  const fixedArgs = ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits']
  let receivedChild = null

  const { spawnFn, calls } = createFakeSpawn(({ child }) => {
    child.stdout.emit('data', Buffer.from('{"result":"ok"}'))
    child.emit('close', 0)
  })

  const prevVerticeSecret = process.env.VERTICE_API_TOKEN
  process.env.VERTICE_API_TOKEN = 'segredo-nao-vaza'
  try {
    const out = await runHeadless({
      command: 'C:\\fake\\claude.cmd',
      args: fixedArgs,
      cwd: testDir,
      prompt,
      timeoutMs: 5000,
      spawnFn,
      onChild: (child) => { receivedChild = child },
    })

    assert.equal(out.exitCode, 0)
    assert.equal(out.timedOut, false)
    assert.equal(out.stdout, '{"result":"ok"}')
    assert.equal(out.stderr, '')
    assert.equal(calls.length, 1)
    assert.equal(receivedChild, calls[0].child)

    const call = calls[0]
    assert.equal(call.options.shell, false)
    assert.equal(call.options.windowsHide, true)
    assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe'])
    assert.equal(call.options.env.VERTICE_API_TOKEN, undefined)

    if (process.platform === 'win32') {
      assert.equal(call.command, 'cmd.exe')
      assert.deepEqual(call.args, ['/c', 'C:\\fake\\claude.cmd', ...fixedArgs])
    } else {
      assert.equal(call.command, 'C:\\fake\\claude.cmd')
      assert.deepEqual(call.args, fixedArgs)
    }

    assert.equal(call.args.join(' ').includes('&'), false)
    assert.equal(call.args.join(' ').includes('Linha 1'), false)
    assert.equal(call.getStdin(), prompt)
  } finally {
    if (prevVerticeSecret === undefined) delete process.env.VERTICE_API_TOKEN
    else process.env.VERTICE_API_TOKEN = prevVerticeSecret
  }
})

test('runHeadless aplica teto de 1 MB em stdout e stderr preservando o final', async () => {
  const oneMb = 1024 * 1024
  const { spawnFn } = createFakeSpawn(({ child }) => {
    child.stdout.emit('data', Buffer.from('A'.repeat(700_000)))
    child.stdout.emit('data', Buffer.from('B'.repeat(600_000)))
    child.stderr.emit('data', Buffer.from('E'.repeat(1_200_000) + 'TAIL_ERR'))
    child.emit('close', 0)
  })

  const out = await runHeadless({
    command: 'codex',
    args: ['exec', '-'],
    prompt: 'teste teto',
    timeoutMs: 5000,
    spawnFn,
  })

  assert.equal(Buffer.byteLength(out.stdout, 'utf8'), oneMb)
  assert.equal(out.stdout.endsWith('B'.repeat(600_000)), true)
  assert.equal(out.stdout.startsWith('A'), true)
  assert.equal(Buffer.byteLength(out.stderr, 'utf8'), oneMb)
  assert.equal(out.stderr.endsWith('TAIL_ERR'), true)
})

test('runHeadless mata o processo no timeout e marca timedOut: true', async () => {
  const { spawnFn, calls } = createFakeSpawn(() => {
    // Processo não encerra sozinho para disparar o timeout.
  })

  const out = await runHeadless({
    command: 'codex',
    args: ['exec', '-'],
    prompt: 'demora',
    timeoutMs: 25,
    spawnFn,
  })

  assert.equal(out.timedOut, true)
  assert.equal(out.exitCode, null)
  assert.deepEqual(calls[0].child.killCalls, ['SIGKILL'])
})

test('completeWorkItem aceita status failed explícito com error e volta o agente para idle', async () => {
  const projPath = join(testDir, 'proj-orch')
  mkdirSync(projPath, { recursive: true })
  createProject({ id: 'proj-h1', name: 'Headless Test', path: projPath })
  allowProjectWorkspace({ id: 'proj-h1', path: projPath })

  upsertAgent({
    id: 'ag-h1',
    name: 'Executor Headless',
    role: 'Dev',
    runtime: 'Claude Code',
    model: 'claude-sonnet',
    status: 'working',
    task: 'Tarefa automática',
    projectId: 'proj-h1',
  })
  createWorkItem({
    id: 'wi-h1',
    title: 'Tarefa automática',
    status: 'doing',
    assigneeId: 'ag-h1',
    headless: true,
    ranMode: 'headless',
    projectId: 'proj-h1',
  })

  const events = []
  configureOrchestrator({ broadcast: (ev) => events.push(ev) })

  const res = await completeWorkItem('wi-h1', {
    status: 'failed',
    error: 'Código de saída 1: erro simulado',
    auto: true,
    reason: 'headless',
  })

  assert.deepEqual(res, { ok: true, status: 'failed' })
  const item = getWorkItem('wi-h1')
  assert.equal(item.status, 'failed')
  assert.equal(item.error, 'Código de saída 1: erro simulado')
  assert.equal(item.ranMode, 'headless')

  const agent = getAgent('ag-h1')
  assert.equal(agent.status, 'idle')
  assert.equal(agent.task, '')
  assert.ok(agent.memory.includes('Tarefa falhou'))

  const broadcastEv = events.find((e) => e.type === 'task-updated' && e.workItemId === 'wi-h1')
  assert.ok(broadcastEv)
  assert.equal(broadcastEv.auto, true)
  assert.equal(broadcastEv.reason, 'headless')

  // onWorkItemRemoved (string e objeto) e stopHeadlessRuns executam sem erro
  onWorkItemRemoved('wi-inexistente')
  stopHeadlessRuns()
})
