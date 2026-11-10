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

### [06/11/2026] E11 — Despacho de tarefas e boot (itens 4, 5, 9 da revisão)

- **Despacho (`orchestrator.js`):** instrução montada em UMA linha (`prompt` + `Tarefa: título`, quebras → espaço); sessão NOVA espera a CLI assentar (`waitForSessionReady`: houve saída e ficou quieta 800 ms; desiste em 10 s e segue; retorna na hora se a sessão morrer) via `trackedBroadcast`, que também repassa ao WebSocket; texto e Enter em escritas separadas (200 ms) porque TUIs tratam texto+Enter colados como colagem; `writeToSession` falso → erro "sessão encerrada" e a tarefa NÃO vai para `doing`. `ensureAgentSession` devolve `{ sessionId, created }`; sem projeto ativo → erro claro (400).
- **`completeWorkItem`** devolve `{ ok: false }` para tarefa inexistente e a rota responde 404 (antes `ok: true` e, sem try/catch, risco de requisição pendurada).
- **Detecção (`runtimes.js`):** `detectRuntimes({ force })` com cache de 20 s e `inflight` compartilhado; `GET /api/runtimes?refresh=1` e `POST /runtimes/:id/install` forçam.
- **Frontend:** `refreshService`/boot aplicam o snapshot primeiro e abrem o WebSocket antes da detecção; `api.runtimes(refresh)` com timeout de 90 s (o `get` padrão abortava em 8 s e deixava `realRuntimes` nulo).
- **Verificação:** lógica de espera testada extraindo o código real (silêncio → ~330 ms; saída contínua → só libera após parar, 973 ms; CLI muda → desiste em ~650 ms; sessão encerrada → retorna; `exit` esquece a sessão); montagem da instrução (quebras `\n`/`\r\n` → espaço; sem prompt); cache testado com detecção simulada (1 detecção para 2 chamadas; force simultâneos deduplicados; erro libera nova tentativa); HTTP real: `complete` inexistente 404, `dispatch` sem projeto 400 e a tarefa permanece `todo`. `tsc -b` e `eslint .` exit 0. NÃO verificado: despacho para uma CLI real (PTY/CLI autenticada indisponíveis no sandbox), tempo real da detecção com cache (o `where` trava no sandbox) e o app no navegador. Os tempos (800 ms/10 s/200 ms) são heurísticos: ajustar se alguma CLI demorar mais para exibir o prompt.
- **Ainda abertos da revisão:** API sem validação de enums (status/prioridade/kind), `setTerminalLines` a cada chunk do PTY, `deleteAgent` deixa tarefas órfãs, caminhos com espaço no perfil Windows (`cmd.exe /c`/modo pipe) não testados, mapa nome→id de runtime duplicado no frontend.


### [09/11/2026] Auditoria E9, E10 e E11 (Concluídos e Validados na Máquina Real)

- **Escopo auditado (commits `1179ae4`..`9de26be`):**
  - **E9 (`6.7`) — Operação Limpa do Zero:**
    - Banco `core/data/vertice.db` verificado: `mode = "clean"`, `0` projetos, `0` agentes, `0` conexões, `0` metas, `0` tarefas, `0` eventos e `0` `allowedWorkspaces`, preservando `approvedRuntimes: ["claude", "codex", "kimi", "powershell", "antigravity"]` e `policies` intactas.
    - Rotas `POST /api/workspace/clear` e `POST /api/workspace/reset`, auto-ativação + auto-autorização do primeiro projeto (`assertSafeProjectPath` + `allowProjectWorkspace`), criação do primeiro agente principal (`kind: 'manager'`) quando `agents = []`, e auto-criação do `Gerente` em `POST /api/orchestrator/delegate` conferidos.
  - **E10 (`6.8`) — Segurança do Serviço Local (`core/src/security.js` + `workspace.js` + Electron):**
    - Validação de `Host` e `Origin` em HTTP e WebSocket (`verifyClient`), token por execução (`VERTICE_API_TOKEN` → `--vertice-token` → `preload.cjs` em CommonJS → `X-Vertice-Token` / `?token=`), e bloqueio de `C:\Users` / `Public` / outros perfis em `assertSafeProjectPath`.
  - **E11 (`6.9`) — Despacho em Linha Única + Cache de Runtimes + Boot Rápido:**
    - `dispatchWorkItem` aguarda silêncio de 800ms da sessão nova (`waitForSessionReady`) e envia instrução em linha única + `\r` separado (200ms); cache de 20s + deduplicação em `detectRuntimes`; boot do frontend aplica snapshot e abre WebSocket antes da detecção de CLIs.
- **Testes executados nesta auditoria:**
  - `node --test test/workspace.test.js` em `vertice/core` → **13/13 testes passando**.
  - `npm run lint` (`eslint .`) em `vertice/app` → **0 erros**.
  - `npm run build` (`tsc -b && vite build`) em `vertice/app` → **0 erros** (`dist/` gerado em 8.26s).
- **Observações / Itens menores opcionais identificados na revisão:**
  1. **`smoke-core.ps1` com banco em modo `clean`:** o script atual (`vertice/.agents/skills/vertice-verificacao/scripts/smoke-core.ps1`) exige `$ws.agents.Count -ge 1` na linha 17 e `$ws.allowedWorkspaces[0].path` na linha 58, o que falha se rodado direto num banco recém-limpo (`E9`). Se necessário, adaptar o script para criar um projeto temporário de smoke quando `projects.Count -eq 0` e restaurar o estado ao final.
  2. **5 itens menores listados pelo Kiro em E11 (não bloqueantes para simular a operação):** validação de enums na API (`status`/`priority`/`kind`), otimização de `setTerminalLines` quando o `LiveTerminal` (xterm) já está visível, limpeza/desatribuição de tarefas ao remover agente (`deleteAgent`), teste de caminhos com espaço no modo `pipe`, e unificação do mapa `RUNTIME_NAME_TO_ID` no frontend.


### [09/11/2026] Auditoria do Instalador Desktop (`installers/electron`) — Bugs Reais Encontrados (Task E12)

- **O que foi executado na máquina real:**
  - `npm install` em `vertice/installers/electron` (374 pacotes instalados; `node_modules` mantido no disco para não exigir novo download).
  - Download do binário `electron.exe` (`node node_modules/electron/install.js`) e geração do instalador NSIS via `npm run dist` → gerou `out\Vertice-Setup-0.1.0.exe` (121 MB) e `out\win-unpacked\Vértice.exe`.
  - Teste real do `node-pty@1.1.0` dentro do runtime do Electron 45 (`ABI=150`, `Node 24.22.1`): **FUNCIONOU NATIVAMENTE** (`PTY_IN_ELECTRON_OK`) sem precisar de Visual Studio Build Tools nem `electron-rebuild` (usa N-API pré-compilado em `prebuilds/win32-x64/conpty.node`).

- **Por que o instalador (`Vértice.exe`) NÃO subiu o core de primeira — 4 bugs encontrados (registrados na Task E12):**
  1. **[CRÍTICO — CORE] `ReferenceError: req is not defined` em `GET /api/runtimes` (`core/src/index.js:57-59`):**
     A assinatura da rota na E11 ficou `app.get('/api/runtimes', async (_req, res) => {` mas na linha 59 usa `req.query.refresh === '1'`. Toda chamada a `/api/runtimes` lança `ReferenceError: req is not defined`! Basta trocar `_req` por `req` na linha 57.
  2. **[CRÍTICO — INSTALADOR] `electron-builder` não copia `core/node_modules` em `extraResources` (`installers/electron/package.json`):**
     O `electron-builder` aplica um filtro interno padrão `!**/node_modules/**/*` em `extraResources`. Como resultado, `out\win-unpacked\resources\core\node_modules` não foi criado e o `Vértice.exe` empacotado falhou ao iniciar o core com:
     `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from ...\resources\core\src\index.js`.
     - **Solução:** Adicionar entrada explícita `{ "from": "../../core/node_modules", "to": "core/node_modules", "filter": ["**/*", "!.bin/**", "!.cache/**"] }` em `extraResources` e `"npmRebuild": false` em `"build"`.
  3. **[CRÍTICO — FRONT NO ELECTRON] `BrowserRouter` em `file://` (`app/src/main.tsx`):**
     Com `mainWindow.loadFile(APP_INDEX)`, o `<Navigate to="/agentes" replace />` do `BrowserRouter` altera a URL para `file:///C:/agentes`. Ao recarregar a janela (`Ctrl+R`), o Electron tenta abrir `C:\agentes` no disco e cai em tela em branco (`ERR_FILE_NOT_FOUND`).
     - **Solução:** Usar `HashRouter` em `app/src/main.tsx` (quando `window.location.protocol === 'file:'` ou sempre) e rodar `npm run build` em `app/` (no ambiente sem spawn do Kiro, podemos rodar o `vite build` e `electron-builder` aqui após o ajuste).
  4. **[BUILD / DX] `electron@45.2.1` sem `postinstall` automático (`installers/electron/package.json`):**
     Adicionar `"postinstall": "node node_modules/electron/install.js"` nos `scripts` de `installers/electron/package.json` e `out/` no `.gitignore`.

### [06/11/2026] E12 — Correções do instalador Electron e da rota /api/runtimes

1. **BUG MEU (E11): `GET /api/runtimes` derrubava o core.** A rota declarava `(_req, res)` mas usava `req.query.refresh`. Express 4 não captura rejeição de handler assíncrono, então o `ReferenceError` virava `unhandledRejection` e o Node encerrava o processo. Reproduzido antes da correção (processo encerrado, `ReferenceError` no stderr) e comparado depois (processo segue vivo, stderr limpo). **Por que escapou:** na E11 testei o cache de `detectRuntimes` isolado e a lógica do despacho, mas nunca chamei a rota HTTP (a detecção trava no sandbox) — a verificação não cobriu a camada que mudei. Corrigido: `async (req, res)`.
2. **`core/node_modules` não ia para o pacote.** O electron-builder ignora `node_modules` dentro de `extraResources`; sem `express`/`ws`/`node-pty` o core falha com `ERR_MODULE_NOT_FOUND`. `package.json` do instalador: entrada explícita `../../core/node_modules → core/node_modules` (sem `.bin`/`.cache`), a entrada de `core` passou a excluir `node_modules/**` (evita sobreposição — decisão minha) e `"npmRebuild": false`. Premissa conferida: `node-pty@1.1.0` depende de `node-addon-api` (N-API) e traz `prebuilds/win32-x64`, então NÃO precisa de rebuild nem de Visual Studio Build Tools — o README (D2) dizia o contrário e foi corrigido.
3. **`BrowserRouter` em `file://`.** `main.tsx` usa `HashRouter` quando `location.protocol === 'file:'` (dev/preview seguem com `BrowserRouter`), evitando rota `file:///C:/agentes` e tela em branco no F5.
4. **Electron 45 não baixa o binário no `npm install`** (o pacote publicado não tem `scripts`; só expõe `install-electron`). Adicionado `"postinstall": "node node_modules/electron/install.js"`. `out/` entrou no `.gitignore`.
- **Verificação:** item 1 por teste de processo (antes/depois); `package.json` validado como JSON e as entradas de `extraResources` conferidas; `tsc -b` e `eslint .` exit 0. **NÃO verificado:** `npm run pack`/`dist` (sem rede no sandbox) — falta confirmar que `out\win-unpacked\resources\core\node_modules\express`, `ws` e `node-pty` existem; abrir `Vértice.exe` e testar `/api/health`, `/api/runtimes` e o F5 em cada aba (HashRouter e token no Electron real).


### [09/11/2026] Auditoria Final E12 + SYNC-D — Instalador `Vertice-Setup-0.1.0.exe` Compilado e Validado

- **Build de produção completo:**
  1. `npm run build` em `vertice/app` (`tsc -b && vite build` com `HashRouter` para `file:`) → `0` erros (5.97s).
  2. `electron-builder --win --x64` em `vertice/installers/electron` → gerou o instalador NSIS **`Vertice-Setup-0.1.0.exe` (133 MB)** em `installers/electron/out/Vertice-Setup-0.1.0.exe` e `installers/electron/dist-out/Vertice-Setup-0.1.0.exe`.
- **Verificação do aplicativo empacotado (`win-unpacked\Vértice.exe`):**
  - `resources\core\node_modules\express` = `True`, `ws` = `True`, `node-pty` = `True`.
  - `Vértice.exe` iniciado → `[vertice-core] ouvindo em http://localhost:7845 (ws em /ws)` com **`stderr` 100% limpo** (zero erros).
  - `GET http://localhost:7845/api/health` → `{"ok":true,"service":"vertice-core","version":"0.1.0"}`.
  - `GET http://localhost:7845/api/workspace` → `projects=0, agents=0, approved=claude,codex,kimi,powershell` (estado limpo para operar do zero).
  - `GET http://localhost:7845/api/runtimes` → `200 OK` (`claude(2.1.318), codex(0.167.0), kimi(2.5.2), antigravity(1.5.3), powershell()`).
  - Banco SQLite criado automaticamente em `%APPDATA%\Vértice\data\vertice.db` (`True`).
  - **E12 (`6.10`), E1 e SYNC-D marcados como `[x]` concluídos.**


### [09/11/2026] Nova Task E13 (`6.11` / `B3`) — Mover Automaticamente Tarefas Concluídas pela IA para "Aguardando aprovação" (`review`)

- **Solicitação do usuário:** Assim que as IAs terminarem as tarefas em andamento (`doing`), elas devem mover automaticamente o card para a coluna **"Aguardando aprovação" (`review`)**.
- **Especificação técnica registrada em `tasks-agentes.md` (E13) e `tasks.md` (6.11):**
  1. **Backend (`core/src/orchestrator.js`):**
     - Manter mapa `activeSessionTasks` (`sessionId → { workItemId, agentId, sentAt, instruction, rawChunks, responseStarted, quietTimer }`) alimentado por `dispatchWorkItem` e monitorado em `trackedBroadcast(event)`.
     - Anexar à instrução enviada ao agente: `Ao finalizar esta tarefa, escreva na última linha exatamente: [TAREFA_CONCLUIDA]`.
     - Ignorar o eco inicial do próprio comando enviado ao PTY (primeiros ~800ms ou descartando o trecho que casa com a instrução enviada).
     - Acionar `completeWorkItem(workItemId, { result })` automaticamente quando ocorrer qualquer um dos 3 gatilhos:
       - **(a) Marcador explícito:** saída da IA (após o eco) contém `[TAREFA_CONCLUIDA]` (ou prompt `PS ...>` no PowerShell);
       - **(b) Fim do processo (`exit`):** a sessão encerra (`exitCode === 0` → `review` com `result`; se erro sem resposta, registra aviso);
       - **(c) Silêncio pós-resposta em TUIs interativas (Claude, Kimi, Codex, Antigravity):** após a IA ter produzido saída de resposta real (`responseStarted = true`), se ficar quieta por `IDLE_COMPLETE_MS` (~4500ms) e o final da saída **não** for um menu bloqueante aguardando confirmação do usuário (`Trust`, `Allow`, `[y/n]`, `(y/n)`), concluir a tarefa automaticamente com os últimos ~1500 caracteres limpos em `result`, mudando `status` para `review`, o agente para `idle`, gravando evento no histórico e emitindo `task-updated` no WebSocket.
     - Limpar o monitor em `completeWorkItem` para evitar conclusão duplicada se o usuário mover o card manualmente antes.
  2. **Frontend (`app/src/store/workspace.tsx` + `app/src/pages/Work.tsx`):**
     - Em `workspace.tsx`, ao receber `task-updated` no WebSocket, exibir toast quando uma tarefa migrar para `review` (`toast.success('Tarefa concluída pela IA → Aguardando aprovação')`).
     - Em `Work.tsx` (`WorkCard`), exibir prévia enxuta (1–2 linhas truncadas) de `item.result` quando presente nos cards em `Aguardando aprovação` (`review`) / `Concluído` (`done`).

### [06/11/2026] E13 — Conclusão automática de tarefas (fecha a B3 por outro caminho)

**Problema:** `dispatchWorkItem` movia a tarefa para `doing` e digitava a instrução na CLI, mas nada a levava a `review` quando a IA terminava. As CLIs interativas continuam abertas, então não há "fim de processo": a conclusão tem de ser INFERIDA.

**Implementação:**
- `core/src/task-monitor.js` (novo): `createTaskMonitor` com relógio/timers injetáveis. Gatilhos, em ordem: (1) **marcador** — linha com SOMENTE `[TAREFA_CONCLUIDA]` (aceita bordas/bullets de TUI); (2) **exit** da sessão (código ≠ 0 vira `[Aviso]` no resultado e a tarefa vai para `review`, não `failed`, pois o front não tem coluna `failed`); (3) **silêncio** de 4,5 s depois de resposta real (≥ 20 caracteres úteis), exceto se o fim da saída for um prompt de confirmação ("Trust this folder", `[y/n]`, "Esc to cancel"...); (4) **PowerShell**: volta do prompt `PS ...>` conclui em 600 ms.
- **Armadilha do eco:** o terminal repete o que foi digitado. A instrução pede "a palavra TAREFA_CONCLUIDA entre colchetes" (nunca o marcador já entre colchetes), o monitor ignora a saída dos primeiros 1,5 s e só aceita o marcador sozinho numa linha. No PowerShell o sufixo não é enviado (a instrução vira comando).
- **Prompt bloqueante obsoleto (achado nos testes):** o texto do prompt permanece no buffer (o `stripAnsi` remove os códigos de limpar tela), o que bloquearia para sempre. Agora ele só bloqueia se vieram ≤ 40 caracteres de conteúdo depois dele; redesenhado no fim, volta a bloquear.
- `orchestrator.js`: `startTaskMonitor` ANTES de digitar; `trackedBroadcast` alimenta o monitor (output/exit); `autoCompleteTask` só conclui se a tarefa AINDA estiver em `doing` (não sobrescreve decisão do usuário), registra o evento `complete` antes do broadcast e chama `completeWorkItem(..., { auto: true, reason })`; `completeWorkItem` cancela monitores da tarefa (conclusão manual) e inclui `auto`/`reason` no evento `task-updated`; nova tarefa na mesma sessão substitui o monitor da anterior (a antiga fica `doing` até o usuário decidir). Variável opcional `VERTICE_IDLE_COMPLETE_MS` ajusta o silêncio.
- **Frontend:** `WorkItem.result?`; toast "Tarefa concluída pela IA → Aguardando aprovação" só quando o evento traz `auto: true` (conclusão manual não duplica); card em `review`/`done` mostra as 2 últimas linhas do resultado (`.work-card__result`, completo no `title`).
- **Verificação:** monitor com relógio simulado (23 casos: eco ignorado, palavra sem colchetes ≠ marcador, marcador no meio de frase ≠ marcador, borda de TUI, silêncio e reinício do timer, spinner, prompts bloqueantes e liberação, PowerShell, exit 0/1/imediato, cancelamento, conclui 1x, ANSI/CR/duplicatas/limite 1500); ligação ao orquestrador extraindo o código real (marcador, silêncio, exit, usuário já moveu a tarefa → não sobrescreve, cancelamento manual, segunda tarefa na sessão, sem reconclusão); `completeWorkItem` real com banco temporário (review, resultado salvo, agente `idle` só quando não há outra `doing`, flag `auto` só no automático); `tsc -b` e `eslint .` exit 0.
- **NÃO verificado:** nenhuma CLI real (PTY e login indisponíveis no sandbox). Os padrões de prompt, os tempos e a obediência de cada IA ao pedido do marcador são HEURÍSTICAS: uma CLI que fique quieta >4,5 s "pensando" pode ser concluída cedo; uma que ignore o pedido só conclui por silêncio. Ajustar `idleMs`/`echoMs` com o uso real. A saída ainda traz ruído de TUI (bordas, rodapés). Alterações NÃO commitadas.


### [09/11/2026] Auditoria E13 + Atualização Final do Instalador (`Vertice-Setup-0.1.0.exe`)

- **Auditoria e refinamento em `core/src/task-monitor.js`, `core/src/orchestrator.js` e `core/src/index.js`:**
  - Durante o teste real no `Vértice.exe` empacotado, identificamos que `echoMs = 1500` iniciado antes de `writeToSession` descartava respostas rápidas (< 1.5s, como retorno imediato de prompt ou comandos rápidos), e sessões abertas pelo botão "Iniciar sessão real" do Inspector (`POST /api/sessions` em `index.js`) usavam `onEvent: broadcast` em vez de `trackedBroadcast`.
  - **Correções aplicadas:**
    1. Em `orchestrator.js`, `startTaskMonitor` passa a iniciar imediatamente antes do envio do `\r` (após os 200ms de digitação da instrução, quando o eco já ocorreu).
    2. Em `task-monitor.js`, `echoMs` passou a `0` por padrão com remoção explícita da `instruction` caso reapareça no buffer, verificação de `MARKER_LINE` (`[TAREFA_CONCLUIDA]`) antes de `minResponseChars`, e liberação de `arm()` no retorno do prompt `PS ...>` mesmo em saídas curtas.
    3. Em `index.js` (`POST /api/sessions`), sessões abertas pelo Inspector usam `onEvent: trackedBroadcast` e chamam `registerAgentSession(agentId, session.id)` para que o despachante reutilize a sessão aberta e monitore suas tarefas.
- **Teste real ponta a ponta no `Vértice.exe` empacotado:**
  - `AFTER_DISPATCH: status=doing agent=working` → após 2s: **`AFTER_AUTO_COMPLETE: status=review agent=idle`** com `result` capturado e salvo no SQLite, e banco limpo em seguida (`POST /api/workspace/clear`).
- **Instalador atualizado:**
  - `npm run build` em `vertice/app` (`0` erros, 3.00s) + `electron-builder --win --x64` em `vertice/installers/electron` → **`out\Vertice-Setup-0.1.0.exe`** atualizado e pronto para instalação/distribuição.


### [09/11/2026] Nova Task E14 (`6.12`) — Bugs na Reabertura do App + Edição de Agentes/Tarefas/Projetos + Biblioteca de Prompts Salvos

- **Relato do usuário (com print anexado):**
  1. Ao reabrir o programa tendo apenas **1 agente criado (`Tester`)**, o terminal de `Tester` exibiu texto falso de demonstração (`"Vértice shell — ambiente de demonstração / Workspace: C:\work\atlas / PS> vertice status --team / 5 agentes · 3 executando..."`) e o agente apareceu rodando sem sessão.
  2. Depois de criados, **não é possível editar as Tarefas, nem o Agente e nem os Projetos**.
  3. O sistema de logs e persistência ao fechar/reabrir funcionou muito bem, mas o usuário quer **uma área para salvar os prompts na tela de criar/editar a IA**, garantindo também que os agentes/prompts nunca se desfaçam ao reiniciar o computador ou fechar o programa.

- **Diagnóstico técnico e especificação registrada em `tasks-agentes.md` (`E14`) e `tasks.md` (`6.12`):**
  1. **Causa raiz do Bug 1 (print do terminal de `Tester`):**
     - Em `workspace.tsx:267`, `createAgent` atribuiu `id = 'gerente'` ao 1º agente criado pelo usuário (`Tester`).
     - Em `workspace.tsx:114`, `terminalLines` inicializa com `{ gerente: initialTerminalLines }` (que contém `Workspace: C:\work\atlas` e `5 agentes · 3 executando...`).
     - Ao reabrir o app com 1 agente (`snapshot.agents.length === 1`), `if (snapshot.agents.length === 0) setTerminalLines({})` (`workspace.tsx:138`) não limpou `terminalLines.gerente`, injetando o texto falso da demo dentro do terminal do agente `Tester`!
     - Além disso, no boot de `core/src/db.js`, agentes que estavam `status = 'working'` ao fechar o programa continuam marcados como `working` no SQLite sem processo PTY vivo.
     - **Solução:** Inicializar `terminalLines` como `{}` em `workspace.tsx`, usar `${slug}-${Date.now().toString(36)}` como `id` em `createAgent`, e no boot de `db.js` resetar `UPDATE agents SET status = 'idle' WHERE status = 'working'` e `UPDATE sessions SET status = 'ended' WHERE status = 'running'`.
  2. **Solução do Bug 2 (Edição completa de Agentes, Tarefas, Metas e Projetos):**
     - Adicionar `EditAgentDialog` (ou modo edição em `CreateAgentDialog`) + botões **"Editar"** em `Agentes.tsx` e `Inspector.tsx` (incluindo edição e exclusão do agente `manager`).
     - Adicionar edição/exclusão de Tarefas e Metas em `Work.tsx` + rotas `DELETE /api/work-items/:id`, `PATCH /api/goals/:id` e `DELETE /api/goals/:id` no backend.
     - Adicionar edição/exclusão de Projetos em `Projects.tsx` + rotas `PATCH /api/projects/:id` (validando `path` com `assertSafeProjectPath` e registrando em `allowed_workspaces`) e `DELETE /api/projects/:id` no backend.
  3. **Solução do Item 3 (Biblioteca de Prompts Salvos + Persistência no Boot):**
     - Persistir modelos de prompts no SQLite (`settings.promptTemplates` ou tabela `prompt_templates`, preservados mesmo em `clearWorkspaceData()`) e exibir na tela de Criar/Editar Agente (`AgentDialogs.tsx`) controles para **"Salvar prompt"** e **"Carregar prompt salvo"** (com 1 clique).
     - Adicionar retry automático de conexão no boot do `workspace.tsx` caso o `vertice-core` ainda esteja subindo no primeiro instante da abertura.

  4. **Complemento Essencial na E14 — "Memória Viva" Contínua da Conversa entre Reinicializações:**
     - **Solicitação explícita do usuário:** *"Tudo isso garante que ele vai ter o contexto da conversa antes de ela fechar? Gostaria de memória viva"*.
     - **Arquitetura de Memória Viva adicionada à E14 (`tasks-agentes.md` e `tasks.md`):**
       - **Persistência contínua (`db.js` + `sessions.js` + `orchestrator.js`):** Colunas `memory TEXT` e `last_transcript TEXT` na tabela `agents` + espelhamento automático em `.vertice/memory/<agentId>.md` dentro do workspace do projeto ativo. Durante a sessão (`onData` com debounce ~2s e no `exit`/`killSession`), a conversa limpa é salva no SQLite e no arquivo `.vertice/memory/<agentId>.md` (junto com o histórico de tarefas concluídas por aquele agente).
       - **Restauração visual no Terminal (`workspace.tsx` + `TerminalPanel.tsx`):** Ao reabrir o Vértice, `applySnapshot` carrega `agent.lastTranscript` para dentro de `terminalLines[agent.id]`, exibindo toda a conversa anterior na tela com o marcador `— Memória Viva carregada · contexto anterior preservado —`.
       - **Retomada de contexto pela IA (`orchestrator.js` + `index.js`):** Quando o usuário inicia uma nova sessão real (`POST /api/sessions` ou `dispatchWorkItem`) para um agente que já possui `memory` / `last_transcript` da sessão anterior, o core injeta automaticamente (após `waitForSessionReady`) o contexto da **Memória Viva** (referenciando `.vertice/memory/<agentId>.md` e o resumo/últimos turnos da conversa anterior), garantindo que a IA continue a conversa sabendo exatamente o que foi discutido e feito antes de fechar o programa!
       - **Inspeção e edição da Memória Viva (`Inspector.tsx`):** Aba/seção no Inspector permitindo ao usuário ler, editar ou limpar a Memória Viva acumulada de cada agente.

### [09/11/2026] E14 — Terminal fantasma, edição de tudo, memória viva e biblioteca de prompts

**Incidente durante o desenvolvimento (MEU ERRO):** o primeiro teste HTTP das rotas novas rodou contra a porta 7845, que era do `Vértice.exe` instalado do usuário (o core de teste não conseguiu abrir a porta e o script falou com o app real). O banco do app ficou com: agente `gerente` (era o **Tester**: Antigravity CLI, instrução "Você é responsável por testar todo o programa que está inserido"; função e modelo originais não recuperados) sobrescrito como "Chefe"/"Líder"/Claude Code/"m"/"p"; lixo criado: projeto "P" (pasta em %TEMP%\vertice-e14proj), agentes `w1` ("Worker Editado"), `w2` ("Worker2"), `outro` (cópia marcada como gerente), meta `g1` ("Meta 1"), tarefa `t1` ("Tarefa Editada", status inválido "quase", result "hack") e 2 conexões. Projeto Testeeeer, meta Teste e as 4 tarefas concluídas ficaram intactos. **LIMPEZA PENDENTE** (decisão do usuário): fechar o app, localizar o banco (em %APPDATA%, pasta do app) e remover esses ids exatos com backup. **Regra adotada:** testes HTTP só numa porta livre conferida antes (ex.: 7899) e com banco temporário.

**Backend (`db.js`, `agent-memory.js` novo, `orchestrator.js`, `index.js`, Electron `main.js`):**
- Migração v4 (`agents.memory`, `agents.last_transcript`). No boot, `recoverFromUnexpectedShutdown()`: agentes `working` → `idle` e sessões `running` → `ended` (processos PTY não sobrevivem ao fechamento).
- Memória viva: transcrição limpa por agente (sem ANSI/linhas repetidas, até 15 mil caracteres) gravada com debounce de 2 s, na hora no `exit` da sessão e no encerramento do programa (`shutdownCore()`, chamado pelo `before-quit` do Electron e por SIGINT/SIGTERM no modo standalone); espelhada em `<projeto ativo>/.vertice/memory/<agente>.md` (só dentro de workspace permitido; nome de arquivo saneado). Cada tarefa concluída acrescenta `[data] Tarefa concluída: título → resumo` em `memory` (máx. 8 mil caracteres).
- Retomada: ao abrir uma sessão de um agente que já tinha conversa (≥ 200 caracteres reais) ou memória, a IA recebe UMA linha pedindo para ler `.vertice/memory/<agente>.md` — no Inspector, depois que a CLI sobe; no despacho de tarefa, como prefixo da instrução. Não vale para PowerShell. Decisão: mandar ler o arquivo em vez de colar o histórico no terminal (colar 15 mil caracteres num TUI seria lento e quebraria em várias submissões).
- Rotas: `PATCH/DELETE /api/projects/:id` (pasta validada como na criação; workspace `ws-<id>` trocado/liberado; ativo excluído ativa o próximo), `PATCH /api/agents/:id` validado (tipos, status, runtime do catálogo, supervisor existente e sem ciclo; ignora `id`/`kind`), `DELETE /api/agents/:id` (inclusive gerente; encerra sessões; subordinados sem supervisor, tarefas sem responsável), `POST /api/agents/:id/memory` (`{memory}` ou `{clear:true}`), `PATCH/DELETE /api/goals/:id` (tarefas ficam sem meta), `PATCH /api/work-items/:id` validado (status/prioridade/responsável/meta; não grava `result`), `DELETE /api/work-items/:id` (libera o agente se estava em `doing`), `promptTemplates` em `PATCH /api/settings` (sobrevive a "Limpar workspace"). `GET /api/workspace` traz `lastTranscript`; broadcasts não (peso). Corrigido também: `POST /api/agents` com `parentId` não gravava `created_by` (usado na detecção de ciclos).

**Frontend:**
- Bug 1: `terminalLines` começa `{}` (demo só em `resetDemo`); `createAgent` sempre gera id a partir do nome (nunca `'gerente'`); `reconcileTerminalLines` (novo `src/lib/workspace-helpers.ts`) descarta terminais de agentes inexistentes (mantém `install-*`) e restaura a conversa anterior com o marcador "— Memória viva carregada —"; `lastTranscript` não vai para o estado/localStorage. Boot tenta o core por ~1 min (40 × 1,5 s) antes do modo offline.
- Edição: `EditAgentDialog` (mesmo formulário do criar; supervisor sem o próprio agente e seus descendentes; runtime atual fora da lista continua selecionável); botões Editar/Remover nos cards, no destaque do agente principal (agora removível) e no Inspector; `RemoveAgentDialog` diz o que acontece com subordinados/tarefas/memória. Work: editar/excluir tarefa (com status) e meta; tarefa com status desconhecido aparece em "A fazer" com aviso. Projects: editar/excluir com confirmação (arquivos no disco nunca são apagados). Erros do core (403 de pasta, ciclo...) aparecem como toast e o diálogo continua aberto (`mutate()` em `api.ts`).
- Inspector: aba "Memória" (ver, editar, limpar com confirmação; mostra o arquivo `.vertice/memory/...`).
- Biblioteca de prompts no criar/editar agente: "Carregar prompt salvo" (confirma antes de substituir), "Salvar na biblioteca" (mesmo nome atualiza) e remover. Só online.

**Verificação:** backend — db/migração v3→v4/recuperação (23 casos), `agent-memory.js` (21), rotas HTTP isoladas na porta 7899 (44), gravação da conversa + reabertura em processo novo (14). Frontend — `tsc -b` e `eslint .` exit 0; helpers testados transpilando o próprio arquivo (15 casos, incluindo o cenário do agente `gerente`). **NÃO verificado:** `vite build` (trava no sandbox), nenhuma tela no navegador, sessão PTY real e a nota de retomada chegando a uma CLI real (se a IA de fato lê o arquivo depende da CLI).
- **Achado nos dados do usuário (E13, não corrigido):** a tarefa "Mover o arquivo .txt para a pasta teste" foi concluída 10 ms após o despacho — provavelmente a TUI redesenhou o `[TAREFA_CONCLUIDA]` da resposta anterior. O `result` salvo também traz muito ruído da interface da CLI.
- Alterações NÃO commitadas.

### [10/11/2026] Auditoria Final da E14 (`6.12`), Correção do Redesenho da TUI em `task-monitor.js`, Limpeza do Banco do Usuário e Rebuild do Instalador
- **O que foi auditado e corrigido:**
  1. **Correção do falso-positivo de conclusão automática por redesenho de TUI (`core/src/task-monitor.js`):**
     - **Causa raiz confirmada nos dados reais do usuário (`%APPDATA%\Vértice\data\vertice.db`):** Ao despachar uma 2ª ou 3ª tarefa na mesma sessão de uma TUI de tela cheia (`agy.exe`, `claude`, `kimi`), o envio do `\r` faz a TUI redesenhar toda a janela do terminal de cima a baixo. Esse redesenho inclui as tarefas anteriores no scrollback (com seus respectivos `[TAREFA_CONCLUIDA]`) seguidas do prompt da tarefa atual quebrado em 2+ linhas pela TUI. Como `clean.includes(cleanInstruction)` falhava quando a TUI quebrava linha no meio da instrução, todo o scrollback anterior ficava em `response` e `MARKER_LINE.test(response.slice(-2000))` casava o `[TAREFA_CONCLUIDA]` da tarefa anterior em 10 ms!
     - **Solução aplicada em `core/src/task-monitor.js`:**
       - `buildInstructionBoundaryRegex(cleanInstruction)`: casa a instrução (ou seu sufixo a partir de `Tarefa: <título>`) mesmo quebrada em múltiplas linhas, indentada ou com bordas de TUI (`│`, `>`). Sempre que aparece em `response`, tudo até o fim da **última** ocorrência é descartado (`response = response.slice(lastEnd)`), eliminando de uma só vez tanto o scrollback de tarefas anteriores (e seus `[TAREFA_CONCLUIDA]` antigos) quanto o eco do próprio prompt atual.
       - Proteção para redesenho multi-chunk (`isStalePriorTaskRedraw`): se um redesenho grande trouxer `Tarefa: <anterior>` + `[TAREFA_CONCLUIDA]` no 1º chunk antes de o prompt da tarefa atual chegar no 2º chunk, o marcador antigo é ignorado.
       - Limpeza de molduras/rodapés de TUI (`TUI_CHROME_LINE`: divisórias `────`, prompt vazio `>`, `? for shortcuts`, `esc to cancel`, linhas de spinner `Working.../Loading...` e `└ Tip:`) em `buildResult`, deixando o resumo salvo no card e na Memória Viva limpo.
  2. **Limpeza e restauração do banco do usuário (`%APPDATA%\Vértice\data\vertice.db`):**
     - Criado backup em `%APPDATA%\Vértice\data\vertice.db.bak-pre-e14-clean`.
     - Removidos todos os registros de teste criados acidentalmente (`projects` `P`/`vertice-e14proj`, `allowed_workspaces` correspondente, `agents` `w1`/`w2`/`outro`, `connections` órfãs, `goals` `g1`, `work_items` `t1` e `events >= 57`).
     - Restaurado o agente `gerente` para **`Tester`** (`role: 'Testes e validação'`, `runtime: 'Antigravity CLI'`, `model: 'agy'`, `status: 'idle'`, `prompt: 'Você é responsável por testar todo o programa que está inserido'`) já com a migração v4 aplicada, `memory` preenchida com as entregas reais e sincronizada em `C:\Users\admin\OneDrive\Desktop\IAS\MVP Visual\Teste 1\.vertice\memory\gerente.md`.