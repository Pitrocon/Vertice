import { useNavigate } from 'react-router'
import { Bot, CirclePause, CirclePlay, Network, Plus, Sparkles, SquareTerminal, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import { statusLabels, type Agent } from '@/types/agent'

export function AgentesPage() {
  const { agents, setSelectedId, setModal, togglePause } = useWorkspace()
  const navigate = useNavigate()
  const manager = agents.find((agent) => agent.kind === 'manager')
  const workers = agents.filter((agent) => agent.kind === 'worker')

  const openInOrganograma = (id: string) => {
    setSelectedId(id)
    navigate('/organograma')
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
            <p>{manager.role} · {manager.task}</p>
          </div>
          <div className="manager-hero__meta">
            <span>{workers.length} subordinados</span>
            <small>{manager.runtime}</small>
          </div>
        </section>
      )}

      <section className="agent-card-grid">
        {workers.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onOpen={() => openInOrganograma(agent.id)} onTogglePause={() => togglePause(agent.id)} onRemove={() => { setSelectedId(agent.id); setModal('remove') }} />
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

function AgentCard({ agent, onOpen, onTogglePause, onRemove }: { agent: Agent; onOpen: () => void; onTogglePause: () => void; onRemove: () => void }) {
  return (
    <article className={`agent-card agent-card--${agent.status}`}>
      <header>
        <span className="agent-card__icon"><Bot size={18} /></span>
        <span className={`status-chip status-chip--${agent.status}`}><i />{statusLabels[agent.status]}</span>
      </header>
      <h3>{agent.name}</h3>
      <p className="agent-card__role">{agent.role}</p>
      <p className="agent-card__task">{agent.task}</p>
      {agent.status === 'working' && (
        <div className="agent-card__progress"><span style={{ width: `${agent.progress}%` }} /></div>
      )}
      <footer>
        <small>{agent.runtime}</small>
        <div className="agent-card__actions">
          <button className="icon-button icon-button--small" onClick={onTogglePause} title={agent.status === 'paused' ? 'Retomar' : 'Pausar'}>
            {agent.status === 'paused' ? <CirclePlay size={15} /> : <CirclePause size={15} />}
          </button>
          <button className="icon-button icon-button--small" onClick={onOpen} title="Ver no organograma"><SquareTerminal size={15} /></button>
          <button className="icon-button icon-button--small icon-button--danger" onClick={onRemove} title="Encerrar agente"><Trash2 size={15} /></button>
        </div>
      </footer>
    </article>
  )
}
