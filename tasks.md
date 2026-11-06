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
- [ ] **6.5 (E7)** **Interação por Setas e Enter no Terminal (estilo Maestri):** Permitir navegar em menus interativos de CLIs (ex.: confirmação de Trust/Approve do Antigravity/Claude/Kimi) usando as **setas do teclado (`↑` `↓` `←` `→`), `Enter` vazio, `Esc` e `Ctrl+C`** direto no `TerminalPanel.tsx` (enviando sequências ANSI `\x1b[A`, `\x1b[B`, `\r`, `\x1b`, `\x03` para a sessão PTY viva via `sendRawKey`), além de botões rápidos na barra do terminal e repasse de comandos `/login` etc. para a CLI ativa.
