import type { Agent, AgentConnection, ActivityEvent, TerminalLine, Goal, WorkItem, Project, CliRuntime } from '@/types/agent'

export const initialAgents: Agent[] = [
  {
    id: 'gerente', name: 'Gerente', role: 'Orquestrador principal', kind: 'manager',
    runtime: 'Claude Code', model: 'claude-sonnet', status: 'working',
    task: 'Coordenando a entrega do MVP', progress: 68,
    prompt: 'Coordene a equipe, divida objetivos em tarefas e crie especialistas quando necessário. Mantenha o contexto do workspace sincronizado.',
    x: 280, y: 0,
  },
  {
    id: 'pesquisador', name: 'Pesquisador', role: 'Inteligência e referências', kind: 'worker',
    runtime: 'Ollama', model: 'qwen3:14b', status: 'idle',
    task: 'Mapeamento de referências concluído', progress: 100,
    prompt: 'Pesquise referências, compare abordagens e entregue sínteses objetivas com fontes.',
    x: 0, y: 215, createdBy: 'gerente',
  },
  {
    id: 'arquiteto', name: 'Arquiteto', role: 'Sistemas e especificação', kind: 'worker',
    runtime: 'Codex CLI', model: 'gpt-codex', status: 'working',
    task: 'Definindo contratos do orquestrador', progress: 44,
    prompt: 'Transforme objetivos em arquitetura técnica, contratos e decisões implementáveis.',
    x: 280, y: 230, createdBy: 'gerente',
  },
  {
    id: 'desenvolvedor', name: 'Desenvolvedor', role: 'Implementação', kind: 'worker',
    runtime: 'OpenCode', model: 'local/default', status: 'working',
    task: 'Implementando o shell do terminal', progress: 72,
    prompt: 'Implemente as especificações no workspace, valide o código e reporte mudanças ao Gerente.',
    x: 560, y: 215, createdBy: 'gerente',
  },
  {
    id: 'revisor', name: 'Revisor', role: 'Qualidade e verificação', kind: 'worker',
    runtime: 'Claude Code', model: 'claude-sonnet', status: 'queued',
    task: 'Aguardando pacote de implementação', progress: 12,
    prompt: 'Revise alterações, procure regressões e valide os critérios de aceite antes da entrega.',
    x: 560, y: 425, createdBy: 'gerente',
  },
]

export const initialConnections: AgentConnection[] = [
  { id: 'e-g-p', source: 'gerente', target: 'pesquisador', label: 'delega' },
  { id: 'e-g-a', source: 'gerente', target: 'arquiteto', label: 'delega', active: true },
  { id: 'e-g-d', source: 'gerente', target: 'desenvolvedor', label: 'delega', active: true },
  { id: 'e-d-r', source: 'desenvolvedor', target: 'revisor', label: 'revisa' },
]

export const initialEvents: ActivityEvent[] = [
  { id: 'ev1', agentId: 'arquiteto', message: 'Contrato de execução atualizado', time: 'agora', type: 'system' },
  { id: 'ev2', agentId: 'desenvolvedor', message: 'Terminal vinculado ao workspace', time: '2 min', type: 'system' },
  { id: 'ev3', agentId: 'gerente', message: 'Revisor adicionado ao fluxo', time: '8 min', type: 'create' },
  { id: 'ev4', agentId: 'pesquisador', message: 'Síntese de referências concluída', time: '14 min', type: 'complete' },
]

export const initialTerminalLines: TerminalLine[] = [
  { id: 't1', type: 'muted', text: 'Vértice shell — ambiente de demonstração' },
  { id: 't2', type: 'muted', text: 'Workspace: C:\\work\\atlas  ·  PowerShell 7' },
  { id: 't3', type: 'command', text: 'vertice status --team' },
  { id: 't4', type: 'output', text: '5 agentes  ·  3 executando  ·  1 na fila  ·  1 disponível' },
  { id: 't5', type: 'success', text: '✓ Orquestração simulada. Nenhum processo externo foi iniciado.' },
]

export const initialGoals: Goal[] = [
  { id: 'goal-mvp', title: 'Lançar o MVP do Vértice', description: 'Primeira versão utilizável do orquestrador local para o time de TI.' },
  { id: 'goal-onboarding', title: 'Preparar o onboarding da empresa', description: 'Materiais e políticas para os funcionários instalarem e usarem o Vértice.' },
]

export const initialWorkItems: WorkItem[] = [
  { id: 'wi-1', title: 'Especificar contratos do orquestrador', status: 'doing', assigneeId: 'arquiteto', goalId: 'goal-mvp', priority: 'alta' },
  { id: 'wi-2', title: 'Implementar o shell do terminal', status: 'doing', assigneeId: 'desenvolvedor', goalId: 'goal-mvp', priority: 'alta' },
  { id: 'wi-3', title: 'Mapear referências de orquestração', status: 'done', assigneeId: 'pesquisador', goalId: 'goal-mvp', priority: 'media' },
  { id: 'wi-4', title: 'Revisar pacote de implementação', status: 'review', assigneeId: 'revisor', goalId: 'goal-mvp', priority: 'alta' },
  { id: 'wi-5', title: 'Definir política de workspaces permitidos', status: 'todo', assigneeId: 'arquiteto', goalId: 'goal-onboarding', priority: 'media' },
  { id: 'wi-6', title: 'Escrever guia de instalação das CLIs', status: 'todo', assigneeId: 'pesquisador', goalId: 'goal-onboarding', priority: 'baixa' },
]

export const initialProjects: Project[] = [
  { id: 'proj-atlas', name: 'Atlas', path: 'C:\\work\\atlas', description: 'Projeto principal do Vértice — orquestrador local de agentes.', active: true },
  { id: 'proj-intranet', name: 'Intranet', path: 'C:\\work\\intranet', description: 'Portal interno da empresa e distribuição da ferramenta.' },
]

export const initialCliRuntimes: CliRuntime[] = [
  { id: 'claude', name: 'Claude Code', kind: 'CLI de IA', command: 'claude', version: '2.1.4', status: 'installed', approved: true },
  { id: 'codex', name: 'Codex CLI', kind: 'CLI de IA', command: 'codex', status: 'missing', approved: true },
  { id: 'kimi', name: 'Kimi CLI', kind: 'CLI de IA', command: 'kimi', status: 'missing', approved: true },
  { id: 'glm', name: 'GLM CLI', kind: 'CLI de IA', command: 'glm', status: 'missing', approved: true },
  { id: 'opencode', name: 'OpenCode', kind: 'CLI de IA', command: 'opencode', version: '0.6.2', status: 'installed', approved: false },
  { id: 'ollama', name: 'Ollama', kind: 'Modelo local', command: 'ollama', version: '0.12.6', status: 'installed', approved: true },
  { id: 'lmstudio', name: 'LM Studio', kind: 'Modelo local', command: 'lms', status: 'missing', approved: false },
]
