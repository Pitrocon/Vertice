import { testDir, cleanup } from './helpers/env.js'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  TRANSCRIPT_MAX_CHARS,
  compactTranscript,
  createTranscriptRecorder,
  hasPriorContext,
  safeFileName,
  memoryRelativePath,
  buildResumeNote,
  buildConnectedAgentsHint,
  formatMemoryEntry,
  buildMemoryMarkdown,
  writeMemoryFile,
} from '../src/agent-memory.js'
import { parsePoliciesMarkdown } from '../src/policies.js'

after(() => {
  cleanup()
})

function createFakeTimers() {
  let nextId = 1
  const pending = new Map()
  return {
    setTimer(fn, delay) {
      const id = nextId++
      pending.set(id, { fn, delay })
      return id
    },
    clearTimer(id) {
      pending.delete(id)
    },
    count: () => pending.size,
    delays: () => [...pending.values()].map((t) => t.delay),
    runAll() {
      for (const [id, entry] of [...pending.entries()]) {
        pending.delete(id)
        entry.fn()
      }
    },
  }
}

test('compactTranscript remove códigos ANSI, redesenhos consecutivos e excesso de linhas vazias mantendo o final', () => {
  const raw = [
    '\x1b[32mInício da execução\x1b[0m   ',
    '',
    '',
    '',
    '\x1b[1mCarregando...\x1b[0m',
    '\x1b[1mCarregando...\x1b[0m',
    'Linha final importante\r\n',
  ].join('\r\n')

  assert.equal(
    compactTranscript(raw),
    'Início da execução\n\nCarregando...\nLinha final importante',
  )

  const longInput = 'A'.repeat(500) + '\nTRECHO_FINAL_PRESERVADO'
  const compacted = compactTranscript(longInput, 40)
  assert.equal(compacted.length, 40)
  assert.ok(compacted.endsWith('TRECHO_FINAL_PRESERVADO'))
  assert.equal(TRANSCRIPT_MAX_CHARS, 15000)
})

test('createTranscriptRecorder usa timers injetados com debounce, flush, flushAll, forget e forgetAll', () => {
  const timers = createFakeTimers()
  const stored = new Map([['ag-1', 'anterior\n'], ['ag-2', '']])
  const savedCalls = []

  const recorder = createTranscriptRecorder({
    load: (id) => (stored.has(id) ? stored.get(id) : null),
    save: (id, text) => {
      stored.set(id, text)
      savedCalls.push({ id, text })
    },
    debounceMs: 2000,
    maxChars: 80,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  })

  // Agente desconhecido (ex.: sessão de instalação) é ignorado
  recorder.append('install-claude', 'baixando pacote...')
  assert.equal(timers.count(), 0)
  recorder.flush('install-claude')
  assert.equal(savedCalls.length, 0)

  // Agente conhecido acumula com debounce único e remove ANSI
  recorder.append('ag-1', '\x1b[36mprimeira linha\x1b[0m\n')
  recorder.append('ag-1', 'segunda linha\n')
  assert.equal(timers.count(), 1)
  assert.deepEqual(timers.delays(), [2000])
  assert.equal(savedCalls.length, 0)

  // Disparo do timer salva versão compactada
  timers.runAll()
  assert.equal(timers.count(), 0)
  assert.equal(savedCalls.length, 1)
  assert.equal(savedCalls[0].id, 'ag-1')
  assert.equal(savedCalls[0].text, 'anterior\nprimeira linha\nsegunda linha')

  // Flush quando não está sujo não regrava
  recorder.flush('ag-1')
  assert.equal(savedCalls.length, 1)

  // Flush manual cancela timer pendente e grava imediatamente
  recorder.markSessionStart('ag-2')
  recorder.append('ag-2', 'X'.repeat(400) + 'FINAL_AG2')
  assert.equal(timers.count(), 1)
  recorder.flush('ag-2')
  assert.equal(timers.count(), 0)
  assert.equal(savedCalls.length, 2)
  assert.ok(savedCalls[1].text.length <= 80)
  assert.ok(savedCalls[1].text.endsWith('FINAL_AG2'))

  // forget cancela timer e impede flushAll de regravar texto esquecido
  recorder.append('ag-1', 'texto descartado')
  recorder.append('ag-2', 'texto mantido')
  assert.equal(timers.count(), 2)
  recorder.forget('ag-1')
  assert.equal(timers.count(), 1)
  recorder.flushAll()
  assert.equal(timers.count(), 0)
  assert.equal(savedCalls.length, 3)
  assert.equal(savedCalls[2].id, 'ag-2')
  assert.ok(savedCalls[2].text.endsWith('texto mantido'))

  // forgetAll limpa quaisquer timers restantes
  recorder.append('ag-1', 'novo texto')
  assert.equal(timers.count(), 1)
  recorder.forgetAll()
  assert.equal(timers.count(), 0)
  recorder.flushAll()
  assert.equal(savedCalls.length, 3)
})

test('hasPriorContext distingue banner curto de conversa real ou memória prévia', () => {
  assert.equal(hasPriorContext({ memory: '', transcript: '' }), false)
  assert.equal(hasPriorContext({ memory: '   ', transcript: '— nova sessão —\n\n— nova sessão —' }), false)
  assert.equal(hasPriorContext({ memory: '', transcript: 'a'.repeat(199) }), false)
  assert.equal(hasPriorContext({ memory: '', transcript: `— nova sessão —\n${'a'.repeat(200)}` }), true)
  assert.equal(hasPriorContext({ memory: '[01/01] Tarefa concluída: X', transcript: '' }), true)
})

test('safeFileName e memoryRelativePath impedem travessia de diretório e nomes inválidos', () => {
  assert.equal(safeFileName('ag-dev_1.2'), 'ag-dev_1.2')
  assert.equal(safeFileName('../../etc/passwd'), '.._.._etc_passwd')
  assert.equal(safeFileName('..\\segredo\\arquivo'), '.._segredo_arquivo')
  assert.equal(safeFileName('..'), 'agente')
  assert.equal(safeFileName('.'), 'agente')
  assert.equal(safeFileName(''), 'agente')
  assert.equal(safeFileName(null), 'agente')
  assert.equal(safeFileName('a'.repeat(150)).length, 100)
  assert.equal(memoryRelativePath('ag/1'), '.vertice/memory/ag_1.md')
})

test('buildMemoryMarkdown inclui "## Políticas do setor" fiel às políticas e writeMemoryFile persiste para leitura', () => {
  const gerente = { id: 'gerente', name: 'Gerente', role: 'Coordenação', prompt: 'Coordene o time' }
  const dev = { id: 'dev-1', name: 'Desenvolvedor', role: 'Implementação', prompt: 'Implemente a tarefa' }
  const revisor = { id: 'rev-1', name: 'Revisor', role: 'Qualidade', prompt: 'Revise entregas' }
  const allAgents = [gerente, dev, revisor]
  const connections = [
    { source: 'gerente', target: 'dev-1' },
    { source: 'dev-1', target: 'rev-1' },
  ]

  const policies = {
    allowDestructiveCommands: false,
    allowNetwork: true,
    allowCredentials: false,
  }

  const md = buildMemoryMarkdown({
    agent: dev,
    memory: formatMemoryEntry({ title: 'API de login', result: 'Endpoints criados', date: new Date('2026-01-10T12:00:00Z') }),
    transcript: 'Saída anterior do terminal',
    allAgents,
    connections,
    policies,
  })

  assert.ok(md.includes('# Memória viva — Desenvolvedor'))
  assert.ok(md.includes('## Políticas do setor'))
  assert.ok(md.includes('## Equipe e Conexões no Organograma'))
  assert.ok(md.includes('**Gerente**'))
  assert.ok(md.includes('**Revisor**'))
  assert.ok(md.includes('[PARA: Revisor]'))
  assert.deepEqual(parsePoliciesMarkdown(md), policies)

  // Grava em disco e lê de volta para conferir a seção de políticas
  const projectPath = join(testDir, 'proj-mem')
  mkdirSync(projectPath, { recursive: true })
  const filePath = writeMemoryFile(projectPath, '../dev-1', md)
  assert.ok(filePath.endsWith(join('.vertice', 'memory', '.._dev-1.md')))
  const written = readFileSync(filePath, 'utf8')
  assert.deepEqual(parsePoliciesMarkdown(written), policies)

  // Sem políticas explícitas, assume falha fechada (todas false)
  const fallbackMd = buildMemoryMarkdown({ agent: dev })
  assert.deepEqual(parsePoliciesMarkdown(fallbackMd), {
    allowDestructiveCommands: false,
    allowNetwork: false,
    allowCredentials: false,
  })

  const hint = buildConnectedAgentsHint(dev, allAgents, connections)
  assert.ok(hint.includes('Gerente (Coordenação)'))
  assert.ok(hint.includes('Revisor (Qualidade)'))
  const note = buildResumeNote('dev-1', hint)
  assert.equal(note.includes('\n'), false)
  assert.ok(note.includes('.vertice/memory/dev-1.md'))
})
