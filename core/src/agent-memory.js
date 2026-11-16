// Memória viva dos agentes (E14).
//
// O processo da CLI morre quando o programa fecha, então a IA e a tela do terminal "esquecem" a
// conversa. Para dar continuidade o Vértice guarda, por agente:
//   - uma TRANSCRIÇÃO limpa (sem códigos ANSI, sem linhas repetidas) do terminal, até ~15 mil caracteres;
//   - uma MEMÓRIA acumulada (uma linha por tarefa concluída);
// e espelha tudo num arquivo dentro do workspace do projeto: .vertice/memory/<agente>.md. Ao reabrir a
// sessão, a IA é orientada a LER esse arquivo (a nota de retomada), em vez de colar o histórico no terminal.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripAnsi } from './task-monitor.js'
import { buildPoliciesMarkdown, normalizePolicies } from './policies.js'

export const TRANSCRIPT_MAX_CHARS = 15000
const SESSION_SEPARATOR = '— nova sessão —'
// Abaixo disto a "conversa anterior" é só banner de inicialização da CLI: não vale retomar.
const MIN_PRIOR_TRANSCRIPT_CHARS = 200

/** Remove ANSI, linhas repetidas por redesenho e excesso de linhas em branco; mantém o final. */
export function compactTranscript(text, maxChars = TRANSCRIPT_MAX_CHARS) {
  const out = []
  for (const raw of stripAnsi(text).split('\n')) {
    const line = raw.trimEnd()
    if (line.trim() === '') {
      if (out.length && out[out.length - 1] !== '') out.push('')
      continue
    }
    if (out[out.length - 1] === line) continue
    out.push(line)
  }
  const joined = out.join('\n').trim()
  return joined.length > maxChars ? joined.slice(-maxChars) : joined
}

/**
 * Grava a transcrição de cada agente com debounce. `load(agentId)` devolve o texto salvo (ou null se o
 * agente não existe: sessões de instalação, por exemplo, são ignoradas) e `save(agentId, text)` persiste.
 */
export function createTranscriptRecorder({
  load,
  save,
  debounceMs = 2000,
  maxChars = TRANSCRIPT_MAX_CHARS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const buffers = new Map() // agentId -> { text, timer, dirty } | { ignored: true }

  function entryFor(agentId) {
    let entry = buffers.get(agentId)
    if (!entry) {
      const saved = load(agentId)
      entry = saved === null || saved === undefined ? { ignored: true } : { text: saved, timer: null, dirty: false }
      buffers.set(agentId, entry)
    }
    return entry
  }

  function flush(agentId) {
    const entry = buffers.get(agentId)
    if (!entry || entry.ignored) return
    if (entry.timer !== null) { clearTimer(entry.timer); entry.timer = null }
    if (!entry.dirty) return
    entry.text = compactTranscript(entry.text, maxChars)
    entry.dirty = false
    save(agentId, entry.text)
  }

  function schedule(agentId, entry) {
    if (entry.timer !== null) return
    entry.timer = setTimer(() => { entry.timer = null; flush(agentId) }, debounceMs)
    if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref()
  }

  function add(agentId, text) {
    if (!agentId || !text) return
    const entry = entryFor(agentId)
    if (entry.ignored) return
    entry.text += text
    if (entry.text.length > maxChars * 4) entry.text = entry.text.slice(-maxChars * 2) // evita crescer sem limite
    entry.dirty = true
    schedule(agentId, entry)
  }

  return {
    append(agentId, data) { add(agentId, stripAnsi(String(data ?? ''))) },
    markSessionStart(agentId) { add(agentId, `\n${SESSION_SEPARATOR}\n`) },
    flush,
    flushAll() { for (const agentId of [...buffers.keys()]) flush(agentId) },
    // Apaga o que está em memória (ao limpar a memória, excluir o agente ou limpar o workspace):
    // sem isso, um flush posterior regravaria o texto antigo.
    forget(agentId) {
      const entry = buffers.get(agentId)
      if (entry && !entry.ignored && entry.timer !== null) clearTimer(entry.timer)
      buffers.delete(agentId)
    },
    forgetAll() {
      for (const agentId of [...buffers.keys()]) this.forget(agentId)
    },
  }
}

/** Havia conversa/tarefas de verdade antes desta sessão? (decide se vale mandar a nota de retomada) */
export function hasPriorContext({ memory, transcript }) {
  if (memory && memory.trim()) return true
  const body = String(transcript ?? '').split(SESSION_SEPARATOR).join('').trim()
  return body.length >= MIN_PRIOR_TRANSCRIPT_CHARS
}

/** Nome de arquivo seguro: sem separadores nem "..", então o caminho nunca sai de .vertice/memory. */
export function safeFileName(agentId) {
  const cleaned = String(agentId ?? '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)
  return !cleaned || /^\.+$/.test(cleaned) ? 'agente' : cleaned
}

export function memoryRelativePath(agentId) {
  return `.vertice/memory/${safeFileName(agentId)}.md`
}

/** Nota de UMA linha que orienta a IA a ler a memória e conexões (uma quebra de linha viraria Enter no terminal). */
export function buildResumeNote(agentId, connectedHint = '') {
  const base = `Contexto do agente Vértice: leia o arquivo ${memoryRelativePath(agentId)} (seu papel, instrução de sistema, agentes conectados, tarefas concluídas e última conversa) e siga suas diretrizes.`
  return connectedHint ? `${base} ${connectedHint}` : base
}

/** Resumo em UMA linha dos agentes conectados no organograma e como acioná-los pelo terminal. */
export function buildConnectedAgentsHint(agent, allAgents = [], connections = []) {
  if (!agent) return ''
  const outgoing = connections
    .filter((c) => c.source === agent.id)
    .map((c) => allAgents.find((a) => a.id === c.target))
    .filter(Boolean)
  const incoming = connections
    .filter((c) => c.target === agent.id)
    .map((c) => allAgents.find((a) => a.id === c.source))
    .filter(Boolean)
  if (!outgoing.length && !incoming.length) return ''
  const parts = []
  if (incoming.length) {
    parts.push(`Você recebe demandas de: ${incoming.map((a) => `${a.name} (${a.role})`).join(', ')}.`)
  }
  if (outgoing.length) {
    parts.push(`Agentes conectados para quem você pode enviar saída/tarefas: ${outgoing.map((a) => `${a.name} (${a.role})`).join(', ')}. Para mandar qualquer saída ou tarefa para um agente conectado, escreva em uma linha sozinha a tag PARA seguida de dois-pontos e o nome do agente entre colchetes, seguido da mensagem em uma única linha.`)
  }
  return parts.join(' ')
}

export function formatMemoryEntry({ title, result, error, date = new Date() }) {
  const when = date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  const body = String(error || result || '')
    .split('\n').map((line) => line.trim()).filter(Boolean).slice(-2).join(' · ')
  const summary = body.length > 200 ? `${body.slice(0, 197)}…` : (body || 'sem resultado capturado')
  return `[${when}] ${error ? 'Tarefa falhou' : 'Tarefa concluída'}: ${title} → ${summary}`
}

export function buildMemoryMarkdown({ agent, memory, transcript, allAgents = [], connections = [], policies }) {
  const effectivePolicies = policies ?? normalizePolicies(null).policies
  const tail = String(transcript ?? '').slice(-6000).trim()
  const outgoing = connections
    .filter((c) => c.source === agent.id)
    .map((c) => allAgents.find((a) => a.id === c.target))
    .filter(Boolean)
  const incoming = connections
    .filter((c) => c.target === agent.id)
    .map((c) => allAgents.find((a) => a.id === c.source))
    .filter(Boolean)
  const connectionLines = []
  if (incoming.length) {
    connectionLines.push('### Quem envia demandas para você (Supervisores / Origem):')
    for (const src of incoming) {
      connectionLines.push(`- **${src.name}** (ID: \`${src.id}\` · Papel: ${src.role}) — Instrução: ${src.prompt || '(sem instrução)'}`)
    }
  }
  if (outgoing.length) {
    if (connectionLines.length) connectionLines.push('')
    connectionLines.push('### Agentes conectados que recebem sua saída / delegação (Destino):')
    for (const dst of outgoing) {
      connectionLines.push(`- **${dst.name}** (ID: \`${dst.id}\` · Papel: ${dst.role} · Memória: \`${memoryRelativePath(dst.id)}\`) — Instrução: ${dst.prompt || '(sem instrução)'}`)
    }
    connectionLines.push('')
    connectionLines.push('### Como enviar mensagem ou saída para um agente conectado:')
    connectionLines.push('Sempre que terminar uma etapa que deva seguir para o próximo agente conectado (ou quando o usuário pedir para mandar a saída para outro agente), escreva em uma linha sozinha no terminal:')
    connectionLines.push('`[PARA: NomeDoAgente] sua mensagem, saída ou instrução completa em uma única linha`')
    connectionLines.push(`Exemplo real para sua conexão: \`[PARA: ${outgoing[0].name}] Segue minha saída para você revisar/executar: ...\``)
    connectionLines.push('O Vértice intercepta essa linha automaticamente, abre o terminal do agente destino e entrega a mensagem para ele executar na hora.')
  }

  return [
    `# Memória viva — ${agent.name}`,
    '',
    '> Gerado pelo Vértice. É o contexto deste agente entre uma sessão e outra: use-o como ponto de partida.',
    '',
    '## Papel',
    agent.role || '(não definido)',
    '',
    '## Instrução de sistema',
    agent.prompt || '(não definida)',
    '',
    buildPoliciesMarkdown(effectivePolicies),
    '',
    '## Equipe e Conexões no Organograma',
    connectionLines.length ? connectionLines.join('\n') : '(nenhum outro agente conectado a este no momento)',
    '',
    '## Tarefas e contexto acumulado',
    (memory ?? '').trim() || '(nenhuma tarefa concluída ainda)',
    '',
    '## Última conversa (trecho final do terminal)',
    '````text',
    tail || '(sem conversa registrada)',
    '````',
    '',
  ].join('\n')
}

/** Grava em <projeto>/.vertice/memory/<agente>.md. O CHAMADOR deve passar um caminho já confinado. */
export function writeMemoryFile(projectPath, agentId, content) {
  const dir = join(projectPath, '.vertice', 'memory')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${safeFileName(agentId)}.md`)
  writeFileSync(file, content, { encoding: 'utf8' })
  return file
}