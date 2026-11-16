import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
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
import { Check, Focus, Settings2, SquareTerminal, Trash2, X } from 'lucide-react'
import { AgentNode, type AgentFlowNode } from '@/components/AgentNode'
import { Inspector } from '@/components/Inspector'
import { TerminalPanel } from '@/components/TerminalPanel'
import { useWorkspace } from '@/store/workspace'
import type { Agent, ConnectionHandle, TerminalLine } from '@/types/agent'

const nodeTypes = { agent: AgentNode }

const HANDLE_IDS: ConnectionHandle[] = ['top', 'right', 'bottom', 'left']
const asHandle = (value: string | null | undefined): ConnectionHandle | undefined =>
  HANDLE_IDS.includes(value as ConnectionHandle) ? (value as ConnectionHandle) : undefined

function OrganogramaView() {
  const workspace = useWorkspace()
  const {
    agents, connections, events, selectedId, terminalOpen, terminalExpanded, terminalLines,
    showGrid, showMinimap, setSelectedId, setModal, setTerminalOpen, setTerminalExpanded,
    setAgentPosition, addConnection, updateConnectionLabel, removeConnection, togglePause, runCommand, clearTerminal,
  } = workspace
  const flowRef = useRef<ReactFlowInstance<AgentFlowNode, Edge> | null>(null)
  // Linha clicada no organograma: abre o editor de rótulo (G1).
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const selectedEdge = selectedEdgeId ? connections.find((item) => item.id === selectedEdgeId) : undefined

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
    // Pinos gravados (G1); sem pino gravado, o React Flow escolhe o ponto automaticamente.
    sourceHandle: connection.sourceHandle ?? null,
    targetHandle: connection.targetHandle ?? null,
    label: connection.label,
    selected: connection.id === selectedEdgeId,
    animated: true,
    className: connection.active ? 'flow-edge flow-edge--active' : 'flow-edge',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: connection.active ? '#e8862e' : '#4d9aff' },
  })), [connections, selectedEdgeId])

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
    if (!connection.source || !connection.target) return
    addConnection(connection.source, connection.target, {
      sourceHandle: asHandle(connection.sourceHandle),
      targetHandle: asHandle(connection.targetHandle),
    })
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
            connectionMode={ConnectionMode.Loose}
            onInit={(instance) => { flowRef.current = instance }}
            onNodesChange={handleNodesChange}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onConnect={handleConnect}
            onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
            onPaneClick={() => setSelectedEdgeId(null)}
            onEdgeDoubleClick={(_, edge) => { setSelectedEdgeId(null); removeConnection(edge.id) }}
            onEdgesDelete={(deleted) => deleted.forEach((edge) => removeConnection(edge.id))}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 0.95 }}
            minZoom={0.3}
            maxZoom={1.6}
            snapToGrid
            snapGrid={[16, 16]}
            defaultEdgeOptions={{ type: 'default' }}
            connectionLineStyle={{ stroke: '#4d9aff', strokeWidth: 2, strokeDasharray: '6 4' }}
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
          </div>
          {selectedEdge && (
            <EdgeEditor
              key={selectedEdge.id}
              label={selectedEdge.label ?? ''}
              sourceName={agents.find((agent) => agent.id === selectedEdge.source)?.name ?? selectedEdge.source}
              targetName={agents.find((agent) => agent.id === selectedEdge.target)?.name ?? selectedEdge.target}
              onSave={async (label) => { if (await updateConnectionLabel(selectedEdge.id, label)) setSelectedEdgeId(null) }}
              onRemove={() => { removeConnection(selectedEdge.id); setSelectedEdgeId(null) }}
              onClose={() => setSelectedEdgeId(null)}
            />
          )}
          <div className="canvas-hint">Arraste os nós para organizar <span>·</span> Puxe qualquer ponto lateral para conectar <span>·</span> Clique na linha para editar o rótulo</div>
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
            onRestartSession={() => workspace.restartAgentSession(activeTerminalAgent.id)}
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
        connections={connections}
        events={events}
        serviceOnline={workspace.serviceOnline}
        workspacePath={workspace.activeProject?.path}
        hasLiveSession={Boolean(selectedAgent && workspace.liveSessions[selectedAgent.id])}
        onStartSession={() => selectedAgent && workspace.startAgentSession(selectedAgent.id)}
        onStopSession={() => selectedAgent && workspace.stopAgentSession(selectedAgent.id)}
        onOpenTerminal={() => setTerminalOpen(true)}
        onTogglePause={() => selectedAgent && togglePause(selectedAgent.id)}
        onEdit={() => setModal('edit')}
        onRemove={() => setModal('remove')}
        onSaveMemory={(memory) => (selectedAgent ? workspace.saveAgentMemory(selectedAgent.id, memory) : Promise.resolve(false))}
        onClearMemory={() => (selectedAgent ? workspace.clearAgentMemory(selectedAgent.id) : Promise.resolve(false))}
        onSendMessage={(targetId, message) => (selectedAgent ? workspace.sendAgentMessage(selectedAgent.id, targetId, message) : Promise.resolve(false))}
        onSelect={(id) => setSelectedId(id)}
        onClose={() => setSelectedId(null)}
        mobileOpen={false}
      />
    </div>
  )
}

/** Editor da linha selecionada: rótulo (ex.: "revisa", "entrega para") e remoção. */
function EdgeEditor({ label, sourceName, targetName, onSave, onRemove, onClose }: {
  label: string
  sourceName: string
  targetName: string
  onSave: (label: string) => Promise<void>
  onRemove: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(label)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (saving) return
    setSaving(true)
    await onSave(draft)
    setSaving(false)
  }
  return (
    <div className="edge-editor" role="dialog" aria-label="Editar conexão">
      <span className="edge-editor__route">{sourceName} → {targetName}</span>
      <input
        autoFocus
        value={draft}
        maxLength={60}
        placeholder="Rótulo da conexão (ex.: revisa)"
        aria-label="Rótulo da conexão"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); void save() }
          if (event.key === 'Escape') { event.preventDefault(); onClose() }
        }}
      />
      <button className="icon-button icon-button--small" onClick={() => void save()} disabled={saving} title="Salvar rótulo" aria-label="Salvar rótulo"><Check size={14} /></button>
      <button className="icon-button icon-button--small icon-button--danger" onClick={onRemove} title="Remover conexão" aria-label="Remover conexão"><Trash2 size={14} /></button>
      <button className="icon-button icon-button--small" onClick={onClose} title="Fechar" aria-label="Fechar editor da conexão"><X size={14} /></button>
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
