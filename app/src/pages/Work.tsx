import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, GripVertical, Pencil, Plus, Save, Target, Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useWorkspace, type WorkItemInput } from '@/store/workspace'
import { priorityLabels, workStatusLabels, workStatusOrder, type Goal, type WorkItem, type WorkPriority, type WorkStatus } from '@/types/agent'

type WorkModal =
  | { kind: 'issue'; item?: WorkItem; intent?: 'start' }
  | { kind: 'goal'; goal?: Goal }
  | { kind: 'delete-issue'; item: WorkItem }
  | { kind: 'delete-goal'; goal: Goal }
  | null

// Status que a interface não conhece (ex.: "failed" ou um valor antigo inválido) não some do quadro:
// a tarefa aparece em "A fazer", com um aviso, e pode ser editada ou excluída.
function columnOf(item: WorkItem): WorkStatus {
  return workStatusOrder.includes(item.status) ? item.status : 'todo'
}

export function WorkPage() {
  const {
    agents, goals, workItems, moveWorkItem, addWorkItem, addGoal, updateWorkItem, deleteWorkItem, updateGoal, deleteGoal,
    dispatchWorkItem, completeWorkItem, serviceOnline,
  } = useWorkspace()
  const [modal, setModal] = useState<WorkModal>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<WorkStatus | null>(null)
  const close = () => setModal(null)

  // Colocar em andamento: online, despacha para a sessão real do responsável; offline (demonstração), só move.
  const startItem = (id: string) => {
    if (serviceOnline) void dispatchWorkItem(id)
    else moveWorkItem(id, 'doing')
  }

  const handleMove = (item: WorkItem, next: WorkStatus) => {
    if (columnOf(item) === next) return
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

  const itemsIn = (status: WorkStatus) => workItems.filter((item) => columnOf(item) === status)

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
                  agentName={item.assigneeId ? agents.find((a) => a.id === item.assigneeId)?.name : undefined}
                  goalTitle={item.goalId ? goals.find((g) => g.id === item.goalId)?.title : undefined}
                />
              ))}
              {itemsIn(status).length === 0 && <div className="work-column__empty">{dragOverStatus === status ? 'Solte a tarefa aqui' : 'Nenhuma tarefa'}</div>}
            </div>
          </div>
        ))}
      </section>

      {modal?.kind === 'issue' && <IssueDialog item={modal.item} intent={modal.intent} onClose={close} onCreate={addWorkItem} onSave={updateWorkItem} onStart={startItem} />}
      {modal?.kind === 'goal' && <GoalDialog goal={modal.goal} onClose={close} onCreate={addGoal} onSave={updateGoal} />}
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

function WorkCard({ item, agentName, goalTitle, isDragging, onDragStart, onDragEnd, onMove, onEdit, onDelete }: {
  item: WorkItem
  agentName?: string
  goalTitle?: string
  isDragging?: boolean
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onMove: (status: WorkStatus) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const column = columnOf(item)
  const index = workStatusOrder.indexOf(column)
  // Antes de aprovar, o gestor vê o que a IA entregou (últimas linhas do resultado).
  const resultPreview = (item.status === 'review' || item.status === 'done') && item.result ? summarizeResult(item.result) : ''
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
      {column !== item.status && <p className="work-card__invalid">Status "{item.status}" não reconhecido · edite a tarefa para corrigir.</p>}
      {resultPreview && <p className="work-card__result" title={item.result}>→ {resultPreview}</p>}
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

/** Criar (sem `item`) ou editar (com `item`) uma tarefa. */
function IssueDialog({ item, intent, onClose, onCreate, onSave, onStart }: {
  item?: WorkItem
  /** "start": aberto ao tentar pôr em andamento uma tarefa sem responsável (G4). */
  intent?: 'start'
  onClose: () => void
  onCreate: (input: { title: string; description?: string; assigneeId?: string; goalId?: string; priority: WorkPriority }) => void
  onSave: (id: string, input: WorkItemInput) => Promise<boolean>
  onStart: (id: string) => void
}) {
  const { agents, goals } = useWorkspace()
  const [title, setTitle] = useState(item?.title ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [assigneeId, setAssigneeId] = useState(item?.assigneeId ?? '')
  const [goalId, setGoalId] = useState(item?.goalId ?? '')
  const [priority, setPriority] = useState<WorkPriority>(item?.priority ?? 'media')
  const [status, setStatus] = useState<WorkStatus>(item ? (intent === 'start' ? 'doing' : columnOf(item)) : 'todo')
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
    }
    if (!item) {
      onCreate(base)
      onClose()
      return
    }
    // Ir para "Em andamento" exige responsável e passa pelo mesmo despacho do quadro (não só troca o status).
    if (wantsStart && !assigneeId) return
    setSaving(true)
    const ok = await onSave(item.id, { ...base, status: wantsStart ? columnOf(item) : status })
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
          {item && (
            <label>Status<select value={status} onChange={(e) => setStatus(e.target.value as WorkStatus)}>{workStatusOrder.map((value) => <option key={value} value={value}>{workStatusLabels[value]}</option>)}</select></label>
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