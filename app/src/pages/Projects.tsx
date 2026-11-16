import { useState } from 'react'
import { Check, FolderKanban, FolderOpen, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useWorkspace } from '@/store/workspace'
import { canPickFolder, pickFolder } from '@/lib/desktop'
import type { Project } from '@/types/agent'

type ProjectModal = { kind: 'new' } | { kind: 'edit'; project: Project } | { kind: 'delete'; project: Project } | null

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function ProjectsPage() {
  const { projects, agents, connections, goals, workItems, serviceOnline, setActiveProject, addProject, updateProject, deleteProject } = useWorkspace()
  const [modal, setModal] = useState<ProjectModal>(null)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const close = () => setModal(null)

  const resolveCounts = (project: Project) => {
    if (project.counts) return project.counts
    if (!project.active) return null
    return {
      agents: agents.length,
      connections: connections.length,
      goals: goals.length,
      tasks: workItems.length,
      openTasks: workItems.filter((item) => item.status !== 'done').length,
    }
  }

  const activate = async (id: string) => {
    if (activatingId) return
    setActivatingId(id)
    await setActiveProject(id)
    setActivatingId(null)
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">AGRUPAMENTO</span>
          <h1>Projects</h1>
          <p>{formatCount(projects.length, 'projeto', 'projetos')} · cada projeto tem seu workspace e sua equipe</p>
        </div>
        <div className="page-header__actions">
          <button className="button button--primary" onClick={() => setModal({ kind: 'new' })}><Plus size={15} /> Novo projeto</button>
        </div>
      </header>

      {projects.length === 0 && (
        <p className="page-note">Nenhum projeto ainda. Crie o primeiro com "Novo projeto": informe uma pasta dedicada (ex.: <code>%USERPROFILE%\vertice-workspaces\meu-projeto</code>). Ela passa a ser o único local onde os agentes podem trabalhar.</p>
      )}
      <section className="project-grid">
        {projects.map((project) => {
          const counts = resolveCounts(project)
          const tasksText = !counts
            ? '—'
            : counts.tasks > 0 && counts.tasks !== counts.openTasks
              ? `${counts.openTasks} (${counts.tasks} no total)`
              : String(counts.openTasks)
          return (
            <article key={project.id} className={`project-card ${project.active ? 'is-active' : ''}`}>
              <header>
                <span className="project-card__icon"><FolderKanban size={19} /></span>
                <div className="project-card__header-end">
                  {project.active && <span className="project-card__badge"><Check size={12} /> Ativo</span>}
                  <button className="icon-button icon-button--small" onClick={() => setModal({ kind: 'edit', project })} title="Editar projeto" aria-label={`Editar o projeto ${project.name}`}><Pencil size={14} /></button>
                  <button className="icon-button icon-button--small icon-button--danger" onClick={() => setModal({ kind: 'delete', project })} title="Excluir projeto" aria-label={`Excluir o projeto ${project.name}`}><Trash2 size={14} /></button>
                </div>
              </header>
              <h3>{project.name}</h3>
              <p>{project.description}</p>
              <dl className="project-card__meta">
                <div><dt>Workspace</dt><dd>{project.path}</dd></div>
                <div><dt>Equipe</dt><dd>{counts ? formatCount(counts.agents, 'agente', 'agentes') : '—'}</dd></div>
                <div><dt>Tarefas abertas</dt><dd>{tasksText}</dd></div>
              </dl>
              {!project.active && (
                <button
                  className="button button--secondary project-card__activate"
                  disabled={activatingId !== null}
                  onClick={() => void activate(project.id)}
                >
                  {activatingId === project.id ? 'Ativando…' : 'Tornar ativo'}
                </button>
              )}
            </article>
          )
        })}
      </section>

      <p className="page-note">{serviceOnline ? 'A troca de projeto é persistida no serviço local; as sessões dos agentes rodam confinadas ao workspace do projeto ativo.' : 'Offline: a troca de projeto é apenas visual (demonstração). Inicie o vertice-core para persistência e isolamento reais por projeto.'}</p>

      {modal?.kind === 'new' && <ProjectDialog projects={projects} serviceOnline={serviceOnline} onClose={close} onCreate={addProject} onSave={updateProject} />}
      {modal?.kind === 'edit' && <ProjectDialog project={modal.project} projects={projects} serviceOnline={serviceOnline} onClose={close} onCreate={addProject} onSave={updateProject} />}
      {modal?.kind === 'delete' && (() => {
        const counts = resolveCounts(modal.project)
        return (
          <ConfirmDialog title={`Excluir o projeto ${modal.project.name}?`} eyebrow="PROJECTS" confirmLabel="Excluir projeto" onClose={close} onConfirm={() => deleteProject(modal.project.id)}>
            <p>
              {counts
                ? `Serão removidos: ${formatCount(counts.agents, 'agente', 'agentes')}, ${formatCount(counts.connections, 'conexão', 'conexões')}, ${formatCount(counts.goals, 'meta', 'metas')}, ${formatCount(counts.tasks, 'tarefa', 'tarefas')}.`
                : 'Todos os agentes, conexões, metas e tarefas vinculados a este projeto no Vértice serão removidos.'}
            </p>
            <p><strong>A pasta e os arquivos em disco NÃO são apagados:</strong> tudo em <code>{modal.project.path}</code> permanece intacto.</p>
            {modal.project.active && (
              <p>{projects.length > 1
                ? 'Este é o projeto ativo: as sessões abertas dele serão encerradas e o próximo projeto da lista passará a ser o ativo.'
                : 'Este é o projeto ativo: as sessões abertas dele serão encerradas e será necessário criar ou ativar outro projeto antes de iniciar agentes ou tarefas.'}</p>
            )}
          </ConfirmDialog>
        )
      })()}
    </div>
  )
}

/** Criar (sem `project`) ou editar (com `project`) um projeto. */
function ProjectDialog({ project, projects, serviceOnline, onClose, onCreate, onSave }: {
  project?: Project
  projects: Project[]
  serviceOnline: boolean
  onClose: () => void
  onCreate: (input: { name: string; path: string; description: string; copyTeamFromProjectId?: string }) => Promise<boolean>
  onSave: (id: string, input: { name: string; path: string; description: string }) => Promise<boolean>
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [path, setPath] = useState(project?.path ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [copyTeamFromProjectId, setCopyTeamFromProjectId] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const pathChanged = Boolean(project) && path.trim() !== '' && path.trim() !== project?.path

  // App desktop: seletor nativo de pastas (G8). O core ainda valida a pasta ao salvar.
  const choosePath = async () => {
    const chosen = await pickFolder(path.trim() || project?.path)
    if (chosen) setPath(chosen)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !path.trim() || saving) return
    const base = { name: name.trim(), path: path.trim(), description: description.trim() || 'Sem descrição.' }
    setSaving(true)
    // O core valida a pasta (recusa pastas de sistema etc.) e a origem da cópia; se recusar, o diálogo continua aberto.
    const ok = project
      ? await onSave(project.id, base)
      : await onCreate(copyTeamFromProjectId ? { ...base, copyTeamFromProjectId } : base)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title={project ? 'Editar projeto' : 'Novo projeto'} eyebrow="PROJECTS" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="agent-form">
        <div className="form-grid">
          <label>Nome<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Suporte" aria-invalid={submitted && !name.trim()} />{submitted && !name.trim() && <small className="field-error">Informe um nome.</small>}</label>
          <label>
            Workspace
            <span className="input-with-action">
              <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="%USERPROFILE%\vertice-workspaces\suporte" aria-invalid={submitted && !path.trim()} />
              {canPickFolder && (
                <button type="button" className="button button--secondary button--small" onClick={() => void choosePath()}><FolderOpen size={13} /> Escolher pasta…</button>
              )}
            </span>
            {submitted && !path.trim() && <small className="field-error">Informe o diretório.</small>}
          </label>
          {!project && (
            <label style={{ gridColumn: '1 / -1' }}>
              Copiar a equipe de…
              <select value={copyTeamFromProjectId} onChange={(e) => setCopyTeamFromProjectId(e.target.value)}>
                <option value="">Começar sem equipe</option>
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.counts ? `${item.name} (${formatCount(item.counts.agents, 'agente', 'agentes')})` : item.name}
                  </option>
                ))}
              </select>
              <small className="form-hint">
                {serviceOnline
                  ? 'Opcional. Copia apenas os agentes e as conexões do organograma, sem metas nem tarefas.'
                  : 'Offline: a cópia real de equipe depende do serviço local (vertice-core).'}
              </small>
            </label>
          )}
        </div>
        {pathChanged && project && (
          <p className="form-note">A pasta não é movida: os arquivos continuam em <code>{project.path}</code>. A pasta nova passa a ser o workspace deste projeto.</p>
        )}
        <label className="prompt-field">Descrição<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que esta equipe vai entregar neste projeto?" /></label>
        <footer className="modal-footer">
          <button className="button button--secondary" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button--primary" type="submit" disabled={saving}>{project ? <><Save size={15} /> Salvar alterações</> : <><Plus size={15} /> Criar projeto</>}</button>
        </footer>
      </form>
    </Modal>
  )
}