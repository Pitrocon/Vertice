import { Bot, ChevronDown, ChevronRight, CirclePlus, Network, Plus, Sparkles, X } from 'lucide-react'
import type { Agent } from '@/types/agent'
import { statusLabels } from '@/types/agent'

interface SidebarProps {
  agents: Agent[]
  selectedId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onManager: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
}

export function Sidebar({ agents, selectedId, onSelect, onCreate, onManager, mobileOpen, onCloseMobile }: SidebarProps) {
  const manager = agents.find((agent) => agent.kind === 'manager')
  const workers = agents.filter((agent) => agent.kind === 'worker')

  return (
    <>
      {mobileOpen && <button className="mobile-backdrop" onClick={onCloseMobile} aria-label="Fechar lista de agentes" />}
      <aside className={`sidebar ${mobileOpen ? 'is-mobile-open' : ''}`}>
        <div className="workspace-block">
          <div className="section-label">WORKSPACE ATIVO</div>
          <button className="workspace-switch" onClick={onManager} title="Abrir delegação do workspace">
            <span className="workspace-glyph">A</span>
            <span><strong>Atlas</strong><small>C:\work\atlas</small></span>
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="sidebar-section agents-section">
          <div className="sidebar-section__heading">
            <span className="section-label">AGENTES <b>{String(agents.length).padStart(2, '0')}</b></span>
            <button className="icon-button icon-button--small" onClick={onCreate} aria-label="Criar agente"><Plus size={15} /></button>
          </div>

          <div className="agent-tree">
            {manager && (
              <button className={`tree-agent tree-agent--manager ${selectedId === manager.id ? 'is-active' : ''}`} onClick={() => onSelect(manager.id)}>
                <Network size={15} />
                <span><strong>{manager.name}</strong><small>{statusLabels[manager.status]}</small></span>
                <span className={`status-dot status-dot--${manager.status}`} />
              </button>
            )}
            <div className="tree-children">
              {workers.map((agent) => (
                <button key={agent.id} className={`tree-agent ${selectedId === agent.id ? 'is-active' : ''}`} onClick={() => onSelect(agent.id)}>
                  <ChevronRight size={12} className="tree-branch" />
                  <Bot size={14} />
                  <span><strong>{agent.name}</strong><small>{agent.runtime}</small></span>
                  <span className={`status-dot status-dot--${agent.status}`} />
                </button>
              ))}
            </div>
          </div>

          <button className="manager-action" onClick={onManager}>
            <Sparkles size={15} />
            <span>Delegar ao Gerente</span>
            <kbd>G</kbd>
          </button>
          <button className="create-agent-link" onClick={onCreate}><CirclePlus size={14} /> Novo agente manual</button>
        </div>

        <div className="sidebar-spacer" />
        <div className="runtime-block">
          <div className="section-label">INTEGRAÇÕES DO MVP</div>
          <div className="runtime-row"><span>CLIs de IA</span><small>Claude · Codex · OpenCode</small></div>
          <div className="runtime-row"><span>Modelos locais</span><small>Ollama · LM Studio</small></div>
        </div>
        <div className="prototype-note"><span className="status-dot status-dot--idle" /> PROTÓTIPO · DADOS NO NAVEGADOR</div>
        <button className="mobile-close icon-button" onClick={onCloseMobile} aria-label="Fechar painel"><X size={18} /></button>
      </aside>
    </>
  )
}
