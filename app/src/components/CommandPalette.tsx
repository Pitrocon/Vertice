import { useState } from 'react'
import { ArrowUpRight, Focus, Network, Plus, RotateCcw, Search, SquareTerminal, Trash2 } from 'lucide-react'
import { Modal } from './Modal'

interface CommandPaletteProps {
  onClose: () => void
  onCreate: () => void
  onManager: () => void
  onTerminal: () => void
  onFit: () => void
  onReset: () => void
  onClear: () => void
}

export function CommandPalette({ onClose, onCreate, onManager, onTerminal, onFit, onReset, onClear }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const commands = [
    { id: 'manager', label: 'Delegar objetivo ao Gerente', hint: 'Criar equipe autônoma', icon: Network, action: onManager },
    { id: 'create', label: 'Criar agente manualmente', hint: 'Configurar runtime e prompt', icon: Plus, action: onCreate },
    { id: 'terminal', label: 'Abrir terminal do agente', hint: 'Agente selecionado', icon: SquareTerminal, action: onTerminal },
    { id: 'fit', label: 'Enquadrar todos os agentes', hint: 'Centralizar o canvas', icon: Focus, action: onFit },
    { id: 'reset', label: 'Carregar dados de demonstração', hint: 'Substitui o workspace por uma equipe de exemplo', icon: RotateCcw, action: onReset },
    { id: 'clear', label: 'Limpar workspace (operar do zero)', hint: 'Apaga agentes, projetos e tarefas; mantém as CLIs', icon: Trash2, action: onClear },
  ]
  const filtered = commands.filter((command) => `${command.label} ${command.hint}`.toLowerCase().includes(query.toLowerCase()))

  return (
    <Modal title="Comandos do workspace" eyebrow="NAVEGAÇÃO RÁPIDA" onClose={onClose}>
      <div className="command-search"><Search size={17} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Digite um comando…" /></div>
      <div className="command-list">
        {filtered.map((command) => <button key={command.id} onClick={() => { onClose(); command.action() }}><command.icon size={17} /><span><strong>{command.label}</strong><small>{command.hint}</small></span><ArrowUpRight size={14} /></button>)}
        {filtered.length === 0 && <div className="command-empty">Nenhum comando encontrado.</div>}
      </div>
    </Modal>
  )
}
