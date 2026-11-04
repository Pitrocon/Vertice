import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  initialAgents, initialConnections, initialEvents, initialTerminalLines,
  initialGoals, initialWorkItems, initialProjects, initialCliRuntimes,
} from '@/data/initial'
import type {
  Agent, AgentConnection, ActivityEvent, TerminalLine,
  Goal, WorkItem, Project, CliRuntime, WorkStatus,
} from '@/types/agent'
import type { NewAgentInput } from '@/components/AgentDialogs'

export type ModalName = 'create' | 'manager' | 'commands' | 'settings' | 'remove' | null

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
  clearTerminal: (agentId: string) => void
  resetDemo: () => void
  moveWorkItem: (id: string, status: WorkStatus) => void
  addWorkItem: (input: { title: string; assigneeId?: string; goalId?: string; priority: WorkItem['priority'] }) => void
  addGoal: (input: { title: string; description: string }) => void
  addProject: (input: { name: string; path: string; description: string }) => void
  setActiveProject: (id: string) => void
  checkCli: (id: string) => void
  installCli: (id: string) => void
  toggleCliApproved: (id: string) => void
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null)

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

  const activeProject = useMemo(() => projects.find((project) => project.active) ?? projects[0], [projects])

  const addEvent = useCallback((agentId: string, message: string, type: ActivityEvent['type']) => {
    setEvents((current) => [{ id: crypto.randomUUID(), agentId, message, time: 'agora', type }, ...current].slice(0, 20))
  }, [])

  const setAgentPosition = useCallback((id: string, x: number, y: number) => {
    setAgents((current) => current.map((agent) => (agent.id === id ? { ...agent, x, y } : agent)))
  }, [setAgents])

  const addConnection = useCallback((source: string, target: string) => {
    if (!source || !target || source === target) return
    if (connections.some((item) => item.source === source && item.target === target)) {
      toast.info('Estes agentes já estão conectados')
      return
    }
    setConnections((current) => [...current, { id: crypto.randomUUID(), source, target, label: 'vincula' }])
    addEvent(source, `Nova conexão com ${agents.find((a) => a.id === target)?.name}`, 'system')
    toast.success('Conexão criada no organograma')
  }, [connections, agents, setConnections, addEvent])

  const createAgent = useCallback((input: NewAgentInput) => {
    const id = `${input.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`
    setAgents((current) => {
      const workerCount = current.filter((agent) => agent.kind === 'worker').length
      const agent: Agent = {
        id, name: input.name, role: input.role, kind: 'worker', runtime: input.runtime, model: input.model,
        status: 'idle', task: 'Aguardando primeira tarefa', progress: 0, prompt: input.prompt,
        x: 80 + (workerCount % 3) * 310, y: 560 + Math.floor(workerCount / 3) * 190, createdBy: input.parentId,
      }
      return [...current, agent]
    })
    setConnections((current) => [...current, { id: crypto.randomUUID(), source: input.parentId, target: id, label: 'delega' }])
    setSelectedId(id)
    setModal(null)
    addEvent(input.parentId, `${input.name} criado e vinculado à equipe`, 'create')
    toast.success(`${input.name} adicionado à equipe`)
  }, [setAgents, setConnections, addEvent])

  const delegateToManager = useCallback((objective: string) => {
    const stamp = Date.now().toString(36)
    setAgents((currentAgents) => {
      const manager = currentAgents.find((agent) => agent.kind === 'manager') ?? currentAgents[0]
      const existingNames = new Set(currentAgents.map((agent) => agent.name))
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
      const startIndex = currentAgents.filter((agent) => agent.kind === 'worker').length
      const newAgents: Agent[] = templates.map((template, index) => ({
        ...template, id: `${template.name.toLowerCase()}-${stamp}-${index}`, name: uniqueName(template.name), kind: 'worker' as const,
        status: index === 0 ? 'working' as const : 'queued' as const, progress: index === 0 ? 8 : 0,
        x: 30 + ((startIndex + index) % 3) * 315, y: 570 + Math.floor((startIndex + index) / 3) * 195, createdBy: manager.id,
      }))
      setConnections((current) => [...current, ...newAgents.map((agent) => ({ id: crypto.randomUUID(), source: manager.id, target: agent.id, label: 'delega', active: agent.status === 'working' }))])
      setTerminalLines((current) => ({
        ...current, [manager.id]: [...(current[manager.id] ?? []),
          { id: crypto.randomUUID(), type: 'command', text: `vertice delegate "${objective}"` },
          { id: crypto.randomUUID(), type: 'success', text: `✓ Equipe simulada criada: ${newAgents.map((agent) => agent.name).join(', ')}` },
          { id: crypto.randomUUID(), type: 'muted', text: 'Nenhum processo externo foi iniciado.' },
        ],
      }))
      addEvent(manager.id, `Equipe de ${newAgents.length} agentes criada para novo objetivo`, 'delegate')
      setSelectedId(manager.id)
      return [...currentAgents.map((agent) => agent.id === manager.id ? { ...agent, status: 'working' as const, task: objective, progress: 12 } : agent), ...newAgents]
    })
    setModal(null)
    setTerminalOpen(true)
    toast.success('Gerente criou uma equipe de 3 agentes')
  }, [setAgents, setConnections, addEvent])

  const togglePause = useCallback((id: string) => {
    setAgents((current) => current.map((agent) => {
      if (agent.id !== id) return agent
      const nextStatus: Agent['status'] = agent.status === 'paused' ? 'idle' : 'paused'
      addEvent(id, nextStatus === 'paused' ? 'Agente pausado' : 'Agente retomado', 'system')
      toast.success(nextStatus === 'paused' ? `${agent.name} pausado` : `${agent.name} disponível`)
      return { ...agent, status: nextStatus }
    }))
  }, [setAgents, addEvent])

  const removeAgent = useCallback((id: string) => {
    setAgents((current) => {
      const target = current.find((agent) => agent.id === id)
      if (!target || target.kind === 'manager') return current
      setConnections((connections) => connections.filter((connection) => connection.source !== id && connection.target !== id))
      toast.success(`${target.name} removido da equipe`)
      return current.filter((agent) => agent.id !== id)
    })
    setSelectedId('gerente')
    setModal(null)
  }, [setAgents, setConnections])

  const runCommand = useCallback((command: string) => {
    const agent = agents.find((item) => item.id === selectedId) ?? agents[0]
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
  }, [agents, selectedId])

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
    toast.success('Demonstração restaurada')
  }, [setAgents, setConnections, setGoals, setWorkItems, setProjects])

  const moveWorkItem = useCallback((id: string, status: WorkStatus) => {
    setWorkItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)))
  }, [setWorkItems])

  const addWorkItem = useCallback((input: { title: string; assigneeId?: string; goalId?: string; priority: WorkItem['priority'] }) => {
    setWorkItems((current) => [...current, { id: crypto.randomUUID(), status: 'todo' as const, ...input }])
    toast.success('Tarefa criada no quadro')
  }, [setWorkItems])

  const addGoal = useCallback((input: { title: string; description: string }) => {
    setGoals((current) => [...current, { id: crypto.randomUUID(), ...input }])
    toast.success('Meta criada')
  }, [setGoals])

  const addProject = useCallback((input: { name: string; path: string; description: string }) => {
    setProjects((current) => [...current, { id: crypto.randomUUID(), ...input }])
    toast.success(`Projeto ${input.name} criado`)
  }, [setProjects])

  const setActiveProject = useCallback((id: string) => {
    setProjects((current) => current.map((project) => ({ ...project, active: project.id === id })))
    const project = projects.find((item) => item.id === id)
    if (project) toast.success(`Projeto ativo: ${project.name}`)
  }, [setProjects, projects])

  const checkCli = useCallback((id: string) => {
    setCliRuntimes((current) => current.map((cli) => (cli.id === id ? { ...cli, status: 'checking' as const } : cli)))
    window.setTimeout(() => {
      setCliRuntimes((current) => current.map((cli) => {
        if (cli.id !== id) return cli
        return { ...cli, status: cli.version ? 'installed' as const : 'missing' as const }
      }))
    }, 900)
  }, [])

  const installCli = useCallback((id: string) => {
    const cli = cliRuntimes.find((item) => item.id === id)
    if (!cli) return
    setCliRuntimes((current) => current.map((item) => (item.id === id ? { ...item, status: 'installing' as const } : item)))
    window.setTimeout(() => {
      setCliRuntimes((current) => current.map((item) => (item.id === id ? { ...item, status: 'installed' as const, version: item.version ?? '1.0.0' } : item)))
      toast.success(`${cli.name} instalado (demonstração)`, { description: 'A instalação real será executada pelo serviço local.' })
    }, 2400)
  }, [cliRuntimes])

  const toggleCliApproved = useCallback((id: string) => {
    setCliRuntimes((current) => current.map((cli) => (cli.id === id ? { ...cli, approved: !cli.approved } : cli)))
  }, [])

  const value: WorkspaceValue = {
    agents, connections, events, selectedId, modal, terminalOpen, terminalExpanded, terminalLines,
    showGrid, showMinimap, goals, workItems, projects, activeProject, cliRuntimes,
    setSelectedId, setModal, setTerminalOpen, setTerminalExpanded, setShowGrid, setShowMinimap,
    setAgentPosition, addConnection, createAgent, delegateToManager, togglePause, removeAgent,
    runCommand, clearTerminal, resetDemo,
    moveWorkItem, addWorkItem, addGoal, addProject, setActiveProject,
    checkCli, installCli, toggleCliApproved,
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) throw new Error('useWorkspace deve ser usado dentro de WorkspaceProvider')
  return context
}
