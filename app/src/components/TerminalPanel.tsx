import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Eraser, SquareTerminal, X } from 'lucide-react'
import type { Agent, TerminalLine } from '@/types/agent'

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
}

export function TerminalPanel({ agents, activeAgent, lines, expanded, workspacePath, onSelectAgent, onCommand, onClear, onToggleExpanded, onClose }: TerminalPanelProps) {
  const [command, setCommand] = useState('')
  const outputRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [lines, activeAgent.id])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!command.trim()) return
    onCommand(command.trim())
    setCommand('')
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
      <div className="terminal-output" ref={outputRef} onClick={() => document.getElementById('terminal-command')?.focus()}>
        {lines.map((line) => <div key={line.id} className={`terminal-line terminal-line--${line.type}`}>{line.type === 'command' && <span>PS&gt; </span>}{line.text}</div>)}
        {lines.length === 0 && <div className="terminal-line terminal-line--muted">Terminal limpo. Digite /help para ver os comandos da demonstração.</div>}
      </div>
      <form className="terminal-input" onSubmit={submit}>
        <label htmlFor="terminal-command" title={workspacePath}>PS {workspacePath ?? 'workspace'}&gt;</label>
        <input id="terminal-command" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Digite /help para ver os comandos" autoComplete="off" />
        <kbd>ENTER</kbd>
      </form>
    </section>
  )
}
