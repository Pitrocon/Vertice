import { useMemo, useState } from 'react'
import { ArrowRight, Bot, Network, Plus, Sparkles, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import type { Agent } from '@/types/agent'

export interface NewAgentInput {
  name: string
  role: string
  runtime: string
  model: string
  prompt: string
  parentId: string
}

export function CreateAgentDialog({ agents, serviceOnline, scopePath, onClose, onCreate }: { agents: Agent[]; serviceOnline?: boolean; scopePath?: string; onClose: () => void; onCreate: (input: NewAgentInput) => void }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [runtime, setRuntime] = useState('Claude Code')
  const [model, setModel] = useState('claude-sonnet')
  const [prompt, setPrompt] = useState('')
  const [parentId, setParentId] = useState('gerente')
  const [submitted, setSubmitted] = useState(false)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !role.trim() || !prompt.trim()) return
    onCreate({ name: name.trim(), role: role.trim(), runtime, model, prompt: prompt.trim(), parentId })
  }

  return (
    <Modal title="Criar novo agente" eyebrow="CONFIGURAÇÃO MANUAL" onClose={onClose} wide>
      <form onSubmit={submit} className="agent-form">
        <div className="form-grid">
          <label>Nome do agente<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Documentador" aria-invalid={submitted && !name.trim()} />{submitted && !name.trim() && <small className="field-error">Informe um nome.</small>}</label>
          <label>Função<input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Ex.: Documentação técnica" aria-invalid={submitted && !role.trim()} />{submitted && !role.trim() && <small className="field-error">Informe uma função.</small>}</label>
          <label>Runtime<select value={runtime} onChange={(e) => { setRuntime(e.target.value); setModel(e.target.value === 'Ollama' ? 'qwen3:14b' : e.target.value === 'LM Studio' ? 'local-model' : e.target.value === 'Codex CLI' ? 'gpt-codex' : e.target.value === 'Kimi CLI' ? 'kimi-k2' : e.target.value === 'GLM CLI' ? 'glm-4.6' : 'claude-sonnet') }}><option>Claude Code</option><option>Codex CLI</option><option>Kimi CLI</option><option>GLM CLI</option><option>Antigravity CLI</option><option>OpenCode</option><option>Ollama</option><option>LM Studio</option></select></label>
          <label>Modelo<input value={model} onChange={(e) => setModel(e.target.value)} /></label>
          <label>Supervisor<select value={parentId} onChange={(e) => setParentId(e.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
          <div className="form-scope"><span>ESCOPO</span><strong>{scopePath ?? 'workspace do projeto ativo'}</strong><small>Autonomia total herdada do workspace</small></div>
        </div>
        <label className="prompt-field">Instrução de sistema<textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Descreva como este agente deve trabalhar, o que deve entregar e quando reportar ao supervisor." aria-invalid={submitted && !prompt.trim()} />{submitted && !prompt.trim() && <small className="field-error">Descreva a instrução inicial.</small>}</label>
        <footer className="modal-footer"><span>{serviceOnline ? 'O agente será criado e persistido no workspace real.' : 'Offline: a criação é apenas demonstração.'}</span><button className="button button--primary" type="submit"><Plus size={16} /> Criar agente</button></footer>
      </form>
    </Modal>
  )
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

export function RemoveAgentDialog({ agent, onClose, onConfirm }: { agent: Agent; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal title={`Encerrar ${agent.name}?`} eyebrow="REMOVER AGENTE" onClose={onClose}>
      <div className="confirm-copy"><p>O agente e suas conexões serão removidos do mapa e do workspace. O histórico de eventos será preservado.</p></div>
      <footer className="modal-footer"><button className="button button--secondary" onClick={onClose}>Manter agente</button><button className="button button--danger-solid" onClick={onConfirm}><Trash2 size={15} /> Encerrar agente</button></footer>
    </Modal>
  )
}
