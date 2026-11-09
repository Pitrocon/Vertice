import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { api, connectEvents, stripAnsi, type DetectedRuntime, type LiveSessionInfo, type WorkspaceSnapshot, type VerticeSettings, type AllowedWorkspace } from '@/lib/api'
import {
  initialAgents, initialConnections, initialEvents, initialTerminalLines,
  initialGoals, initialWorkItems, initialProjects, initialCliRuntimes,
} from '@/data/initial'
import type {
  Agent, AgentConnection, ActivityEvent, TerminalLine,
  Goal, WorkItem, Project, CliRuntime, WorkStatus,
} from '@/types/agent'
import type { NewAgentInput } from '@/components/AgentDialogs'

export type ModalName = 'create' | 'manager' | 'commands' | 'settings' | 'remove' | 'clear' | null

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

interface WorkspaceValue {
  agents: Agent[]
  connections: AgentConnection[]
  events: ActivityEvent[]
  selectedId: string | null
  modal: ModalName
  terminalOpen: boolean
  terminalExpanded: boolean
  terminalLines: Record<string, TerminalLine[]>
  showGrid: boolean
  showMinimap: boolean
  goals: Goal[]
  workItems: WorkItem[]
  projects: Project[]
  activeProject: Project
  cliRuntimes: CliRuntime[]
  setSelectedId: (id: string | null) => void
  setModal: (modal: ModalName) => void
  setTerminalOpen: (open: boolean) => void
  setTerminalExpanded: (expanded: boolean | ((value: boolean) => boolean)) => void
  setShowGrid: (show: boolean) => void
  setShowMinimap: (show: boolean) => void
  setAgentPosition: (id: string, x: number, y: number) => void
  addConnection: (source: string, target: string) => void
  createAgent: (input: NewAgentInput) => void
  delegateToManager: (objective: string) => void
  togglePause: (id: string) => void
  removeAgent: (id: string) => void
  runCommand: (command: string) => void
  sendRawKey: (data: string) => void
  resizeAgentSession: (agentId: string, cols: number, rows: number) => void
  getRawOutput: (agentId: string) => string
  subscribeRawOutput: (listener: RawOutputListener) => () => void
  clearTerminal: (agentId: string) => void
  resetDemo: () => void
  clearWorkspace: () => Promise<void>
  moveWorkItem: (id: string, status: WorkStatus) => void
  addWorkItem: (input: { title: string; assigneeId?: string; goalId?: string; priority: WorkItem['priority'] }) => void
  addGoal: (input: { title: string; description: string }) => void
  addProject: (input: { name: string; path: string; description: string }) => void
  setActiveProject: (id: string) => void
  checkCli: (id: string) => void
  installCli: (id: string) => void
  toggleCliApproved: (id: string) => void
  settings: VerticeSettings | null
  allowedWorkspaces: AllowedWorkspace[]
  updatePolicies: (policies: Partial<VerticeSettings['policies']>) => void
  dispatchWorkItem: (id: string) => Promise<void>
  completeWorkItem: (id: string, result?: string) => Promise<void>
  serviceOnline: boolean
  realRuntimes: DetectedRuntime[] | null
  liveSessions: Record<string, LiveSessionInfo>
  refreshService: () => Promise<void>
  startAgentSession: (agentId: string) => Promise<void>
  stopAgentSession: (agentId: string) => Promise<void>
  installCliReal: (runtimeId: string) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

// Limite da saída bruta guardada por agente (caracteres) para replay no xterm.
const MAX_RAW_OUTPUT = 200_000
// `data === null` significa "sessão nova: limpar o terminal".
export type RawOutputListener = (agentId: string, data: string | null) => void

// Comandos internos do terminal do Vértice; nunca são repassados à sessão real.
const RESERVED_COMMANDS = new Set(['/help', '/status', '/agents', '/create', '/delegate', '/clear'])

const RUNTIME_NAME_TO_ID: Record<string, string> = {
  'Claude Code': 'claude', 'Codex CLI': 'codex', 'Kimi CLI': 'kimi', 'GLM CLI': 'glm', 'GLM CLI (Z.ai)': 'glm', 'Antigravity CLI': 'antigravity',
  OpenCode: 'opencode', Ollama: 'ollama', 'LM Studio': 'lmstudio', PowerShell: 'powershell',
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = usePersistentState<Agent[]>('vertice.agents', initialAgents)
  const [connections, setConnections] = usePersistentState<AgentConnection[]>('vertice.connections', initialConnections)
  const [goals, setGoals] = usePersistentState<Goal[]>('vertice.goals', initialGoals)
  const [workItems, setWorkItems] = usePersistentState<WorkItem[]>('vertice.workItems', initialWorkItems)
  const [projects, setProjects] = usePersistentState<Project[]>('vertice.projects', initialProjects)
  const [events, setEvents] = useState<ActivityEvent[]>(initialEvents)
  const [selectedId, setSelectedId] = useState<string | null>('gerente')
  const [modal, setModal] = useState<ModalName>(null)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [terminalExpanded, setTerminalExpanded] = useState(false)
  const [terminalLines, setTerminalLines] = useState<Record<string, TerminalLine[]>>({ gerente: initialTerminalLines })
  const [showGrid, setShowGrid] = useState(true)
  const [showMinimap, setShowMinimap] = useState(true)
  const [cliRuntimes, setCliRuntimes] = useState<CliRuntime[]>(initialCliRuntimes)
  const [serviceOnline, setServiceOnline] = useState(false)
  const [realRuntimes, setRealRuntimes] = useState<DetectedRuntime[] | null>(null)
  const [liveSessions, setLiveSessions] = useState<Record<string, LiveSessionInfo>>({})
  const [settings, setSettings] = useState<VerticeSettings | null>(null)
  const [allowedWorkspaces, setAllowedWorkspaces] = useState<AllowedWorkspace[]>([])
  const wsRef = useRef<WebSocket | null>(null)

  const applySnapshot = useCallback((snapshot: WorkspaceSnapshot | null) => {
    if (!snapshot) return
    setProjects(snapshot.projects)
    setAgents(snapshot.agents)
    setConnections(snapshot.connections)
    setGoals(snapshot.goals)
    setWorkItems(snapshot.workItems)
    // Lista vazia também é um estado válido (workspace limpo): sempre sobrescreve os eventos.
    if (snapshot.events) setEvents(snapshot.events)
    // Mantém a seleção se o agente ainda existe; senão seleciona o primeiro (ou ninguém).
    setSelectedId((current) => (current && snapshot.agents.some((agent) => agent.id === current) ? current : (snapshot.agents[0]?.id ?? null)))
    // Sem agentes não há terminais: descarta linhas de demonstração de agentes que não existem mais.
    if (snapshot.agents.length === 0) setTerminalLines({})
    if (snapshot.settings) setSettings(snapshot.settings)
    if (snapshot.allowedWorkspaces) setAllowedWorkspaces(snapshot.allowedWorkspaces)
  }, [setProjects, setAgents, setConnections, setGoals, setWorkItems])

  // Saída BRUTA (com ANSI) por agente, para o emulador de terminal (xterm.js).
  // Guardada em ref (não em state) para não re-renderizar a cada chunk do PTY.
  const rawOutputRef = useRef<Record<string, { chunks: string[]; size: number }>>({})
  const rawListenersRef = useRef<Set<RawOutputListener>>(new Set())

  const pushRawOutput = useCallback((agentId: string, data: string) => {
    const entry = rawOutputRef.current[agentId] ?? (rawOutputRef.current[agentId] = { chunks: [], size: 0 })
    entry.chunks.push(data)
    entry.size += data.length
    // Descarta os chunks mais antigos acima do limite (mantém ao menos o último).
    while (entry.size > MAX_RAW_OUTPUT && entry.chunks.length > 1) {
      entry.size -= entry.chunks.shift()!.length
    }
    rawListenersRef.current.forEach((listener) => listener(agentId, data))
  }, [])

  const resetRawOutput = useCallback((agentId: string) => {
    delete rawOutputRef.current[agentId]
    rawListenersRef.current.forEach((listener) => listener(agentId, null))
  }, [])

  const getRawOutput = useCallback((agentId: string) => (rawOutputRef.current[agentId]?.chunks.join('') ?? ''), [])

  const subscribeRawOutput = useCallback((listener: RawOutputListener) => {
    rawListenersRef.current.add(listener)
    return () => { rawListenersRef.current.delete(listener) }
  }, [])

  const appendSessionOutput = useCallback((agentId: string, data: string) => {
    const clean = stripAnsi(data)
    const textLines = clean.split('\n').map((line) => line.trimEnd()).filter((line) => line.length > 0)
    if (!textLines.length) return
    setTerminalLines((current) => {
      const existing = current[agentId] ?? []
      const merged = [...existing, ...textLines.map((text) => ({ id: crypto.randomUUID(), type: 'output' as const, text }))]
      return { ...current, [agentId]: merged.slice(-300) }
    })
  }, [])

  const refreshService = useCallback(async () => {
    const online = await api.health()
    setServiceOnline(online)
    if (online) {
      // Workspace primeiro (rápido); a detecção de CLIs (lenta, sem cache) chega depois.
      applySnapshot(await api.getWorkspace())
      const detected = await api.runtimes(true)
      if (detected) setRealRuntimes(detected)
    }
  }, [applySnapshot])

  useEffect(() => {
    let mounted = true
    const boot = async () => {
      const online = await api.health()
      if (!mounted) return
      setServiceOnline(online)
      if (!online) return
      // Workspace e WebSocket primeiro: a detecção de CLIs é lenta e não pode bloquear a tela.
      const snapshot = await api.getWorkspace()
      if (!mounted) return
      applySnapshot(snapshot)
      void api.runtimes().then((detected) => { if (mounted && detected) setRealRuntimes(detected) })
      wsRef.current = connectEvents((event) => {
        if (event.type === 'output') {
          const data = String(event.data ?? '')
          pushRawOutput(String(event.agentId), data)
          appendSessionOutput(String(event.agentId), data)
        } else if (event.type === 'session-started' && event.id && event.agentId) {
          // Sessões abertas pelo core (ex.: despacho de tarefa) também ficam "vivas" na UI.
          const agentId = String(event.agentId)
          resetRawOutput(agentId)
          setLiveSessions((current) => ({
            ...current,
            [agentId]: {
              id: String(event.id), agentId, command: String(event.command ?? ''),
              cwd: String(event.cwd ?? ''), mode: event.mode === 'pipe' ? 'pipe' : 'pty',
            },
          }))
        } else if ((event.type === 'workspace-updated' || event.type === 'task-updated') && event.snapshot) {
          const snapshot = event.snapshot as WorkspaceSnapshot
          // `auto`: a IA concluiu a tarefa (detecção do core). Conclusões manuais não geram este aviso.
          if (event.type === 'task-updated' && event.auto === true) {
            const finished = snapshot.workItems.find((item) => item.id === event.workItemId)
            toast.success(finished ? `Tarefa concluída pela IA → Aguardando aprovação: ${finished.title}` : 'Tarefa concluída pela IA → Aguardando aprovação')
          }
          applySnapshot(snapshot)
        } else if (event.type === 'exit' || event.type === 'session-ended') {
          setLiveSessions((current) => {
            const entry = Object.entries(current).find(([, session]) => session.id === event.sessionId)
            if (!entry) return current
            appendSessionOutput(entry[0], '— sessão encerrada —')
            const next = { ...current }
            delete next[entry[0]]
            return next
          })
        }
      })
    }
    void boot()
    return () => { mounted = false; wsRef.current?.close() }
  }, [appendSessionOutput, applySnapshot, pushRawOutput, resetRawOutput])

  const activeProject = useMemo(() => projects.find((project) => project.active) ?? projects[0], [projects])

  const addEvent = useCallback((agentId: string, message: string, type: ActivityEvent['type']) => {
    setEvents((current) => [{ id: crypto.randomUUID(), agentId, message, time: 'agora', type }, ...current].slice(0, 20))
  }, [])

  const setAgentPosition = useCallback((id: string, x: number, y: number) => {
    setAgents((current) => current.map((agent) => (agent.id === id ? { ...agent, x, y } : agent)))
    if (serviceOnline) void api.patchAgent(id, { x, y })
  }, [setAgents, serviceOnline])

  const addConnection = useCallback((source: string, target: string) => {
    if (!source || !target || source === target) return
    if (connections.some((item) => item.source === source && item.target === target)) {
      toast.info('Estes agentes já estão conectados')
      return
    }
    const conn: AgentConnection = { id: crypto.randomUUID(), source, target, label: 'vincula' }
    setConnections((current) => [...current, conn])
    addEvent(source, `Nova conexão com ${agents.find((a) => a.id === target)?.name}`, 'system')
    if (serviceOnline) void api.createConnection(conn).then(applySnapshot)
    toast.success('Conexão criada no organograma')
  }, [connections, agents, setConnections, addEvent, serviceOnline, applySnapshot])

  const createAgent = useCallback((input: NewAgentInput) => {
    const slug = input.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')
    // Sem supervisor (`parentId` vazio) = agente principal. Só é permitido quando ainda não há gerente.
    const isPrincipal = !input.parentId
    const id = isPrincipal && !agents.some((agent) => agent.id === 'gerente') ? 'gerente' : `${slug}-${Date.now().toString(36)}`
    const workerCount = agents.filter((agent) => agent.kind === 'worker').length
    const agent: Agent = isPrincipal
      ? {
          id, name: input.name, role: input.role, kind: 'manager', runtime: input.runtime, model: input.model,
          status: 'idle', task: 'Aguardando objetivo', progress: 0, prompt: input.prompt, x: 280, y: 0,
        }
      : {
          id, name: input.name, role: input.role, kind: 'worker', runtime: input.runtime, model: input.model,
          status: 'idle', task: 'Aguardando primeira tarefa', progress: 0, prompt: input.prompt,
          x: 80 + (workerCount % 3) * 310, y: 560 + Math.floor(workerCount / 3) * 190, createdBy: input.parentId,
        }
    setAgents((current) => [...current, agent])
    // Agente principal não tem supervisor: não cria conexão (evita aresta órfã para um agente inexistente).
    if (!isPrincipal) {
      setConnections((current) => [...current, { id: crypto.randomUUID(), source: input.parentId, target: id, label: 'delega' }])
    }
    setSelectedId(id)
    setModal(null)
    addEvent(isPrincipal ? id : input.parentId, isPrincipal ? `${input.name} criado como agente principal` : `${input.name} criado e vinculado à equipe`, 'create')
    if (serviceOnline) void api.createAgent({ ...agent, parentId: isPrincipal ? undefined : input.parentId }).then(applySnapshot)
    toast.success(isPrincipal ? `${input.name} criado como agente principal` : `${input.name} adicionado à equipe`)
  }, [agents, setAgents, setConnections, addEvent, serviceOnline, applySnapshot])

  const delegateToManager = useCallback((objective: string) => {
    const stamp = Date.now().toString(36)
    const existingManager = agents.find((agent) => agent.kind === 'manager') ?? agents[0]
    // Workspace do zero (sem agentes): o Gerente padrão é criado junto (no core, ao delegar online).
    const manager: Agent = existingManager ?? {
      id: 'gerente', name: 'Gerente', role: 'Orquestrador principal', kind: 'manager',
      runtime: 'Claude Code', model: 'claude-sonnet', status: 'idle', task: 'Aguardando objetivo', progress: 0,
      prompt: 'Coordene a equipe, divida objetivos em tarefas e crie especialistas quando necessário.', x: 280, y: 0,
    }
    const existingNames = new Set(agents.map((agent) => agent.name))
    const uniqueName = (base: string) => {
      if (!existingNames.has(base)) return base
      let index = 2
      while (existingNames.has(`${base} ${index}`)) index += 1
      return `${base} ${index}`
    }
    const templates = [
      { name: 'Estrategista', role: 'Estratégia e decomposição', runtime: 'Claude Code', model: 'claude-sonnet', task: 'Decompondo o objetivo em entregas', prompt: `Decomponha este objetivo em entregas coordenáveis: ${objective}` },
      { name: 'Analista', role: 'Análise e contexto', runtime: 'Kimi CLI', model: 'kimi-k2', task: 'Analisando contexto e restrições', prompt: `Analise contexto, dados e restrições para: ${objective}` },
      { name: 'Executor', role: 'Execução da entrega', runtime: 'Codex CLI', model: 'gpt-codex', task: 'Preparando o plano de execução', prompt: `Execute a entrega principal e reporte o resultado para: ${objective}` },
    ]
    const startIndex = agents.filter((agent) => agent.kind === 'worker').length
    const newAgents: Agent[] = templates.map((template, index) => ({
      ...template, id: `${template.name.toLowerCase()}-${stamp}-${index}`, name: uniqueName(template.name), kind: 'worker' as const,
      status: index === 0 ? 'working' as const : 'queued' as const, progress: index === 0 ? 8 : 0,
      x: 30 + ((startIndex + index) % 3) * 315, y: 570 + Math.floor((startIndex + index) / 3) * 195, createdBy: manager.id,
    }))
    const newConnections: AgentConnection[] = newAgents.map((agent) => ({
      id: crypto.randomUUID(), source: manager.id, target: agent.id, label: 'delega', active: agent.status === 'working',
    }))

    if (serviceOnline) {
      // ONLINE: orquestração REAL. O core cria subagentes + conexões + tarefas
      // reais (validando runtime aprovado e limite). As sessões só iniciam quando
      // cada tarefa é despachada no Work — por isso a mensagem é honesta.
      void api.orchestratorDelegate({
        managerId: manager.id,
        objective,
        team: templates.map((template) => ({
          name: uniqueName(template.name), role: template.role,
          runtime: template.runtime, model: template.model, prompt: template.prompt,
        })),
      }).then((res) => {
        if (!res || !res.ok) {
          setTerminalLines((current) => ({
            ...current, [manager.id]: [...(current[manager.id] ?? []),
              { id: crypto.randomUUID(), type: 'command', text: `vertice delegate "${objective}"` },
              { id: crypto.randomUUID(), type: 'muted', text: 'Falha ao delegar: verifique runtimes aprovados e o limite de agentes nas CLIs.' },
            ],
          }))
          toast.error('Não foi possível criar a equipe (ver aprovações de CLI)')
          return
        }
        applySnapshot(res.snapshot)
        setTerminalLines((current) => ({
          ...current, [manager.id]: [...(current[manager.id] ?? []),
            { id: crypto.randomUUID(), type: 'command', text: `vertice delegate "${objective}"` },
            { id: crypto.randomUUID(), type: 'success', text: `✓ ${res.created.length} subagente(s) real(is) criado(s) e registrado(s) no workspace.` },
            { id: crypto.randomUUID(), type: 'muted', text: 'As sessões iniciam ao despachar cada tarefa no quadro Work.' },
          ],
        }))
        addEvent(manager.id, `Gerente criou ${res.created.length} subagente(s) real(is) para: ${objective}`, 'delegate')
        toast.success(`Gerente criou ${res.created.length} subagente(s) real(is)`)
      })
    } else {
      // OFFLINE: demonstração visual, claramente rotulada como simulação.
      setAgents((currentAgents) => [
        ...(existingManager ? currentAgents : [manager, ...currentAgents]).map((agent) => agent.id === manager.id ? { ...agent, status: 'working' as const, task: objective, progress: 12 } : agent),
        ...newAgents,
      ])
      setConnections((current) => [...current, ...newConnections])
      setTerminalLines((current) => ({
        ...current, [manager.id]: [...(current[manager.id] ?? []),
          { id: crypto.randomUUID(), type: 'command', text: `vertice delegate "${objective}"` },
          { id: crypto.randomUUID(), type: 'success', text: `✓ Equipe simulada criada: ${newAgents.map((agent) => agent.name).join(', ')}` },
          { id: crypto.randomUUID(), type: 'muted', text: 'Demonstração offline · nenhum processo externo foi iniciado. Inicie o vertice-core para orquestração real.' },
        ],
      }))
      addEvent(manager.id, `Equipe simulada de ${newAgents.length} agentes criada (offline)`, 'delegate')
      toast.success('Equipe simulada criada (offline)')
    }
    setSelectedId(manager.id)
    setModal(null)
    setTerminalOpen(true)
  }, [agents, setAgents, setConnections, addEvent, setTerminalLines, setSelectedId, setModal, setTerminalOpen, serviceOnline, applySnapshot])

  const togglePause = useCallback((id: string) => {
    const target = agents.find((agent) => agent.id === id)
    if (!target) return
    const nextStatus: Agent['status'] = target.status === 'paused' ? 'idle' : 'paused'
    setAgents((current) => current.map((agent) => (agent.id === id ? { ...agent, status: nextStatus } : agent)))
    addEvent(id, nextStatus === 'paused' ? 'Agente pausado' : 'Agente retomado', 'system')
    if (serviceOnline) void api.patchAgent(id, { status: nextStatus }).then(applySnapshot)
    toast.success(nextStatus === 'paused' ? `${target.name} pausado` : `${target.name} disponível`)
  }, [agents, setAgents, addEvent, serviceOnline, applySnapshot])

  const removeAgent = useCallback((id: string) => {
    const target = agents.find((agent) => agent.id === id)
    if (!target || target.kind === 'manager') return
    setConnections((current) => current.filter((connection) => connection.source !== id && connection.target !== id))
    setAgents((current) => current.filter((agent) => agent.id !== id))
    if (serviceOnline) void api.deleteAgent(id).then(applySnapshot)
    toast.success(`${target.name} removido da equipe`)
    setSelectedId(agents.find((agent) => agent.kind === 'manager')?.id ?? null)
    setModal(null)
  }, [agents, setAgents, setConnections, serviceOnline, applySnapshot])

  const runCommand = useCallback((command: string) => {
    const agent = agents.find((item) => item.id === selectedId) ?? agents[0]
    if (!agent) return
    if (command === '/clear') {
      setTerminalLines((current) => ({ ...current, [agent.id]: [] }))
      return
    }
    // Com sessão real viva, tudo vai para a CLI, exceto os comandos internos reservados
    // (assim /login, /trust etc. chegam à CLI em vez de caírem na simulação).
    if (liveSessions[agent.id] && !RESERVED_COMMANDS.has(command)) {
      void api.sendInput(liveSessions[agent.id].id, `${command}\r`)
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
  }, [agents, selectedId, liveSessions])

  // Ajusta o tamanho do PTY quando o emulador (xterm) muda de dimensões.
  const resizeAgentSession = useCallback((agentId: string, cols: number, rows: number) => {
    const session = liveSessions[agentId]
    if (!session || cols < 2 || rows < 1) return
    void api.resizeSession(session.id, cols, rows)
  }, [liveSessions])

  // Envia bytes/sequências ANSI direto ao PTY da sessão viva do agente selecionado,
  // sem "\r" extra (setas, Enter vazio, Esc, Tab, Ctrl+C em menus interativos de CLIs).
  const sendRawKey = useCallback((data: string) => {
    const agent = agents.find((item) => item.id === selectedId) ?? agents[0]
    const session = agent ? liveSessions[agent.id] : undefined
    if (!session) return
    void api.sendInput(session.id, data)
  }, [agents, selectedId, liveSessions])

  const clearTerminal = useCallback((agentId: string) => {
    setTerminalLines((current) => ({ ...current, [agentId]: [] }))
  }, [])

  const resetDemo = useCallback(() => {
    setAgents(initialAgents)
    setConnections(initialConnections)
    setGoals(initialGoals)
    setWorkItems(initialWorkItems)
    setProjects(initialProjects)
    setEvents(initialEvents)
    setTerminalLines({ gerente: initialTerminalLines })
    setCliRuntimes(initialCliRuntimes)
    setSelectedId('gerente')
    setModal(null)
    setTerminalOpen(true)
    if (serviceOnline) void api.resetWorkspace().then(applySnapshot)
    toast.success('Demonstração restaurada')
  }, [setAgents, setConnections, setGoals, setWorkItems, setProjects, serviceOnline, applySnapshot])

  // Operar do zero: apaga projetos, agentes, conexões, metas, tarefas, workspaces e eventos.
  // A aba CLI's (aprovações e políticas) é preservada.
  const clearWorkspace = useCallback(async () => {
    setModal(null)
    if (serviceOnline) {
      const snapshot = await api.clearWorkspace()
      if (!snapshot) { toast.error('Não foi possível limpar o workspace'); return }
      applySnapshot(snapshot)
    } else {
      setAgents([])
      setConnections([])
      setGoals([])
      setWorkItems([])
      setProjects([])
    }
    rawOutputRef.current = {}
    setEvents([])
    setLiveSessions({})
    setTerminalLines({})
    setSelectedId(null)
    toast.success('Workspace limpo · você pode começar do zero')
  }, [serviceOnline, applySnapshot, setAgents, setConnections, setGoals, setWorkItems, setProjects])

  const moveWorkItem = useCallback((id: string, status: WorkStatus) => {
    setWorkItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)))
    if (serviceOnline) void api.patchWorkItem(id, { status }).then(applySnapshot)
  }, [setWorkItems, serviceOnline, applySnapshot])

  const addWorkItem = useCallback((input: { title: string; assigneeId?: string; goalId?: string; priority: WorkItem['priority'] }) => {
    const item: WorkItem = { id: crypto.randomUUID(), status: 'todo' as const, ...input }
    setWorkItems((current) => [...current, item])
    if (serviceOnline) void api.createWorkItem(item).then(applySnapshot)
    toast.success('Tarefa criada no quadro')
  }, [setWorkItems, serviceOnline, applySnapshot])

  const addGoal = useCallback((input: { title: string; description: string }) => {
    const goal: Goal = { id: crypto.randomUUID(), ...input }
    setGoals((current) => [...current, goal])
    if (serviceOnline) void api.createGoal(goal).then(applySnapshot)
    toast.success('Meta criada')
  }, [setGoals, serviceOnline, applySnapshot])

  const addProject = useCallback((input: { name: string; path: string; description: string }) => {
    const proj: Project = { id: crypto.randomUUID(), ...input }
    if (serviceOnline) {
      // Online: o core valida o caminho (recusa pastas de sistema), autoriza o workspace e
      // ativa o primeiro projeto. Só aparece na tela se o core aceitar (sem projeto "fantasma").
      void api.createProject(proj).then(({ snapshot, error }) => {
        if (!snapshot) { toast.error(error ?? 'Não foi possível criar o projeto'); return }
        applySnapshot(snapshot)
        toast.success(`Projeto ${input.name} criado`)
      })
      return
    }
    setProjects((current) => [...current, { ...proj, active: current.length === 0 }])
    toast.success(`Projeto ${input.name} criado (offline)`)
  }, [setProjects, serviceOnline, applySnapshot])

  const setActiveProject = useCallback((id: string) => {
    setProjects((current) => current.map((project) => ({ ...project, active: project.id === id })))
    if (serviceOnline) void api.activateProject(id).then(applySnapshot)
    const project = projects.find((item) => item.id === id)
    if (project) toast.success(`Projeto ativo: ${project.name}`)
  }, [setProjects, projects, serviceOnline, applySnapshot])

  const checkCli = useCallback((id: string) => {
    // Verificacao real: re-consulta o serviço local. Offline mantém o aviso de demonstração.
    if (serviceOnline) { void refreshService(); return }
    setCliRuntimes((current) => current.map((cli) => (cli.id === id ? { ...cli, status: cli.version ? 'installed' as const : 'missing' as const } : cli)))
  }, [serviceOnline, refreshService])

  const installCli = useCallback(async (id: string) => {
    if (serviceOnline) {
      const res = await api.installRuntime(id)
      if (res) { applySnapshot(res.snapshot); await refreshService(); toast.success(`${res.runtime?.name ?? id} instalado — versão ${res.runtime?.version ?? 'verificada'}`) }
      else toast.error('Falha na instalação pelo serviço local')
      return
    }
    toast.error('Serviço local offline — não é possível instalar de forma real')
  }, [serviceOnline, applySnapshot, refreshService])

  const startAgentSession = useCallback(async (agentId: string) => {
    const agent = agents.find((item) => item.id === agentId)
    if (!agent) return
    if (!serviceOnline) { toast.error('Serviço local offline — inicie o vertice-core'); return }
    const runtimeId = RUNTIME_NAME_TO_ID[agent.runtime] ?? 'powershell'
    const detected = realRuntimes?.find((item) => item.id === runtimeId)
    if (runtimeId !== 'powershell' && detected && detected.status !== 'installed') {
      toast.error(`${agent.runtime} não está instalado nesta máquina`)
      return
    }
    if (!activeProject) { toast.error('Crie um projeto na aba Projects antes de iniciar uma sessão real'); return }
    const session = await api.createSession({ agentId, runtimeId, cwd: activeProject.path })
    if (!session) { toast.error('Falha ao iniciar a sessão real (verifique se a CLI está aprovada na aba CLI\'s)'); return }
    setLiveSessions((current) => ({ ...current, [agentId]: session }))
    setSelectedId(agentId)
    setTerminalOpen(true)
    setTerminalLines((current) => ({
      ...current, [agentId]: [...(current[agentId] ?? []),
        { id: crypto.randomUUID(), type: 'success', text: `✓ Sessão real iniciada · ${session.command}` },
        { id: crypto.randomUUID(), type: 'muted', text: `modo ${session.mode} · diretório ${session.cwd}` },
      ],
    }))
    toast.success(`Sessão real de ${agent.name} iniciada`)
  }, [agents, serviceOnline, realRuntimes, activeProject])

  const stopAgentSession = useCallback(async (agentId: string) => {
    const session = liveSessions[agentId]
    if (!session) return
    await api.killSession(session.id)
    setLiveSessions((current) => { const next = { ...current }; delete next[agentId]; return next })
    setTerminalLines((current) => ({
      ...current, [agentId]: [...(current[agentId] ?? []), { id: crypto.randomUUID(), type: 'muted', text: 'Sessão encerrada pelo usuário.' }],
    }))
  }, [liveSessions])

  const installCliReal = useCallback(async (runtimeId: string) => {
    const target = realRuntimes?.find((item) => item.id === runtimeId)
    if (!target?.install || !serviceOnline) return
    const installAgentId = `install-${runtimeId}`
    const session = await api.createSession({ agentId: installAgentId, runtimeId: 'powershell', cwd: '' })
    if (!session) { toast.error('Não foi possível abrir o terminal de instalação'); return }
    setLiveSessions((current) => ({ ...current, [installAgentId]: session }))
    setTerminalLines((current) => ({
      ...current, [installAgentId]: [
        { id: crypto.randomUUID(), type: 'muted', text: `Instalando ${target.name} em um terminal real (PowerShell)…` },
        { id: crypto.randomUUID(), type: 'command', text: target.install ?? '' },
      ],
    }))
    await api.sendInput(session.id, `${target.install}\r`)
  }, [realRuntimes, serviceOnline])

  const toggleCliApproved = useCallback((id: string) => {
    setCliRuntimes((current) => current.map((cli) => (cli.id === id ? { ...cli, approved: !cli.approved } : cli)))
    if (serviceOnline) {
      const current = settings?.approvedRuntimes ?? []
      const next = current.includes(id) ? current.filter((r) => r !== id) : [...current, id]
      void api.updateSettings({ approvedRuntimes: next }).then(applySnapshot)
    }
  }, [serviceOnline, settings, applySnapshot])

  const updatePolicies = useCallback((policies: Partial<VerticeSettings['policies']>) => {
    if (!serviceOnline) { toast.error('Serviço local offline — políticas não podem ser salvas'); return }
    void api.updateSettings({ policies }).then(applySnapshot)
  }, [serviceOnline, applySnapshot])

  const dispatchWorkItem = useCallback(async (id: string) => {
    if (!serviceOnline) { toast.error('Serviço local offline — inicie o vertice-core'); return }
    const res = await api.dispatchWorkItem(id)
    if (res?.ok) { applySnapshot(res.snapshot); toast.success('Tarefa despachada para a sessão real do agente') }
    else toast.error('Não foi possível despachar a tarefa (verifique responsável, runtime aprovado e workspace)')
  }, [serviceOnline, applySnapshot])

  const completeWorkItem = useCallback(async (id: string, result?: string) => {
    if (!serviceOnline) { toast.error('Serviço local offline'); return }
    const res = await api.completeWorkItem(id, { result })
    if (res?.ok) { applySnapshot(res.snapshot); toast.success('Tarefa movida para aprovação') }
  }, [serviceOnline, applySnapshot])

  const value: WorkspaceValue = {
    agents, connections, events, selectedId, modal, terminalOpen, terminalExpanded, terminalLines,
    showGrid, showMinimap, goals, workItems, projects, activeProject, cliRuntimes,
    setSelectedId, setModal, setTerminalOpen, setTerminalExpanded, setShowGrid, setShowMinimap,
    setAgentPosition, addConnection, createAgent, delegateToManager, togglePause, removeAgent,
    runCommand, sendRawKey, resizeAgentSession, getRawOutput, subscribeRawOutput, clearTerminal, resetDemo, clearWorkspace,
    moveWorkItem, addWorkItem, addGoal, addProject, setActiveProject,
    checkCli, installCli, toggleCliApproved,
    settings, allowedWorkspaces, updatePolicies, dispatchWorkItem, completeWorkItem,
    serviceOnline, realRuntimes, liveSessions, refreshService,
    startAgentSession, stopAgentSession, installCliReal,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace deve ser usado dentro de WorkspaceProvider')
  return context
}
