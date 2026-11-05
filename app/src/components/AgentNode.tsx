import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Bot, Braces, Network, Search, ShieldCheck } from 'lucide-react'
import type { Agent } from '@/types/agent'
import { statusLabels } from '@/types/agent'

export type AgentFlowNode = Node<{ agent: Agent }, 'agent'>

const roleIcons = {
  gerente: Network,
  pesquisador: Search,
  arquiteto: Braces,
  revisor: ShieldCheck,
}

export function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const { agent } = data
  const Icon = roleIcons[agent.id as keyof typeof roleIcons] ?? Bot

  return (
    <div className={`agent-node agent-node--${agent.kind} agent-node--${agent.status} ${selected ? 'is-selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="agent-handle" />
      <div className="agent-node__topline">
        <span className="agent-node__icon"><Icon size={16} strokeWidth={1.7} /></span>
        <span className={`status-dot status-dot--${agent.status}`} />
      </div>
      <div className="agent-node__identity">
        <strong>{agent.name}</strong>
        <span>{agent.role}</span>
      </div>
      <div className="agent-node__task">{agent.task}</div>
      <div className="agent-node__footer">
        <span>{agent.runtime}</span>
        <span>{statusLabels[agent.status]}</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="agent-handle" />
    </div>
  )
}
