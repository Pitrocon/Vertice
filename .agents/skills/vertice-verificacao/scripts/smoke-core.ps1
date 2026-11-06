# Smoke test do vertice-core. Requer o serviço rodando (npm start em vertice\core).
param([string]$Base = 'http://localhost:7845')
$ErrorActionPreference = 'Stop'

function Ok($msg)   { Write-Host "[OK]   $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[FALHA] $msg" -ForegroundColor Red; exit 1 }

try { $health = Invoke-RestMethod "$Base/api/health" -TimeoutSec 5 } catch { Fail "Servico offline em $Base" }
if (-not $health.ok) { Fail 'health nao retornou ok' }
Ok "health: $($health.service) v$($health.version)"

$runtimes = (Invoke-RestMethod "$Base/api/runtimes" -TimeoutSec 60).runtimes
$installed = ($runtimes | Where-Object status -eq 'installed' | ForEach-Object { "$($_.id)($($_.version))" }) -join ', '
Ok "runtimes detectados: $installed"

$ws = Invoke-RestMethod "$Base/api/workspace"
if (-not $ws.agents -or $ws.agents.Count -lt 1) { Fail 'workspace snapshot sem agentes' }
Ok "workspace snapshot SQLite: $($ws.projects.Count) projetos, $($ws.agents.Count) agentes, $($ws.workItems.Count) tarefas"

$newAgent = @{
  id = 'smoke-agent-db'
  name = 'Agente Smoke'
  role = 'Teste SQLite'
  kind = 'worker'
  runtime = 'Claude Code'
  model = 'claude-sonnet'
  status = 'idle'
  task = 'Validar persistencia'
  progress = 0
  prompt = 'Teste'
  x = 100
  y = 100
  parentId = 'gerente'
} | ConvertTo-Json
$afterCreate = Invoke-RestMethod "$Base/api/agents" -Method Post -ContentType 'application/json' -Body $newAgent
if (-not ($afterCreate.agents | Where-Object id -eq 'smoke-agent-db')) { Fail 'agente nao persistido no SQLite' }
Ok 'agente criado e persistido no SQLite'

$afterDelete = Invoke-RestMethod "$Base/api/agents/smoke-agent-db" -Method Delete
if ($afterDelete.agents | Where-Object id -eq 'smoke-agent-db') { Fail 'agente nao removido do SQLite' }
Ok 'agente removido do SQLite'

# Confinamento: o backend deve recusar (403) cwd fora do workspace permitido.
function Expect-403($label, $payload) {
  try {
    Invoke-RestMethod "$Base/api/sessions" -Method Post -ContentType 'application/json' -Body ($payload | ConvertTo-Json) | Out-Null
    Fail "$label deveria retornar 403, mas a sessao foi criada"
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    if ($status -ne 403) { Fail "$label retornou HTTP $status (esperado 403)" }
    Ok "$label bloqueado com 403"
  }
}
Expect-403 'cwd fora do workspace (C:\Windows)' @{ agentId = 'smoke-test'; runtimeId = 'powershell'; cwd = 'C:\Windows' }
Expect-403 'cwd com traversal (..)' @{ agentId = 'smoke-test'; runtimeId = 'powershell'; cwd = ((($ws.allowedWorkspaces)[0].path) + '\..\..') }

# Sessao valida: usa o primeiro workspace permitido (nao o diretorio atual do script).
$allowed = ($ws.allowedWorkspaces)[0].path
if (-not $allowed) { Fail 'nenhum workspace permitido configurado no core' }
$body = @{ agentId = 'smoke-test'; runtimeId = 'powershell'; cwd = $allowed } | ConvertTo-Json
$session = (Invoke-RestMethod "$Base/api/sessions" -Method Post -ContentType 'application/json' -Body $body).session
if (-not $session.id) { Fail 'sessao nao criada' }
Ok "sessao criada: modo $($session.mode) ($($session.cwd))"

$payload = @{ data = "Write-Output vertice-smoke`r" } | ConvertTo-Json
$sent = Invoke-RestMethod "$Base/api/sessions/$($session.id)/input" -Method Post -ContentType 'application/json' -Body $payload
if (-not $sent.ok) { Fail 'falha ao enviar input' }
Ok 'input enviado'

Start-Sleep -Seconds 2
$active = (Invoke-RestMethod "$Base/api/sessions").active
if (-not ($active | Where-Object id -eq $session.id)) { Fail 'sessao nao aparece como ativa' }
Ok 'sessao listada como ativa'

Invoke-RestMethod "$Base/api/sessions/$($session.id)" -Method Delete | Out-Null
Ok 'sessao encerrada'

$events = (Invoke-RestMethod "$Base/api/events").events | Select-Object -First 3
Ok "ultimos eventos: $(($events.message) -join ' | ')"
