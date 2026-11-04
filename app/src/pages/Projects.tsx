import { useState } from 'react'
import { Check, FolderKanban, Plus } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { useWorkspace } from '@/store/workspace'

export function ProjectsPage() {
  const { projects, agents, workItems, setActiveProject, addProject } = useWorkspace()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">AGRUPAMENTO</span>
          <h1>Projects</h1>
          <p>{projects.length} projetos · cada projeto tem seu workspace e sua equipe</p>
        </div>
        <div className="page-header__actions">
          <button className="button button--primary" onClick={() => setModalOpen(true)}><Plus size={15} /> Novo projeto</button>
        </div>
      </header>

      <section className="project-grid">
        {projects.map((project) => (
          <article key={project.id} className={`project-card ${project.active ? 'is-active' : ''}`}>
            <header>
              <span className="project-card__icon"><FolderKanban size={19} /></span>
              {project.active && <span className="project-card__badge"><Check size={12} /> Ativo</span>}
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

      <p className="page-note">Nesta fase, a troca de projeto é visual: equipe e tarefas continuam sendo as da demonstração. O isolamento real por projeto chega com o serviço local.</p>

      {modalOpen && <NewProjectDialog onClose={() => setModalOpen(false)} onCreate={addProject} />}
    </div>
  )
}

function NewProjectDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { name: string; path: string; description: string }) => void }) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('C:\\work\\')
  const [description, setDescription] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !path.trim()) return
    onCreate({ name: name.trim(), path: path.trim(), description: description.trim() || 'Sem descrição.' })
    onClose()
  }

  return (
    <Modal title="Novo projeto" eyebrow="PROJECTS" onClose={onClose}>
      <form onSubmit={submit} className="agent-form">
        <div className="form-grid">
          <label>Nome<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Suporte" aria-invalid={submitted && !name.trim()} />{submitted && !name.trim() && <small className="field-error">Informe um nome.</small>}</label>
          <label>Workspace<input value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\work\suporte" aria-invalid={submitted && !path.trim()} />{submitted && !path.trim() && <small className="field-error">Informe o diretório.</small>}</label>
        </div>
        <label className="prompt-field">Descrição<textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="O que esta equipe vai entregar neste projeto?" /></label>
        <footer className="modal-footer"><button className="button button--secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit"><Plus size={15} /> Criar projeto</button></footer>
      </form>
    </Modal>
  )
}
