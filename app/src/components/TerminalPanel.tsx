import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eraser, SquareTerminal, X } from 'lucide-react'
import { LiveTerminal } from './LiveTerminal'
import type { Agent, TerminalLine } from '@/types/agent'
import type { RawOutputListener } from '@/store/workspace'

interface TerminalPanelProps {
  agents: Agent[]
  activeAgent: Agent
  lines: TerminalLine[]
  expanded: boolean
  onSelectAgent: (id: string) => void
  onCommand: (command: string) => void
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
}

// Sequências enviadas ao PTY para navegar em menus interativos das CLIs.
const KEY_SEQUENCES: Record<string, string> = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Enter: '\r',
  Escape: '\x1b',
  Tab: '\t',
}
const CTRL_C = '\x03'

// Botões da barra de controles (para quem prefere o mouse).
const CONTROL_BUTTONS: { label: string; title: string; data: string }[] = [
  { label: '↑', title: 'Seta para cima', data: KEY_SEQUENCES.ArrowUp },
  { label: '↓', title: 'Seta para baixo', data: KEY_SEQUENCES.ArrowDown },
  { label: 'Enter ↵', title: 'Confirmar (Enter)', data: KEY_SEQUENCES.Enter },
  { label: 'Esc', title: 'Cancelar (Esc)', data: KEY_SEQUENCES.Escape },
  { label: 'Ctrl+C', title: 'Interromper (Ctrl+C)', data: CTRL_C },
]

// Converte um KeyboardEvent do campo de comando na sequência do PTY, ou null se a tecla não
// deve ser repassada. Espaço é repassado (marca opções em menus de seleção).
function toPtySequence(event: React.KeyboardEvent, hasSelection: boolean): string | null {
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'c') {
    // Com texto selecionado, Ctrl+C continua sendo "copiar".
    return hasSelection ? null : CTRL_C
  }
  if (event.ctrlKey || event.altKey || event.metaKey) return null
  // Shift+Tab fica livre para o usuário conseguir sair do terminal pelo teclado.
  if (event.key === 'Tab' && event.shiftKey) return null
  if (KEY_SEQUENCES[event.key]) return KEY_SEQUENCES[event.key]
  if (event.key === ' ') return ' '
  return null
}

export function TerminalPanel({
  agents, activeAgent, lines, expanded, workspacePath, hasLiveSession = false,
  onRawKey, getRawOutput, subscribeRawOutput, onTerminalResize,
  onSelectAgent, onCommand, onClear, onToggleExpanded, onClose,
}: TerminalPanelProps) {
  const [command, setCommand] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)
  const showEmulator = hasLiveSession && Boolean(onRawKey && getRawOutput && subscribeRawOutput && onTerminalResize)

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [lines, activeAgent.id])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!command.trim()) return
    onCommand(command.trim())
    setCommand('')
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!hasLiveSession || !onRawKey) return
    const input = event.currentTarget
    const hasSelection = input.selectionStart !== input.selectionEnd
    // Ctrl+C interrompe a CLI mesmo com texto digitado (se nada estiver selecionado).
    if (event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'c') {
      if (hasSelection) return
      event.preventDefault()
      onRawKey(CTRL_C)
      return
    }
    // Com texto no campo, as teclas editam o comando normalmente (Enter envia a linha).
    if (command !== '') return
    const data = toPtySequence(event, hasSelection)
    if (data === null) return
    event.preventDefault()
    onRawKey(data)
  }

  return (
    <section className={`terminal-panel ${expanded ? 'is-expanded' : ''}`} aria-label={`Terminal de ${activeAgent.name}`}>
      <header className="terminal-header">
        <div className="terminal-title"><SquareTerminal size={15} /><span>TERMINAL</span></div>
        <div className="terminal-tabs">
          {agents.map((agent) => <button key={agent.id} className={agent.id === activeAgent.id ? 'is-active' : ''} onClick={() => onSelectAgent(agent.id)}><i className={`status-dot status-dot--${agent.status}`} />{agent.name}</button>)}
        </div>
        <div className="terminal-tools">
          <button className="icon-button icon-button--small" onClick={onClear} aria-label="Limpar terminal"><Eraser size={14} /></button>
          <button className="icon-button icon-button--small" onClick={onToggleExpanded} aria-label={expanded ? 'Reduzir terminal' : 'Expandir terminal'}>{expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button>
          <button className="icon-button icon-button--small" onClick={onClose} aria-label="Fechar terminal"><X size={15} /></button>
        </div>
      </header>
      {showEmulator ? (
        <LiveTerminal
          key={activeAgent.id}
          agentId={activeAgent.id}
          getBuffer={getRawOutput!}
          subscribe={subscribeRawOutput!}
          onData={onRawKey!}
          onResize={(cols, rows) => onTerminalResize!(activeAgent.id, cols, rows)}
        />
      ) : (
        <div
          className="terminal-output"
          ref={outputRef}
          role="log"
          aria-label="Saída do terminal"
          onClick={() => { if ((window.getSelection()?.toString() ?? '') === '') document.getElementById('terminal-command')?.focus() }}
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
      <form className="terminal-input" onSubmit={submit}>
        <label htmlFor="terminal-command" title={workspacePath}>PS {workspacePath ?? 'workspace'}&gt;</label>
        <input id="terminal-command" value={command} onChange={(e) => setCommand(e.target.value)} onKeyDown={handleInputKeyDown} placeholder={hasLiveSession ? 'Digite para a CLI · setas, Enter e Esc navegam nos menus' : 'Digite /help para ver os comandos'} autoComplete="off" />
        <kbd>ENTER</kbd>
      </form>
    </section>
  )
}
