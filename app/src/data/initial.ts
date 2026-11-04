import type { Agent, AgentConnection, ActivityEvent, TerminalLine } from '@/types/agent'

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
