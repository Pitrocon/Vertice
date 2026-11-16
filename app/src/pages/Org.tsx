import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, FolderLock, KeyRound, Plug, PlugZap, RefreshCw, RotateCcw, X } from 'lucide-react'
import { useWorkspace } from '@/store/workspace'
import type { DetectedRuntime, InstallLog, VerticePolicies } from '@/lib/api'
import type { CliStatus, PolicyKey } from '@/types/agent'

const POLICY_DEFINITIONS: {
  key: PolicyKey
  title: string
  description: string
  fallbackNote: string
}[] = [
  {
    key: 'allowDestructiveCommands',
    title: 'Comandos destrutivos permitidos',
    description: 'Quando desligado, a instrução vai para a IA como diretiva. Nenhuma CLI tem bloqueio técnico completo para isso.',
    fallbackNote: 'Aplicada como diretiva na memória e na instrução do agente.',
  },
  {
    key: 'allowNetwork',
    title: 'Acesso à rede pelos agentes',
    description: 'Quando desligado, o Codex roda com sandbox sem rede (bloqueio técnico). Nas demais CLIs é diretiva; no Claude Code as ferramentas web são bloqueadas e um comando de shell ainda pode acessar a rede.',
    fallbackNote: 'Aplicada como diretiva na memória e na instrução do agente.',
  },
  {
    key: 'allowCredentials',
    title: 'Uso de credenciais pelos agentes',
    description: 'Diretiva: registrada na memória e na instrução de cada agente.',
    fallbackNote: 'Aplicada como diretiva na memória e na instrução do agente.',
  },
]

const cliStatusLabels: Record<CliStatus, string> = {
  installed: 'Instalado',
  missing: 'Não encontrado',
  checking: 'Verificando…',
  installing: 'Instalando…',
}

// G3: o que a verificação de login consegue afirmar (só a existência da credencial, não a validade).
const authLabels: Record<'found' | 'not-found' | 'unknown', { text: string; title: string }> = {
  found: { text: 'Credencial encontrada', title: 'Há um login salvo desta CLI nesta máquina. Se ele tiver expirado, a CLI pede login de novo.' },
  'not-found': { text: 'Login não encontrado', title: 'Nenhuma credencial nos locais conhecidos. Abra o terminal de login antes de usar esta CLI.' },
  unknown: { text: 'Login: não dá para verificar daqui', title: 'O Vértice não sabe onde esta CLI guarda o login. Abra o terminal de login para conferir.' },
}

export function OrgPage() {
  const {
    serviceOnline, realRuntimes, cliRuntimes, liveSessions, refreshService,
    settings, updatePolicies, toggleCliApproved, installCli, installLogs, clearInstallLog, openLoginTerminal,
  } = useWorkspace()
  const [checking, setChecking] = useState(false)
  const [installingId, setInstallingId] = useState<string | null>(null)

  const installedRuntimes = useMemo(
    () => (serviceOnline && realRuntimes ? realRuntimes.filter((runtime) => runtime.status === 'installed') : []),
    [serviceOnline, realRuntimes],
  )
  const activeSessionCount = Object.keys(liveSessions).length

  const verify = async () => {
    setChecking(true)
    await refreshService()
    window.setTimeout(() => setChecking(false), 600)
  }

  const handleInstall = async (id: string) => {
    if (installingId) return
    setInstallingId(id)
    try {
      await installCli(id)
    } finally {
      setInstallingId(null)
    }
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
        authenticates: Boolean(runtime.authenticates),
        auth: runtime.auth ?? null,
      }))
    : cliRuntimes.map((runtime) => ({ ...runtime, install: null as string | null, authenticates: false, auth: null as DetectedRuntime['auth'] }))

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
          <p>O Vértice confere se cada CLI está instalada nesta máquina e se há login salvo. Se não estiver instalada, "Instalar" roda o instalador oficial e mostra a saída ao vivo.</p>
        </div>
        <div className="cli-table">
          <div className="cli-row cli-row--head">
            <span>CLI</span>
            <span>Comando</span>
            <span>Tipo</span>
            <span>Estado</span>
            <span>Versão</span>
            <span>Aprovada</span>
            <span>Ação</span>
          </div>
          {rows.map((cli) => (
            <div key={cli.id} className="cli-row cli-row--real">
              <span className="cli-row__name"><strong>{cli.name}</strong></span>
              <span><code>{cli.command}</code></span>
              <span>{cli.kind}</span>
              <span className="cli-row__state">
                <span className={`cli-status cli-status--${cli.status}`}><i />{cliStatusLabels[cli.status]}</span>
                {cli.status === 'installed' && cli.auth && (
                  <small className={`cli-auth cli-auth--${cli.auth}`} title={authLabels[cli.auth].title}>{authLabels[cli.auth].text}</small>
                )}
              </span>
              <span>{cli.version ?? '—'}</span>
              <span>
                <input
                  type="checkbox"
                  aria-label={`Aprovar ${cli.name}`}
                  checked={Boolean(settings?.approvedRuntimes.includes(cli.id))}
                  disabled={!serviceOnline}
                  onChange={() => toggleCliApproved(cli.id)}
                />
              </span>
              <span>
                {cli.status === 'missing' && serviceOnline && cli.install && (
                  <button className="button button--primary button--small" disabled={installingId !== null} onClick={() => void handleInstall(cli.id)}>
                    {installingId === cli.id ? <><RefreshCw size={13} className="spin" /> Instalando…</> : <><Download size={13} /> Instalar</>}
                  </button>
                )}
                {cli.status === 'missing' && serviceOnline && !cli.install && <small className="cli-manual">manual</small>}
                {cli.status === 'missing' && !serviceOnline && <small className="cli-manual">—</small>}
                {cli.status === 'installed' && serviceOnline && cli.authenticates ? (
                  <button className="button button--secondary button--small" onClick={() => void openLoginTerminal(cli.id)} title="Abre uma janela do PowerShell com esta CLI para você fazer o login">
                    <KeyRound size={13} /> Abrir terminal de login
                  </button>
                ) : cli.status === 'installed' && <span className="cli-ok">✓</span>}
              </span>
            </div>
          ))}
        </div>
        {serviceOnline && rows.some((cli) => cli.status === 'missing' && cli.install) && (
          <p className="org-hint">Instalar executa o comando oficial num PowerShell do serviço local, sem pedir senha de administrador. A saída aparece abaixo, ao vivo, e o resultado fica no histórico.</p>
        )}
      </section>

      {Object.keys(installLogs).length > 0 && (
        <section className="org-section">
          <div className="org-section__heading">
            <h2>Instalação</h2>
            <p>Saída real do instalador, transmitida pelo serviço local enquanto roda.</p>
          </div>
          {Object.entries(installLogs).map(([runtimeId, log]) => (
            <InstallLogView
              key={runtimeId}
              name={rows.find((cli) => cli.id === runtimeId)?.name ?? runtimeId}
              log={log}
              onClose={() => clearInstallLog(runtimeId)}
            />
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
          <p>Defina o que os agentes podem fazer e confira, em cada CLI instalada, o que tem bloqueio técnico e o que vale como diretiva.</p>
        </div>
        {activeSessionCount > 0 && (
          <div className="policy-session-warning" role="status">
            <RotateCcw size={15} />
            <span>
              {`A alteração só vale para sessões iniciadas depois. Reinicie as sessões abertas (${activeSessionCount}) para aplicar.`}
            </span>
          </div>
        )}
        <div className="settings-list settings-list--page policy-list">
          {POLICY_DEFINITIONS.map((policy) => {
            const inputId = `policy-${policy.key}`
            return (
              <div key={policy.key} className="policy-item">
                <label className="policy-item__control" htmlFor={inputId}>
                  <span>
                    <strong>{policy.title}</strong>
                    <small>{policy.description}</small>
                  </span>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={Boolean(settings?.policies?.[policy.key])}
                    disabled={!serviceOnline}
                    onChange={(e) => updatePolicies({ [policy.key]: e.target.checked } as Partial<VerticePolicies>)}
                  />
                </label>
                <div className="policy-effects">
                  <span className="policy-effects__heading">Efeito por CLI instalada</span>
                  {!serviceOnline ? (
                    <p className="policy-effects__empty">
                      Serviço local offline — conecte para ver o efeito real nas CLIs instaladas.
                    </p>
                  ) : !realRuntimes ? (
                    <p className="policy-effects__empty">
                      Verificando as CLIs instaladas nesta máquina…
                    </p>
                  ) : installedRuntimes.length === 0 ? (
                    <p className="policy-effects__empty">
                      Nenhuma CLI instalada detectada nesta máquina.
                    </p>
                  ) : (
                    <ul className="policy-effects__list">
                      {installedRuntimes.map((runtime) => {
                        const effect = runtime.policyEffects?.[policy.key]
                        const kind = effect?.kind === 'technical' ? 'technical' : 'directive'
                        const badgeLabel = kind === 'technical' ? 'Bloqueio técnico' : 'Diretiva'
                        const note = effect?.note?.trim() || policy.fallbackNote
                        return (
                          <li key={runtime.id} className="policy-effect-row">
                            <strong className="policy-effect-row__runtime">{runtime.name}</strong>
                            <span
                              className={`policy-badge policy-badge--${kind}`}
                              title={effect?.source}
                            >
                              {badgeLabel}
                            </span>
                            <span className="policy-effect-row__note">{note}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {!serviceOnline && <p className="org-hint">Conecte o serviço local para editar e salvar as políticas.</p>}
      </section>
    </div>
  )
}

/** G3: log ao vivo de uma instalação, com tempo decorrido e rolagem automática para o fim. */
function InstallLogView({ name, log, onClose }: { name: string; log: InstallLog; onClose: () => void }) {
  const bodyRef = useRef<HTMLPreElement | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!log.running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [log.running])

  useEffect(() => {
    const body = bodyRef.current
    if (body) body.scrollTop = body.scrollHeight
  }, [log.text])

  const seconds = Math.max(0, Math.round((now - log.startedAt) / 1000))
  const elapsed = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`
  const state = log.running ? `Instalando… ${elapsed}` : log.ok ? 'Concluída' : 'Falhou'

  return (
    <div className="install-log-card">
      <header>
        <strong>{name}</strong>
        <span className={`install-log-card__state ${log.running ? 'is-running' : log.ok ? 'is-ok' : 'is-failed'}`}>
          {log.running && <RefreshCw size={12} className="spin" />} {state}
        </span>
        {!log.running && <button className="icon-button icon-button--small" onClick={onClose} aria-label={`Fechar o log de ${name}`}><X size={13} /></button>}
      </header>
      <pre ref={bodyRef} className="install-log">{log.text.trim() || 'Aguardando a primeira saída do instalador…'}</pre>
    </div>
  )
}

function WorkspacePolicy() {
  const { activeProject, allowedWorkspaces, serviceOnline } = useWorkspace()
  const list = serviceOnline && allowedWorkspaces.length
    ? allowedWorkspaces
    : (activeProject ? [{ id: 'ativo', path: activeProject.path }] : [])
  return (
    <div className="workspace-policy">
      {list.map((ws) => (
        <div key={ws.id} className="workspace-policy__row">
          <FolderLock size={16} />
          <span><strong>{ws.path}</strong><small>{ws.path === activeProject?.path ? 'Projeto ativo · ' : ''}leitura, escrita e execução</small></span>
          <span className="cli-status cli-status--installed"><i /> Permitido</span>
        </div>
      ))}
      {!list.length && <div className="workspace-policy__row"><small>Nenhum workspace permitido configurado.</small></div>}
    </div>
  )
}
