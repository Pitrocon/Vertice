import { useMemo, useState } from 'react'
import { ArrowRight, BookmarkPlus, Bot, Network, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import type { Agent } from '@/types/agent'
import type { PromptTemplate } from '@/lib/api'
import { selfAndDescendants } from '@/lib/workspace-helpers'

export interface NewAgentInput {
  name: string
  role: string
  runtime: string
  model: string
  prompt: string
  parentId: string
}

const RUNTIME_OPTIONS = ['Claude Code', 'Codex CLI', 'Kimi CLI', 'GLM CLI', 'Antigravity CLI', 'OpenCode', 'Ollama', 'LM Studio']

function defaultModelFor(runtime: string) {
  if (runtime === 'Ollama') return 'qwen3:14b'
  if (runtime === 'LM Studio') return 'local-model'
  if (runtime === 'Codex CLI') return 'gpt-codex'
  if (runtime === 'Kimi CLI') return 'kimi-k2'
  if (runtime === 'GLM CLI') return 'glm-4.6'
  return 'claude-sonnet'
}



interface PromptLibraryProps {
  templates: PromptTemplate[]
  prompt: string
  serviceOnline?: boolean
  onLoad: (prompt: string) => void
  onSave: (name: string, prompt: string) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}

/** Biblioteca de prompts salvos: carregar com 1 clique e guardar a instrução atual para reutilizar. */
function PromptLibrary({ templates, prompt, serviceOnline, onLoad, onSave, onDelete }: PromptLibraryProps) {
  const [selectedId, setSelectedId] = useState('')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = templates.find((template) => template.id === selectedId)

  const load = (id: string) => {
    setSelectedId(id)
    const template = templates.find((item) => item.id === id)
    if (!template) return
    if (prompt.trim() && prompt !== template.prompt && !window.confirm(`Substituir a instrução atual pelo prompt "${template.name}"?`)) {
      setSelectedId('')
      return
    }
    onLoad(template.prompt)
  }

  const save = async () => {
    if (!name.trim() || !prompt.trim() || busy) return
    setBusy(true)
    const ok = await onSave(name, prompt)
    setBusy(false)
    if (ok) { setNaming(false); setName('') }
  }

  const remove = async () => {
    if (!selected || !window.confirm(`Remover "${selected.name}" da biblioteca de prompts?`)) return
    setBusy(true)
    if (await onDelete(selected.id)) setSelectedId('')
    setBusy(false)
  }

  if (naming) {
    return (
      <div className="prompt-library">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome do prompt (ex.: Revisor de código)"
          aria-label="Nome do prompt salvo"
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); void save() }
            // Esc fecha só a caixa do nome, não o diálogo inteiro.
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNaming(false) }
          }}
        />
        <button type="button" className="button button--primary button--small" disabled={busy || !name.trim()} onClick={() => void save()}><Save size={13} /> Salvar</button>
        <button type="button" className="button button--secondary button--small" disabled={busy} onClick={() => setNaming(false)}>Cancelar</button>
      </div>
    )
  }

  const saveHint = !serviceOnline
    ? 'A biblioteca de prompts fica no serviço local (offline agora).'
    : !prompt.trim() ? 'Escreva a instrução antes de salvar.' : 'Guardar esta instrução para reutilizar em outros agentes.'

  return (
    <div className="prompt-library">
      <select value={selectedId} onChange={(event) => load(event.target.value)} disabled={!templates.length} aria-label="Carregar prompt salvo">
        <option value="">{templates.length ? 'Carregar prompt salvo…' : 'Nenhum prompt salvo ainda'}</option>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
      {selected && (
        <button type="button" className="icon-button icon-button--small icon-button--danger" disabled={busy || !serviceOnline} onClick={() => void remove()} title="Remover da biblioteca" aria-label={`Remover ${selected.name} da biblioteca`}><Trash2 size={13} /></button>
      )}
      <button type="button" className="button button--secondary button--small" disabled={!serviceOnline || !prompt.trim()} title={saveHint} onClick={() => { setName(selected?.name ?? ''); setNaming(true) }}><BookmarkPlus size={13} /> Salvar na biblioteca</button>
    </div>
  )
}

interface AgentFormProps {
  agents: Agent[]
  serviceOnline?: boolean
  scopePath?: string
  promptTemplates: PromptTemplate[]
  onSavePrompt: (name: string, prompt: string) => Promise<boolean>
  onDeletePrompt: (id: string) => Promise<boolean>
  onClose: () => void
}

/** Formulário único de agente: criar (sem `agent`) ou editar (com `agent`). */
function AgentFormDialog({ agent, agents, serviceOnline, scopePath, promptTemplates, onSavePrompt, onDeletePrompt, onClose, onSubmit }: AgentFormProps & { agent?: Agent; onSubmit: (input: NewAgentInput) => void | Promise<boolean> }) {
  const editing = Boolean(agent)
  const [name, setName] = useState(agent?.name ?? '')
  const [role, setRole] = useState(agent?.role ?? '')
  const [runtime, setRuntime] = useState(agent?.runtime ?? 'Claude Code')
  const [model, setModel] = useState(agent?.model ?? 'claude-sonnet')
  const [prompt, setPrompt] = useState(agent?.prompt ?? '')
  // Sem agente principal no workspace, o primeiro agente criado pode ser o principal (sem supervisor).
  const hasManager = agents.some((item) => item.kind === 'manager')
  const blocked = useMemo(() => (agent ? selfAndDescendants(agents, agent.id) : new Set<string>()), [agents, agent])
  const supervisorOptions = agents.filter((item) => !blocked.has(item.id))
  const [parentId, setParentId] = useState(() => (agent ? agent.createdBy ?? '' : agents.find((item) => item.kind === 'manager')?.id ?? agents[0]?.id ?? ''))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  // Runtime atual fora da lista (ex.: "GLM CLI (Z.ai)" ou "PowerShell") continua selecionável.
  const runtimeOptions = RUNTIME_OPTIONS.includes(runtime) ? RUNTIME_OPTIONS : [runtime, ...RUNTIME_OPTIONS]

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !role.trim() || !prompt.trim() || saving) return
    setSaving(true)
    const result = await onSubmit({ name: name.trim(), role: role.trim(), runtime, model: model.trim() || defaultModelFor(runtime), prompt: prompt.trim(), parentId })
    setSaving(false)
    if (result !== false) onClose()
  }

  const footerText = editing
    ? (serviceOnline ? 'As mudanças valem para as próximas sessões e tarefas; uma sessão já aberta continua com a configuração anterior.' : 'Offline: a edição não é salva no serviço local.')
    : (serviceOnline ? 'O agente será criado e persistido no workspace real.' : 'Offline: a criação é apenas demonstração.')

  return (
    <Modal
      title={editing ? `Editar ${agent?.name}` : 'Criar novo agente'}
      eyebrow={editing ? (agent?.kind === 'manager' ? 'AGENTE PRINCIPAL' : 'CONFIGURAÇÃO DO AGENTE') : 'CONFIGURAÇÃO MANUAL'}
      onClose={onClose}
      wide
    >
      <form onSubmit={(event) => void submit(event)} className="agent-form">
        <div className="form-grid">
          <label>Nome do agente<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Documentador" aria-invalid={submitted && !name.trim()} />{submitted && !name.trim() && <small className="field-error">Informe um nome.</small>}</label>
          <label>Função<input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Ex.: Documentação técnica" aria-invalid={submitted && !role.trim()} />{submitted && !role.trim() && <small className="field-error">Informe uma função.</small>}</label>
          <label>Runtime<select value={runtime} onChange={(e) => { setRuntime(e.target.value); setModel(defaultModelFor(e.target.value)) }}>{runtimeOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label>Modelo<input value={model} onChange={(e) => setModel(e.target.value)} /></label>
          <label>Supervisor<select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            {editing
              ? <option value="">{agent?.kind === 'manager' ? 'Nenhum (agente principal)' : 'Nenhum (sem supervisor)'}</option>
              : !hasManager && <option value="">Nenhum (agente principal / Gerente)</option>}
            {supervisorOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <div className="form-scope"><span>ESCOPO</span><strong>{scopePath ?? 'workspace do projeto ativo'}</strong><small>Autonomia total herdada do workspace</small></div>
        </div>
        <div className="prompt-field">
          <div className="prompt-field__head">
            <label htmlFor="agent-prompt">Instrução de sistema</label>
            <PromptLibrary templates={promptTemplates} prompt={prompt} serviceOnline={serviceOnline} onLoad={setPrompt} onSave={onSavePrompt} onDelete={onDeletePrompt} />
          </div>
          <textarea id="agent-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Descreva como este agente deve trabalhar, o que deve entregar e quando reportar ao supervisor." aria-invalid={submitted && !prompt.trim()} />
          {submitted && !prompt.trim() && <small className="field-error">Descreva a instrução inicial.</small>}
        </div>
        <footer className="modal-footer">
          <span>{footerText}</span>
          <button className="button button--primary" type="submit" disabled={saving}>{editing ? <><Save size={16} /> Salvar alterações</> : <><Plus size={16} /> Criar agente</>}</button>
        </footer>
      </form>
    </Modal>
  )
}

export function CreateAgentDialog({ onCreate, ...props }: AgentFormProps & { onCreate: (input: NewAgentInput) => void }) {
  return <AgentFormDialog {...props} onSubmit={onCreate} />
}

export function EditAgentDialog({ onSave, ...props }: AgentFormProps & { agent: Agent; onSave: (input: NewAgentInput) => Promise<boolean> }) {
  return <AgentFormDialog {...props} onSubmit={onSave} />
}

export function ManagerDialog({ serviceOnline, onClose, onDelegate }: { serviceOnline?: boolean; onClose: () => void; onDelegate: (objective: string) => void }) {
  const [objective, setObjective] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const plan = useMemo(() => [
    { name: 'Estrategista', role: 'Decompor o objetivo e priorizar entregas', runtime: 'Claude Code' },
    { name: 'Analista', role: 'Investigar contexto, dados e restrições', runtime: 'Kimi CLI' },
    { name: 'Executor', role: 'Produzir a entrega e reportar o resultado', runtime: 'Codex CLI' },
  ], [])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (objective.trim().length < 12) return
    onDelegate(objective.trim())
  }

  return (
    <Modal title="Delegar um objetivo" eyebrow="ORQUESTRAÇÃO AUTÔNOMA" onClose={onClose} wide>
      <form onSubmit={submit} className="manager-form">
        <div className="manager-intro"><span><Network size={22} /></span><div><strong>O Gerente monta a equipe.</strong><p>Ele criará especialistas, definirá instruções e conectará cada agente ao objetivo.</p></div></div>
        <label className="prompt-field">Objetivo para o workspace<textarea autoFocus value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Ex.: Especificar e prototipar uma CLI para orquestrar agentes locais no Windows." aria-invalid={submitted && objective.trim().length < 12} />{submitted && objective.trim().length < 12 && <small className="field-error">Descreva um objetivo com pelo menos 12 caracteres.</small>}</label>
        <div className="team-plan"><div className="section-label">{serviceOnline ? 'EQUIPE PROPOSTA · CRIAÇÃO REAL' : 'EQUIPE PROPOSTA · DEMONSTRAÇÃO (OFFLINE)'}</div>{plan.map((agent, index) => <div className="plan-agent" key={agent.name}><span className="plan-index">0{index + 1}</span><Bot size={16} /><span><strong>{agent.name}</strong><small>{agent.role}</small></span><em>{agent.runtime}</em></div>)}</div>
        <div className="autonomy-banner"><Sparkles size={16} /><span><strong>Autonomia total no workspace</strong><small>O Gerente poderá criar e coordenar estes agentes sem aprovações intermediárias.</small></span></div>
        <footer className="modal-footer"><button className="button button--secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button--primary" type="submit">Criar equipe <ArrowRight size={16} /></button></footer>
      </form>
    </Modal>
  )
}

export function RemoveAgentDialog({ agent, subordinates, tasks, onClose, onConfirm }: { agent: Agent; subordinates: number; tasks: number; onClose: () => void; onConfirm: () => void }) {
  const effects = [
    subordinates > 0 && `${subordinates} agente(s) ficam sem supervisor`,
    tasks > 0 && `${tasks} tarefa(s) ficam sem responsável`,
  ].filter(Boolean)
  return (
    <Modal title={`Remover ${agent.name}?`} eyebrow={agent.kind === 'manager' ? 'REMOVER AGENTE PRINCIPAL' : 'REMOVER AGENTE'} onClose={onClose}>
      <div className="confirm-copy">
        <p>O agente e as conexões dele saem do organograma e do workspace. Se houver uma sessão dele aberta, ela é encerrada. O histórico de eventos é preservado.</p>
        {effects.length > 0 && <p>{effects.join(' · ')} (nada é apagado).</p>}
        <p>A memória viva dele é apagada; o arquivo em <code>.vertice/memory</code> continua na pasta do projeto.</p>
      </div>
      <footer className="modal-footer"><button className="button button--secondary" onClick={onClose}>Manter agente</button><button className="button button--danger-solid" onClick={onConfirm}><Trash2 size={15} /> Remover agente</button></footer>
    </Modal>
  )
}