import { useNavigate } from 'react-router'
import { Bot, CirclePause, CirclePlay, Network, Pencil, Plus, Sparkles, SquareTerminal, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import { statusLabels, type Agent } from '@/types/agent'

export function AgentesPage() {
  const { agents, setSelectedId, setModal, togglePause } = useWorkspace()
  const navigate = useNavigate()
  const manager = agents.find((agent) => agent.kind === 'manager')
  // Todos os outros aparecem em cards, inclusive um segundo agente principal, se existir.
  const others = agents.filter((agent) => agent.id !== manager?.id)
  const subordinates = manager ? agents.filter((agent) => agent.createdBy === manager.id).length : 0

  const openInOrganograma = (id: string) => {
    setSelectedId(id)
    navigate('/organograma')
  }

  const openModal = (id: string, modal: 'edit' | 'remove') => {
    setSelectedId(id)
    setModal(modal)
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">EQUIPE</span>
          <h1>Agentes</h1>
          <p>{agents.length} pessoas de IA na equipe · {agents.filter((a) => a.status === 'working').length} executando agora</p>
        </div>
        <div className="page-header__actions">
          <button className="button button--secondary" onClick={() => setModal('create')}><Plus size={15} /> Novo agente</button>
          <button className="button button--primary" onClick={() => setModal('manager')}><Sparkles size={15} /> Delegar ao Gerente</button>
        </div>
      </header>

      {manager && (
        <section className="manager-hero" onClick={() => openInOrganograma(manager.id)}>
          <div className="manager-hero__icon"><Network size={24} /></div>
          <div className="manager-hero__body">
            <div className="manager-hero__title">
              <h2>{manager.name}</h2>
              <span className={`status-chip status-chip--${manager.status}`}><i />{statusLabels[manager.status]}</span>
            </div>
            <p>{manager.role}{manager.task ? ` · ${manager.task}` : ''}</p>
          </div>
          <div className="manager-hero__meta">
            <span>{subordinates} subordinado{subordinates === 1 ? '' : 's'}</span>
            <small>{manager.runtime}</small>
          </div>
          <div className="manager-hero__actions">
            <button className="icon-button icon-button--small" onClick={(event) => { event.stopPropagation(); openModal(manager.id, 'edit') }} title="Editar agente" aria-label={`Editar ${manager.name}`}><Pencil size={15} /></button>
            <button className="icon-button icon-button--small icon-button--danger" onClick={(event) => { event.stopPropagation(); openModal(manager.id, 'remove') }} title="Remover agente" aria-label={`Remover ${manager.name}`}><Trash2 size={15} /></button>
          </div>
        </section>
      )}

      <section className="agent-card-grid">
        {others.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            onOpen={() => openInOrganograma(agent.id)}
            onTogglePause={() => togglePause(agent.id)}
            onEdit={() => openModal(agent.id, 'edit')}
            onRemove={() => openModal(agent.id, 'remove')}
          />
        ))}
        <button className="agent-card agent-card--new" onClick={() => setModal('create')}>
          <Plus size={20} />
          <strong>Adicionar à equipe</strong>
          <small>Cargo, instruções e supervisor</small>
        </button>
      </section>
    </div>
  )
}

function AgentCard({ agent, onOpen, onTogglePause, onEdit, onRemove }: { agent: Agent; onOpen: () => void; onTogglePause: () => void; onEdit: () => void; onRemove: () => void }) {
  return (
    <article className={`agent-card agent-card--${agent.status}`}>
      <header>
        <span className="agent-card__icon">{agent.kind === 'manager' ? <Network size={18} /> : <Bot size={18} />}</span>
        <span className={`status-chip status-chip--${agent.status}`}><i />{statusLabels[agent.status]}</span>
      </header>
      <h3>{agent.name}</h3>
      <p className="agent-card__role">{agent.role}</p>
      <p className="agent-card__task">{agent.task}</p>
      {agent.status === 'working' && (
        <div className="agent-card__activity"><i /> Em execução</div>
      )}
      <footer>
        <small>{agent.runtime}</small>
        <div className="agent-card__actions">
          <button className="icon-button icon-button--small" onClick={onTogglePause} title={agent.status === 'paused' ? 'Retomar' : 'Pausar'} aria-label={agent.status === 'paused' ? `Retomar ${agent.name}` : `Pausar ${agent.name}`}>
            {agent.status === 'paused' ? <CirclePlay size={15} /> : <CirclePause size={15} />}
          </button>
          <button className="icon-button icon-button--small" onClick={onEdit} title="Editar agente" aria-label={`Editar ${agent.name}`}><Pencil size={15} /></button>
          <button className="icon-button icon-button--small" onClick={onOpen} title="Ver no organograma" aria-label={`Ver ${agent.name} no organograma`}><SquareTerminal size={15} /></button>
          <button className="icon-button icon-button--small icon-button--danger" onClick={onRemove} title="Remover agente" aria-label={`Remover ${agent.name}`}><Trash2 size={15} /></button>
        </div>
      </footer>
    </article>
  )
}