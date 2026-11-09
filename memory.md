# Vértice — Memory (Memória Viva do Projeto)

> **REGRA #1 (OBRIGATÓRIA PARA TODAS AS IAs E SESSÕES):**
> Toda informação relevante para o avanço da tarefa e **tudo o que foi feito** DEVE ser registrado neste arquivo (`memory.md`) antes de encerrar qualquer etapa ou turno de implementação, e a respectiva tarefa deve ser marcada como concluída em `tasks-agentes.md` (quadro ativo) e no `tasks.md` (quadro por fase). Mesmo que a conversa seja compactada, reiniciada ou assumida por outra IA, a leitura de `memory.md` + `tasks-agentes.md` + `tasks.md` deve ser suficiente para retomar o trabalho exatamente de onde parou, sem perda de contexto.

---

## 0. Fluxo de Trabalho Vigente (Agentes + Skills)

> **Atualizado em 05/11/2026.** O projeto passou a ser conduzido por um **time de agentes** e pelo quadro de tarefas por responsável.

- **Quadro de tarefas ativo:** `tasks-agentes.md` — reorganiza o roadmap pendente (Fases 2 a 5 do `tasks.md`) em tarefas acionáveis por agente, com dependências, paralelismo e pontos de verificação (SYNC) por bloco (A, B, C, D, E). O `tasks.md` (quadro por fase técnica) coexiste e deve ser marcado em paralelo.
- **Time de agentes (`.kiro/agents/`):** `vertice-backend` (BACKEND), `vertice-seguranca` (SEG), `vertice-orquestracao` (ORQ), `vertice-frontend` (FRONT), `vertice-runtimes-pacote` (PKG) e `vertice-qa` (QA). Cada agente tem um domínio exclusivo; os handoffs do `tasks-agentes.md` marcam a troca e **dois agentes nunca editam o mesmo arquivo ao mesmo tempo**.
- **Skills do projeto (`.agents/skills/`):** 8 skills especializadas (`vertice`, `vertice-core-backend`, `vertice-runtimes`, `vertice-workspace-seguranca`, `vertice-frontend`, `vertice-orquestracao`, `vertice-verificacao`, `vertice-empacotamento`) com índice em `SKILLS.md`. A skill `vertice` é a porta de entrada obrigatória; `vertice-verificacao` contém o `smoke-core.ps1` e o checklist de honestidade usado pelos SYNCs do QA.
- **Observação sobre invocação:** os agentes de `.kiro/agents/` são perfis da aba de agentes do Kiro; não são subagentes de implementação automaticamente invocáveis. Na prática, a execução tem sido direta seguindo a skill do domínio de cada agente.

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

## 5. Qual é o Próximo Passo Imediato (Bloco D — `tasks-agentes.md`)

Blocos **A** (segurança/Fase 2), **B** (orquestração/Fases 3–4) e **C** (frontend honesto) estão concluídos. A única pendência de B é **B3** (detecção automática de conclusão), que está **preparada mas não ativada** por falta de CLI de IA autenticada na máquina.

**Bloco D — Manifestos e Empacotamento (Fase 5), agente `PKG` (`vertice-runtimes-pacote`), skill `vertice-empacotamento`:**
- **D1 (CONCLUÍDO 05/11/2026):** `RUNTIME_CATALOG` extraído para manifestos declarativos `vertice/runtimes/<id>.json`; `runtimes.js` lê a pasta no boot, com fallback embutido. Ver histórico abaixo.
- **D2 (CONCLUÍDO 05/11/2026):** Scaffold Electron em `vertice/installers/electron/` (main sobe o core in-process, abre `app/dist`, dados em `%APPDATA%\Vertice`). Core preparado com `VERTICE_DATA_DIR`/`VERTICE_RUNTIMES_DIR` e `startCore()` exportado. Falta gerar o `.exe` (`npm run dist`) numa máquina com Build Tools. Ver histórico abaixo.
- **SYNC-D (QA — pendente de máquina normal):** manifestos com detecção intacta (reexecutar `smoke-core.ps1`) + `npm run dist` + smoke test dentro do pacote instalado.

Depois do SYNC-D resta o **Bloco E** (fechamento): E1 (varredura final de honestidade) e E2 (dívida técnica — `app/package.json` hoje `my-app`, remover `info.md`/resíduos de template, avaliar dividir `workspace.tsx` em hooks).

Depois do Bloco D, resta o **Bloco E** (fechamento): E1 (varredura final de honestidade) e E2 (dívida técnica — renomear `package.json` hoje `my-app`, remover `info.md`/resíduos de template, dividir `workspace.tsx` em hooks).

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

### [05/11/2026] Bloco D1 concluído — Manifestos Declarativos de Runtimes (Fase 5.1)
Agente `PKG` (`vertice-runtimes-pacote`), skill `vertice-empacotamento`. Extraído o catálogo hardcoded para arquivos JSON declarativos; `runtimes.js` passa a ler a pasta no boot.

- **`vertice/runtimes/<id>.json` (9 NOVOS):** `claude`, `codex`, `kimi`, `glm`, `antigravity`, `opencode`, `ollama`, `lmstudio`, `powershell`. Cada manifesto traz `id`, `name`, `kind`, `command`, `versionArgs`, `sessionArgs`, `install`, `http`, além de dois campos novos: `authenticates` (true p/ CLIs de IA que exigem login — preparo p/ B3/F1) e `order` (ordem de exibição). O `.gitkeep` da pasta foi removido.
- **`vertice/runtimes/README.md` (NOVO):** documenta o esquema do manifesto e a regra "adicionar uma CLI = criar um arquivo `<id>.json`" (sem editar código).
- **`core/src/runtimes.js`:** `RUNTIME_CATALOG` agora é montado por `loadCatalog()`, que lê `MANIFESTS_DIR` (`core/src/../../runtimes`, resolvido via `import.meta.url`), valida campos obrigatórios (`REQUIRED_FIELDS`), ignora manifestos malformados com `console.warn`, normaliza os campos opcionais e ordena por `order`. Mantido um `FALLBACK_CATALOG` embutido idêntico, usado só se a pasta estiver ausente/vazia (ex.: build empacotado antes de copiar assets) — a detecção nunca quebra. A **forma exportada do catálogo é idêntica à anterior**, então `index.js` (`/api/catalog`, `/api/runtimes/:id/install`, `/api/sessions`) e `orchestrator.js` consomem sem alteração.
- **Verificação:** import do módulo confirma 9 runtimes na ordem correta e com a mesma shape (`command`/`versionArgs`/`sessionArgs`/`install`/`http` preservados); os 9 JSON validam como JSON parseável. OBSERVAÇÃO DE AMBIENTE: nesta sessão o sandbox bloqueia/atrasa o spawn de subprocessos (`where`, erro `0x800700CB` e aviso de FileSystem provider), então `detectRuntimes()` ao vivo e o `smoke-core.ps1` completo deram timeout — não é defeito do código (a lógica de detecção é a mesma que passou em 05/11/2026 e o catálogo carrega instantaneamente). Reexecutar o smoke test numa máquina normal para fechar o SYNC-D.

**Próximo passo:** D2 (empacotamento desktop Windows em `vertice/installers/` — decisão Electron vs. alternativas pendente de confirmação do usuário, ver skill `vertice-empacotamento`), depois SYNC-D e o Bloco E (fechamento).

### [05/11/2026] Bloco D2 concluído — Empacotamento Desktop Windows com Electron (Fase 5.2)
Agente `PKG` (`vertice-runtimes-pacote`), skill `vertice-empacotamento`. Escolhido **Electron** (confirmado pelo usuário), por embutir Node com suporte a `node-pty` e `node:sqlite` — as dependências nativas do core.

**Core preparado para empacotamento (sem acoplar Electron ao core):**
- `core/src/db.js`: `dataDir` agora honra `VERTICE_DATA_DIR` (fallback para `core/data`). No app empacotado, o SQLite vai para `%APPDATA%\Vertice\data`, fora dos arquivos de programa (read-only).
- `core/src/runtimes.js`: `MANIFESTS_DIR` agora honra `VERTICE_RUNTIMES_DIR` (fallback para `../../runtimes`). Permite apontar para os manifestos embarcados em `resources/`.
- `core/src/index.js`: refatorado para exportar `startCore({ port })`, `server` e `PORT`. O `server.listen` saiu do topo do módulo e virou `startCore()`; auto-start só acontece no modo standalone (`node src/index.js`) via checagem de entrypoint (`fileURLToPath(import.meta.url) === resolve(process.argv[1])`). Assim o processo main do Electron importa o core e sobe in-process sem spawnar outro Node. Verificado: importar o módulo não dispara o listen (exports `PORT,server,startCore`).
- Nota: `sessions.js` já filtra `VERTICE_*` do env dos processos filhos (`buildChildEnv`), então as novas vars de config não vazam para as CLIs.

**Scaffold Electron (`vertice/installers/electron/`, NOVOS):**
- `main.js`: processo main ESM. Define `VERTICE_DATA_DIR` (= `app.getPath('userData')/data`) e `VERTICE_RUNTIMES_DIR`; resolve `resourcesRoot` por `app.isPackaged` (dev = `vertice/`; empacotado = `process.resourcesPath`); importa dinamicamente `core/src/index.js` via `pathToFileURL` e chama `startCore()`; abre `BrowserWindow` (contextIsolation ligado, nodeIntegration desligado) carregando `app/dist/index.html` (com fallback honesto se o build não existir); abre links externos no navegador padrão.
- `preload.js`: ponte mínima ESM (`window.vertice = { packaged, coreBaseUrl }`); o frontend continua falando com o core por HTTP/WS em `localhost:7845`.
- `package.json`: deps `electron@45.2.1` (Node 24 embutido → `node:sqlite` disponível), `@electron/rebuild@4.0.1`, `electron-builder@27.0.1`. Scripts `start` (dev), `rebuild` (recompila node-pty para o ABI do Electron), `dist` (NSIS x64), `pack`. `extraResources` copia `core` (sem `data/`), `app/dist` e `runtimes/*.json` para `resources/`. Alvo `nsis` com diretório de instalação escolhível e atalhos.
- `README.md`: build passo a passo (build do app → npm install do core → rebuild nativo → `npm run dist`), pontos de atenção (`node:sqlite` no Electron 45, rebuild do `node-pty`, confinamento intacto, assinatura de código) e checklist de verificação SYNC-D.
- Removido o `.gitkeep` de `installers/`.

**Verificação:** `node --check` OK em `main.js` e `preload.js`; `core/src/index.js` importa e exporta `startCore` sem auto-start; `db.js` com `VERTICE_DATA_DIR` cria o banco no caminho custom e seeda 5 agentes + 2 projetos + settings; catálogo de runtimes carrega 9 dos manifestos. OBSERVAÇÃO DE AMBIENTE: o build real do instalador (`npm run dist`) e o `electron-rebuild` NÃO foram executados nesta sessão — exigem `npm install` do Electron (~downloads grandes) e Visual Studio Build Tools; o sandbox ainda bloqueia/atrasa spawn de subprocessos. Rodar numa máquina Windows normal para gerar e validar o `.exe` (SYNC-D / E1).

**Estado real:** Fase 5 (manifestos + empacotamento) implementada no código. Falta apenas gerar o artefato instalável numa máquina com toolchain e validar em máquina limpa.

**Próximo passo:** Bloco E (fechamento): E1 (varredura final de honestidade + confirmar `tasks.md`/`memory.md` coerentes) e E2 (dívida técnica — `app/package.json` ainda é `"my-app"`; remover `info.md`/resíduos de template; avaliar dividir `workspace.tsx` em hooks). SYNC-D pendente de máquina com Build Tools para empacotar de fato.

### [05/11/2026] Bloco E — Fechamento (E2 concluído, E1 parcial)

**E2 — Dívida técnica (concluído):**
- `app/package.json`: nome `my-app` → `vertice-app`, versão `0.1.0`; `package-lock.json` regenerado via `npm install`.
- Removidos resíduos do gerador: `app/info.md` (apagado), `app/README.md` (template Vite substituído por doc real do Vértice) e o plugin `kimi-plugin-inspect-react` (removido de `vite.config.ts` e das devDependencies; 100 pacotes a menos).
- `app/eslint.config.js`: override para `src/components/ui/**` desligando `react-refresh/only-export-components` e `react-hooks/purity`. Motivo: primitivos shadcn são gerados e exportam variantes junto dos componentes. Antes do override havia 8 erros, todos nesses arquivos.
- `workspace.tsx` (496 linhas) NÃO foi dividido em hooks: o item era condicional ("se necessário"), a store funciona e o risco de regressão superava o ganho.

**E1 — Varredura de honestidade (correções feitas):**
- BUG ENCONTRADO: o frontend nunca chamava `POST /api/orchestrator/delegate`. `delegateToManager` seguia usando templates fixos com `progress` falso e a mensagem "Equipe simulada criada", mesmo online. Corrigido: `api.ts` ganhou `orchestratorDelegate`; online, `delegateToManager` chama o orquestrador real e mostra mensagens honestas (subagentes reais criados, sessões iniciam ao despachar no Work; falha mostra aviso sobre runtimes aprovados). Offline mantém a simulação, rotulada como demonstração.
- `AgentDialogs.tsx`: removido `C:\work\atlas` hardcoded (agora usa o path do projeto ativo, via `scopePath`); rótulos "SIMULAÇÃO"/"simulada neste protótipo" agora dependem de `serviceOnline`; eyebrow "AÇÃO NO PROTÓTIPO" → "REMOVER AGENTE".
- `Projects.tsx`: nota "troca de projeto é visual" era falsa online (ativar/criar projeto persiste no core); agora condicional. Default do campo workspace `C:\work\` removido.
- `Agentes.tsx` + `index.css`: o card ainda exibia barra de `progress` falso (C2 só cobrira AgentNode/Inspector). Trocada por indicador "Em execução" sem porcentagem.
- `Organograma.tsx`: mensagem padrão do terminal "Modo demonstração" agora reflete o estado real (sessão viva / sem sessão / core offline).
- `App.tsx`: textos "protótipo" no modal de preferências ajustados ("Restaurar dados iniciais").
- `AGENTS.md`: seções "O que é REAL" e "O que ainda NÃO é automático" reescritas e roadmap atualizado (estavam desatualizadas, ainda listavam como simulado o que já é real).

**Verificação:** `eslint .` exit 0; `tsc -b` exit 0. NÃO verificado: `vite build` deu timeout (240 s) neste sandbox, que já bloqueia spawn de subprocessos; teste visual no navegador e `smoke-core.ps1` completo também pendentes. Num ambiente normal: `npm run build` no `app/`, depois `smoke-core.ps1` e uma passada nas 5 telas.

**Pendências conhecidas:**
- ~~Mapa `nameToId` do GLM~~ CORRIGIDO (05/11/2026): `core/src/orchestrator.js` agora exporta `runtimeIdFromName()` (fonte única; aceita `GLM CLI`, `GLM CLI (Z.ai)` e o próprio id). `POST /api/orchestrator/delegate` usa essa função e retorna 400 para runtime desconhecido, em vez de cair em `powershell` em silêncio (o que contornaria a checagem de aprovação). Verificado por import: `GLM CLI`/`GLM CLI (Z.ai)`/`glm` → `glm`; `Foo` → `null`; `index.js` carrega. Fluxo HTTP completo não testado (sandbox sem spawn).
- SYNC-D, B3 e SYNC-C visual continuam abertos; F1/F2 seguem como trabalho futuro.
- Itens residuais com "demonstração" no texto são o caminho offline e estão corretos.

**Próximo passo:** Implementar a task **E7 (`6.5` em `tasks.md`) — Interação por Setas e Enter no Terminal (estilo Maestri)**:
- **Contexto (vídeo de referência do Maestri):** Em sessões reais de CLIs de IA (como Antigravity `agy`, Claude Code `claude`, Kimi `kimi`), aparecem menus interativos no terminal (ex.: *"Trust this folder?"*, *"Approve tool execution?"*, seleção de login/tema) onde o usuário navega com as **setas (`↑` / `↓`)** e confirma com **`Enter`**.
- **Problema atual:** `TerminalPanel.tsx` ignora `Enter` quando o input de texto está vazio (`if (!command.trim()) return`) e não captura `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Escape` ou `Ctrl+C`, obrigando o usuário a tentar digitar números/texto em vez de usar as setas.
- **Solução especificada em E7 (`tasks-agentes.md`):**
  1. Adicionar `sendRawKey(data: string)` no `workspace.tsx` que chama `api.sendInput(liveSessions[agent.id].id, data)` diretamente sem `\r` extra, e permitir que comandos `/` que não sejam os 6 internos (`/help`, `/status`, `/agents`, `/create`, `/delegate`, `/clear`) sejam enviados à sessão real.
  2. Capturar `onKeyDown` no `TerminalPanel.tsx` quando houver sessão real ativa (`hasLiveSession`) para enviar imediatamente `\x1b[A` (`↑`), `\x1b[B` (`↓`), `\x1b[C` (`→`), `\x1b[D` (`←`), `\r` (`Enter` com campo vazio), `\x1b` (`Esc`), `\t` (`Tab`) e `\x03` (`Ctrl+C`), mais botões rápidos clicáveis na barra do terminal (`↑`, `↓`, `Enter ↵`, `Esc`, `Ctrl+C`).

### [06/11/2026] Ajustes finos E3–E6 (tasks-agentes.md)

- **E3:** template do `Analista` (store e `ManagerDialog`) trocado de `Ollama` para `Kimi CLI` (`kimi-k2`), runtime aprovado no seed; `maxAgents` default de `/api/orchestrator/delegate` 6 → 12 (o seed tem 4 workers; +3 estourava o limite). Sem isso a delegação online num banco novo falharia (403/400).
- **E4:** `Org.tsx` ganhou a coluna "Aprovada" no cabeçalho (7 colunas, alinhado às linhas). `TerminalPanel` recebe `workspacePath` (de `Organograma.tsx`) e mostra o path real do projeto ativo no prompt (CSS com ellipsis); placeholder "explorar a simulação" → "ver os comandos".
- **E5:** o core já emitia `task-updated` (dispatch/complete) com `snapshot`, mas o frontend só tratava `workspace-updated`. Agora ambos chamam `applySnapshot`.
- **E6 (1):** `smoke-core.ps1` usa o primeiro `allowedWorkspaces` como cwd da sessão válida e ganhou `Expect-403` para `C:\Windows` e para traversal `..`.
- **E6 (2) — CORREÇÃO DA PREMISSA:** conferido no registro npm: `electron@45.2.1` EXISTE (latest 45.2.3; Node 24 embutido, necessário para `node:sqlite`), então NÃO foi feito downgrade para `^35`. O pacote inexistente era `electron-builder@27.0.1` (404; latest 26.18.0, a 27 só tem alpha) — erro meu de D2, vindo de um snippet de busca. Trocado por `26.18.0`. `@electron/rebuild@4.0.1` existe.
- **Verificação:** `tsc -b` e `eslint .` exit 0. Contra o core real (porta 7845): `cwd=C:\Windows` → 403 e traversal → 403 (asserções novas validadas). NÃO verificado: sessão válida (500 por `EPERM` ao criar `%USERPROFILE%\vertice-workspaces\atlas`, e o spawn do PTY travou — ambos limites do sandbox), `/api/runtimes` (detecção dá timeout) e portanto o `smoke-core.ps1` completo. Rodar o smoke numa máquina normal.
- **Commit:** alterações pendentes dos Blocos D/E commitadas em commits separados por escopo (Conventional Commits).

### [06/11/2026] E7 — Navegação por teclado em menus interativos de CLIs (parcial) + E8 aberta

- **`workspace.tsx`:** novo `sendRawKey(data)` (envia bytes/ANSI ao PTY da sessão viva do agente selecionado, sem `\r` extra). `runCommand` agora repassa à sessão viva qualquer entrada (inclusive `/login`, `/trust`), exceto os 6 comandos internos reservados (`RESERVED_COMMANDS`: `/help /status /agents /create /delegate /clear`).
- **`TerminalPanel.tsx`:** props `hasLiveSession` e `onRawKey`. Com sessão real: a área de saída (`tabIndex=0`, `role="log"`) e o input VAZIO capturam `↑ ↓ ← → Enter Esc Tab Espaço` e `Ctrl+C`, enviando `\x1b[A/B/D/C`, `\r`, `\x1b`, `\t`, ` `, `\x03`. Na área de saída também são repassados caracteres simples (ex.: `y`/`n`). Decisões de acessibilidade/usabilidade: `Ctrl+C` com texto selecionado continua sendo "copiar"; `Shift+Tab` não é interceptado (permite sair do terminal pelo teclado); com texto digitado no input as teclas editam o comando normalmente; `Ctrl+C` no input interrompe a CLI mesmo com texto. Barra de controles clicáveis (`↑ ↓ Enter ↵ Esc Ctrl+C`) visível só com sessão real; CSS `.terminal-keys*` (azul = ação) e foco visível.
- **`Organograma.tsx`:** liga `hasLiveSession` e `onRawKey={workspace.sendRawKey}`.
- **Verificação:** `tsc -b` e `eslint .` exit 0; mapeamento testado extraindo `toPtySequence` do próprio arquivo e transpilando (15/15 casos OK, incluindo copiar com seleção e Shift+Tab livre). NÃO testado: sessão real com CLI (sandbox sem PTY/CLI autenticada) nem o comportamento visual no navegador.
- **LIMITAÇÃO CONHECIDA (→ E8):** a saída da sessão ainda passa por `stripAnsi` e vira linhas de texto (`appendSessionOutput`). A entrada por setas/Enter funciona, mas o destaque da opção selecionada não é renderizado e menus redesenhados aparecem repetidos. Por isso a E7 ficou `[~]` e foi aberta a E8 (renderizar com `@xterm/xterm`, como já sugerido na skill `vertice-frontend`).
- Alterações NÃO commitadas (commit só sob pedido).

### [06/11/2026] E8 — Terminal com emulador xterm.js (código pronto, NÃO instalado/testado)

- **Dependências** (`app/package.json`, versão exata, par estável atual conferido no registro npm): `@xterm/xterm@6.0.0` e `@xterm/addon-fit@0.11.0`. O `npm install` FALHOU no sandbox (`ENOTFOUND registry.npmjs.org`, shell sem rede), então as deps foram declaradas à mão e o `package-lock.json` NÃO foi atualizado → é obrigatório rodar `npm install` em `app/` antes de `tsc`/`build` (um `npm ci` falharia).
- **`components/LiveTerminal.tsx` (NOVO):** `Terminal` + `FitAddon`, fundo transparente (`allowTransparency`) e cores hex aproximadas da paleta (o xterm não lê `oklch`). Faz replay do buffer ao montar, assina novos chunks (`data === null` = sessão nova → `term.reset()`), `onData` → PTY, `onResize` (debounce 120 ms; também notifica o tamanho inicial porque o PTY nasce 120x30) e `ResizeObserver` para refit (ignora contêiner com tamanho 0). Teclado: `Ctrl+C` com seleção copia; `Shift+Tab` sai do terminal (não é capturado).
- **`TerminalPanel.tsx`:** com sessão real (`hasLiveSession` + props do emulador) renderiza `LiveTerminal` no lugar da lista de linhas; offline/simulação continua com linhas. Barra de teclas e campo de comando da E7 mantidos. Removidos `handleOutputKeyDown` e o parâmetro `forwardPrintable` (o xterm trata o teclado). O arquivo estava SEM o `import ... from 'react'` quando fui editar (alterado fora da minha sessão); reescrito completo com os imports corretos.
- **`workspace.tsx`:** buffer bruto por agente em `useRef` (até 200 000 chars, descarta chunks antigos), `getRawOutput`, `subscribeRawOutput`, `resizeAgentSession`; saída bruta alimenta o buffer além das linhas (mantidas para o fallback e para após o fim da sessão). **Correção de bug correlato:** o evento `session-started` do core nunca era tratado, então sessões abertas pelo despachante (tarefa → `doing`) não apareciam como vivas na UI; agora registram `liveSessions` e limpam o buffer.
- **`api.ts`:** `resizeSession` (rota `POST /api/sessions/:id/resize` já existia).
- **Verificação:** `eslint .` exit 0. `tsc -b`: único erro é módulo `@xterm/*` não encontrado (+ dois `TS7006` consequentes); o restante compila. A API usada (`onData`, `onResize`, `hasSelection`, `reset`, `loadAddon`, `open`, `attachCustomKeyEventHandler`, `FitAddon.fit`) foi conferida contra os `.d.ts` publicados em `@xterm/xterm@6.0.0` e `@xterm/addon-fit@0.11.0`. NÃO verificado: build, render, resize e navegação por setas com CLI real.
- **Limites conhecidos:** o replay após trocar de agente reescreve o buffer cortado por chunk (pode partir uma sequência de escape no limite de 200 KB); depois que a sessão termina a tela volta para a lista de linhas (texto sem ANSI).
- Alterações NÃO commitadas.


### [06/11/2026] Auditoria E7/E8 (Concluídos) + Nova Task E9 (Operação Limpa do Zero mantendo apenas CLIs)

- **Auditoria e validação de E7 + E8 na máquina com rede:**
  - Executado `npm install` em `vertice/app` → `@xterm/xterm@6.0.0` e `@xterm/addon-fit@0.11.0` instalados com sucesso (0 vulnerabilidades, `package-lock.json` atualizado).
  - Executado `npm run build` (`tsc -b && vite build`) → compilou com **0 erros** em 2.64s.
  - Executado `npm run lint` (`eslint .`) → **0 erros**.
  - Executado `vertice\.agents\skills\vertice-verificacao\scripts\smoke-core.ps1` contra `vertice-core` → **12/12 etapas `[OK]`** (incluindo sessões confinadas e bloqueio 403 de `C:\Windows` e `..`).
  - **E7 e E8 marcadas como `[x]`** em `tasks-agentes.md` e `tasks.md`.

- **Próximo passo — Task E9 (`6.7` em `tasks.md`): Limpar todas as infos de Agentes, Projetos, Tarefas e Workspace mantendo apenas as CLIs (para simular uma operação real do zero):**
  1. **Backend (`core/src/db.js` + `core/src/index.js`):**
     - Hoje `seedInitialData(false)` roda em todo boot e checa `COUNT(*) === 0` em `projects`, `agents`, `connections`, `goals`, `work_items` e `allowed_workspaces`, reinserindo todos os dados de demonstração se o banco for limpo.
     - **Ação:** Criar `clearWorkspaceData()` em `db.js` que apaga `projects`, `agents`, `connections`, `goals`, `work_items`, `allowed_workspaces`, `events` e `sessions` mantendo apenas `settings` (`approvedRuntimes` e `policies` das CLIs). Ajustar `seedInitialData(false)` para **não** repopular agentes/projetos/tarefas/workspaces (garantindo apenas `settings` das CLIs), limpar `core/data/vertice.db` e expor `POST /api/workspace/clear` em `core/src/index.js` (mantendo `POST /api/workspace/reset` para restaurar dados de demo se desejado).
  2. **Criação do primeiro Projeto (`core/src/db.js` + `core/src/index.js`):**
     - Ao criar um projeto em `POST /api/projects` (`createProject`), se não houver projeto ativo ainda (`SELECT COUNT(*) FROM projects WHERE active = 1` for `0`), criá-lo já com `active = 1`.
     - Registrar automaticamente o `path` do projeto criado/ativado em `allowed_workspaces` (`addAllowedWorkspace`) para que `assertAllowedCwd` autorize sessões reais no novo projeto sem erro 403.
  3. **Criação do primeiro Agente / Gerente quando `agents = []` (`app/src/components/AgentDialogs.tsx` + `app/src/store/workspace.tsx` + `core/src/index.js`):**
     - Em `CreateAgentDialog`, quando `agents.length === 0` (ou como opção explícita no `<select>` de Supervisor), exibir `<option value="">Nenhum (Agente Principal / Gerente)</option>`. Quando `parentId` for vazio (`''`), criar o agente com `kind: 'manager'`, `x: 280, y: 0`, sem `createdBy` e sem criar conexão órfã.
     - Em `delegateToManager` (`workspace.tsx`) e `POST /api/orchestrator/delegate` (`core/src/index.js`), se ainda não existir um agente `manager` quando o usuário clicar em "Delegar ao Gerente", auto-criar o `Gerente` (`id: 'gerente'`, `kind: 'manager'`, `runtime: 'Claude Code'`, `model: 'claude-sonnet'`) antes de criar a equipe subordinada (evitando crash `manager is undefined` ou 404).
  4. **Sincronização do estado limpo no Frontend (`app/src/store/workspace.tsx` + `app/src/data/initial.ts`):**
     - Em `applySnapshot` (`workspace.tsx` linha 132), trocar `if (snapshot.events?.length) setEvents(snapshot.events)` por `if (snapshot.events) setEvents(snapshot.events)` e atualizar `selectedId` quando `snapshot.agents` estiver vazio (`setSelectedId(snapshot.agents[0]?.id ?? null)`).
     - Iniciar `initialAgents`, `initialConnections`, `initialGoals`, `initialWorkItems`, `initialProjects` e `initialEvents` vazios por padrão (ou adicionar ação `clearWorkspace` no modal de Preferências / `Ctrl+K`), mantendo `initialCliRuntimes` intacto.

### [06/11/2026] E9 — Estado limpo / operação do zero (mantendo só a aba CLI's)

**Decisão de modelo:** o boot NÃO repovoa mais dados de demonstração. Um banco novo (ou limpo) tem 0 projetos/agentes/conexões/metas/tarefas/workspaces permitidos e só as `settings` das CLIs. A demo virou ação explícita. `meta.workspace_mode` = `clean` | `demo` (bancos antigos são classificados pelo conteúdo, sem alterar dados).

**Core (`db.js`, `workspace.js`, `index.js`):**
- Removido o auto-reseed (`seedInitialData(false)` no boot e o seed de `allowed_workspaces` na migração v1). `seedSettings()` garante só `approvedRuntimes`/`policies`.
- `clearWorkspaceData()` apaga projetos, agentes, conexões, metas, tarefas, `allowed_workspaces`, eventos e histórico de sessões; NUNCA toca em `settings`. `loadDemoData()` (antigo `seedInitialData(true)`) carrega a demo e agora PRESERVA `settings` (antes o reset também zerava aprovações das CLIs).
- Rotas: `POST /api/workspace/clear` (novo; encerra sessões vivas) e `POST /api/workspace/reset` (carrega demo; também encerra sessões).
- Primeiro projeto nasce ativo (`createProject`); criar/ativar projeto registra o path em `allowed_workspaces` (`allowProjectWorkspace`, idempotente, comparação case-insensitive/barra final).
- **DECISÃO DE SEGURANÇA:** como o projeto passa a autorizar o próprio diretório, o `POST /api/projects` agora valida o caminho (`assertSafeProjectPath` em `workspace.js`): exige caminho absoluto, expande `%VAR%`, e recusa UNC/dispositivo, `..`, raiz de unidade, a pasta pessoal inteira e Windows/Program Files/ProgramData (e subpastas, resolvendo junctions) com 403. Sem isso, qualquer chamada à API poderia autorizar `C:\Windows` e anular o confinamento. Limitação: não há autenticação na API local; o confinamento continua sendo por caminho (F2).
- `POST /api/orchestrator/delegate`: sem nenhum gerente, cria o `Gerente` padrão — DEPOIS de validar o time (uma delegação inválida não deixa gerente "fantasma").
- `POST /api/sessions` sem projeto ativo → 400 com mensagem clara ("Crie um projeto na aba Projects…").

**Frontend:** `applySnapshot` sempre sobrescreve eventos, reajusta `selectedId` (ou `null`) e zera `terminalLines` sem agentes; `createAgent` sem supervisor cria o agente principal (`kind: manager`, `id: 'gerente'` se livre, sem conexão órfã) — `CreateAgentDialog` ganhou a opção "Nenhum (agente principal / Gerente)" quando não há gerente; `delegateToManager` não quebra mais com `agents = []`; `removeAgent` não força `'gerente'`; `addProject` online só mostra o projeto se o core aceitar (toast com o motivo do 403, sem projeto fantasma); `startAgentSession` avisa se não há projeto ativo; nova ação `clearWorkspace` (Preferências + Ctrl+K → "Limpar workspace (operar do zero)", com modal de confirmação); estado vazio em Projects. O offline manteve os dados de demonstração (decisão: a task permitia "sincronizar com o snapshot vazio" em vez de esvaziar o `initial.ts`).

**Banco real:** backup em `core/data/vertice.db.bak-20261106-182153` (ignorado pelo Git) e limpeza com `clearWorkspaceData()`: antes proj=2 ag=7 conn=6 goals=2 wi=6 allowed=2 (modo demo) → depois tudo 0, `settings` intactas (`claude,codex,kimi,powershell,antigravity`), e um novo boot continuou vazio.

**Verificação:** (core, banco temporário, servidor real) boot limpo; sessão sem projeto → 400; projeto em `C:\Windows\System32` → 403; raiz `C:\` → 403; projeto válido → 200, ativo e autorizado; `%TEMP%\…` expandido; delegação com runtime não aprovado → 403 e 0 agentes; delegação do zero → 200 criando Gerente + subagente + conexão + tarefa; clear → tudo 0 com settings; demo → 2/5/4/2/6; clear de novo. (app) `tsc -b` e `eslint .` exit 0 (xterm já instalado). NÃO verificado: comportamento no navegador (5 telas vazias, criar projeto → agente → sessão real), `npm run build` e sessão PTY (sandbox).
- Alterações NÃO commitadas.

### [06/11/2026] E10 — Revisão de código: correções de segurança do serviço local

Revisão de leitura do core/app encontrou, e CONFIRMOU rodando contra o servidor real, 3 falhas de segurança (corrigidas):
1. **WebSocket sem checagem de Origin:** qualquer site aberto no navegador conectava em `ws://localhost:7845/ws`, lia a saída dos terminais e, com o id da sessão (vazado em `session-started`), podia enviar input (execução de comandos).
2. **POST "simples" sem corpo passava pelo CORS:** `POST /api/workspace/clear` com `Origin: evil.example` apagou o projeto (CORS só impede a LEITURA da resposta). Furo introduzido pela rota `clear` da E9; também valia para `reset`, `activate`, `install`, `dispatch`.
3. **`assertSafeProjectPath` aceitava `C:\Users` e `C:\Users\Public`:** um projeto ali autorizava trabalho em todos os perfis.

**Correções:** `core/src/security.js` (novo; `checkRequestOrigin`, `isLocalHost`, token com `timingSafeEqual`); middleware global no `index.js` (Host + Origin em toda requisição não-OPTIONS; CORS agora também reflete `file://` quando há token) e `verifyClient` no WebSocket; `workspace.js` recusa pasta que contém o home e pastas do diretório de perfis fora do home; `api.ts` envia `X-Vertice-Token`/`?token=` quando `window.vertice.token` existe; Electron gera o token (`main.js`) e o repassa por `additionalArguments` ao `preload.cjs`. **Bug latente da D2 corrigido:** `preload.js` usava `import` com `"type": "module"`; preloads em sandbox (padrão) exigem CommonJS → renomeado para `preload.cjs` e `package.json` atualizado.

**Verificação (core real, banco temporário, 14/14 OK):** sem Origin → 200; `localhost:3000` → 200; `evil.example` POST/GET → 403; `null` sem token / token errado → 403; `null` com token → 200; Host `evil.example` → 403; WS `evil.example` e `null` sem token → 401; WS sem Origin / localhost / `null`+token → conecta. Caminhos: `C:\Users`, `Public` e outro perfil → bloqueados; subpasta do home, `D:\projetos`, `C:\work\app` → aceitos. `tsc -b` e `eslint .` exit 0. NÃO testado: app empacotado (token/preload no Electron real), fluxo no navegador.

**Riscos remanescentes (não corrigidos, ver revisão):** despacho de tarefa envia o prompt com quebras de linha + `\r` imediato (cada `\n` vira Enter); boot espera a detecção de CLIs (`get()` aborta em 8 s); a API não valida enums de status/prioridade/kind; cada chunk do PTY re-renderiza o app via `setTerminalLines`; `deleteAgent` deixa tarefas órfãs; `ensureAgentSession` sem projeto ativo devolve 403 "Caminho ausente"; caminhos com espaço no perfil Windows (`cmd.exe /c`, modo pipe) não testados.
- Alterações NÃO commitadas.
