import { useState } from 'react'
import { ArrowLeft, ArrowRight, Plus, Target } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { useWorkspace } from '@/store/workspace'
import { priorityLabels, workStatusLabels, workStatusOrder, type WorkItem, type WorkPriority, type WorkStatus } from '@/types/agent'

export function WorkPage() {
  const { agents, goals, workItems, moveWorkItem, addWorkItem, addGoal } = useWorkspace()
  const [modal, setModal] = useState<'issue' | 'goal' | null>(null)

  const goalProgress = (goalId: string) => {
    const items = workItems.filter((item) => item.goalId === goalId)
    if (!items.length) return 0
    return Math.round((items.filter((item) => item.status === 'done').length / items.length) * 100)
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">TRABALHO</span>
          <h1>Work</h1>
          <p>{workItems.filter((i) => i.status !== 'done').length} tarefas abertas · {goals.length} metas ativas</p>
        </div>
        <div className="page-header__actions">
          <button className="button button--secondary" onClick={() => setModal('goal')}><Target size={15} /> Nova meta</button>
          <button className="button button--primary" onClick={() => setModal('issue')}><Plus size={15} /> Nova tarefa</button>
        </div>
      </header>

      <section className="goal-row">
        {goals.map((goal) => (
          <article key={goal.id} className="goal-card">
            <div className="goal-card__top"><Target size={16} /><h3>{goal.title}</h3></div>
            <p>{goal.description}</p>
            <div className="goal-card__progress"><span style={{ width: `${goalProgress(goal.id)}%` }} /></div>
            <small>{goalProgress(goal.id)}% das tarefas concluídas</small>
          </article>
        ))}
      </section>

      <section className="work-board">
        {workStatusOrder.map((status) => (
          <div key={status} className="work-column">
            <header className="work-column__header">
              <span>{workStatusLabels[status]}</span>
              <b>{workItems.filter((item) => item.status === status).length}</b>
            </header>
            <div className="work-column__body">
              {workItems.filter((item) => item.status === status).map((item) => (
                <WorkCard key={item.id} item={item} onMove={(next) => moveWorkItem(item.id, next)} agentName={item.assigneeId ? agents.find((a) => a.id === item.assigneeId)?.name : undefined} goalTitle={item.goalId ? goals.find((g) => g.id === item.goalId)?.title : undefined} />
              ))}
              {workItems.filter((item) => item.status === status).length === 0 && <div className="work-column__empty">Nenhuma tarefa</div>}
            </div>
          </div>
        ))}
      </section>

      {modal === 'issue' && <NewIssueDialog onClose={() => setModal(null)} onCreate={addWorkItem} />}
      {modal === 'goal' && <NewGoalDialog onClose={() => setModal(null)} onCreate={addGoal} />}
    </div>
  )
}

function WorkCard({ item, agentName, goalTitle, onMove }: { item: WorkItem; agentName?: string; goalTitle?: string; onMove: (status: WorkStatus) => void }) {
  const index = workStatusOrder.indexOf(item.status)
  return (
    <article className="work-card">
      <div className="work-card__top">
        <span className={`priority-chip priority-chip--${item.priority}`}>{priorityLabels[item.priority]}</span>
        <div className="work-card__moves">
          {index > 0 && <button className="icon-button icon-button--small" onClick={() => onMove(workStatusOrder[index - 1])} title="Mover para trás"><ArrowLeft size={13} /></button>}
          {index < workStatusOrder.length - 1 && <button className="icon-button icon-button--small" onClick={() => onMove(workStatusOrder[index + 1])} title="Mover para frente"><ArrowRight size={13} /></button>}
        </div>
      </div>
      <strong>{item.title}</strong>
      <footer>
        {agentName && <span className="work-card__assignee">{agentName}</span>}
        {goalTitle && <small>{goalTitle}</small>}
      </footer>
    </article>
  )
}

function NewIssueDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { title: string; assigneeId?: string; goalId?: string; priority: WorkPriority }) => void }) {
  const { agents, goals } = useWorkspace()
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [goalId, setGoalId] = useState('')
  const [priority, setPriority] = useState<WorkPriority>('media')
  const [submitted, setSubmitted] = useState(false)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!title.trim()) return
    onCreate({ title: title.trim(), assigneeId: assigneeId || undefined, goalId: goalId || undefined, priority })
    onClose()
  }

  return (
    <Modal title="Nova tarefa" eyebrow="WORK / ISSUE" onClose={onClose}>
      <form onSubmit={submit} className="agent-form">
        <div className="form-grid">
          <label style={{ gridColumn: '1 / -1' }}>Título<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Revisar política de aprovações" aria-invalid={submitted && !title.trim()} />{submitted && !title.trim() && <small className="field-error">Informe um título.</small>}</label>
          <label>Responsável<select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}><option value="">Sem responsável</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <label>Meta<select value={goalId} onChange={(e) => setGoalId(e.target.value)}><option value="">Sem meta</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
          <label>Prioridade<select value={priority} onChange={(e) => setPriority(e.target.value as WorkPriority)}><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option></select></label>
        </div>
        <footer className="modal-footer"><button className="button button--secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit"><Plus size={15} /> Criar tarefa</button></footer>
      </form>
    </Modal>
  )
}

function NewGoalDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { title: string; description: string }) => void }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!title.trim()) return
    onCreate({ title: title.trim(), description: description.trim() || 'Sem descrição.' })
    onClose()
  }

  return (
    <Modal title="Nova meta" eyebrow="WORK / GOAL" onClose={onClose}>
      <form onSubmit={submit} className="agent-form">
        <div className="form-grid">
          <label style={{ gridColumn: '1 / -1' }}>Título<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Lançar a intranet do setor" aria-invalid={submitted && !title.trim()} />{submitted && !title.trim() && <small className="field-error">Informe um título.</small>}</label>
        </div>
        <label className="prompt-field">Descrição<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que precisa ser verdade quando esta meta estiver concluída?" /></label>
        <footer className="modal-footer"><button className="button button--secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit"><Target size={15} /> Criar meta</button></footer>
      </form>
    </Modal>
  )
}
