# Vértice — Tasks (Quadro de Tarefas do Projeto)

> **REGRA DE USO:**
> 1. Antes de iniciar qualquer implementação, consulte este arquivo para saber qual é a próxima tarefa pendente (`[ ]`).
> 2. Ao concluir uma tarefa, marque-a imediatamente como `[x]` com a data de conclusão e registre o que foi feito em `memory.md`.
> 3. Se surgirem subtarefas ou bugs durante o desenvolvimento, adicione-os aqui na fase correspondente.

---

## Fase 0 — Fundação, Diagnóstico e Governança
- [x] **0.1** Estrutura inicial do repositório (`app/`, `core/`, `docs/`, `runtimes/`, `installers/`) — *(04/11/2026)*
- [x] **0.2** Navegação em 5 seções (Agentes, Work, Projects, Organograma, CLI's) e identidade Azul + Laranja — *(04/11/2026)*
- [x] **0.3** Serviço local `vertice-core` (`:7845`) com detecção de CLIs, sessões `node-pty`, WebSocket e SQLite inicial (`sessions`, `events`) — *(04/11/2026)*
- [x] **0.4** Catálogo de 9 runtimes (incluindo Kimi, GLM/Z.ai, Antigravity) e correção de spawn `.cmd` no Windows — *(04/11/2026)*
- [x] **0.5** Criação das 8 skills do projeto em `.agents/skills/`, script `smoke-core.ps1` e documento `SKILLS.md` — *(05/11/2026)*
- [x] **0.6** Criação do sistema de memória contínua (`memory.md` e `tasks.md`) e vinculação no `AGENTS.md` — *(05/11/2026)*
- [x] **0.7** Configurar identidade Git no repositório (`git config user.name` / `user.email`) e commitar os arquivos pendentes de documentação/skills — *(05/11/2026)*
- [x] **0.8** Corrigir `detectRuntimes()` em `core/src/runtimes.js` para executar `--version` usando o executável resolvido (`resolveCommand` / `cmd.exe /c` para `.cmd`) e diretórios globais padrão do Windows, exibindo a versão real do Claude Code (`2.1.318`), Kimi (`2.4.1`) e Antigravity (`1.4.11`) — *(05/11/2026)*

---

## Fase 1 — Persistência Completa no SQLite (Substituir `localStorage`)
> **Objetivo:** Fazer com que Projetos, Agentes, Conexões, Metas e Tarefas sejam salvos no SQLite (`core/data/vertice.db`) como fonte única da verdade quando o serviço local estiver online.

- [x] **1.1** Expandir `core/src/db.js` com as tabelas `projects`, `agents`, `connections`, `goals` e `work_items` — *(05/11/2026)*
- [x] **1.2** Implementar seed automático no `core/src/db.js`: se o banco estiver vazio no primeiro boot, popular com os dados iniciais padrão (equivalentes ao `initial.ts`) — *(05/11/2026)*
- [x] **1.3** Criar rotas REST em `core/src/index.js` para CRUD de:
  - `GET/POST /api/workspace` e `POST /api/workspace/reset`
  - `POST /api/projects` e `POST /api/projects/:id/activate`
  - `POST/PATCH/DELETE /api/agents` e `POST /api/agents/batch` (incluindo posição `x, y`, `status`, `task`)
  - `POST /api/connections`
  - `POST /api/goals`
  - `POST/PATCH /api/work-items` — *(05/11/2026)*
- [x] **1.4** Emitir eventos WebSocket (`workspace-updated` com snapshot completo) a cada mutação no backend — *(05/11/2026)*
- [x] **1.5** Atualizar `app/src/lib/api.ts` e `app/src/store/workspace.tsx` para carregar e persistir todas as alterações via API do `core` quando `serviceOnline === true` (mantendo fallback honesto de demonstração apenas se offline) — *(05/11/2026)*
- [x] **1.6** Validar com `smoke-core.ps1` atualizado e build de produção do frontend (`npm run build`) — *(05/11/2026)*

---

## Fase 2 — Confinamento de Workspace e Políticas Reais no Backend
> **Objetivo:** Garantir tecnicamente no `core/` que nenhuma sessão ou operação ocorra fora dos diretórios autorizados e que políticas de TI sejam respeitadas.

- [x] **2.1** Criar tabela/configuração de `settings` e `allowed_workspaces` no `core` (com suporte a criar o diretório do projeto na máquina, caso o usuário autorize, ou selecionar uma pasta existente válida).
- [x] **2.2** Criar módulo `core/src/workspace.js` com `resolveInside(root, targetPath)` e `assertAllowedCwd(cwd)` (validação case-insensitive no Windows, resolução de symlinks/junctions, bloqueio de `..` e caminhos fora do workspace com erro HTTP `403`, removendo o fallback silencioso para `homedir()`).
- [x] **2.3** Persistir no backend a aprovação de CLIs (`approved`) e as políticas da página `CLI's` (`Org.tsx`), recusando `POST /api/sessions` para runtimes não aprovados.
- [x] **2.4** Mover a instalação de CLIs para um endpoint dedicado `POST /api/runtimes/:id/install` que só executa comandos oficiais do catálogo aprovado e revalida a versão ao terminar.

---

## Fase 3 — Fila de Tarefas e Execução Real pelos Agentes
> **Objetivo:** Conectar o quadro `Work` (issues/metas) às sessões reais dos agentes.

- [x] **3.1** Vincular `WorkItem` à execução do agente: ao mover uma tarefa para `Em andamento` (`doing`) com um agente atribuído, iniciar/usar a sessão real do agente no diretório do projeto ativo e enviar a instrução da tarefa.
- [x] **3.2** Sincronizar o estado real do agente (`working`, `idle`, `paused`) no card e no nó do Organograma de acordo com a sessão viva e a tarefa ativa, removendo porcentagens de progresso falsas.
- [ ] **3.3** Permitir anexar o log/saída da sessão ao histórico da tarefa e mover para `Aguardando aprovação` (`review`) quando concluída.

---

## Fase 4 — Orquestração Real pelo Agente Gerente
> **Objetivo:** Substituir a delegação simulada (`delegateToManager`) por criação e coordenação real de subagentes dentro do workspace.

- [x] **4.1** Implementar fluxo onde o Gerente recebe um objetivo, decompõe em subtarefas/subagentes reais (usando um runtime instalado e aprovado, ex.: Claude Code) e registra os subagentes e tarefas no SQLite.
- [x] **4.2** Fazer as conexões do Organograma (`source -> target`) determinarem quem pode delegar tarefas para quem no despachante do `core`.
- [x] **4.3** Remover o banner de "AMBIENTE DE DEMONSTRAÇÃO" quando o `core` estiver conectado e operando 100% sobre dados e sessões reais.

---

## Fase 5 — Manifestos Declarativos e Empacotamento (Intranet)
- [x] **5.1** Extrair `RUNTIME_CATALOG` para arquivos JSON declarativos em `vertice/runtimes/<id>.json` — *(05/11/2026)*
- [x] **5.2** Definir e implementar empacotamento desktop Windows (Electron ou instalador local) em `vertice/installers/` para distribuição interna — *(05/11/2026, scaffold Electron; build do instalador requer máquina com Build Tools)*

---

## Fase 6 — Ajustes Finos da Auditoria (Polimento Final — Bloco E)
- [x] **6.1 (E3)** Alinhar template de delegação do Gerente (`Analista` → `Kimi CLI` em vez de `Ollama` não aprovado no seed) e aumentar `maxAgents` default em `/api/orchestrator/delegate` de `6` para `12` (já que o seed inicia com 4 workers + 3 novos = 7) — *(06/11/2026)*
- [x] **6.2 (E4)** Adicionar coluna `<span>Aprovada</span>` no cabeçalho `.cli-row--head` de `app/src/pages/Org.tsx` (alinhando as 7 colunas) e usar o diretório do projeto ativo no prompt de `TerminalPanel.tsx` (removendo `C:\work\atlas` fixo) — *(06/11/2026)*
- [x] **6.3 (E5)** Tratar o evento WebSocket `task-updated` junto com `workspace-updated` em `app/src/store/workspace.tsx` — *(06/11/2026)*
- [x] **6.4 (E6)** Atualizar `smoke-core.ps1` para usar `$ws.allowedWorkspaces[0].path` no teste de sessão (e testar 403 em `C:\Windows`), corrigir versão do Electron em `installers/electron/package.json` para versão existente no npm (ex.: `^35.0.0`) e commitar todas as alterações no Git — *(06/11/2026)*
- [x] **6.5 (E7)** **Interação por Setas e Enter no Terminal (estilo Maestri):** Permitir navegar em menus interativos de CLIs (ex.: confirmação de Trust/Approve do Antigravity/Claude/Kimi) usando as **setas do teclado (`↑` `↓` `←` `→`), `Enter` vazio, `Esc` e `Ctrl+C`** direto no `TerminalPanel.tsx` (enviando sequências ANSI `\x1b[A`, `\x1b[B`, `\r`, `\x1b`, `\x03` para a sessão PTY viva via `sendRawKey`), além de botões rápidos na barra do terminal e repasse de comandos `/login` etc. para a CLI ativa — *(06/11/2026)*
- [x] **6.6 (E8)** **Emulador de terminal real (`@xterm/xterm` + `@xterm/addon-fit`) em `LiveTerminal.tsx`:** Renderizar saída bruta ANSI das sessões PTY com redimensionamento automático e replay de buffer — *(06/11/2026: instalado via `npm install`, `npm run build` e `npm run lint` OK)*
- [x] **6.7 (E9)** **Operação Limpa do Zero (Limpar Agentes, Projetos, Tarefas e Workspace mantendo apenas as CLIs):**
  - Impedir que `seedInitialData(false)` em `core/src/db.js` repopule agentes/projetos/tarefas/workspaces quando as tabelas estiverem vazias (manter apenas `settings` das CLIs), adicionar `clearWorkspaceData()` + rota `POST /api/workspace/clear` e deixar `core/data/vertice.db` limpo;
  - Ao criar o primeiro projeto (`POST /api/projects`), torná-lo ativo (`active = 1`) automaticamente e registrar seu `path` em `allowed_workspaces`;
  - Permitir criar o primeiro Agente/Gerente quando `agents = []` em `CreateAgentDialog` / `workspace.tsx` e auto-criar o `Gerente` em `delegateToManager` / `POST /api/orchestrator/delegate` se ainda não existir;
  - Sincronizar listas vazias no frontend (`initial.ts` e `applySnapshot` em `workspace.tsx`) para iniciar com `0` agentes, `0` projetos, `0` metas e `0` tarefas, preservando apenas a aba `CLI's` — *(06/11/2026)*
- [x] **6.8 (E10)** **Segurança do serviço local (`core/src/security.js`, `workspace.js`, Electron `main.js`/`preload.cjs`):** Validação de `Origin`/`Host` em HTTP e WebSocket, token por execução para `file://` no Electron (`preload.cjs` em CommonJS) e bloqueio de `C:\Users` / `Public` / outros perfis em `assertSafeProjectPath` — *(06/11/2026)*
- [x] **6.9 (E11)** **Despacho em linha única aguardando inicialização da CLI + cache de detecção e boot não-bloqueante:** `dispatchWorkItem` aguarda silêncio da sessão nova (`waitForSessionReady`) e envia texto + `\r` separados; cache de 20s + deduplicação em `detectRuntimes`; boot do frontend carrega workspace e WebSocket antes da detecção de CLIs — *(06/11/2026)*
- [x] **6.10 (E12)** **Correções do Instalador Desktop (`Vertice-Setup-0.1.0.exe`) e `GET /api/runtimes`:**
  1. Corrigir `ReferenceError: req is not defined` em `GET /api/runtimes` (`core/src/index.js` linha 57: trocar `async (_req, res)` por `async (req, res)`).
  2. Incluir `{ "from": "../../core/node_modules", "to": "core/node_modules", "filter": ["**/*", "!.bin/**", "!.cache/**"] }` em `extraResources` do `installers/electron/package.json` (o `electron-builder` ignora `node_modules` dentro de `../../core` por padrão, causando `Cannot find package 'express'` ao abrir `Vértice.exe`).
  3. Trocar `BrowserRouter` por `HashRouter` (ou condicional `window.location.protocol === 'file:'`) em `app/src/main.tsx` para não quebrar a navegação/reload em `file://` no Electron.
  4. Adicionar `"postinstall": "node node_modules/electron/install.js"` em `installers/electron/package.json` e `out/` no `.gitignore` — *(09/11/2026: compilado e validado com `Vertice-Setup-0.1.0.exe` e `Vértice.exe` rodando)*
- [x] **6.11 (E13 / B3)** **Transição Automática `Em andamento` (`doing`) → `Aguardando aprovação` (`review`) ao Concluir Tarefa pela IA (`core/src/orchestrator.js` + `workspace.tsx` + `Work.tsx`):**
  - Rastrear a tarefa ativa por sessão (`activeSessionTasks`) em `core/src/orchestrator.js` ao despachar (`dispatchWorkItem`).
  - Detectar automaticamente o término da execução da IA por 3 gatilhos combinados (ignorando o eco inicial da instrução enviada ao PTY):
    1. Marcador explícito `[TAREFA_CONCLUIDA]` na saída da IA (instruído no final do prompt despachado) ou retorno ao prompt `PS ...>` (PowerShell);
    2. Encerramento do processo da sessão (`event.type === 'exit'`);
    3. Fim de turno / silêncio pós-resposta nas TUIs interativas (`IDLE_COMPLETE_MS` ~4.5s sem novos chunks após a IA já ter iniciado a resposta, desde que a última linha não seja um prompt de confirmação bloqueante `[y/n]` / `Trust`).
  - Chamar automaticamente `completeWorkItem(workItemId, { result })` (que muda a tarefa para `review` / **"Aguardando aprovação"**, volta o agente para `idle` e emite `task-updated` via WebSocket), exibir toast no frontend e mostrar prévia de `item.result` no `WorkCard` (`Work.tsx`) — *(09/11/2026: validado em execução real e empacotado no `Vertice-Setup-0.1.0.exe`)*
- [x] **6.12 (E14)** **Correção do Terminal na Reabertura + Edição de Agentes/Tarefas/Projetos + "Memória Viva" Contínua da Conversa e Biblioteca de Prompts:**
  1. **Bug do terminal na reabertura (`workspace.tsx` + `db.js`):** Inicializar `terminalLines` como `{}` vazio (em vez de `{ gerente: initialTerminalLines }`), não forçar `id = 'gerente'` em `createAgent` quando o usuário cria um agente com outro nome (ex.: `Tester`), e no boot de `db.js` resetar `status = 'working'` → `'idle'` (já que sessões PTY não sobrevivem ao fechamento do app).
  2. **Edição e exclusão de Agentes, Tarefas, Metas e Projetos (`AgentDialogs.tsx`, `Agentes.tsx`, `Inspector.tsx`, `Work.tsx`, `Projects.tsx`, `db.js`, `index.js`):** Permitir editar todos os campos de agentes (inclusive `manager`), tarefas, metas e projetos pela UI e persistir no SQLite.
  3. **Memória Viva da Conversa (`agents.memory` + `agents.last_transcript` no SQLite + `.vertice/memory/<agentId>.md` no workspace) + Biblioteca de Prompts Salvos (`promptTemplates`):**
     - Salvar continuamente a conversa limpa de cada agente (`last_transcript`) e o histórico de entregas (`memory`) no SQLite e em `.vertice/memory/<agentId>.md`;
     - Ao reabrir o programa, restaurar o histórico visual da conversa no terminal do agente e, ao iniciar uma nova sessão real da CLI, injetar automaticamente a **Memória Viva** (contexto da conversa anterior + `.vertice/memory/<agentId>.md`) para que a IA mantenha o contexto de antes de fechar;
     - Permitir salvar/carregar/excluir prompts reutilizáveis na tela de Criar/Editar IA (`promptTemplates`) e visualizar/editar a Memória Viva do agente no `Inspector.tsx` — *(10/11/2026: auditado, falso-positivo de redesenho da TUI corrigido em `task-monitor.js`, banco `%APPDATA%\Vértice\data\vertice.db` restaurado e instalador `Vertice-Setup-0.1.0.exe` atualizado)*.
