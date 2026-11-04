import { useState } from 'react'
import { Download, FolderLock, Plug, PlugZap, RefreshCw } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import type { CliStatus } from '@/types/agent'

const cliStatusLabels: Record<CliStatus, string> = {
  installed: 'Instalado',
  missing: 'Não encontrado',
  checking: 'Verificando…',
  installing: 'Instalando…',
}

export function OrgPage() {
  const { serviceOnline, realRuntimes, cliRuntimes, refreshService, installCliReal, terminalLines, liveSessions } = useWorkspace()
  const [checking, setChecking] = useState(false)

  const verify = async () => {
    setChecking(true)
    await refreshService()
    window.setTimeout(() => setChecking(false), 600)
  }

  const rows = serviceOnline && realRuntimes
    ? realRuntimes.filter((runtime) => runtime.id !== 'powershell').map((runtime) => ({
        id: runtime.id,
        name: runtime.name,
        kind: runtime.kind,
        command: runtime.command,
        version: runtime.version,
        status: runtime.status as CliStatus,
        install: runtime.install,
      }))
    : cliRuntimes.map((runtime) => ({ ...runtime, install: null as string | null }))

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="section-label">ORGANIZAÇÃO</span>
          <h1>CLI's</h1>
          <p>CLIs disponíveis para a equipe, workspaces e políticas do setor</p>
        </div>
        <div className="page-header__actions">
          <button className="button button--secondary" onClick={verify} disabled={checking}>
            <RefreshCw size={15} className={checking ? 'spin' : ''} /> Verificar agora
          </button>
        </div>
      </header>

      <div className={`demo-banner ${serviceOnline ? 'demo-banner--online' : ''}`}>
        {serviceOnline ? <PlugZap size={16} /> : <Plug size={16} />}
        {serviceOnline ? (
          <span><strong>Serviço local conectado.</strong> Os estados abaixo são reais, verificados nesta máquina pelo vertice-core.</span>
        ) : (
          <span><strong>Serviço local offline.</strong> Exibindo dados de demonstração. Inicie o serviço com <code>npm start</code> na pasta <code>core/</code> para ver o estado real das CLIs.</span>
        )}
      </div>

      <section className="org-section">
        <div className="org-section__heading">
          <h2>Seletor de CLI</h2>
          <p>Ao selecionar, o Vértice confere se a CLI está instalada na máquina. Se não estiver, a instalação é guiada pelo terminal embutido.</p>
        </div>
        <div className="cli-table">
          <div className="cli-row cli-row--head">
            <span>CLI</span>
            <span>Comando</span>
            <span>Tipo</span>
            <span>Estado</span>
            <span>Versão</span>
            <span>Ação</span>
          </div>
          {rows.map((cli) => (
            <div key={cli.id} className="cli-row cli-row--real">
              <span className="cli-row__name"><strong>{cli.name}</strong></span>
              <span><code>{cli.command}</code></span>
              <span>{cli.kind}</span>
              <span><span className={`cli-status cli-status--${cli.status}`}><i />{cliStatusLabels[cli.status]}</span></span>
              <span>{cli.version ?? '—'}</span>
              <span>
                {cli.status === 'missing' && serviceOnline && cli.install && (
                  <button className="button button--primary button--small" onClick={() => installCliReal(cli.id)}><Download size={13} /> Instalar</button>
                )}
                {cli.status === 'missing' && serviceOnline && !cli.install && <small className="cli-manual">manual</small>}
                {cli.status === 'missing' && !serviceOnline && <small className="cli-manual">—</small>}
                {cli.status === 'installed' && <span className="cli-ok">✓</span>}
              </span>
            </div>
          ))}
        </div>
        {serviceOnline && rows.some((cli) => cli.status === 'missing' && cli.install) && (
          <p className="org-hint">Instalar abre um terminal PowerShell real e executa o comando de instalação. A saída aparece no terminal da página Organograma e fica registrada no histórico.</p>
        )}
      </section>

      {Object.keys(liveSessions).some((key) => key.startsWith('install-')) && (
        <section className="org-section">
          <div className="org-section__heading">
            <h2>Instalação em andamento</h2>
            <p>Saída real do terminal de instalação.</p>
          </div>
          {Object.keys(liveSessions).filter((key) => key.startsWith('install-')).map((key) => (
            <div key={key} className="install-log">
              {(terminalLines[key] ?? []).slice(-12).map((line) => (
                <div key={line.id} className={`terminal-line terminal-line--${line.type}`}>{line.text}</div>
              ))}
            </div>
          ))}
        </section>
      )}

      <section className="org-section">
        <div className="org-section__heading">
          <h2>Workspaces permitidos</h2>
          <p>Os agentes têm autonomia total apenas dentro destes diretórios. A restrição será aplicada pelo serviço local, não pelo prompt.</p>
        </div>
        <WorkspacePolicy />
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

function WorkspacePolicy() {
  const { activeProject } = useWorkspace()
  return (
    <div className="workspace-policy">
      <div className="workspace-policy__row">
        <FolderLock size={16} />
        <span><strong>{activeProject?.path}</strong><small>Projeto ativo · leitura, escrita e execução</small></span>
        <span className="cli-status cli-status--installed"><i /> Permitido</span>
      </div>
    </div>
  )
}
