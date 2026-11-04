import { Download, FolderLock, RefreshCw, ShieldCheck } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import type { CliStatus } from '@/types/agent'

const cliStatusLabels: Record<CliStatus, string> = {
  installed: 'Instalado',
  missing: 'Não encontrado',
  checking: 'Verificando…',
  installing: 'Instalando…',
}

export function OrgPage() {
  const { cliRuntimes, checkCli, installCli, toggleCliApproved, activeProject } = useWorkspace()

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">ORGANIZAÇÃO</span>
          <h1>CLI's</h1>
          <p>CLIs disponíveis para a equipe, workspaces e políticas do setor</p>
        </div>
      </header>

      <div className="demo-banner">
        <ShieldCheck size={16} />
        <span><strong>Ambiente de demonstração.</strong> A verificação e a instalação reais das CLIs serão executadas pelo serviço local do Vértice, com aprovação do TI.</span>
      </div>

      <section className="org-section">
        <div className="org-section__heading">
          <h2>Seletor de CLI</h2>
          <p>Ao selecionar, o Vértice confere se a CLI está instalada na máquina. Se não estiver, a instalação é guiada pelo terminal embutido.</p>
        </div>
        <div className="cli-table">
          <div className="cli-row cli-row--head">
            <span>Disponível p/ equipe</span>
            <span>CLI</span>
            <span>Comando</span>
            <span>Tipo</span>
            <span>Estado</span>
            <span>Ação</span>
          </div>
          {cliRuntimes.map((cli) => (
            <div key={cli.id} className={`cli-row ${cli.approved ? '' : 'is-disabled'}`}>
              <span>
                <input type="checkbox" checked={cli.approved} onChange={() => toggleCliApproved(cli.id)} aria-label={`Disponibilizar ${cli.name} para a equipe`} />
              </span>
              <span className="cli-row__name"><strong>{cli.name}</strong>{cli.version && cli.status === 'installed' && <small>v{cli.version}</small>}</span>
              <span><code>{cli.command}</code></span>
              <span>{cli.kind}</span>
              <span><span className={`cli-status cli-status--${cli.status}`}><i />{cliStatusLabels[cli.status]}</span></span>
              <span>
                {cli.status === 'missing' && cli.approved && (
                  <button className="button button--primary button--small" onClick={() => installCli(cli.id)}><Download size={13} /> Instalar</button>
                )}
                {(cli.status === 'installed' || cli.status === 'missing') && (
                  <button className="button button--secondary button--small" onClick={() => checkCli(cli.id)} disabled={!cli.approved}><RefreshCw size={13} /> Verificar</button>
                )}
                {(cli.status === 'checking' || cli.status === 'installing') && (
                  <button className="button button--secondary button--small" disabled><RefreshCw size={13} className="spin" /> Aguarde</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="org-section">
        <div className="org-section__heading">
          <h2>Workspaces permitidos</h2>
          <p>Os agentes têm autonomia total apenas dentro destes diretórios. A restrição será aplicada pelo serviço local, não pelo prompt.</p>
        </div>
        <div className="workspace-policy">
          <div className="workspace-policy__row">
            <FolderLock size={16} />
            <span><strong>{activeProject?.path}</strong><small>Projeto ativo · leitura, escrita e execução</small></span>
            <span className="cli-status cli-status--installed"><i /> Permitido</span>
          </div>
        </div>
      </section>

      <section className="org-section">
        <div className="org-section__heading">
          <h2>Políticas do setor</h2>
          <p>Definidas pelo responsável de TI e aplicadas a todas as máquinas da empresa.</p>
        </div>
        <div className="settings-list settings-list--page">
          <label><span><strong>Aprovação do Gerente sem intermediários</strong><small>O Gerente pode criar e coordenar subagentes dentro do workspace sem pedir confirmação.</small></span><input type="checkbox" defaultChecked /></label>
          <label><span><strong>Comandos destrutivos exigem confirmação</strong><small>Excluir arquivos, formatar ou apagar dados fora do workspace sempre pede aprovação humana.</small></span><input type="checkbox" defaultChecked /></label>
          <label><span><strong>Acesso à rede pelos agentes</strong><small>Permitir que os agentes façam chamadas de rede a partir do workspace.</small></span><input type="checkbox" /></label>
        </div>
      </section>
    </div>
  )
}
