import { testDir, cleanup } from './helpers/env.js'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { COMPLETION_INSTRUCTION, createTaskMonitor, stripAnsi } from '../src/task-monitor.js'

after(() => {
  cleanup()
})

function createFakeClock(initialMs = 10_000) {
  let current = initialMs
  let nextId = 1
  const timers = new Map()
  return {
    now: () => current,
    setTimer(fn, delay) {
      const id = nextId++
      timers.set(id, { fn, runAt: current + Math.max(0, delay) })
      return id
    },
    clearTimer(id) {
      timers.delete(id)
    },
    pendingCount: () => timers.size,
    advanceBy(ms) {
      const target = current + ms
      while (true) {
        let earliest = null
        for (const [id, entry] of timers.entries()) {
          if (entry.runAt <= target && (!earliest || entry.runAt < earliest.runAt)) {
            earliest = { id, ...entry }
          }
        }
        if (!earliest) break
        current = earliest.runAt
        timers.delete(earliest.id)
        earliest.fn()
      }
      current = target
    },
  }
}

test('stripAnsi remove sequências ANSI, normaliza quebras de linha e limpa controles', () => {
  const input = '\x1b[32mOlá\x1b[0m\r\n\x1b]0;Titulo\x07Mundo\x08!'
  assert.equal(stripAnsi(input), 'Olá\nMundo!')
})

test('conclui por marcador explícito [TAREFA_CONCLUIDA] após resposta real e ignora eco da instrução', () => {
  const clock = createFakeClock()
  const completions = []
  const instruction = `Tarefa: Implementar relatório\n${COMPLETION_INSTRUCTION}`

  const monitor = createTaskMonitor({
    runtimeId: 'claude',
    instruction,
    onComplete: (ev) => completions.push(ev),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  // Eco exato e parcial da instrução não conclui nem entra no resultado
  monitor.feed(instruction + '\n')
  monitor.feed('escreva em uma linha sozinha a palavra TAREFA_CONCLUIDA\n')
  clock.advanceBy(10_000)
  assert.equal(completions.length, 0)
  assert.equal(monitor.finished, false)

  // Resposta real + moldura de TUI + marcador dividido em chunks
  monitor.feed('────\n⠋ Working...\nImplementei o relatório em src/report.js com sucesso.\n')
  monitor.feed('│ [TAREFA_')
  monitor.feed('CONCLUIDA] │\n')

  assert.equal(completions.length, 1)
  assert.equal(monitor.finished, true)
  assert.equal(clock.pendingCount(), 0)
  assert.equal(completions[0].reason, 'marker')
  assert.equal(completions[0].result, 'Implementei o relatório em src/report.js com sucesso.')

  // Chamadas posteriores não disparam novamente
  monitor.feed('Texto tardio\n')
  monitor.exit(0)
  assert.equal(completions.length, 1)
})

test('conclui por fim de sessão (exit) preservando saída, avisando código != 0 e cancelando timer pendente', () => {
  const clock = createFakeClock()
  const completions1 = []
  const m1 = createTaskMonitor({
    runtimeId: 'codex',
    onComplete: (ev) => completions1.push(ev),
    idleMs: 4500,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  m1.feed('Alterações parciais aplicadas nos arquivos principais.\n')
  assert.equal(clock.pendingCount(), 1)
  m1.exit(2)
  assert.equal(clock.pendingCount(), 0)
  assert.equal(completions1.length, 1)
  assert.equal(completions1[0].reason, 'exit')
  assert.equal(completions1[0].exitCode, 2)
  assert.ok(completions1[0].result.includes('Alterações parciais aplicadas nos arquivos principais.'))
  assert.ok(completions1[0].result.includes('[Aviso] O processo da CLI encerrou com código 2.'))

  const completions2 = []
  const m2 = createTaskMonitor({
    runtimeId: 'codex',
    onComplete: (ev) => completions2.push(ev),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  m2.exit(0)
  assert.equal(completions2.length, 1)
  assert.equal(completions2[0].reason, 'exit')
  assert.equal(completions2[0].result, '[Aviso] A sessão foi encerrada sem saída textual capturada.')
})

test('conclui por silêncio (idleMs) somente após resposta real e respeita debounce e janela echoMs', () => {
  const clock = createFakeClock(10_000)
  const completions = []

  const monitor = createTaskMonitor({
    runtimeId: 'codex',
    idleMs: 4500,
    echoMs: 500,
    minResponseChars: 20,
    onComplete: (ev) => completions.push(ev),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  // Dentro de echoMs: ignorado
  monitor.feed('Eco inicial que deve ser descartado completamente.\n')
  clock.advanceBy(400)
  assert.equal(clock.pendingCount(), 0)

  // Passou echoMs, mas abaixo de minResponseChars: não arma o timer
  clock.advanceBy(200)
  monitor.feed('curto')
  clock.advanceBy(10_000)
  assert.equal(completions.length, 0)

  // Resposta real (>= 20 chars) arma idleMs
  monitor.feed(' — agora temos uma resposta completa da CLI.')
  clock.advanceBy(4000)
  assert.equal(completions.length, 0)

  // Novo chunk reinicia o idleMs
  monitor.feed('\nDetalhes finais da análise.')
  clock.advanceBy(4499)
  assert.equal(completions.length, 0)

  clock.advanceBy(1)
  assert.equal(completions.length, 1)
  assert.equal(completions[0].reason, 'idle')
  assert.ok(completions[0].result.includes('agora temos uma resposta completa da CLI.'))
  assert.ok(completions[0].result.includes('Detalhes finais da análise.'))
})

test('PowerShell conclui usando settleMs quando o prompt PS retorna', () => {
  const clock = createFakeClock()
  const completions = []
  const monitor = createTaskMonitor({
    runtimeId: 'powershell',
    idleMs: 4500,
    settleMs: 600,
    minResponseChars: 20,
    onComplete: (ev) => completions.push(ev),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  monitor.feed('OK\nPS C:\\projeto> ')
  clock.advanceBy(599)
  assert.equal(completions.length, 0)
  clock.advanceBy(1)
  assert.equal(completions.length, 1)
  assert.equal(completions[0].reason, 'idle')
  assert.ok(completions[0].result.includes('OK'))
})

test('rejeita eco do prompt e redesenho de TUI anterior (isStalePriorTaskRedraw) até chegar a tarefa atual', () => {
  const clock = createFakeClock()
  const completions = []
  const instruction = `Tarefa: Criar endpoint de saúde\n${COMPLETION_INSTRUCTION}`

  const monitor = createTaskMonitor({
    runtimeId: 'claude',
    instruction,
    idleMs: 4500,
    onComplete: (ev) => completions.push(ev),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  // Redesenho de tarefa anterior com [TAREFA_CONCLUIDA] antigo antes do prompt atual aparecer
  monitor.feed('Tarefa: Tarefa antiga já finalizada\nResultado antigo que não deve vazar.\n[TAREFA_CONCLUIDA]\n')
  clock.advanceBy(10_000)
  assert.equal(completions.length, 0)
  assert.equal(monitor.finished, false)

  // Chega o redesenho com a tarefa atual + resposta em seguida; instructionBoundary descarta o histórico antigo
  monitor.feed(`│ Tarefa: Criar endpoint de saúde\n│ ${COMPLETION_INSTRUCTION}\nEndpoint /api/health verificado e documentado.\n`)
  monitor.feed('[TAREFA_CONCLUIDA]\n')

  assert.equal(completions.length, 1)
  assert.equal(completions[0].reason, 'marker')
  assert.equal(completions[0].result, 'Endpoint /api/health verificado e documentado.')
  assert.equal(completions[0].result.includes('Resultado antigo'), false)
})

test('não conclui por idleMs quando a última linha é prompt bloqueante ([y/n], Trust this folder) e conclui após resolução', () => {
  const clock = createFakeClock()
  const completions = []

  const monitor = createTaskMonitor({
    runtimeId: 'claude',
    idleMs: 4500,
    minResponseChars: 10,
    onComplete: (ev) => completions.push(ev),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  monitor.feed('Do you trust the files in this folder? Trust this folder [y/n] ')
  clock.advanceBy(4500)
  assert.equal(completions.length, 0)
  assert.equal(monitor.finished, false)

  // Continua aguardando em ciclos seguintes enquanto estiver bloqueado
  clock.advanceBy(9000)
  assert.equal(completions.length, 0)

  // Outro prompt bloqueante mais adiante também segura
  monitor.feed('\nAllow this tool execution? [y/n]')
  clock.advanceBy(4500)
  assert.equal(completions.length, 0)

  // Após o usuário responder e a CLI avançar (> 40 chars não-brancos), conclui por silêncio
  monitor.feed('\nPermissão concedida, aplicando todas as alterações necessárias no módulo alvo agora.')
  clock.advanceBy(4500)
  assert.equal(completions.length, 1)
  assert.equal(completions[0].reason, 'idle')
})

test('cancel() interrompe timer ativo e impede conclusão futura', () => {
  const clock = createFakeClock()
  const completions = []
  const monitor = createTaskMonitor({
    runtimeId: 'codex',
    idleMs: 4500,
    onComplete: (ev) => completions.push(ev),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })

  monitor.feed('Execução longa em andamento antes da troca de projeto.')
  assert.equal(clock.pendingCount(), 1)
  monitor.cancel()
  assert.equal(monitor.finished, true)
  assert.equal(clock.pendingCount(), 0)

  clock.advanceBy(10_000)
  monitor.exit(0)
  assert.equal(completions.length, 0)
})
