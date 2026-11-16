import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, GripVertical, Lock, Pencil, Plus, RotateCcw, Save, Search, Target, Trash2, Undo2, X } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useWorkspace, type WorkItemInput } from '@/store/workspace'
import { findDetectedRuntime } from '@/lib/workspace-helpers'
import { priorityLabels, workStatusLabels, workStatusOrder, type Goal, type WorkItem, type WorkPriority, type WorkStatus } from '@/types/agent'

type WorkModal =
  | { kind: 'issue'; item?: WorkItem; intent?: 'start' }
  | { kind: 'goal'; goal?: Goal }
  | { kind: 'delete-issue'; item: WorkItem }
  | { kind: 'review'; id: string }
  | { kind: 'delete-goal'; goal: Goal }
  | null

// "failed" fica em "Aguardando aprovação": o gestor decide (tentar de novo ou devolver com feedback).
// Status que a interface não conhece (valor antigo inválido) não some do quadro: a tarefa aparece em
// "A fazer", com um aviso, e pode ser editada ou excluída.
function columnOf(item: WorkItem): WorkStatus {
  if (item.status === 'failed') return 'review'
  return workStatusOrder.includes(item.status as WorkStatus) ? (item.status as WorkStatus) : 'todo'
}

const formatDateTime = (value?: string) => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function executionModeLabel(ranMode?: WorkItem['ranMode']) {
  if (ranMode === 'headless') return 'Automático'
  if (ranMode === 'interactive') return 'Terminal'
  return null
}

export function WorkPage() {
  const {
    agents, goals, workItems, moveWorkItem, addWorkItem, addGoal, updateWorkItem, deleteWorkItem, updateGoal, deleteGoal,
    dispatchWorkItem, completeWorkItem, approveWorkItem, rejectWorkItem, serviceOnline,
  } = useWorkspace()
  const [modal, setModal] = useState<WorkModal>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<WorkStatus | null>(null)
  // G6: busca e filtros do quadro (só na tela; não mudam nada no banco).
  const [query, setQuery] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [goalFilter, setGoalFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const close = () => setModal(null)

  // G6: dependências que ainda não estão concluídas (dependência excluída não bloqueia).
  const blockersOf = (item: WorkItem) => (item.dependsOn ?? [])
    .map((id) => workItems.find((w) => w.id === id))
    .filter((dep): dep is WorkItem => Boolean(dep && dep.status !== 'done'))
  const blockedMessage = (blockers: WorkItem[]) =>
    `Esta tarefa depende de "${blockers[0].title}"${blockers.length > 1 ? ` e de mais ${blockers.length - 1}` : ''}, ainda não concluída. Ela começa sozinha quando a dependência for aprovada.`

  // Colocar em andamento: online, despacha para a sessão real do responsável; offline (demonstração), só move.
  const startItem = (id: string) => {
    const item = workItems.find((w) => w.id === id)
    const blockers = item ? blockersOf(item) : []
    if (blockers.length) { toast.info(blockedMessage(blockers)); return }
    if (serviceOnline) void dispatchWorkItem(id)
    else moveWorkItem(id, 'doing')
  }

  const handleMove = (item: WorkItem, next: WorkStatus) => {
    if (columnOf(item) === next) return
    const blockers = next === 'doing' ? blockersOf(item) : []
    if (blockers.length) { toast.info(blockedMessage(blockers)); return }
    // G4: sem responsável não há quem execute. Em vez de mover em silêncio (parecendo que está rodando),
    // abre a tarefa com o campo Responsável em foco; ao salvar com alguém escolhido, a tarefa é iniciada.
    if (next === 'doing' && !item.assigneeId) {
      toast.info('Escolha quem vai executar esta tarefa para colocá-la em andamento')
      setModal({ kind: 'issue', item, intent: 'start' })
      return
    }
    // Quando online, a movimentação dispara a execução real correspondente.
    if (next === 'doing') {
      startItem(item.id)
      return
    }
    if (serviceOnline && next === 'review') {
      void completeWorkItem(item.id)
      return
    }
    moveWorkItem(item.id, next)
  }

  const handleDropOnColumn = (event: React.DragEvent, targetStatus: WorkStatus) => {
    event.preventDefault()
    setDragOverStatus(null)
    const droppedId = draggingId || event.dataTransfer.getData('text/vertice-work-id') || event.dataTransfer.getData('text/plain')
    setDraggingId(null)
    if (!droppedId) return
    const item = workItems.find((w) => w.id === droppedId)
    if (item) handleMove(item, targetStatus)
  }

  const goalProgress = (goalId: string) => {
    const items = workItems.filter((item) => item.goalId === goalId)
    if (!items.length) return 0
    return Math.round((items.filter((item) => item.status === 'done').length / items.length) * 100)
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filtering = Boolean(normalizedQuery || agentFilter || goalFilter || priorityFilter)
  const matchesFilters = (item: WorkItem) => {
    if (normalizedQuery && !`${item.title} ${item.description ?? ''}`.toLowerCase().includes(normalizedQuery)) return false
    if (agentFilter && (agentFilter === '__none' ? Boolean(item.assigneeId) : item.assigneeId !== agentFilter)) return false
    if (goalFilter && (goalFilter === '__none' ? Boolean(item.goalId) : item.goalId !== goalFilter)) return false
    if (priorityFilter && item.priority !== priorityFilter) return false
    return true
  }
  const visibleItems = filtering ? workItems.filter(matchesFilters) : workItems
  const clearFilters = () => { setQuery(''); setAgentFilter(''); setGoalFilter(''); setPriorityFilter('') }
  const itemsIn = (status: WorkStatus) => visibleItems.filter((item) => columnOf(item) === status)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">TRABALHO</span>
          <h1>Work</h1>
          <p>{workItems.filter((i) => i.status !== 'done').length} tarefas abertas · {goals.length} metas ativas · arraste os cards entre as colunas</p>
        </div>
        <div className="page-header__actions">
          <button className="button button--secondary" onClick={() => setModal({ kind: 'goal' })}><Target size={15} /> Nova meta</button>
          <button className="button button--primary" onClick={() => setModal({ kind: 'issue' })}><Plus size={15} /> Nova tarefa</button>
        </div>
      </header>

      <section className="goal-row">
        {goals.map((goal) => (
          <article key={goal.id} className="goal-card">
            <div className="goal-card__top">
              <Target size={16} /><h3>{goal.title}</h3>
              <div className="goal-card__actions">
                <button className="icon-button icon-button--small" onClick={() => setModal({ kind: 'goal', goal })} title="Editar meta" aria-label={`Editar a meta ${goal.title}`}><Pencil size={13} /></button>
                <button className="icon-button icon-button--small icon-button--danger" onClick={() => setModal({ kind: 'delete-goal', goal })} title="Excluir meta" aria-label={`Excluir a meta ${goal.title}`}><Trash2 size={13} /></button>
              </div>
            </div>
            <p>{goal.description}</p>
            <div className="goal-card__progress"><span style={{ width: `${goalProgress(goal.id)}%` }} /></div>
            <small>{goalProgress(goal.id)}% das tarefas concluídas</small>
          </article>
        ))}
      </section>

      <section className="work-filters" aria-label="Buscar e filtrar tarefas">
        <label className="work-filters__search">
          <Search size={13} />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por título ou especificação" aria-label="Buscar tarefas" />
        </label>
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} aria-label="Filtrar por responsável">
          <option value="">Todos os responsáveis</option>
          <option value="__none">Sem responsável</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <select value={goalFilter} onChange={(e) => setGoalFilter(e.target.value)} aria-label="Filtrar por meta">
          <option value="">Todas as metas</option>
          <option value="__none">Sem meta</option>
          {goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} aria-label="Filtrar por prioridade">
          <option value="">Todas as prioridades</option>
          <option value="alta">Alta</option>
          <option value="media">Média</option>
          <option value="baixa">Baixa</option>
        </select>
        {filtering && (
          <>
            <span className="work-filters__count">{visibleItems.length} de {workItems.length} tarefas</span>
            <button className="button button--secondary button--small" onClick={clearFilters}><X size={13} /> Limpar</button>
          </>
        )}
      </section>

      <section className="work-board">
        {workStatusOrder.map((status) => (
          <div
            key={status}
            className={`work-column ${dragOverStatus === status ? 'work-column--drag-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (dragOverStatus !== status) setDragOverStatus(status)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDragOverStatus((current) => (current === status ? null : current))
              }
            }}
            onDrop={(event) => handleDropOnColumn(event, status)}
          >
            <header className="work-column__header">
              <span>{workStatusLabels[status]}</span>
              <b>{itemsIn(status).length}</b>
            </header>
            <div className="work-column__body">
              {itemsIn(status).map((item) => (
                <WorkCard
                  key={item.id}
                  item={item}
                  isDragging={draggingId === item.id}
                  onDragStart={(event) => {
                    setDraggingId(item.id)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/vertice-work-id', item.id)
                    event.dataTransfer.setData('text/plain', item.id)
                  }}
                  onDragEnd={() => {
                    setDraggingId(null)
                    setDragOverStatus(null)
                  }}
                  onMove={(next) => handleMove(item, next)}
                  onEdit={() => setModal({ kind: 'issue', item })}
                  onDelete={() => setModal({ kind: 'delete-issue', item })}
                  onReview={() => setModal({ kind: 'review', id: item.id })}
                  agentName={item.assigneeId ? agents.find((a) => a.id === item.assigneeId)?.name : undefined}
                  goalTitle={item.goalId ? goals.find((g) => g.id === item.goalId)?.title : undefined}
                  blockedBy={item.status === 'done' ? [] : blockersOf(item).map((dep) => dep.title)}
                />
              ))}
              {itemsIn(status).length === 0 && <div className="work-column__empty">{dragOverStatus === status ? 'Solte a tarefa aqui' : filtering ? 'Nenhuma tarefa com esses filtros' : 'Nenhuma tarefa'}</div>}
            </div>
          </div>
        ))}
      </section>

      {modal?.kind === 'issue' && <IssueDialog item={modal.item} intent={modal.intent} onClose={close} onCreate={addWorkItem} onSave={updateWorkItem} onStart={startItem} />}
      {modal?.kind === 'goal' && <GoalDialog goal={modal.goal} onClose={close} onCreate={addGoal} onSave={updateGoal} />}
      {modal?.kind === 'review' && (() => {
        const item = workItems.find((w) => w.id === modal.id)
        if (!item) return null
        return (
          <ReviewDialog
            item={item}
            agentName={item.assigneeId ? agents.find((a) => a.id === item.assigneeId)?.name : undefined}
            serviceOnline={serviceOnline}
            onClose={close}
            onApprove={approveWorkItem}
            onReject={rejectWorkItem}
            onRetry={(id) => { close(); void dispatchWorkItem(id) }}
          />
        )
      })()}
      {modal?.kind === 'delete-issue' && (
        <ConfirmDialog title={`Excluir "${modal.item.title}"?`} eyebrow="WORK / ISSUE" confirmLabel="Excluir tarefa" onClose={close} onConfirm={() => deleteWorkItem(modal.item.id)}>
          <p>{modal.item.status === 'doing'
            ? 'A tarefa está em andamento: ela deixa de ser acompanhada e o agente fica disponível. Uma sessão aberta dele continua aberta.'
            : 'A tarefa sai do quadro. Esta ação não pode ser desfeita.'}</p>
        </ConfirmDialog>
      )}
      {modal?.kind === 'delete-goal' && (
        <ConfirmDialog title={`Excluir a meta "${modal.goal.title}"?`} eyebrow="WORK / GOAL" confirmLabel="Excluir meta" onClose={close} onConfirm={() => deleteGoal(modal.goal.id)}>
          <p>{(() => {
            const count = workItems.filter((item) => item.goalId === modal.goal.id).length
            return count ? `As ${count} tarefa(s) desta meta continuam no quadro, só ficam sem meta.` : 'Nenhuma tarefa está vinculada a esta meta.'
          })()}</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function WorkCard({ item, agentName, goalTitle, blockedBy = [], isDragging, onDragStart, onDragEnd, onMove, onEdit, onDelete, onReview }: {
  item: WorkItem
  agentName?: string
  goalTitle?: string
  /** Títulos das dependências ainda não concluídas (G6). */
  blockedBy?: string[]
  isDragging?: boolean
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onMove: (status: WorkStatus) => void
  onEdit: () => void
  onDelete: () => void
  onReview: () => void
}) {
  const column = columnOf(item)
  const index = workStatusOrder.indexOf(column)
  // Antes de aprovar, o gestor vê o que a IA entregou (últimas linhas); a entrega inteira fica na revisão.
  const failed = item.status === 'failed'
  const resultPreview = (item.status === 'review' || item.status === 'done') && item.result ? summarizeResult(item.result) : ''
  const errorPreview = failed && item.error ? summarizeResult(item.error) : ''
  const reviewable = item.status === 'review' || item.status === 'done' || failed
  const ranModeLabel = executionModeLabel(item.ranMode)
  return (
    <article
      className={`work-card ${isDragging ? 'work-card--dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="work-card__top">
        <span className="work-card__grip" title="Arraste para outra coluna">
          <GripVertical size={12} />
          <span className={`priority-chip priority-chip--${item.priority}`}>{priorityLabels[item.priority] ?? item.priority}</span>
          {ranModeLabel && (
            <span
              className={`mode-chip mode-chip--${item.ranMode}`}
              title={item.ranMode === 'headless' ? 'Executada automaticamente (sem terminal)' : 'Executada no terminal interativo'}
            >
              {ranModeLabel}
            </span>
          )}
        </span>
        <div className="work-card__moves">
          <button className="icon-button icon-button--small" onClick={onEdit} title="Editar tarefa" aria-label={`Editar a tarefa ${item.title}`}><Pencil size={12} /></button>
          <button className="icon-button icon-button--small icon-button--danger" onClick={onDelete} title="Excluir tarefa" aria-label={`Excluir a tarefa ${item.title}`}><Trash2 size={12} /></button>
          {index > 0 && <button className="icon-button icon-button--small" onClick={() => onMove(workStatusOrder[index - 1])} title="Mover para trás" aria-label="Mover para trás"><ArrowLeft size={13} /></button>}
          {index < workStatusOrder.length - 1 && <button className="icon-button icon-button--small" onClick={() => onMove(workStatusOrder[index + 1])} title="Mover para frente" aria-label="Mover para frente"><ArrowRight size={13} /></button>}
        </div>
      </div>
      <strong>{item.title}</strong>
      {item.description && <p className="work-card__desc">{item.description}</p>}
      {!failed && column !== item.status && <p className="work-card__invalid">Status "{item.status}" não reconhecido · edite a tarefa para corrigir.</p>}
      {blockedBy.length > 0 && <p className="work-card__blocked" title="Começa sozinha quando as dependências forem concluídas"><Lock size={11} /> Aguardando: {blockedBy.join(', ')}</p>}
      {failed && <p className="work-card__failed">Falhou{errorPreview ? ` · ${errorPreview}` : ''}</p>}
      {resultPreview && <p className="work-card__result" title={item.result}>→ {resultPreview}</p>}
      {reviewable && (
        <button className="work-card__review" onClick={onReview}>
          <FileText size={12} /> {item.status === 'done' ? 'Ver entrega' : 'Revisar entrega'}
        </button>
      )}
      <footer>
        {agentName && <span className="work-card__assignee">{agentName}</span>}
        {goalTitle && <small>{goalTitle}</small>}
      </footer>
    </article>
  )
}

function summarizeResult(result: string) {
  const text = result.split('\n').map((line) => line.trim()).filter(Boolean).slice(-2).join(' · ')
  return text.length > 140 ? `${text.slice(0, 137)}…` : text
}

/**
 * Revisão da Entrega (G5): saída completa da IA (e o erro, se falhou), com as decisões do gestor.
 * "Aguardando aprovação": Aprovar -> Concluído ou Devolver com feedback. "Falhou": Tentar novamente ou
 * Devolver com feedback. "Concluído": só leitura.
 */
function ReviewDialog({ item, agentName, serviceOnline, onClose, onApprove, onReject, onRetry }: {
  item: WorkItem
  agentName?: string
  serviceOnline: boolean
  onClose: () => void
  onApprove: (id: string) => Promise<boolean>
  onReject: (id: string, feedback: string) => Promise<boolean>
  onRetry: (id: string) => void
}) {
  const [writingFeedback, setWritingFeedback] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const failed = item.status === 'failed'
  const pending = item.status === 'review' || failed
  const statusLabel = failed ? 'Falhou' : workStatusLabels[columnOf(item)]
  const ranModeLabel = executionModeLabel(item.ranMode)
  const updated = formatDateTime(item.updatedAt)

  const approve = async () => {
    setBusy(true)
    const ok = await onApprove(item.id)
    setBusy(false)
    if (ok) onClose()
  }

  const reject = async () => {
    if (!feedback.trim()) return
    setBusy(true)
    const ok = await onReject(item.id, feedback.trim())
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal title={item.title} eyebrow="WORK / REVISÃO DA ENTREGA" onClose={onClose} wide>
      <div className="review-view">
        <dl className="review-meta">
          <div><dt>Responsável</dt><dd>{agentName ?? 'Sem responsável'}</dd></div>
          <div><dt>Status</dt><dd className={failed ? 'is-failed' : ''}>{statusLabel}</dd></div>
          {ranModeLabel && (
            <div>
              <dt>Modo de execução</dt>
              <dd><span className={`mode-chip mode-chip--${item.ranMode}`}>{ranModeLabel}</span></dd>
            </div>
          )}
          {updated && <div><dt>Atualizada</dt><dd>{updated}</dd></div>}
        </dl>
        {item.description && (
          <section>
            <span className="section-label">ESPECIFICAÇÃO</span>
            <p className="review-spec">{item.description}</p>
          </section>
        )}
        {failed && (
          <section>
            <span className="section-label">ERRO</span>
            <pre className="review-output review-output--error">{item.error || 'A tarefa falhou sem mensagem de erro.'}</pre>
          </section>
        )}
        <section>
          <span className="section-label">ENTREGA DA IA</span>
          {item.result
            ? <pre className="review-output">{item.result}</pre>
            : <p className="review-empty">{item.ranMode === 'headless'
              ? 'Nenhuma saída registrada pela execução automática.'
              : 'Nenhuma saída registrada. Abra o terminal do agente para ver a conversa completa.'}</p>}
          <small className="review-note">{item.ranMode === 'headless'
            ? 'Resultado capturado diretamente da execução automática.'
            : 'Texto capturado do terminal pela detecção automática de conclusão; pode faltar ou sobrar trecho da conversa.'}</small>
        </section>
        {writingFeedback && (
          <label className="review-feedback">
            O que precisa ser corrigido
            <textarea
              autoFocus
              value={feedback}
              maxLength={2000}
              rows={4}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Ex.: faltou a tabela de custos; refaça a seção 2 com os números de outubro."
            />
            <small>Vai para {item.headless ? `${agentName ?? 'o responsável'}` : `o terminal real de ${agentName ?? 'responsável'}`} junto com a tarefa, e a tarefa volta para "Em andamento".</small>
          </label>
        )}
      </div>
      <footer className="modal-footer">
        {pending && !serviceOnline && <span>Devolver e tentar de novo precisam do serviço local (vertice-core).</span>}
        {writingFeedback ? (
          <>
            <button className="button button--secondary" type="button" disabled={busy} onClick={() => setWritingFeedback(false)}>Cancelar</button>
            <button className="button button--primary" type="button" disabled={busy || !feedback.trim()} onClick={() => void reject()}><Undo2 size={15} /> Devolver para o agente</button>
          </>
        ) : pending ? (
          <>
            <button className="button button--secondary" type="button" disabled={busy || !serviceOnline || !item.assigneeId} onClick={() => setWritingFeedback(true)}><Undo2 size={15} /> Devolver com feedback</button>
            {failed
              ? <button className="button button--primary" type="button" disabled={busy || !serviceOnline || !item.assigneeId} onClick={() => onRetry(item.id)}><RotateCcw size={15} /> Tentar novamente</button>
              : <button className="button button--primary" type="button" disabled={busy} onClick={() => void approve()}><CheckCircle2 size={15} /> Aprovar → Concluído</button>}
          </>
        ) : (
          <button className="button button--secondary" type="button" onClick={onClose}>Fechar</button>
        )}
      </footer>
    </Modal>
  )
}

/** Criar (sem `item`) ou editar (com `item`) uma tarefa. */
function IssueDialog({ item, intent, onClose, onCreate, onSave, onStart }: {
  item?: WorkItem
  /** "start": aberto ao tentar pôr em andamento uma tarefa sem responsável (G4). */
  intent?: 'start'
  onClose: () => void
  onCreate: (input: { title: string; description?: string; assigneeId?: string; goalId?: string; priority: WorkPriority; dependsOn?: string[]; headless?: boolean }) => void
  onSave: (id: string, input: WorkItemInput) => Promise<boolean>
  onStart: (id: string) => void
}) {
  const { agents, goals, workItems, realRuntimes } = useWorkspace()
  const [title, setTitle] = useState(item?.title ?? '')
  // G6: a interface edita uma dependência; outras gravadas pela API são mantidas.
  const [dependsOn, setDependsOn] = useState(item?.dependsOn?.[0] ?? '')
  const [dependsTouched, setDependsTouched] = useState(false)
  const extraDependencies = (item?.dependsOn ?? []).slice(1)
  const dependencyOptions = workItems.filter((w) => w.id !== item?.id)
  const [description, setDescription] = useState(item?.description ?? '')
  const [assigneeId, setAssigneeId] = useState(item?.assigneeId ?? '')
  const [goalId, setGoalId] = useState(item?.goalId ?? '')
  const [priority, setPriority] = useState<WorkPriority>(item?.priority ?? 'media')
  const [status, setStatus] = useState<WorkStatus>(item ? (intent === 'start' ? 'doing' : columnOf(item)) : 'todo')
  const [headless, setHeadless] = useState(Boolean(item?.headless))
  const selectedAgent = agents.find((agent) => agent.id === assigneeId)
  const matchedRuntime = selectedAgent ? findDetectedRuntime(realRuntimes, selectedAgent.runtime) : undefined
  const supportsHeadless = matchedRuntime?.headless === true
  const wantsStart = Boolean(item && status === 'doing' && columnOf(item) !== 'doing')
  const assigneeMissing = wantsStart && !assigneeId
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!title.trim() || saving) return
    const base = {
      title: title.trim(),
      description: description.trim(),
      assigneeId: assigneeId || undefined,
      goalId: goalId || undefined,
      priority,
      ...(supportsHeadless ? { headless } : {}),
      ...(!item
        ? (dependsOn ? { dependsOn: [dependsOn] } : {})
        : dependsTouched ? { dependsOn: [...new Set([dependsOn, ...extraDependencies].filter(Boolean))] } : {}),
    }
    if (!item) {
      onCreate(base)
      onClose()
      return
    }
    // Ir para "Em andamento" exige responsável e passa pelo mesmo despacho do quadro (não só troca o status).
    if (wantsStart && !assigneeId) return
    setSaving(true)
    // Status só vai quando muda: editar uma tarefa que falhou não deve transformá-la em "review".
    const ok = await onSave(item.id, { ...base, ...(!wantsStart && status !== columnOf(item) ? { status } : {}) })
    setSaving(false)
    if (!ok) return
    onClose()
    if (wantsStart) onStart(item.id)
  }

  return (
    <Modal title={item ? 'Editar tarefa' : 'Nova tarefa'} eyebrow="WORK / ISSUE" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="agent-form">
        <div className="form-grid">
          <label style={{ gridColumn: '1 / -1' }}>Título<input autoFocus={intent !== 'start'} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Revisar política de aprovações" aria-invalid={submitted && !title.trim()} />{submitted && !title.trim() && <small className="field-error">Informe um título.</small>}</label>
          <label>
            Responsável
            <select autoFocus={intent === 'start'} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-invalid={assigneeMissing && (submitted || intent === 'start')}>
              <option value="">Sem responsável</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            {assigneeMissing && (submitted || intent === 'start') && <small className="field-error">{agents.length ? 'Escolha quem vai executar para colocar a tarefa em andamento.' : 'Crie um agente antes: sem responsável a tarefa não pode entrar em andamento.'}</small>}
          </label>
          <label>Meta<select value={goalId} onChange={(e) => setGoalId(e.target.value)}><option value="">Sem meta</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
          <label>Prioridade<select value={priority} onChange={(e) => setPriority(e.target.value as WorkPriority)}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label>
          <label style={{ gridColumn: '1 / -1' }}>
            Depende da tarefa
            <select value={dependsOn} onChange={(e) => { setDependsOn(e.target.value); setDependsTouched(true) }}>
              <option value="">Nenhuma (pode começar quando quiser)</option>
              {dependencyOptions.map((w) => <option key={w.id} value={w.id}>{w.title} · {w.status === 'failed' ? 'Falhou' : workStatusLabels[columnOf(w)]}</option>)}
            </select>
            <small className="form-hint">{extraDependencies.length
              ? `Também espera mais ${extraDependencies.length} tarefa(s). `
              : ''}Com responsável, ela começa sozinha quando a tarefa escolhida for concluída.</small>
          </label>
          {item && (
            <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as WorkStatus)}>{workStatusOrder.map((value) => <option key={value} value={value}>{workStatusLabels[value]}</option>)}</select></label>
          )}
          {supportsHeadless && (
            <label className="form-toggle">
              <span>
                <strong>Executar automaticamente (sem terminal)</strong>
                <small>O agente conclui a tarefa em segundo plano e envia a entrega direto para aprovação.</small>
              </span>
              <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
            </label>
          )}
        </div>
        <label className="prompt-field">
          Especificação da tarefa
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descreva os detalhes da tarefa, instruções para o agente, entradas e critérios de entrega…"
          />
        </label>
        <footer className="modal-footer">
          {item && <span>Você também pode arrastar os cards entre as colunas do quadro Work.</span>}
          <button className="button button--secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button--primary" type="submit" disabled={saving}>{item ? <><Save size={15} /> {wantsStart ? 'Salvar e iniciar' : 'Salvar alterações'}</> : <><Plus size={15} /> Criar tarefa</>}</button>
        </footer>
      </form>
    </Modal>
  )
}

/** Criar (sem `goal`) ou editar (com `goal`) uma meta. */
function GoalDialog({ goal, onClose, onCreate, onSave }: {
  goal?: Goal
  onClose: () => void
  onCreate: (input: { title: string; description: string }) => void
  onSave: (id: string, input: { title: string; description: string }) => Promise<boolean>
}) {
  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!title.trim() || saving) return
    const input = { title: title.trim(), description: description.trim() || 'Sem descrição.' }
    if (!goal) {
      onCreate(input)
      onClose()
      return
    }
    setSaving(true)
    const ok = await onSave(goal.id, input)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title={goal ? 'Editar meta' : 'Nova meta'} eyebrow="WORK / GOAL" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="agent-form">
        <div className="form-grid">
          <label style={{ gridColumn: '1 / -1' }}>Título<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Lançar a intranet do setor" aria-invalid={submitted && !title.trim()} />{submitted && !title.trim() && <small className="field-error">Informe um título.</small>}</label>
        </div>
        <label className="prompt-field">Descrição<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que precisa ser verdade quando esta meta estiver concluída?" /></label>
        <footer className="modal-footer">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button--primary" type="submit" disabled={saving}>{goal ? <><Save size={15} /> Salvar alterações</> : <><Target size={15} /> Criar meta</>}</button>
        </footer>
      </form>
    </Modal>
  )
}