import { useState } from 'react'
import { Activity, Bot, ChevronRight, CirclePause, CirclePlay, Clock3, Network, SquareTerminal, Trash2, X } from 'lucide-react'
import type { Agent, ActivityEvent } from '@/types/agent'
import { statusLabels } from '@/types/agent'

interface InspectorProps {
  agent?: Agent
  agents: Agent[]
  events: ActivityEvent[]
  onOpenTerminal: () => void
  onTogglePause: () => void
  onRemove: () => void
  onSelect: (id: string) => void
  onClose: () => void
  mobileOpen: boolean
}

export function Inspector({ agent, agents, events, onOpenTerminal, onTogglePause, onRemove, onSelect, onClose, mobileOpen }: InspectorProps) {
  const [tab, setTab] = useState<'overview' | 'prompt' | 'activity'>('overview')
  const parentAgent = agent?.createdBy ? agents.find((item) => item.id === agent.createdBy) : undefined

  return (
    <aside className={`inspector ${mobileOpen ? 'is-mobile-open' : ''}`}>
      <div className="inspector-heading">
        <span className="section-label">INSPECTOR</span>
        <button className="icon-button icon-button--small" onClick={onClose} aria-label="Fechar inspector"><X size={15} /></button>
      </div>
      {agent ? (
        <>
          <div className="inspector-agent">
            <div className="inspector-agent__icon">{agent.kind === 'manager' ? <Network size={21} /> : <Bot size={21} />}</div>
            <div><h2>{agent.name}</h2><p>{agent.role}</p></div>
            <span className={`status-label status-label--${agent.status}`}><i />{statusLabels[agent.status]}</span>
          </div>
          <div className="inspector-tabs" role="tablist" aria-label="Detalhes do agente">
            <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'is-active' : ''} onClick={() => setTab('overview')}>Visão geral</button>
            <button role="tab" aria-selected={tab === 'prompt'} className={tab === 'prompt' ? 'is-active' : ''} onClick={() => setTab('prompt')}>Prompt</button>
            <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'is-active' : ''} onClick={() => setTab('activity')}>Eventos</button>
          </div>
          <div className="inspector-content">
            {tab === 'overview' && (
              <>
                <div className="detail-group">
                  <div className="section-label">TAREFA ATUAL</div>
                  <p className="current-task">{agent.task}</p>
                  <div className="task-progress"><span style={{ width: `${agent.progress}%` }} /></div>
                  <div className="progress-meta"><span>Progresso simulado</span><strong>{agent.progress}%</strong></div>
                </div>
                <dl className="detail-list">
                  <div><dt>Runtime</dt><dd>{agent.runtime}</dd></div>
                  <div><dt>Modelo</dt><dd>{agent.model}</dd></div>
                  <div><dt>Workspace</dt><dd>C:\work\atlas</dd></div>
                  <div><dt>Origem</dt><dd>{agent.createdBy ? `Criado por ${parentAgent?.name ?? 'Gerente'}` : 'Agente principal'}</dd></div>
                </dl>
                <div className="detail-group">
                  <div className="section-label">CONEXÕES</div>
                  <div className="connection-summary">
                    <Network size={14} />
                    <span>{agent.kind === 'manager' ? `${agents.length - 1} subagentes coordenados` : `Vinculado a ${parentAgent?.name ?? 'Gerente principal'}`}</span>
                  </div>
                </div>
                <div className="detail-group permission-note">
                  <span>PERMISSÕES</span>
                  <strong>Autonomia total no workspace</strong>
                  <small>Leitura, escrita e execução · escopo local</small>
                </div>
              </>
            )}
            {tab === 'prompt' && (
              <div className="prompt-view">
                <div className="section-label">INSTRUÇÃO DE SISTEMA</div>
                <p>{agent.prompt}</p>
                <span>O prompt será editável na versão com execução real.</span>
              </div>
            )}
            {tab === 'activity' && <EventList events={events} agents={agents} onSelect={onSelect} />}
          </div>
          <div className="inspector-actions">
            <button className="button button--primary" onClick={onOpenTerminal}><SquareTerminal size={16} /> Abrir terminal</button>
            <div className="inspector-actions__row">
              <button className="button button--secondary" onClick={onTogglePause}>
                {agent.status === 'paused' ? <CirclePlay size={15} /> : <CirclePause size={15} />}
                {agent.status === 'paused' ? 'Retomar' : 'Pausar'}
              </button>
              {agent.kind !== 'manager' && <button className="button button--danger" onClick={onRemove} aria-label="Encerrar agente"><Trash2 size={15} /></button>}
            </div>
          </div>
        </>
      ) : (
        <div className="inspector-empty">
          <Activity size={24} />
          <h2>Atividade do workspace</h2>
          <p>Selecione um agente no mapa ou acompanhe os eventos recentes.</p>
          <EventList events={events} agents={agents} onSelect={onSelect} />
        </div>
      )}
    </aside>
  )
}

function EventList({ events, agents, onSelect }: { events: ActivityEvent[]; agents: Agent[]; onSelect: (id: string) => void }) {
  return (
    <div className="event-list">
      {events.map((event) => {
        const eventAgent = agents.find((item) => item.id === event.agentId)
        return (
          <button key={event.id} onClick={() => eventAgent && onSelect(event.agentId)} disabled={!eventAgent}>
            <span className={`event-marker event-marker--${event.type}`} />
            <span><strong>{eventAgent?.name ?? 'Sistema'}</strong><small>{event.message}</small><em><Clock3 size={11} />{event.time}</em></span>
            {eventAgent && <ChevronRight size={13} />}
          </button>
        )
      })}
    </div>
  )
}
