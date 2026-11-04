import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { Command, Focus, Menu, Network, Settings2, Sparkles, SquareTerminal } from 'lucide-react'
import { Toaster, toast } from 'sonner'
import { Brand } from '@/components/Brand'
import { AgentNode, type AgentFlowNode } from '@/components/AgentNode'
import { Sidebar } from '@/components/Sidebar'
import { Inspector } from '@/components/Inspector'
import { TerminalPanel } from '@/components/TerminalPanel'
import { CreateAgentDialog, ManagerDialog, RemoveAgentDialog, type NewAgentInput } from '@/components/AgentDialogs'
import { CommandPalette } from '@/components/CommandPalette'
import { Modal } from '@/components/Modal'
import { initialAgents, initialConnections, initialEvents, initialTerminalLines } from '@/data/initial'
import type { Agent, AgentConnection, ActivityEvent, TerminalLine } from '@/types/agent'

const nodeTypes = { agent: AgentNode }
type ModalName = 'create' | 'manager' | 'commands' | 'settings' | 'remove' | null

function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key)
      return saved ? JSON.parse(saved) : fallback
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value))
  }, [key, value])
  return [value, setValue] as const
}

function Workspace() {
  const [agents, setAgents] = usePersistentState<Agent[]>('vertice.agents', initialAgents)
  const [connections, setConnections] = usePersistentState<AgentConnection[]>('vertice.connections', initialConnections)
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents)
  const [selectedId, setSelectedId] = useState<string | null>('gerente')
  const [modal, setModal] = useState<ModalName>(null)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [terminalExpanded, setTerminalExpanded] = useState(false)
  const [terminalLines, setTerminalLines] = useState<Record<string, TerminalLine[]>>({ gerente: initialTerminalLines })
  const [showGrid, setShowGrid] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const flowRef = useRef<ReactFlowInstance<AgentFlowNode, Edge> | null>(null)

  const selectedAgent = selectedId ? agents.find((agent) => agent.id === selectedId) : undefined
  const activeTerminalAgent = selectedAgent ?? agents[0]

  const flowNodes = useMemo<AgentFlowNode[]>(() => agents.map((agent) => ({
    id: agent.id,
    type: 'agent',
    position: { x: agent.x, y: agent.y },
    width: 226,
    height: 137,
    data: { agent },
    selected: agent.id === selectedId,
  })), [agents, selectedId])

  const flowEdges = useMemo<Edge[]>(() => connections.map((connection) => ({
    id: connection.id,
    source: connection.source,
    target: connection.target,
    label: connection.label,
    animated: connection.active,
    className: connection.active ? 'flow-edge flow-edge--active' : 'flow-edge',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: connection.active ? '#d69900' : '#62594e' },
  })), [connections])

  const addEvent = useCallback((agentId: string, message: string, type: ActivityEvent['type']) => {
    setEvents((current) => [{ id: crypto.randomUUID(), agentId, message, time: 'agora', type }, ...current].slice(0, 20))
  }, [])

  const selectAgent = useCallback((id: string, focus = false) => {
    setSelectedId(id)
    setSidebarOpen(false)
    if (window.innerWidth <= 1100) setInspectorOpen(true)
    if (focus) {
      const agent = agents.find((item) => item.id === id)
      if (agent) flowRef.current?.setCenter(agent.x + 110, agent.y + 65, { zoom: 1.05, duration: 250 })
    }
  }, [agents])

  const openTerminal = useCallback(() => {
    setTerminalOpen(true)
    setInspectorOpen(false)
    window.setTimeout(() => document.getElementById('terminal-command')?.focus(), 100)
  }, [])

  const fitCanvas = useCallback(() => {
    flowRef.current?.fitView({ padding: 0.08, duration: 250 })
  }, [])

  const resetDemo = useCallback(() => {
    setAgents(initialAgents)
    setConnections(initialConnections)
    setEvents(initialEvents)
    setTerminalLines({ gerente: initialTerminalLines })
    setSelectedId('gerente')
    setModal(null)
    setTerminalOpen(true)
    toast.success('Demonstração restaurada')
    window.setTimeout(() => flowRef.current?.fitView({ padding: 0.08 }), 80)
  }, [setAgents, setConnections])

  useEffect(() => {
    let resizeTimer: ReturnType<typeof window.setTimeout>
    const onResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => flowRef.current?.fitView({ padding: 0.1, maxZoom: 0.95 }), 160)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', onResize)
    }
  }, [])

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
        openTerminal()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [modal, openTerminal])

  const handleNodesChange = (changes: NodeChange<AgentFlowNode>[]) => {
    const positions = changes.flatMap((change) => change.type === 'position' && change.position ? [{ id: change.id, position: change.position }] : [])
    if (!positions.length) return
    setAgents((current) => current.map((agent) => {
      const update = positions.find((item) => item.id === agent.id)
      return update ? { ...agent, x: update.position.x, y: update.position.y } : agent
    }))
  }

  const handleConnect = (connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    if (connections.some((item) => item.source === connection.source && item.target === connection.target)) {
      toast.info('Estes agentes já estão conectados')
      return
    }
    setConnections((current) => [...current, { id: crypto.randomUUID(), source: connection.source!, target: connection.target!, label: 'vincula' }])
    addEvent(connection.source, `Nova conexão com ${agents.find((a) => a.id === connection.target)?.name}`, 'system')
    toast.success('Conexão criada no mapa')
  }

  const createAgent = (input: NewAgentInput) => {
    const id = `${input.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`
    const workerCount = agents.filter((agent) => agent.kind === 'worker').length
    const agent: Agent = {
      id, name: input.name, role: input.role, kind: 'worker', runtime: input.runtime, model: input.model,
      status: 'idle', task: 'Aguardando primeira tarefa', progress: 0, prompt: input.prompt,
      x: 80 + (workerCount % 3) * 310, y: 560 + Math.floor(workerCount / 3) * 190, createdBy: input.parentId,
    }
    setAgents((current) => [...current, agent])
    setConnections((current) => [...current, { id: crypto.randomUUID(), source: input.parentId, target: id, label: 'delega' }])
    setSelectedId(id)
    setModal(null)
    addEvent(input.parentId, `${agent.name} criado e vinculado ao fluxo`, 'create')
    toast.success(`${agent.name} adicionado ao workspace`)
  }

  const delegateToManager = (objective: string) => {
    const stamp = Date.now().toString(36)
    const manager = agents.find((agent) => agent.kind === 'manager') ?? agents[0]
    const existingNames = new Set(agents.map((agent) => agent.name))
    const uniqueName = (base: string) => {
      if (!existingNames.has(base)) return base
      let index = 2
      while (existingNames.has(`${base} ${index}`)) index += 1
      return `${base} ${index}`
    }
    const templates = [
      { name: 'Estrategista', role: 'Estratégia e decomposição', runtime: 'Claude Code', model: 'claude-sonnet', task: 'Decompondo o objetivo em entregas', prompt: `Decomponha este objetivo em entregas coordenáveis: ${objective}` },
      { name: 'Analista', role: 'Análise e contexto', runtime: 'Ollama', model: 'qwen3:14b', task: 'Analisando contexto e restrições', prompt: `Analise contexto, dados e restrições para: ${objective}` },
      { name: 'Executor', role: 'Execução da entrega', runtime: 'Codex CLI', model: 'gpt-codex', task: 'Preparando o plano de execução', prompt: `Execute a entrega principal e reporte o resultado para: ${objective}` },
    ]
    const startIndex = agents.filter((agent) => agent.kind === 'worker').length
    const newAgents: Agent[] = templates.map((template, index) => ({
      ...template, id: `${template.name.toLowerCase()}-${stamp}-${index}`, name: uniqueName(template.name), kind: 'worker',
      status: index === 0 ? 'working' : 'queued', progress: index === 0 ? 8 : 0,
      x: 30 + ((startIndex + index) % 3) * 315, y: 570 + Math.floor((startIndex + index) / 3) * 195, createdBy: manager.id,
    }))
    setAgents((current) => [...current.map((agent) => agent.id === manager.id ? { ...agent, status: 'working' as const, task: objective, progress: 12 } : agent), ...newAgents])
    setConnections((current) => [...current, ...newAgents.map((agent) => ({ id: crypto.randomUUID(), source: manager.id, target: agent.id, label: 'delega', active: agent.status === 'working' }))])
    addEvent(manager.id, `Equipe de ${newAgents.length} agentes criada para novo objetivo`, 'delegate')
    setSelectedId(manager.id)
    setModal(null)
    setTerminalOpen(true)
    setTerminalLines((current) => ({ ...current, [manager.id]: [...(current[manager.id] ?? []),
      { id: crypto.randomUUID(), type: 'command', text: `vertice delegate "${objective}"` },
      { id: crypto.randomUUID(), type: 'success', text: `✓ Equipe simulada criada: ${newAgents.map((agent) => agent.name).join(', ')}` },
      { id: crypto.randomUUID(), type: 'muted', text: 'Nenhum processo externo foi iniciado.' },
    ] }))
    toast.success('Gerente criou uma equipe de 3 agentes')
    window.setTimeout(() => flowRef.current?.fitView({ padding: 0.16, duration: 250 }), 120)
  }

  const togglePause = () => {
    if (!selectedAgent) return
    const nextStatus: Agent['status'] = selectedAgent.status === 'paused' ? 'idle' : 'paused'
    setAgents((current) => current.map((agent) => agent.id === selectedAgent.id ? { ...agent, status: nextStatus } : agent))
    addEvent(selectedAgent.id, nextStatus === 'paused' ? 'Agente pausado' : 'Agente retomado', 'system')
    toast.success(nextStatus === 'paused' ? `${selectedAgent.name} pausado` : `${selectedAgent.name} disponível`)
  }

  const removeAgent = () => {
    if (!selectedAgent || selectedAgent.kind === 'manager') return
    const removedName = selectedAgent.name
    setAgents((current) => current.filter((agent) => agent.id !== selectedAgent.id))
    setConnections((current) => current.filter((connection) => connection.source !== selectedAgent.id && connection.target !== selectedAgent.id))
    setSelectedId('gerente')
    setModal(null)
    toast.success(`${removedName} removido do mapa`)
  }

  const runCommand = (command: string) => {
    const agent = activeTerminalAgent
    if (!agent) return
    if (command === '/clear') {
      setTerminalLines((current) => ({ ...current, [agent.id]: [] }))
      return
    }
    const lines: TerminalLine[] = [{ id: crypto.randomUUID(), type: 'command', text: command }]
    if (command === '/help') {
      lines.push(
        { id: crypto.randomUUID(), type: 'output', text: '/status   Resume os agentes do workspace' },
        { id: crypto.randomUUID(), type: 'output', text: '/agents   Lista runtimes e estados' },
        { id: crypto.randomUUID(), type: 'output', text: '/create   Abre a criação manual de agente' },
        { id: crypto.randomUUID(), type: 'output', text: '/delegate Abre a orquestração do Gerente' },
        { id: crypto.randomUUID(), type: 'output', text: '/clear    Limpa este terminal' },
      )
    } else if (command === '/status') {
      lines.push({ id: crypto.randomUUID(), type: 'output', text: `${agents.length} agentes · ${agents.filter((a) => a.status === 'working').length} executando · ${agents.filter((a) => a.status === 'paused').length} pausados` })
    } else if (command === '/agents') {
      agents.forEach((item) => lines.push({ id: crypto.randomUUID(), type: 'output', text: `${item.name.padEnd(18)} ${item.runtime.padEnd(14)} ${item.status}` }))
    } else if (command === '/create' || command === '/delegate') {
      lines.push({ id: crypto.randomUUID(), type: 'success', text: command === '/create' ? 'Abrindo configuração manual…' : 'Abrindo delegação ao Gerente…' })
      window.setTimeout(() => setModal(command === '/create' ? 'create' : 'manager'), 120)
    } else {
      lines.push(
        { id: crypto.randomUUID(), type: 'output', text: `Comando registrado para ${agent.name}: ${command}` },
        { id: crypto.randomUUID(), type: 'muted', text: 'Simulação visual: nenhuma CLI ou modelo local foi invocado.' },
      )
    }
    setTerminalLines((current) => ({ ...current, [agent.id]: [...(current[agent.id] ?? []), ...lines] }))
  }

  const currentTerminalLines = activeTerminalAgent ? terminalLines[activeTerminalAgent.id] ?? [
    { id: `welcome-${activeTerminalAgent.id}`, type: 'muted' as const, text: `Terminal visual de ${activeTerminalAgent.name} · ${activeTerminalAgent.runtime}` },
    { id: `mode-${activeTerminalAgent.id}`, type: 'muted' as const, text: 'Modo demonstração · nenhum processo real em execução.' },
  ] : []

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir agentes"><Menu size={19} /></button>
        <Brand />
        <div className="topbar-divider" />
        <div className="topbar-context"><span>WORKSPACE</span><strong>Atlas</strong><small>local</small></div>
        <div className="topbar-spacer" />
        <span className="local-badge"><i /> SIMULAÇÃO LOCAL</span>
        <button className="command-trigger" onClick={() => setModal('commands')}><Command size={14} /><span>Buscar ou comandar</span><kbd>Ctrl K</kbd></button>
        <button className="icon-button" onClick={() => setModal('settings')} aria-label="Configurações do canvas"><Settings2 size={18} /></button>
      </header>

      <div className="app-body">
        <Sidebar agents={agents} selectedId={selectedId} onSelect={(id) => selectAgent(id, true)} onCreate={() => setModal('create')} onManager={() => setModal('manager')} mobileOpen={sidebarOpen} onCloseMobile={() => setSidebarOpen(false)} />
        <main className="canvas-column">
          <div className="canvas-wrap">
            <ReactFlow<AgentFlowNode, Edge>
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onInit={(instance) => { flowRef.current = instance }}
              onNodesChange={handleNodesChange}
              onNodeClick={(_, node) => selectAgent(node.id)}
              onConnect={handleConnect}
              onPaneClick={() => { if (window.innerWidth <= 1100) setInspectorOpen(false) }}
              fitView
              fitViewOptions={{ padding: 0.08, maxZoom: 0.95 }}
              minZoom={0.3}
              maxZoom={1.6}
              snapToGrid
              snapGrid={[16, 16]}
              defaultEdgeOptions={{ type: 'smoothstep' }}
              connectionLineStyle={{ stroke: '#d69900', strokeWidth: 1.5 }}
            >
              {showGrid && <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#51483d" />}
              <Controls position="bottom-left" showInteractive={false} />
              {showMinimap && <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => (node.data as { agent: Agent }).agent.kind === 'manager' ? '#d69900' : '#5e554a'} maskColor="rgba(21,21,21,.76)" bgColor="#1b1917" />}
            </ReactFlow>
            <div className="canvas-heading">
              <span className="section-label">ORQUESTRAÇÃO / MAPA VIVO</span>
              <h1>Mapa de agentes</h1>
              <p>{agents.length} agentes <i /> {connections.length} conexões</p>
            </div>
            <div className="canvas-actions">
              <button className="button button--canvas" onClick={fitCanvas}><Focus size={15} /> Enquadrar</button>
              <button className="button button--primary" onClick={() => setModal('manager')}><Sparkles size={15} /> Nova delegação</button>
            </div>
            <div className="canvas-hint"><Network size={13} /> Arraste os nós para organizar <span>·</span> Puxe um ponto para conectar</div>
          </div>
          {terminalOpen && activeTerminalAgent ? (
            <TerminalPanel agents={agents} activeAgent={activeTerminalAgent} lines={currentTerminalLines} expanded={terminalExpanded} onSelectAgent={(id) => setSelectedId(id)} onCommand={runCommand} onClear={() => setTerminalLines((current) => ({ ...current, [activeTerminalAgent.id]: [] }))} onToggleExpanded={() => setTerminalExpanded((value) => !value)} onClose={() => setTerminalOpen(false)} />
          ) : (
            <button className="terminal-reopen" onClick={openTerminal}><SquareTerminal size={15} /> Abrir terminal <kbd>T</kbd></button>
          )}
        </main>
        <Inspector agent={selectedAgent} agents={agents} events={events} onOpenTerminal={openTerminal} onTogglePause={togglePause} onRemove={() => setModal('remove')} onSelect={(id) => selectAgent(id, true)} onClose={() => { if (window.innerWidth <= 1100) setInspectorOpen(false); else setSelectedId(null) }} mobileOpen={inspectorOpen} />
      </div>

      <footer className="statusbar">
        <span><i className="status-dot status-dot--idle" /> Ambiente visual</span>
        <span>Windows · PowerShell</span>
        <span className="statusbar-center">Autonomia total em <strong>C:\work\atlas</strong></span>
        <button onClick={() => setTerminalOpen((value) => !value)}><SquareTerminal size={12} /> Terminal</button>
        <span>v0.1 / protótipo</span>
      </footer>

      {modal === 'create' && <CreateAgentDialog agents={agents} onClose={() => setModal(null)} onCreate={createAgent} />}
      {modal === 'manager' && <ManagerDialog onClose={() => setModal(null)} onDelegate={delegateToManager} />}
      {modal === 'commands' && <CommandPalette onClose={() => setModal(null)} onCreate={() => setModal('create')} onManager={() => setModal('manager')} onTerminal={openTerminal} onFit={fitCanvas} onReset={resetDemo} />}
      {modal === 'remove' && selectedAgent && <RemoveAgentDialog agent={selectedAgent} onClose={() => setModal(null)} onConfirm={removeAgent} />}
      {modal === 'settings' && (
        <Modal title="Preferências do canvas" eyebrow="ESTAÇÃO DE TRABALHO" onClose={() => setModal(null)}>
          <div className="settings-list">
            <label><span><strong>Grade de alinhamento</strong><small>Exibe pontos e encaixa os nós na grade.</small></span><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} /></label>
            <label><span><strong>Minimapa</strong><small>Mostra a visão geral e permite navegar.</small></span><input type="checkbox" checked={showMinimap} onChange={(e) => setShowMinimap(e.target.checked)} /></label>
            <div className="settings-scope"><span>PERMISSÃO DO GERENTE</span><strong>Autonomia total no workspace</strong><small>Escopo definido para este protótipo: C:\work\atlas</small></div>
          </div>
          <footer className="modal-footer"><button className="button button--secondary" onClick={resetDemo}>Restaurar demonstração</button><button className="button button--primary" onClick={() => setModal(null)}>Concluir</button></footer>
        </Modal>
      )}
      <Toaster position="bottom-center" toastOptions={{ className: 'vertice-toast' }} />
    </div>
  )
}

export default function App() {
  return <ReactFlowProvider><Workspace /></ReactFlowProvider>
}
