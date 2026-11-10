import { useState } from 'react'
import { Check, FolderKanban, Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { useWorkspace } from '@/store/workspace'
import type { Project } from '@/types/agent'

type ProjectModal = { kind: 'new' } | { kind: 'edit'; project: Project } | { kind: 'delete'; project: Project } | null

export function ProjectsPage() {
  const { projects, agents, workItems, serviceOnline, setActiveProject, addProject, updateProject, deleteProject } = useWorkspace()
  const [modal, setModal] = useState<ProjectModal>(null)
  const close = () => setModal(null)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">AGRUPAMENTO</span>
          <h1>Projects</h1>
          <p>{projects.length} projetos · cada projeto tem seu workspace e sua equipe</p>
        </div>
        <div className="page-header__actions">
          <button className="button button--primary" onClick={() => setModal({ kind: 'new' })}><Plus size={15} /> Novo projeto</button>
        </div>
      </header>

      {projects.length === 0 && (
        <p className="page-note">Nenhum projeto ainda. Crie o primeiro com "Novo projeto": informe uma pasta dedicada (ex.: <code>%USERPROFILE%\vertice-workspaces\meu-projeto</code>). Ela passa a ser o único local onde os agentes podem trabalhar.</p>
      )}
      <section className="project-grid">
        {projects.map((project) => (
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
              <div><dt>Equipe</dt><dd>{project.active ? `${agents.length} agentes` : '—'}</dd></div>
              <div><dt>Tarefas abertas</dt><dd>{project.active ? workItems.filter((item) => item.status !== 'done').length : '—'}</dd></div>
            </dl>
            {!project.active && <button className="button button--secondary project-card__activate" onClick={() => setActiveProject(project.id)}>Tornar ativo</button>}
          </article>
        ))}
      </section>

      <p className="page-note">{serviceOnline ? 'A troca de projeto é persistida no serviço local; as sessões dos agentes rodam confinadas ao workspace do projeto ativo.' : 'Offline: a troca de projeto é apenas visual (demonstração). Inicie o vertice-core para persistência e isolamento reais por projeto.'}</p>

      {modal?.kind === 'new' && <ProjectDialog onClose={close} onCreate={addProject} onSave={updateProject} />}
      {modal?.kind === 'edit' && <ProjectDialog project={modal.project} onClose={close} onCreate={addProject} onSave={updateProject} />}
      {modal?.kind === 'delete' && (
        <ConfirmDialog title={`Excluir o projeto ${modal.project.name}?`} eyebrow="PROJECTS" confirmLabel="Excluir projeto" onClose={close} onConfirm={() => deleteProject(modal.project.id)}>
          <p>O projeto sai do Vértice, mas os arquivos da pasta <code>{modal.project.path}</code> não são apagados. Agentes, metas e tarefas continuam no workspace.</p>
          {modal.project.active && (
            <p>{projects.length > 1
              ? 'Este é o projeto ativo: o próximo da lista passa a ser o ativo.'
              : 'Sem projeto ativo, os agentes não conseguem abrir sessões até você criar outro.'} Sessões já abertas continuam rodando até serem encerradas.</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}

/** Criar (sem `project`) ou editar (com `project`) um projeto. */
function ProjectDialog({ project, onClose, onCreate, onSave }: {
  project?: Project
  onClose: () => void
  onCreate: (input: { name: string; path: string; description: string }) => void
  onSave: (id: string, input: { name: string; path: string; description: string }) => Promise<boolean>
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [path, setPath] = useState(project?.path ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const pathChanged = Boolean(project) && path.trim() !== '' && path.trim() !== project?.path

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !path.trim() || saving) return
    const input = { name: name.trim(), path: path.trim(), description: description.trim() || 'Sem descrição.' }
    if (!project) {
      onCreate(input)
      onClose()
      return
    }
    setSaving(true)
    // O core valida a pasta nova (recusa pastas de sistema etc.); se recusar, o diálogo continua aberto.
    const ok = await onSave(project.id, input)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <Modal title={project ? 'Editar projeto' : 'Novo projeto'} eyebrow="PROJECTS" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="agent-form">
        <div className="form-grid">
          <label>Nome<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Suporte" aria-invalid={submitted && !name.trim()} />{submitted && !name.trim() && <small className="field-error">Informe um nome.</small>}</label>
          <label>Workspace<input value={path} onChange={(e) => setPath(e.target.value)} placeholder="%USERPROFILE%\vertice-workspaces\suporte" aria-invalid={submitted && !path.trim()} />{submitted && !path.trim() && <small className="field-error">Informe o diretório.</small>}</label>
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