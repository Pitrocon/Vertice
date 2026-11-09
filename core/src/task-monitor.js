// Detecção automática de conclusão de tarefas (E13 / B3).
//
// Cada tarefa despachada para uma sessão interativa (claude, kimi, codex...) ganha um monitor que
// observa a saída do PTY e decide quando a IA terminou. As CLIs continuam abertas esperando o próximo
// comando, então não existe "fim de processo": a conclusão é INFERIDA por heurísticas, em ordem:
//
//  1. Marcador explícito: a instrução pede à IA uma linha só com a palavra TAREFA_CONCLUIDA entre
//     colchetes. A instrução NUNCA contém o marcador já entre colchetes, senão o eco do terminal
//     (que repete o que foi digitado) dispararia a conclusão na hora.
//  2. Encerramento da sessão (evento "exit").
//  3. Silêncio depois de resposta real (idleMs), exceto se a saída termina num prompt que espera
//     confirmação do usuário (ex.: "Trust this folder", "[y/n]") — aí continua esperando.
//  4. PowerShell: volta do prompt "PS ...>" (a instrução é digitada como comando).
//
// Tudo aqui é heurística: o resultado pode chegar cedo demais (CLI quieta pensando) ou tarde demais.
// Mover para "review" é seguro porque é a etapa de aprovação humana.

export const COMPLETION_INSTRUCTION = 'Quando terminar esta tarefa, escreva em uma linha sozinha a palavra TAREFA_CONCLUIDA entre colchetes.'

// Linha que contém SOMENTE o marcador (aceita bordas/bullets que TUIs desenham ao redor).
const MARKER_SOURCE = '^[\\s\\u2502|>*\\u2022\\u23FA\\u25CF\\u258C-]*\\[TAREFA_CONCLUIDA\\][\\s\\u2502|]*$'
const MARKER_LINE = new RegExp(MARKER_SOURCE, 'm')
const MARKER_LINE_SINGLE = new RegExp(MARKER_SOURCE)

// Prompts que BLOQUEIAM esperando o usuário: não é fim de turno, é a CLI pedindo permissão.
const BLOCKED_PROMPT = /trust this folder|do you trust|yes, i trust|allow (this|the|tool|execution|once|always)|\[y\/n\]|\(y\/n\)|\(yes\/no\)|press enter to (continue|confirm)|do you want to (proceed|continue|allow)|esc to cancel/i

// Depois do último trecho de prompt, quanto conteúdo novo (sem espaços) indica que o usuário já
// respondeu e a CLI seguiu em frente. Sem isso o texto antigo do prompt (que permanece no buffer,
// pois os códigos de limpar tela são removidos) bloquearia a conclusão para sempre.
const BLOCKED_RESOLVED_CHARS = 40

const POWERSHELL_PROMPT = /^PS [^\n]*>\s*$/

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>78cDEHMNOZ]/g

export function stripAnsi(text) {
  return String(text)
    .replace(ANSI_PATTERN, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
}

// Só chunks com pelo menos isto (em letras/números) podem ser descartados como eco; pedaços menores
// (uma tecla, um spinner) não valem a pena e poderiam coincidir com uma resposta curta de verdade.
const MIN_ECHO_CHARS = 6

function normalizeForEcho(text) {
  return String(text).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

const MAX_RESPONSE_CHARS = 30000
const MAX_RESULT_CHARS = 1500

/**
 * Cria o monitor de UMA tarefa. Relógio e timers são injetáveis (testes).
 * `onComplete({ reason, exitCode, result })` é chamado no máximo uma vez.
 */
export function createTaskMonitor({
  runtimeId,
  instruction = '',
  onComplete,
  idleMs = 4500,
  echoMs = 0,
  settleMs = 600,
  minResponseChars = 20,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const startedAt = now()
  const isPowerShell = runtimeId === 'powershell'
  const cleanInstruction = instruction ? stripAnsi(instruction).trim() : ''
  const normalizedInstruction = normalizeForEcho(cleanInstruction)
  let response = ''
  let responseChars = 0
  let timer = null
  let done = false

  // O chunk é só eco da instrução? Compara apenas letras e números: assim vale mesmo com o eco
  // dividido em vários chunks, quebrado em linhas com bordas de TUI ou redesenhado em prefixos
  // (a caixa de entrada de algumas CLIs se redesenha a cada tecla).
  function looksLikeEcho(text) {
    if (!normalizedInstruction) return false
    // A palavra do marcador faz parte da instrução ("...a palavra TAREFA_CONCLUIDA entre colchetes"),
    // então o marcador REAL da IA, inclusive se vier dividido em pedaços ("[TAREFA_" + "CONCLUIDA]"),
    // seria confundido com eco. O eco da instrução não tem colchetes; um pedaço com colchete nunca é eco.
    if (/[\[\]]/.test(text)) return false
    const normalized = normalizeForEcho(text)
    return normalized.length >= MIN_ECHO_CHARS && normalizedInstruction.includes(normalized)
  }

  const lastLines = (count) => response.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '').slice(-count)

  function buildResult(reason, exitCode) {
    const out = []
    for (const line of response.split('\n').map((l) => l.trimEnd())) {
      if (MARKER_LINE_SINGLE.test(line)) continue
      if (line.trim() === '') { if (out.length && out[out.length - 1] !== '') out.push(''); continue }
      if (out[out.length - 1] === line) continue // TUIs redesenham a mesma linha várias vezes
      out.push(line)
    }
    let text = out.join('\n').trim()
    if (text.length > MAX_RESULT_CHARS) text = '…' + text.slice(-MAX_RESULT_CHARS)
    if (reason === 'exit' && exitCode) {
      text = (text ? text + '\n\n' : '') + '[Aviso] O processo da CLI encerrou com código ' + exitCode + '.'
    }
    if (!text) {
      text = reason === 'exit'
        ? '[Aviso] A sessão foi encerrada sem saída textual capturada.'
        : 'Execução concluída (sem saída textual capturada).'
    }
    return text
  }

  // O prompt de confirmação ainda está "ativo"? Só se o último trecho dele é recente: se a CLI o
  // redesenhar no fim da saída, volta a contar como ativo.
  function blockedPromptActive() {
    const tail = response.slice(-4000)
    const pattern = new RegExp(BLOCKED_PROMPT.source, 'gi')
    let end = -1
    let match
    while ((match = pattern.exec(tail)) !== null) {
      end = match.index + match[0].length
      if (match[0].length === 0) pattern.lastIndex++
    }
    if (end < 0) return false
    return tail.slice(end).replace(/\s/g, '').length <= BLOCKED_RESOLVED_CHARS
  }

  function stopTimer() {
    if (timer !== null) { clearTimer(timer); timer = null }
  }

  function finish(reason, exitCode) {
    if (done) return
    done = true
    stopTimer()
    onComplete({ reason, exitCode, result: buildResult(reason, exitCode) })
  }

  function arm() {
    stopTimer()
    const last = lastLines(1)[0]
    const promptBack = isPowerShell && Boolean(last) && POWERSHELL_PROMPT.test(last)
    timer = setTimer(() => {
      timer = null
      if (done) return
      // Terminou num prompt de confirmação? Continua esperando o usuário em vez de concluir.
      if (blockedPromptActive()) { arm(); return }
      finish('idle')
    }, promptBack ? settleMs : idleMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  }

  return {
    feed(data) {
      if (done) return
      // Janela de eco opcional: quando > 0, ignora o intervalo inicial.
      if (echoMs > 0 && now() - startedAt < echoMs) return
      let clean = stripAnsi(data)
      if (!clean) return
      if (cleanInstruction && clean.includes(cleanInstruction)) {
        clean = clean.replace(cleanInstruction, '')
      } else if (looksLikeEcho(clean)) {
        return
      }
      response += clean
      if (response.length > MAX_RESPONSE_CHARS) response = response.slice(-MAX_RESPONSE_CHARS)
      if (MARKER_LINE.test(response.slice(-2000))) { finish('marker'); return }
      responseChars += clean.replace(/\s/g, '').length
      const last = lastLines(1)[0]
      const promptBack = isPowerShell && Boolean(last) && POWERSHELL_PROMPT.test(last)
      // Poucos caracteres (spinner, redesenho de prompt) ainda não contam como resposta real,
      // exceto no PowerShell quando o prompt `PS ...>` já retornou após executar o comando.
      if (!promptBack && responseChars < minResponseChars) return
      arm()
    },
    exit(exitCode) {
      finish('exit', exitCode)
    },
    cancel() {
      done = true
      stopTimer()
    },
    get finished() {
      return done
    },
  }
}