import { useState } from 'react'
import { Activity, ArrowLeft, ArrowRight, Bot, ChevronRight, CirclePause, CirclePlay, Clock3, Eraser, Network, Pencil, Send, SquareTerminal, Trash2, X } from 'lucide-react'
import type { Agent, AgentConnection, ActivityEvent } from '@/types/agent'
import { statusLabels } from '@/types/agent'

interface InspectorProps {
  agent?: Agent
  agents: Agent[]
  connections: AgentConnection[]
  events: ActivityEvent[]
  serviceOnline: boolean
  workspacePath?: string
  hasLiveSession: boolean
  onStartSession: () => void
  onStopSession: () => void
  onOpenTerminal: () => void
  onTogglePause: () => void
  onEdit: () => void
  onRemove: () => void
  onSaveMemory: (memory: string) => Promise<boolean>
  onClearMemory: () => Promise<boolean>
  onSendMessage: (targetId: string, message: string) => Promise<boolean>
  onSelect: (id: string) => void
  onClose: () => void
  mobileOpen: boolean
}

type InspectorTab = 'overview' | 'prompt' | 'memory' | 'activity'

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'overview', label: 'Visão geral' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'memory', label: 'Memória' },
  { id: 'activity', label: 'Eventos' },
]

export function Inspector({ agent, agents, connections, events, serviceOnline, workspacePath, hasLiveSession, onStartSession, onStopSession, onOpenTerminal, onTogglePause, onEdit, onRemove, onSaveMemory, onClearMemory, onSendMessage, onSelect, onClose, mobileOpen }: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('overview')
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
            {TABS.map((item) => (
              <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>
          <div className="inspector-content">
            {tab === 'overview' && (
              <>
                <div className="detail-group">
                  <div className="section-label">TAREFA ATUAL</div>
                  <p className="current-task">{agent.task || 'Sem tarefa ativa'}</p>
                  <div className="progress-meta"><span>Estado</span><strong>{statusLabels[agent.status]}</strong></div>
                </div>
                <dl className="detail-list">
                  <div><dt>Runtime</dt><dd>{agent.runtime}</dd></div>
                  <div><dt>Modelo</dt><dd>{agent.model}</dd></div>
                  <div><dt>Workspace</dt><dd>{workspacePath ?? 'workspace do projeto ativo'}</dd></div>
                  <div><dt>Origem</dt><dd>{agent.createdBy ? `Criado por ${parentAgent?.name ?? 'Gerente'}` : 'Agente principal'}</dd></div>
                </dl>
                <ConnectionsPanel key={agent.id} agent={agent} agents={agents} connections={connections} serviceOnline={serviceOnline} onSelect={onSelect} onSendMessage={onSendMessage} />
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
                <p>{agent.prompt || 'Sem instrução definida.'}</p>
                <span>Instrução enviada ao agente ao despachar uma tarefa. Para alterar, use "Editar".</span>
              </div>
            )}
            {tab === 'memory' && <MemoryPanel key={agent.id} agent={agent} serviceOnline={serviceOnline} onSave={onSaveMemory} onClear={onClearMemory} />}
            {tab === 'activity' && <EventList events={events} agents={agents} onSelect={onSelect} />}
          </div>
          <div className="inspector-actions">
            {serviceOnline ? (
              hasLiveSession ? (
                <button className="button button--secondary" onClick={onStopSession}><SquareTerminal size={16} /> Encerrar sessão real</button>
              ) : (
                <button className="button button--primary" onClick={onStartSession}><SquareTerminal size={16} /> Iniciar sessão real</button>
              )
            ) : (
              <button className="button button--primary" onClick={onOpenTerminal}><SquareTerminal size={16} /> Abrir terminal</button>
            )}
            {serviceOnline && hasLiveSession && (
              <button className="button button--secondary" style={{ marginTop: 8 }} onClick={onOpenTerminal}>Ver saída no terminal</button>
            )}
            <div className="inspector-actions__row">
              <button className="button button--secondary" onClick={onTogglePause}>
                {agent.status === 'paused' ? <CirclePlay size={15} /> : <CirclePause size={15} />}
                {agent.status === 'paused' ? 'Retomar' : 'Pausar'}
              </button>
              <button className="button button--secondary" onClick={onEdit}><Pencil size={15} /> Editar</button>
              <button className="button button--danger" onClick={onRemove} title="Remover agente" aria-label={`Remover ${agent.name}`}><Trash2 size={15} /></button>
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

/**
 * Card "Conexões" (G2): linhas reais do organograma que saem e chegam neste agente, e envio de uma
 * mensagem rápida para um agente ligado. A mensagem é digitada no terminal real do destino.
 */
function ConnectionsPanel({ agent, agents, connections, serviceOnline, onSelect, onSendMessage }: {
  agent: Agent
  agents: Agent[]
  connections: AgentConnection[]
  serviceOnline: boolean
  onSelect: (id: string) => void
  onSendMessage: (targetId: string, message: string) => Promise<boolean>
}) {
  const nameOf = (id: string) => agents.find((item) => item.id === id)?.name ?? id
  const outgoing = connections.filter((item) => item.source === agent.id)
  const incoming = connections.filter((item) => item.target === agent.id)
  const linkedIds = [...new Set([...outgoing.map((item) => item.target), ...incoming.map((item) => item.source)])]
    .filter((id) => agents.some((item) => item.id === id))
  const [targetId, setTargetId] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const target = linkedIds.includes(targetId) ? targetId : linkedIds[0] ?? ''

  const send = async () => {
    if (!target || !message.trim()) return
    setBusy(true)
    const ok = await onSendMessage(target, message.trim())
    setBusy(false)
    if (ok) setMessage('')
  }

  const row = (item: AgentConnection, direction: 'out' | 'in') => {
    const otherId = direction === 'out' ? item.target : item.source
    return (
      <li key={`${direction}-${item.id}`} className={item.active ? 'is-active' : ''}>
        {direction === 'out' ? <ArrowRight size={12} aria-label="envia para" /> : <ArrowLeft size={12} aria-label="recebe de" />}
        <button type="button" onClick={() => onSelect(otherId)}>{nameOf(otherId)}</button>
        {item.label && <small>{item.label}</small>}
        {item.active && <em>em comunicação</em>}
      </li>
    )
  }

  return (
    <div className="detail-group">
      <div className="section-label">CONEXÕES</div>
      {outgoing.length + incoming.length === 0 ? (
        <div className="connection-summary">
          <Network size={14} />
          <span>Sem ligações. Puxe uma linha de um ponto deste agente até outro agente no organograma.</span>
        </div>
      ) : (
        <>
          {outgoing.length > 0 && (<><span className="connection-list__title">Envia para</span><ul className="connection-list">{outgoing.map((item) => row(item, 'out'))}</ul></>)}
          {incoming.length > 0 && (<><span className="connection-list__title">Recebe de</span><ul className="connection-list">{incoming.map((item) => row(item, 'in'))}</ul></>)}
        </>
      )}
      {linkedIds.length > 0 && (
        <div className="quick-message">
          <label>
            <span>Mensagem para</span>
            <select value={target} onChange={(event) => setTargetId(event.target.value)} disabled={busy}>
              {linkedIds.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
            </select>
          </label>
          <textarea
            value={message}
            maxLength={2000}
            rows={3}
            placeholder={`Escreva o que ${agent.name} deve passar para ${nameOf(target)}`}
            aria-label="Mensagem rápida"
            disabled={busy || !serviceOnline}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send() } }}
          />
          <button className="button button--primary button--small" disabled={busy || !serviceOnline || !message.trim()} onClick={() => void send()}>
            <Send size={13} /> {busy ? 'Entregando…' : 'Enviar'}
          </button>
          <small>{serviceOnline
            ? `Entregue como mensagem de ${agent.name} no terminal real do destino (a sessão abre se precisar). A linha fica laranja até a resposta terminar.`
            : 'Precisa do serviço local (vertice-core) para entregar.'}</small>
        </div>
      )}
    </div>
  )
}

/** Aba "Memória": o que o agente acumulou (uma linha por tarefa) e que ele recebe ao retomar uma sessão. */
function MemoryPanel({ agent, serviceOnline, onSave, onClear }: { agent: Agent; serviceOnline: boolean; onSave: (memory: string) => Promise<boolean>; onClear: () => Promise<boolean> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(agent.memory ?? '')
  const [confirmClear, setConfirmClear] = useState(false)
  const [busy, setBusy] = useState(false)
  // Mesmo nome de arquivo que o core gera (caracteres fora de [A-Za-z0-9._-] viram "_").
  const file = `.vertice/memory/${agent.id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100)}.md`

  if (!serviceOnline) {
    return (
      <div className="prompt-view memory-view">
        <div className="section-label">MEMÓRIA VIVA</div>
        <span>A memória viva fica no serviço local. Inicie o vertice-core para ver e editar.</span>
      </div>
    )
  }

  const save = async () => {
    setBusy(true)
    const ok = await onSave(draft)
    setBusy(false)
    if (ok) setEditing(false)
  }

  const clear = async () => {
    setBusy(true)
    const ok = await onClear()
    setBusy(false)
    if (ok) { setConfirmClear(false); setDraft('') }
  }

  return (
    <div className="prompt-view memory-view">
      <div className="section-label">MEMÓRIA VIVA</div>
      {editing ? (
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`Memória viva de ${agent.name}`} />
      ) : (
        <p>{agent.memory?.trim() || 'Nenhuma tarefa concluída ainda. Cada tarefa que este agente concluir entra aqui automaticamente.'}</p>
      )}
      <span>Também fica salva em <code>{file}</code> no projeto ativo, junto com a última conversa do terminal. Ao reabrir uma sessão, a IA é orientada a ler esse arquivo.</span>
      <div className="memory-view__actions">
        {editing ? (
          <>
            <button className="button button--primary button--small" disabled={busy} onClick={() => void save()}>Salvar</button>
            <button className="button button--secondary button--small" disabled={busy} onClick={() => { setEditing(false); setDraft(agent.memory ?? '') }}>Cancelar</button>
          </>
        ) : confirmClear ? (
          <>
            <button className="button button--danger-solid button--small" disabled={busy} onClick={() => void clear()}>Confirmar: apagar memória e conversa</button>
            <button className="button button--secondary button--small" disabled={busy} onClick={() => setConfirmClear(false)}>Cancelar</button>
          </>
        ) : (
          <>
            <button className="button button--secondary button--small" onClick={() => { setDraft(agent.memory ?? ''); setEditing(true) }}><Pencil size={13} /> Editar</button>
            <button className="button button--secondary button--small" onClick={() => setConfirmClear(true)}><Eraser size={13} /> Limpar memória</button>
          </>
        )}
      </div>
    </div>
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