import { useEffect } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router'
import { Building2, ClipboardList, Command, FolderKanban, Network, SquareTerminal, Trash2, Users } from 'lucide-react'
import { Toaster } from 'sonner'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { Brand } from '@/components/Brand'
import { CreateAgentDialog, ManagerDialog, RemoveAgentDialog } from '@/components/AgentDialogs'
import { CommandPalette } from '@/components/CommandPalette'
import { Modal } from '@/components/Modal'
import { WorkspaceProvider, useWorkspace } from '@/store/workspace'
import { AgentesPage } from '@/pages/Agentes'
import { WorkPage } from '@/pages/Work'
import { ProjectsPage } from '@/pages/Projects'
import { OrganogramaPage } from '@/pages/Organograma'
import { OrgPage } from '@/pages/Org'

const navItems = [
  { to: '/agentes', label: 'Agentes', icon: Users, hint: 'A equipe' },
  { to: '/work', label: 'Work', icon: ClipboardList, hint: 'Tarefas e metas' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, hint: 'Projetos' },
  { to: '/organograma', label: 'Organograma', icon: Network, hint: 'Mapa da equipe' },
  { to: '/org', label: "CLI's", icon: Building2, hint: 'CLIs e políticas' },
]

function Shell() {
  const workspace = useWorkspace()
  const navigate = useNavigate()
  const { agents, modal, selectedId, activeProject, setModal, setTerminalOpen, setShowGrid, setShowMinimap, createAgent, delegateToManager, removeAgent, resetDemo, clearWorkspace, showGrid, showMinimap } = workspace
  const selectedAgent = selectedId ? agents.find((agent) => agent.id === selectedId) : undefined

  const goTerminal = () => {
    setTerminalOpen(true)
    navigate('/organograma')
    window.setTimeout(() => document.getElementById('terminal-command')?.focus(), 150)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setModal('commands')
      } else if (!isTyping && !modal && event.key.toLowerCase() === 'g') {
        setModal('manager')
      } else if (!isTyping && !modal && event.key.toLowerCase() === 't') {
        goTerminal()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="app-shell">
      <header className="topbar">
        <Brand />
        <div className="topbar-divider" />
        <div className="topbar-context"><span>PROJETO</span><strong>{activeProject?.name ?? '—'}</strong><small>{activeProject?.path}</small></div>
        <div className="topbar-spacer" />
        <span className={`local-badge ${workspace.serviceOnline ? 'local-badge--online' : ''}`}><i /> {workspace.serviceOnline ? 'AMBIENTE REAL · vertice-core' : 'AMBIENTE DE DEMONSTRAÇÃO'}</span>
        <button className="command-trigger" onClick={() => setModal('commands')}><Command size={14} /><span>Buscar ou comandar</span><kbd>Ctrl K</kbd></button>
      </header>

      <div className="shell-body">
        <nav className="nav-rail" aria-label="Seções do Vértice">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
              <item.icon size={17} strokeWidth={1.8} />
              <span className="nav-item__text"><strong>{item.label}</strong><small>{item.hint}</small></span>
            </NavLink>
          ))}
          <div className="nav-rail__spacer" />
          <button className="nav-item nav-item--button" onClick={goTerminal}>
            <SquareTerminal size={17} strokeWidth={1.8} />
            <span className="nav-item__text"><strong>Terminal</strong><small>Modo avançado</small></span>
            <kbd>T</kbd>
          </button>
        </nav>

        <main className="page-host">
          <Routes>
            <Route path="/" element={<Navigate to="/agentes" replace />} />
            <Route path="/agentes" element={<AgentesPage />} />
            <Route path="/work" element={<WorkPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/organograma" element={<OrganogramaPage />} />
            <Route path="/org" element={<OrgPage />} />
            <Route path="*" element={<Navigate to="/agentes" replace />} />
          </Routes>
        </main>
      </div>

      <footer className="statusbar">
        <span><i className={`status-dot ${workspace.serviceOnline ? 'status-dot--idle' : 'status-dot--paused'}`} /> {workspace.serviceOnline ? 'Serviço local conectado' : 'Serviço local offline · dados simulados'}</span>
        <span>Windows · vertice-core :7845</span>
        <span className="statusbar-center">Autonomia total em <strong>{activeProject?.path ?? 'workspace'}</strong></span>
        <span>v0.2 / estrutura</span>
      </footer>

      {modal === 'create' && <CreateAgentDialog agents={agents} serviceOnline={workspace.serviceOnline} scopePath={activeProject?.path} onClose={() => setModal(null)} onCreate={createAgent} />}
      {modal === 'manager' && <ManagerDialog serviceOnline={workspace.serviceOnline} onClose={() => setModal(null)} onDelegate={delegateToManager} />}
      {modal === 'commands' && (
        <CommandPalette
          onClose={() => setModal(null)}
          onCreate={() => setModal('create')}
          onManager={() => setModal('manager')}
          onTerminal={goTerminal}
          onFit={() => navigate('/organograma')}
          onReset={resetDemo}
          onClear={() => setModal('clear')}
        />
      )}
      {modal === 'clear' && (
        <Modal title="Limpar o workspace?" eyebrow="OPERAR DO ZERO" onClose={() => setModal(null)}>
          <div className="confirm-copy">
            <p>Isto apaga todos os <strong>agentes, projetos, metas, tarefas, conexões e eventos</strong> e encerra as sessões em andamento. Os arquivos das pastas dos projetos no disco <strong>não</strong> são apagados.</p>
            <p>A aba CLI's (aprovações e políticas) é mantida.</p>
          </div>
          <footer className="modal-footer"><button className="button button--secondary" onClick={() => setModal(null)}>Cancelar</button><button className="button button--danger-solid" onClick={() => void clearWorkspace()}><Trash2 size={15} /> Limpar workspace</button></footer>
        </Modal>
      )}
      {modal === 'remove' && selectedAgent && <RemoveAgentDialog agent={selectedAgent} onClose={() => setModal(null)} onConfirm={() => removeAgent(selectedAgent.id)} />}
      {modal === 'settings' && (
        <Modal title="Preferências do organograma" eyebrow="VISUALIZAÇÃO" onClose={() => setModal(null)}>
          <div className="settings-list">
            <label><span><strong>Grade de alinhamento</strong><small>Exibe pontos e encaixa os nós na grade.</small></span><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /></label>
            <label><span><strong>Minimapa</strong><small>Mostra a visão geral e permite navegar.</small></span><input type="checkbox" checked={showMinimap} onChange={(e) => setShowMinimap(e.target.checked)} /></label>
            <div className="settings-scope"><span>PERMISSÃO DO GERENTE</span><strong>Autonomia total no workspace</strong><small>Escopo confinado ao workspace do projeto ativo: {activeProject?.path ?? 'nenhum projeto ativo (crie um na aba Projects)'}</small></div>
          </div>
          <footer className="modal-footer"><button className="button button--secondary" onClick={resetDemo}>Carregar demonstração</button><button className="button button--danger-solid" onClick={() => setModal('clear')}><Trash2 size={15} /> Limpar workspace</button><button className="button button--primary" onClick={() => setModal(null)}>Concluir</button></footer>
        </Modal>
      )}
      <Toaster position="bottom-center" toastOptions={{ className: 'vertice-toast' }} />
    </div>
  )
}

export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  )
}
