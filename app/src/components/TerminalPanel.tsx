import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Eraser, RotateCcw, SquareTerminal, X } from 'lucide-react'
import { toast } from 'sonner'
import { LiveTerminal, type LiveTerminalHandle } from './LiveTerminal'
import type { Agent, TerminalLine } from '@/types/agent'
import type { RawOutputListener } from '@/store/workspace'

interface TerminalPanelProps {
  agents: Agent[]
  activeAgent: Agent
  lines: TerminalLine[]
  expanded: boolean
  onSelectAgent: (id: string) => void
  onCommand: (command: string, options?: { bracketedPaste?: boolean }) => void
  onClear: () => void
  onToggleExpanded: () => void
  onClose: () => void
  workspacePath?: string
  /** Há uma sessão real (PTY) viva para o agente ativo: a saída vira um emulador xterm. */
  hasLiveSession?: boolean
  onRawKey?: (data: string) => void
  getRawOutput?: (agentId: string) => string
  subscribeRawOutput?: (listener: RawOutputListener) => () => void
  onTerminalResize?: (agentId: string, cols: number, rows: number) => void
  onRestartSession?: () => Promise<boolean> | Promise<void> | void
}

const CTRL_C = '\x03'

// Botões da barra de controles (atalhos de mouse; não interferem no foco do terminal).
const CONTROL_BUTTONS: { label: string; title: string; data: string }[] = [
  { label: '↑', title: 'Seta para cima', data: '\x1b[A' },
  { label: '↓', title: 'Seta para baixo', data: '\x1b[B' },
  { label: 'Enter ↵', title: 'Confirmar (Enter)', data: '\r' },
  { label: 'Esc', title: 'Cancelar (Esc)', data: '\x1b' },
  { label: 'Ctrl+C', title: 'Interromper (Ctrl+C)', data: CTRL_C },
]

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Segue para a segunda tentativa com textarea temporário.
    }
  }
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let area: HTMLTextAreaElement | null = null
  try {
    area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-9999px'
    area.style.left = '-9999px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.focus()
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area?.remove()
    previousFocus?.focus?.()
  }
}

export function TerminalPanel({
  agents, activeAgent, lines, expanded, workspacePath, hasLiveSession = false,
  onRawKey, getRawOutput, subscribeRawOutput, onTerminalResize, onRestartSession,
  onSelectAgent, onCommand, onClear, onToggleExpanded, onClose,
}: TerminalPanelProps) {
  const [command, setCommand] = useState('')
  const [copied, setCopied] = useState(false)
  const [restartingAgentId, setRestartingAgentId] = useState<string | null>(null)
  const [focusedTerminalAgentId, setFocusedTerminalAgentId] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const liveTermRef = useRef<LiveTerminalHandle>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingFocusComposerRef = useRef(false)
  const copyTimerRef = useRef<number | undefined>(undefined)

  const showEmulator = hasLiveSession && Boolean(onRawKey && getRawOutput && subscribeRawOutput && onTerminalResize)
  const inputOwner: 'terminal' | 'composer' =
    showEmulator && focusedTerminalAgentId === activeAgent.id ? 'terminal' : 'composer'
  const isRestarting = restartingAgentId === activeAgent.id

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [lines, activeAgent.id])

  useEffect(() => () => window.clearTimeout(copyTimerRef.current), [])

  useEffect(() => {
    if (inputOwner === 'composer' && pendingFocusComposerRef.current) {
      pendingFocusComposerRef.current = false
      textareaRef.current?.focus()
    }
  }, [inputOwner])

  useEffect(() => {
    if (inputOwner !== 'composer') return
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [command, inputOwner])

  const submitCommand = () => {
    const trimmed = command.trim()
    if (!trimmed) return
    const bracketedPaste = showEmulator ? (liveTermRef.current?.hasBracketedPaste() ?? false) : false
    onCommand(trimmed, { bracketedPaste })
    setCommand('')
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    submitCommand()
  }

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      submitCommand()
    }
  }

  const activateComposer = () => {
    if (inputOwner === 'composer') {
      textareaRef.current?.focus()
      return
    }
    pendingFocusComposerRef.current = true
    setFocusedTerminalAgentId(null)
  }

  const handleCopyOutput = async () => {
    const text = showEmulator
      ? (liveTermRef.current?.getText() ?? '')
      : lines.map((line) => (line.type === 'command' ? `PS> ${line.text}` : line.text)).join('\n')
    if (!text.trim()) {
      toast.info('Não há saída no terminal para copiar')
      return
    }
    const ok = await copyToClipboard(text)
    if (!ok) {
      toast.error('Não foi possível copiar a saída')
      return
    }
    setCopied(true)
    window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1800)
    toast.success('Saída copiada')
  }

  const handleRestartSession = async () => {
    if (!onRestartSession || restartingAgentId !== null) return
    const targetId = activeAgent.id
    setRestartingAgentId(targetId)
    try {
      await onRestartSession()
    } finally {
      setRestartingAgentId((current) => (current === targetId ? null : current))
    }
  }

  return (
    <section className={`terminal-panel ${expanded ? 'is-expanded' : ''}`} aria-label={`Terminal de ${activeAgent.name}`}>
      <header className="terminal-header">
        <div className="terminal-title"><SquareTerminal size={15} /><span>TERMINAL</span></div>
        <div className="terminal-tabs">
          {agents.map((agent) => <button key={agent.id} className={agent.id === activeAgent.id ? 'is-active' : ''} onClick={() => onSelectAgent(agent.id)}><i className={`status-dot status-dot--${agent.status}`} />{agent.name}</button>)}
        </div>
        <div className="terminal-tools">
          <button
            type="button"
            className="terminal-tool-btn"
            onClick={() => void handleCopyOutput()}
            title="Copiar saída do terminal"
            aria-label="Copiar saída"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            <span>{copied ? 'Copiado' : 'Copiar saída'}</span>
          </button>
          {hasLiveSession && onRestartSession && (
            <button
              type="button"
              className="terminal-tool-btn terminal-tool-btn--restart"
              onClick={() => void handleRestartSession()}
              disabled={restartingAgentId !== null}
              title="Reiniciar sessão mantendo a Memória Viva"
              aria-label="Reiniciar sessão"
            >
              <RotateCcw size={13} className={isRestarting ? 'spin' : undefined} />
              <span>{isRestarting ? 'Reiniciando…' : 'Reiniciar sessão'}</span>
            </button>
          )}
          <button className="icon-button icon-button--small terminal-tool--clear" onClick={onClear} title="Limpar terminal" aria-label="Limpar terminal"><Eraser size={14} /></button>
          <button className="icon-button icon-button--small" onClick={onToggleExpanded} title={expanded ? 'Reduzir terminal' : 'Expandir terminal'} aria-label={expanded ? 'Reduzir terminal' : 'Expandir terminal'}>{expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
          <button className="icon-button icon-button--small" onClick={onClose} title="Fechar terminal" aria-label="Fechar terminal"><X size={15} /></button>
        </div>
      </header>
      {showEmulator ? (
        <LiveTerminal
          ref={liveTermRef}
          key={activeAgent.id}
          agentId={activeAgent.id}
          getBuffer={getRawOutput!}
          subscribe={subscribeRawOutput!}
          onData={onRawKey!}
          onResize={(cols, rows) => onTerminalResize!(activeAgent.id, cols, rows)}
          onFocusChange={(focused) => setFocusedTerminalAgentId((current) => {
            if (focused) return activeAgent.id
            return current === activeAgent.id ? null : current
          })}
        />
      ) : (
        <div
          className="terminal-output"
          ref={outputRef}
          role="log"
          aria-label="Saída do terminal"
          onClick={() => { if ((window.getSelection()?.toString() ?? '') === '') textareaRef.current?.focus() }}
        >
          {lines.map((line) => <div key={line.id} className={`terminal-line terminal-line--${line.type}`}>{line.type === 'command' && <span>PS&gt; </span>}{line.text}</div>)}
          {lines.length === 0 && <div className="terminal-line terminal-line--muted">Terminal limpo. Digite /help para ver os comandos.</div>}
        </div>
      )}
      {hasLiveSession && onRawKey && (
        <div className="terminal-keys" role="toolbar" aria-label="Controles da sessão interativa">
          <span className="terminal-keys__label">SESSÃO REAL · TECLAS</span>
          {CONTROL_BUTTONS.map((button) => (
            <button
              key={button.label}
              type="button"
              className="terminal-keys__button"
              title={button.title}
              aria-label={button.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRawKey(button.data)}
            >{button.label}</button>
          ))}
        </div>
      )}
      {inputOwner === 'terminal' ? (
        <button
          type="button"
          className="terminal-input terminal-input--passive"
          onClick={activateComposer}
        >
          <span className="terminal-input__dot" aria-hidden="true" />
          <span>Digitando direto no terminal. Clique aqui para escrever uma mensagem.</span>
        </button>
      ) : (
        <form className="terminal-input" onSubmit={handleSubmit}>
          <label htmlFor="terminal-command" title={workspacePath}>PS {workspacePath ?? 'workspace'}&gt;</label>
          <textarea
            ref={textareaRef}
            id="terminal-command"
            rows={1}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={showEmulator ? 'Escreva uma mensagem para a CLI (Enter envia · Shift+Enter quebra linha)' : 'Digite /help para ver os comandos'}
            autoComplete="off"
          />
          <button
            type="submit"
            className="terminal-input__submit"
            disabled={!command.trim()}
            title="Enviar mensagem (Enter)"
            aria-label="Enviar mensagem"
          >
            <kbd>ENTER</kbd>
          </button>
        </form>
      )}
    </section>
  )
}
