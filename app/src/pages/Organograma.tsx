import { useCallback, useEffect, useMemo, useRef } from 'react'
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
import { Focus, Settings2, Sparkles, SquareTerminal } from 'lucide-react'
import { AgentNode, type AgentFlowNode } from '@/components/AgentNode'
import { Inspector } from '@/components/Inspector'
import { TerminalPanel } from '@/components/TerminalPanel'
import { useWorkspace } from '@/store/workspace'
import type { Agent, TerminalLine } from '@/types/agent'

const nodeTypes = { agent: AgentNode }

function OrganogramaView() {
  const workspace = useWorkspace()
  const {
    agents, connections, events, selectedId, terminalOpen, terminalExpanded, terminalLines,
    showGrid, showMinimap, setSelectedId, setModal, setTerminalOpen, setTerminalExpanded,
    setAgentPosition, addConnection, togglePause, runCommand, clearTerminal,
  } = workspace
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
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: connection.active ? '#e8862e' : '#62594e' },
  })), [connections])

  const fitCanvas = useCallback(() => {
    flowRef.current?.fitView({ padding: 0.08, duration: 250 })
  }, [])

  // Centraliza no agente quando a seleção muda vindo de outra seção
  useEffect(() => {
    if (!selectedId) return
    const agent = agents.find((item) => item.id === selectedId)
    if (agent) flowRef.current?.setCenter(agent.x + 110, agent.y + 65, { zoom: 1.05, duration: 250 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

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

  const handleNodesChange = (changes: NodeChange<AgentFlowNode>[]) => {
    changes.forEach((change) => {
      if (change.type === 'position' && change.position) setAgentPosition(change.id, change.position.x, change.position.y)
    })
  }

  const handleConnect = (connection: Connection) => {
    if (connection.source && connection.target) addConnection(connection.source, connection.target)
  }

  const hasLiveSessionForTerminal = Boolean(activeTerminalAgent && workspace.liveSessions[activeTerminalAgent.id])
  const currentTerminalLines: TerminalLine[] = activeTerminalAgent ? terminalLines[activeTerminalAgent.id] ?? [
    { id: `welcome-${activeTerminalAgent.id}`, type: 'muted' as const, text: `Terminal de ${activeTerminalAgent.name} · ${activeTerminalAgent.runtime}` },
    {
      id: `mode-${activeTerminalAgent.id}`, type: 'muted' as const,
      text: hasLiveSessionForTerminal
        ? 'Sessão real conectada · a saída do processo aparece aqui.'
        : workspace.serviceOnline
          ? 'Sem sessão ativa · inicie uma sessão real no Inspector ou despache uma tarefa no Work.'
          : 'Serviço local offline · inicie o vertice-core para abrir sessões reais.',
    },
  ] : []

  return (
    <div className="org-layout">
      <main className="canvas-column">
        <div className="canvas-wrap">
          <ReactFlow<AgentFlowNode, Edge>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onInit={(instance) => { flowRef.current = instance }}
            onNodesChange={handleNodesChange}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onConnect={handleConnect}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 0.95 }}
            minZoom={0.3}
            maxZoom={1.6}
            snapToGrid
            snapGrid={[16, 16]}
            defaultEdgeOptions={{ type: 'smoothstep' }}
            connectionLineStyle={{ stroke: '#e8862e', strokeWidth: 1.5 }}
          >
            {showGrid && <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#51483d" />}
            <Controls position="bottom-left" showInteractive={false} />
            {showMinimap && <MiniMap position="bottom-right" pannable zoomable nodeColor={(node) => (node.data as { agent: Agent }).agent.kind === 'manager' ? '#e8862e' : '#5e554a'} maskColor="rgba(21,21,21,.76)" bgColor="#1b1917" />}
          </ReactFlow>
          <div className="canvas-heading">
            <span className="section-label">EQUIPE / ORGANOGRAMA</span>
            <h1>Mapa da equipe</h1>
            <p>{agents.length} agentes <i /> {connections.length} conexões</p>
          </div>
          <div className="canvas-actions">
            <button className="icon-button" onClick={() => setModal('settings')} aria-label="Preferências do organograma" style={{ border: '1px solid var(--border-subtle)', background: 'var(--surface)' }}><Settings2 size={16} /></button>
            <button className="button button--canvas" onClick={fitCanvas}><Focus size={15} /> Enquadrar</button>
            <button className="button button--primary" onClick={() => setModal('manager')}><Sparkles size={15} /> Nova delegação</button>
          </div>
          <div className="canvas-hint">Arraste os nós para organizar <span>·</span> Puxe um ponto para conectar</div>
        </div>
        {terminalOpen && activeTerminalAgent ? (
          <TerminalPanel
            agents={agents}
            activeAgent={activeTerminalAgent}
            workspacePath={workspace.activeProject?.path}
            hasLiveSession={hasLiveSessionForTerminal}
            onRawKey={workspace.sendRawKey}
            getRawOutput={workspace.getRawOutput}
            subscribeRawOutput={workspace.subscribeRawOutput}
            onTerminalResize={workspace.resizeAgentSession}
            lines={currentTerminalLines}
            expanded={terminalExpanded}
            onSelectAgent={(id) => setSelectedId(id)}
            onCommand={runCommand}
            onClear={() => clearTerminal(activeTerminalAgent.id)}
            onToggleExpanded={() => setTerminalExpanded((value) => !value)}
            onClose={() => setTerminalOpen(false)}
          />
        ) : (
          <button className="terminal-reopen" onClick={() => setTerminalOpen(true)}><SquareTerminal size={15} /> Abrir terminal <kbd>T</kbd></button>
        )}
      </main>
      <Inspector
        agent={selectedAgent}
        agents={agents}
        events={events}
        serviceOnline={workspace.serviceOnline}
        workspacePath={workspace.activeProject?.path}
        hasLiveSession={Boolean(selectedAgent && workspace.liveSessions[selectedAgent.id])}
        onStartSession={() => selectedAgent && workspace.startAgentSession(selectedAgent.id)}
        onStopSession={() => selectedAgent && workspace.stopAgentSession(selectedAgent.id)}
        onOpenTerminal={() => setTerminalOpen(true)}
        onTogglePause={() => selectedAgent && togglePause(selectedAgent.id)}
        onRemove={() => setModal('remove')}
        onSelect={(id) => setSelectedId(id)}
        onClose={() => setSelectedId(null)}
        mobileOpen={false}
      />
    </div>
  )
}

export function OrganogramaPage() {
  return (
    <ReactFlowProvider>
      <OrganogramaView />
    </ReactFlowProvider>
  )
}
