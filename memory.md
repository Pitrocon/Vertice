# Vértice — Memory (Memória Viva do Projeto)

> **REGRA #1 (OBRIGATÓRIA PARA TODAS AS IAs E SESSÕES):**
> Toda informação relevante para o avanço da tarefa e **tudo o que foi feito** DEVE ser registrado neste arquivo (`memory.md`) antes de encerrar qualquer etapa ou turno de implementação, e a respectiva tarefa deve ser marcada como concluída em `tasks.md`. Mesmo que a conversa seja compactada, reiniciada ou assumida por outra IA, a leitura de `memory.md` + `tasks.md` deve ser suficiente para retomar o trabalho exatamente de onde parou, sem perda de contexto.

---

## 1. Visão Geral e Diretrizes Inegociáveis

- **Produto:** Vértice — Local Agent OS (Windows). Orquestrador local de equipes de agentes de IA voltado para **pessoas não técnicas** (referência: Paperclip.ing — modelo "gerenciar uma equipe", não "operar CLIs").
- **Identidade Visual:** Base escura (`oklch`), Azul (`--accent`) para ações primárias e navegação, Laranja (`--accent-warm`) para atividade e alertas.
- **Linguagem:** Termos de gestão (cargos, tarefas, metas, aprovações). Terminal é "modo avançado".
- **Honestidade de Execução:** Nunca apresentar simulação como execução real. O que for demonstrativo precisa exibir aviso claro.
- **Segurança no Backend:** Confinamento de diretório (`workspace`) e políticas são impostos tecnicamente pelo `core/`, nunca apenas por prompt ou UI.

---

## 2. Arquitetura Atual do Repositório (`vertice/`)

- `app/` — Frontend React 19 + TypeScript + Vite 7 + Tailwind/CSS custom + `@xyflow/react` (porta `3000`).
  - Estado centralizado em `app/src/store/workspace.tsx`.
  - Cliente HTTP/WS em `app/src/lib/api.ts` apontando para `http://localhost:7845`.
  - 5 seções: **Agentes** (`/agentes`), **Work** (`/work`), **Projects** (`/projects`), **Organograma** (`/organograma`), **CLI's** (`/org`).
- `core/` — Serviço local em Node.js ESM (Node v26.13.0 na máquina atual), Express + `ws` + `node-pty` + `node:sqlite` (porta `7845`).
  - `core/src/index.js`: servidor HTTP + WebSocket (`/ws`) + rotas REST (`/api/health`, `/api/runtimes`, `/api/catalog`, `/api/sessions`, `/api/events`).
  - `core/src/runtimes.js`: catálogo e detecção real de 9 runtimes (`claude`, `codex`, `kimi`, `glm`, `antigravity`, `opencode`, `ollama`, `lmstudio`, `powershell`).
  - `core/src/sessions.js`: criação de sessões reais via `node-pty` (usando `cmd.exe /c` para `.cmd`/`.bat` no Windows) ou fallback `pipe`.
  - `core/src/db.js`: banco SQLite (`core/data/vertice.db`) — atualmente persiste apenas `sessions` e `events`.
- `.agents/skills/` e `SKILLS.md`: 8 skills customizadas cobrindo backend, runtimes, segurança, frontend, orquestração, verificação (com `smoke-core.ps1`) e empacotamento.

---

## 3. Estado Atual: O que é REAL vs. SIMULADO

### Já é REAL e funcional
1. **Detecção de CLIs (`GET /api/runtimes`):** Verifica via `where` + diretórios globais padrão do Windows (`%APPDATA%\npm`, npm-global do Kimi Desktop, `%LOCALAPPDATA%\agy\bin`, `~/.kimi-code/bin`) e testa `--version` usando `cmd.exe /c` para arquivos `.cmd`/`.bat`, além de ping HTTP para Ollama (`:11434`) e LM Studio (`:1234`).
   - *Resolvido em 05/11/2026:* Detecta com versão exata nesta máquina: `claude` (`2.1.318`), `kimi` (`2.4.1`), `antigravity` (`1.4.11`) e `powershell`.
2. **Sessões de terminal reais (`POST /api/sessions`):** Abre processo real via `node-pty` (ConPTY) no Windows e faz streaming de saída por WebSocket (`/ws`).
3. **Instalação de CLIs via UI:** Abre sessão PowerShell real e envia o comando de instalação do catálogo.
4. **Persistência Completa no SQLite (`core/data/vertice.db`):** Tabelas `projects`, `agents`, `connections`, `goals`, `work_items`, `sessions` e `events` com seed automático, endpoints REST (`GET /api/workspace`, `POST /api/workspace/reset`, CRUD de todas as entidades) e broadcast WebSocket (`workspace-updated`). Quando `vertice-core` está online, toda ação na UI é salva no SQLite.

### Ainda é SIMULADO
1. **Delegação do Gerente (`delegateToManager`):** Embora já salve os 3 agentes criados (Estrategista, Analista, Executor) no SQLite, ainda usa templates fixos e não inicia processos reais automaticamente.
2. **Confinamento de Workspace:** O projeto padrão aponta para `C:\work\atlas` (que não existe na máquina), e `safeCwd()` em `core/src/sessions.js` faz fallback silencioso para `homedir()` sem bloquear caminhos fora do workspace.
3. **Políticas do setor e aprovação de CLIs:** Checkboxes na página `CLI's` são apenas visuais.

---

## 4. Histórico Cronológico de Avanços

### [04/11/2026] Fundação e Corte Inicial
- Protótipo original migrado para estrutura `vertice/` (`app/`, `core/`, `docs/`, `runtimes/`, `installers/`).
- Navegação reestruturada em 5 seções no modelo Paperclip.ing com tema escuro Azul + Laranja (`d4abc2a`, `1ea64a5`).
- Implementado `vertice-core` na porta `7845` com detecção de CLIs, sessões `node-pty`, streaming WebSocket e SQLite para sessões/eventos (`53b65d8`).
- Adicionados Kimi, GLM (Z.ai) e Antigravity ao catálogo; corrigido spawn de `.cmd` no Windows com `cmd.exe /c` (`c2f4e4d`, `3adfff2`).
- Criado `AGENTS.md` documentando regras e roadmap (`31ae0cc`).

### [05/11/2026] Auditoria, Skills, Execução Ao Vivo e Sistema de Memória
- Leitura completa e diagnóstico arquitetural da pasta `vertice/`.
- Criadas 8 skills especializadas em `vertice/.agents/skills/` (`vertice`, `vertice-core-backend`, `vertice-runtimes`, `vertice-workspace-seguranca`, `vertice-frontend`, `vertice-orquestracao`, `vertice-verificacao`, `vertice-empacotamento`) + script `smoke-core.ps1` validado contra o serviço real.
- Criado índice `vertice/SKILLS.md`.
- Subido ambiente completo (`core` em `:7845` + `app` Vite em `:3000`) e validada a tela `CLI's` conectada ao serviço local.
- Identificados dois pontos técnicos na verificação ao vivo:
  1. `detectRuntimes()` em `core/src/runtimes.js` chama `run(runtime.command, runtime.versionArgs)` usando o nome bruto em vez do caminho resolvido (`.cmd`), fazendo a versão do `claude` retornar `null` (`—` na tabela).
  2. O Git local ainda não possui `user.name` e `user.email` configurados, impedindo commits até que sejam definidos.
- Criados `memory.md` e `tasks.md` na raiz de `vertice/` e atualizados `AGENTS.md` e a skill `vertice` para tornar obrigatória a atualização de ambos a cada avanço.
- **Concluídas as Fases 0 (0.7, 0.8) e Fase 1 completa (1.1 a 1.6):**
  - Encerrados os servidores em segundo plano (portas `3000` e `7845` fechadas conforme solicitado).
  - `core/src/runtimes.js`: `run()` agora executa `.cmd`/`.bat` via `cmd.exe /c` e `where()` busca também nos diretórios padrão de instalação de CLIs no Windows (`%APPDATA%\npm`, npm-global do Kimi Desktop, `%LOCALAPPDATA%\agy\bin`, `~/.kimi-code/bin`). Resultado real: `claude` (`2.1.318`), `kimi` (`2.4.1`) e `antigravity` (`1.4.11`) detectados com versão.
  - `core/src/db.js`: adicionadas tabelas `projects`, `agents`, `connections`, `goals`, `work_items`, `seedInitialData()` automático e funções CRUD + `getWorkspaceSnapshot()`.
  - `core/src/index.js`: rotas REST completas (`/api/workspace`, `/api/workspace/reset`, `/api/projects`, `/api/agents`, `/api/agents/batch`, `/api/connections`, `/api/goals`, `/api/work-items`) emitindo `workspace-updated` no WebSocket.
  - `app/src/lib/api.ts` e `app/src/store/workspace.tsx`: sincronização automática com o SQLite no boot e em cada mutação quando `serviceOnline === true`, escutando `workspace-updated` no WebSocket.
  - Testado e validado com `npm run build` no `app/` e `smoke-core.ps1` no `core/` (100% `[OK]`).

---

## 5. Qual é o Próximo Passo Imediato (Fase 2)

**Fase 2 — Confinamento de Workspace e Políticas Reais no Backend (`2.1` a `2.4`):**
Criar `core/src/workspace.js` para validar tecnicamente os diretórios de projetos (`resolveInside`, `assertAllowedCwd`), bloquear acessos fora do workspace com HTTP `403` (removendo o fallback silencioso para `homedir()`), persistir a aprovação de CLIs e políticas da tela `CLI's` no SQLite e mover a instalação de CLIs para um endpoint dedicado (`POST /api/runtimes/:id/install`).

### [05/11/2026] Blocos A e B do tasks-agentes.md — Confinamento (Fase 2) e Orquestração Real (Fases 3/4)
Executado pela Opção 1 (implementação direta seguindo as skills). Os agentes customizados em `.kiro/agents/` são para a aba de agentes do Kiro; não são invocáveis como subagentes de implementação, por isso a execução foi direta.

**Bloco A — Confinamento e Políticas (Fase 2, REAL agora):**
- `core/src/db.js`: tabela `meta` (schema_version), migração idempotente via `columnExists`/`ALTER TABLE` (nunca apaga `data/`). Novas tabelas `settings` (chave/valor JSON) e `allowed_workspaces`. Seed: `approvedRuntimes=[claude,codex,kimi,powershell]`, `policies={allowDestructiveCommands:false,allowNetwork:true,allowCredentials:false}`. Workspace padrão agora `%USERPROFILE%\vertice-workspaces\atlas|intranet` (via `os.homedir()`), migração v2 corrige projetos legados `C:\work\*`. Funções `getSettings/getSetting/setSetting`, `listAllowedWorkspaces/addAllowedWorkspace/removeAllowedWorkspace`; snapshot inclui `settings` e `allowedWorkspaces`.
- `core/src/workspace.js` (NOVO): `resolveInside(root,p)` (realpath do ancestral existente, case-insensitive Windows, rejeita `..`, UNC, dispositivos, prefixo parecido) e `assertAllowedCwd(cwd, allowed)` → `WorkspaceError` (403), sem fallback para homedir(). Testes `core/test/workspace.test.js`: 13/13.
- `core/src/sessions.js`: sem `safeCwd()`/homedir; exige cwd válido; `env` filtrado (remove `VERTICE_*`).
- `core/src/index.js`: `POST /api/sessions` valida cwd (403) e runtime aprovado (403), cria o diretório confinado; novo `POST /api/runtimes/:id/install` (só comando oficial + revalida versão); `GET/PATCH /api/settings` e `POST/DELETE /api/settings/workspaces`.
- SYNC-A verificado: health 200, settings OK, 403 para ollama (não aprovado) e C:\Windows (fora), sessão válida 200 criando `vertice-workspaces\atlas`.

**Bloco B — Orquestração Real (Fases 3/4):**
- B1 `db.js`: `work_items` ganhou `parent_task_id, depends_on, result, error, created_by, created_at, updated_at` (migração v3 idempotente). `agents.progress` descontinuado como fonte de verdade.
- B2/B4/B5 `core/src/orchestrator.js` (NOVO) + `index.js`: `dispatchWorkItem` abre/reusa sessão real confinada e envia a instrução da tarefa (tarefa→doing, agente→working); `completeWorkItem` → review/failed e agente volta a idle (status derivado do real, sem % falsa); `POST /api/orchestrator/delegate` cria subagentes reais + conexões + tarefas validando runtime aprovado e limite; `canDelegate` usa as conexões do organograma. Rotas `POST /api/work-items/:id/dispatch` e `/complete`.
- SYNC-B verificado com PowerShell (runtime aprovado): delegate criou subagente+tarefa reais (200); dispatch abriu sessão PTY confinada em atlas e marcou doing/working; complete marcou review+result e agente idle. Dados de teste limpos.

**B3 PREPARADO, NÃO ATIVADO:** detecção automática de conclusão via modo não interativo exige CLI de IA instalada E autenticada. O Claude NÃO está autenticado nesta máquina, então a conclusão é manual (mover para review/done). O gancho `completeWorkItem` está pronto para quando houver login.

**INCIDENTE DE ENCODING (corrigido):** editar `tasks.md`/`memory.md` com `Get-Content -Raw` + `Set-Content -Encoding UTF8` (Windows PowerShell) corrompeu os acentos por dupla codificação. Restaurado via `git checkout` e reaplicado com `[System.IO.File]::WriteAllText` + UTF8 sem BOM. REGRA: ao editar arquivos com acentos pelo terminal, usar sempre `[System.IO.File]::ReadAllText/WriteAllText` com UTF8 sem BOM.

**Próximo passo:** Bloco C (frontend honesto) — ligar a tela CLI's a `/api/settings` e `/api/runtimes/:id/install`, remover progresso inventado (C2), ligar o Work kanban ao dispatch (C3) e remover o banner de demonstração quando online (C4). Depois Bloco D (manifestos + empacotamento) e E (fechamento).
### [05/11/2026] Bloco C concluído — Frontend Honesto (tasks-agentes.md)
Liga as telas aos dados reais do backend e remove indicadores simulados. Build e lint do app limpos.

- **api.ts:** novos tipos `VerticeSettings`, `VerticePolicies`, `AllowedWorkspace`; `WorkspaceSnapshot` agora inclui `settings`/`allowedWorkspaces`. Novos métodos: `getSettings`, `updateSettings`, `installRuntime`, `dispatchWorkItem`, `completeWorkItem`.
- **store/workspace.tsx:** estado `settings`/`allowedWorkspaces` populado pelo `applySnapshot`. `toggleCliApproved` e `updatePolicies` agora persistem via `PATCH /api/settings`. `installCli` usa o endpoint dedicado `POST /api/runtimes/:id/install` (substitui o `setTimeout` simulado); `checkCli` re-consulta o serviço real. Novos `dispatchWorkItem`/`completeWorkItem` chamam as rotas reais. (Observação de processo: o arquivo usa quebras LF; edições via terminal precisaram usar `\n` — algumas substituições com `\r\n` falharam silenciosamente e foram refeitas.)
- **C1 Org.tsx:** coluna "Aprovada" na tabela de CLIs ligada a `settings.approvedRuntimes` (toggle real, com efeito no backend); políticas do setor agora refletem/salvam `settings.policies` (destrutivos, rede, credenciais); "Workspaces permitidos" lista `allowedWorkspaces` reais. CSS do grid `.cli-row` ajustado de 6 para 7 colunas.
- **C2:** removida a barra de "Progresso simulado" do `AgentNode.tsx` e do `Inspector.tsx`; Inspector mostra o estado (statusLabels) e o workspace real (`activeProject.path`) em vez do hardcoded `C:\work\atlas`.
- **C3 Work.tsx:** mover um card para "Em andamento" (doing) com responsável chama `dispatchWorkItem` (sessão real); mover para "Aguardando aprovação" (review) chama `completeWorkItem`. Offline mantém o comportamento local.
- **C4 App.tsx:** o selo da topbar vira "AMBIENTE REAL · vertice-core" quando `serviceOnline`, e "AMBIENTE DE DEMONSTRAÇÃO" quando offline.

**SYNC-C:** `npm run build` e `npm run lint` sem erros. Validação de integração com o core real: `PATCH /api/settings` altera política (allowNetwork→false) e aprovação; remover a aprovação do powershell fez `POST /api/sessions` desse runtime retornar 403 — prova de que a aprovação de CLI na tela deixou de ser cosmética. TESTE VISUAL NO NAVEGADOR (chrome-devtools) PENDENTE — não disponível nesta sessão; verificar as 5 seções e contraste azul/laranja manualmente.

**Estado real atualizado:** políticas e aprovação de CLIs agora são REAIS ponta a ponta (UI → backend → efeito em sessões). Progresso falso removido da UI. Banner de demonstração honesto conforme conexão.

**Próximo passo:** Bloco D (D1: extrair RUNTIME_CATALOG para manifestos JSON em runtimes/; D2: empacotamento Windows em installers/). Depois Bloco E (fechamento e limpeza de dívidas: package.json "my-app", resíduos de template).