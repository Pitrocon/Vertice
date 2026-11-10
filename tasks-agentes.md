# Vértice — Tasks por Agente (Quadro de Execução do Time)

> **O que é este arquivo:** um segundo escopo de tarefas, orientado ao **time de agentes** criado
> em `.kiro/agents/`, que reorganiza o roadmap pendente (Fases 2 a 5 do `tasks.md`) em tarefas
> acionáveis por agente, com dependências, paralelismo e pontos de verificação explícitos.
> Objetivo: levar o Vértice de "protótipo com backend parcial" até **funcional de ponta a ponta**.
>
> **Relação com `tasks.md`:** os dois arquivos coexistem. `tasks.md` é o quadro por fase técnica;
> este é o quadro por responsável. Ao concluir qualquer tarefa aqui, marque também o item
> correspondente no `tasks.md` e registre em `memory.md` (REGRA #1 de continuidade do `AGENTS.md`).
>
> **Formato de cada tarefa:**
> `- [ ] **Tx.y** (AGENTE) — objetivo`
>   - **Aceite:** condição objetiva de pronto.
>   - **Handoff:** o que libera / para quem.
>   - **Demo:** como provar que é real (nada simulado como real).

---

## Legenda de agentes

| Sigla | Agente (`.kiro/agents/`) | Domínio |
|---|---|---|
| `BACKEND` | `vertice-backend` | core/: rotas, WebSocket, SQLite, sessões, sincronização com api.ts |
| `SEG` | `vertice-seguranca` | confinamento de workspace, validação de caminhos, políticas, aprovação de CLIs |
| `ORQ` | `vertice-orquestracao` | Gerente real, fila de tarefas, conexões como rotas, status real |
| `FRONT` | `vertice-frontend` | telas, store, identidade azul/laranja, linguagem de gestor |
| `PKG` | `vertice-runtimes-pacote` | manifestos de CLI, empacotamento para intranet |
| `QA` | `vertice-qa` | build, lint, smoke test, teste no navegador, checklist de honestidade |

---

## Diagnóstico do estado real (base deste escopo)

Levantado por leitura direta do código em 05/11/2026:

- **`core/src/sessions.js`** — `safeCwd()` faz fallback silencioso para `homedir()`; `env: process.env`
  repassa o ambiente inteiro. **Sem confinamento real.**
- **`core/src/index.js`** — `POST /api/sessions` aceita qualquer `runtimeId` do catálogo e qualquer `cwd`;
  não existe `settings` nem aprovação de CLIs no backend.
- **`core/src/db.js`** — `agents.progress` é número inventado; o seed aponta para `C:\work\atlas`
  (inexistente na máquina). Falta `settings`/`allowed_workspaces`; `work_items` não tem
  `parent_task_id`, `depends_on`, `result`, `error`, `created_by`, timestamps.
- **`core/src/runtimes.js`** — catálogo hardcoded (Fase 5.1 quer mover para JSON); instalação só
  joga o comando num PTY, sem revalidar a versão.
- **`app/src/store/workspace.tsx`** — `delegateToManager` usa templates fixos + banner
  "Nenhum processo externo foi iniciado"; `checkCli`/`installCli` são `setTimeout` simulados;
  `toggleCliApproved` só altera estado local; o `progress` exibido vem de número falso.

---

## Ordem e paralelismo

```
Bloco A (SEG + BACKEND)  ──┬──► Bloco B (BACKEND → ORQ)  ──┐
                           │                                ├──► Bloco E (QA — fechamento)
         Bloco C (FRONT) ──┴── acompanha A e B ─────────────┘
Bloco D (PKG) ── corre em paralelo desde o início; sincroniza no fim
QA ── executa um SYNC ao fim de cada bloco (A, B, C, D) e o fechamento final (E)
```

- **A** é pré-requisito de **B** e **C** (segurança é a fundação).
- **C** (frontend) acompanha A e B, ligando as telas assim que os endpoints existem.
- **D** (manifestos + empacotamento) pode começar cedo, pois quase não colide com A/B/C.
- **Nunca** dois agentes editam o mesmo arquivo ao mesmo tempo — os handoffs marcam a troca.

---

## Bloco A — Fundação de Segurança (Fase 2) · pré-requisito de B e C

Trilhas paralelas no início: **A1 (SEG)** e **A2 (BACKEND)** começam juntas; **A3** depende das duas.

- [x] **A1** (SEG) — Criar `core/src/workspace.js` com `resolveInside(root, p)` (`path.resolve` +
  `fs.realpathSync.native`, comparação case-insensitive no Windows, rejeitando `..`, UNC `\\server`,
  dispositivos `\\.\` e `\\?\`) e `assertAllowedCwd(cwd)` que lança erro 403. Cobrir com testes.
  - **Aceite:** rejeita `..\..`, `C:\Windows`, junction apontando para fora, unidade diferente,
    variação de maiúsc/minúsc e UNC; aceita caminho válido dentro do root.
  - **Handoff:** libera A3.
  - **Demo:** rodar os testes e mostrar todos os casos cobertos.

- [x] **A2** (BACKEND) — Adicionar tabelas `settings` (chave/valor) e `allowed_workspaces` em `db.js`,
  com migração via `meta(schema_version)` e `ALTER TABLE` condicional (nunca apagar `data/`).
  Substituir o seed `C:\work\atlas` por um workspace real ou criável.
  - **Aceite:** tabelas criadas em banco já existente sem perda de dados; `schema_version` atualizado.
  - **Handoff:** libera A3 e A5.

- [x] **A3** (BACKEND + SEG) — Aplicar confinamento em `POST /api/sessions`: validar `cwd` com
  `assertAllowedCwd` (403 se fora), recusar `runtimeId` fora de `approvedRuntimes` (403), remover o
  fallback para `homedir()` em `sessions.js` e passar `env` filtrado (sem segredos do Vértice).
  - **Aceite:** sessão fora do workspace → 403 com mensagem em PT-BR; sessão válida inicia normal.
  - **Demo:** `smoke-core.ps1` passando + uma tentativa bloqueada registrada em eventos.

- [x] **A4** (BACKEND) — Criar `POST /api/runtimes/:id/install` dedicado: executa apenas o comando
  oficial do catálogo aprovado e **revalida a versão** ao terminar; emite eventos. Remover a
  instalação "solta" via input de PTY.
  - **Aceite:** instalar runtime aprovado roda o comando e retorna a versão revalidada; não aprovado → 403.
  - **Handoff:** libera C1.

- [x] **A5** (BACKEND) — Endpoints `GET/PATCH /api/settings` (workspaces permitidos, runtimes
  aprovados, políticas) com broadcast `workspace-updated`.
  - **Aceite:** alterar settings persiste no SQLite e dispara snapshot no WebSocket.
  - **Handoff:** libera C1.

- [x] **SYNC-A** (QA) — Verificar o bloco: `npm run build` no `app/`, `smoke-core.ps1`, e os casos de
  403. Emitir veredito antes de liberar B e C.

---

## Bloco B — Orquestração Real (Fases 3 e 4) · depende de A

**B1 (BACKEND)** destrava **B2–B5 (ORQ)**.

- [x] **B1** (BACKEND) — Expandir `work_items` com `parent_task_id`, `depends_on`, `result`, `error`,
  `created_by`, `created_at`, `updated_at` (migração sem perda). Marcar `agents.progress` como
  descontinuado (não mais fonte de verdade).
  - **Aceite:** novas colunas presentes; CRUD de tarefas continua funcionando.
  - **Handoff:** libera B2.

- [x] **B2** (ORQ) — Criar `core/src/orchestrator.js` (despachante): ao mover um `work_item` para
  `doing` com responsável, garantir a sessão real do agente (cwd confinado do projeto ativo,
  validado pelo Bloco A), enviar o prompt da tarefa e emitir `task-updated` via WebSocket.
  - **Aceite:** mover uma tarefa para "Em andamento" abre/usa sessão real e envia a instrução.
  - **Demo:** arrastar um card no Work e ver a sessão real no terminal do Organograma.

- [~] **B3** (ORQ — atendida de outra forma pela E13: detecção por heurística no terminal INTERATIVO, sem modo não interativo; ainda sem validação com CLI real) — Detecção de conclusão via modo não interativo da CLI (pesquisar as flags oficiais
  de Claude/Codex/Kimi antes de implementar; prompt único + exit code/JSON). Resultado → `review`
  (ou `done`), anexando o log/saída ao histórico da tarefa.
  - **Aceite:** a tarefa conclui e migra para "Aguardando aprovação" com log salvo.

- [x] **B4** (ORQ) — Status do agente derivado do real: `working` só com tarefa `doing` + sessão viva;
  `paused` só se a sessão foi pausada de fato; `idle` caso contrário. Sem porcentagem inventada.
  - **Aceite:** o estado exibido corresponde a sessão/tarefa reais.
  - **Handoff:** alinhar com C2.

- [x] **B5** (ORQ) — Gerente real: recebe um objetivo, propõe a equipe em JSON estruturado; o core
  valida (runtime aprovado, cwd no workspace, limite de agentes) e cria agentes + conexões + tarefas
  reais, substituindo os templates fixos de `delegateToManager`. As conexões `source → target`
  governam quem pode delegar a quem (recusar delegação sem conexão).
  - **Aceite:** o Gerente cria um subagente real e delega uma tarefa executada dentro do workspace.
  - **Demo:** critério de sucesso §8 do `docs/transferencia-prototipo.txt` completo.

- [x] **SYNC-B** (QA — validado com PowerShell; fluxo CLI de IA pendente de login) — Verificar o fluxo completo: detectar runtime → criar agente → iniciar sessão
  real → enviar tarefa → stream de saída → status real no canvas → persistência → Gerente cria
  subagente real.

---

## Bloco C — Frontend Honesto (transversal) · acompanha A e B

- [x] **C1** (FRONT) — Ligar a tela CLI's (`pages/Org.tsx`) aos endpoints reais de `settings` (A5) e de
  instalação (A4): aprovação de CLI e políticas passam a persistir no backend; remover o
  `toggleCliApproved` só-local e os `setTimeout` de `checkCli`/`installCli`, usando `installCliReal` /
  `POST /api/runtimes/:id/install`.
  - **Aceite:** aprovar/reprovar CLI reflete no backend e afeta o início de sessão (runtime não
    aprovado não inicia).

- [x] **C2** (FRONT) — Remover o `progress` inventado da UI (Inspector, AgentNode, cards): exibir
  estado em linguagem de gestor ("Executando tarefa X", "Aguardando aprovação") sem porcentagem.
  - **Aceite:** nenhuma barra/percentual falso aparece; o estado vem do backend (B4).

- [x] **C3** (FRONT) — Ligar o Work kanban ao despachante (B2): mover um card dispara a execução real
  e mostra o log/saída no histórico da tarefa.
  - **Aceite:** interação no kanban reflete sessão real e estado da tarefa.

- [x] **C4** (FRONT) — Remover o banner "AMBIENTE DE DEMONSTRAÇÃO" quando `serviceOnline` e tudo operar
  sobre dados/sessões reais; manter o fallback honesto apenas offline.
  - **Aceite:** online = sem banners de simulação; offline = banner claro de demonstração.

- [x] **SYNC-C** (QA — build+lint OK e endpoints reais validados; teste visual no navegador pendente) — Teste no navegador (skill `chrome-devtools`): as 5 seções sem erro no console,
  selo "Serviço local conectado", e contraste da paleta azul/laranja (skill `a11y-debugging`).

---

## Bloco D — Manifestos e Empacotamento (Fase 5) · paralelo desde o início

- [x] **D1** (PKG) — Extrair o `RUNTIME_CATALOG` de `core/src/runtimes.js` para manifestos declarativos
  `vertice/runtimes/<id>.json` (comando de instalação, verificação, autenticação, `sessionArgs`);
  `runtimes.js` passa a ler os manifestos. Não quebrar a detecção atual. — *(05/11/2026)*
  - **Aceite:** a detecção continua funcionando lendo os JSON; adicionar uma CLI = criar um arquivo. ✓

- [x] **D2** (PKG) — Definir e implementar o empacotamento desktop Windows (Electron ou instalador
  local) em `vertice/installers/`, com rebuild dos módulos nativos (`node-pty`, `node:sqlite`) e
  inicialização do core + app juntos. — *(05/11/2026, Electron)*
  - **Aceite:** artefato instalável que sobe o core e abre o app. ✓ scaffold Electron pronto (`installers/electron/`): `main.js` sobe o core in-process e abre `app/dist`; `package.json` com electron-builder (alvo NSIS x64) e `extraResources`; README com build passo a passo.
  - **Demo:** instalar numa máquina limpa da intranet e abrir o Vértice. ⏳ requer `npm run dist` em máquina com Build Tools (ver SYNC-D).

- [x] **SYNC-D** (QA — 09/11/2026: `Vertice-Setup-0.1.0.exe` e `win-unpacked\Vértice.exe` compilados e executados com sucesso; `express`/`ws`/`node-pty` empacotados em `resources\core\node_modules`; `/api/health`, `/api/workspace`, `/api/runtimes` e banco `%APPDATA%\Vértice\data\vertice.db` verificados) — Verificar os manifestos (detecção intacta) e o smoke test dentro do pacote.

---

## Bloco E — Fechamento

- [x] **E1** (QA — varredura e correções feitas em 05/11/2026; `vite build` + `eslint` + instalador validados em 09/11/2026) — Varredura final de honestidade: nada simulado aparece como real em nenhuma tela;
  `AGENTS.md`, `memory.md` e o `tasks.md` original (Fases 2–5) refletem o estado real e estão marcados.
  - **Aceite:** checklist de commit da skill `vertice-verificacao` 100% atendido.

- [x] **E2** (BACKEND + FRONT — 05/11/2026; `workspace.tsx` mantido sem divisão em hooks por decisão: 496 linhas funcionais, risco de regressão sem ganho) — Limpezas de dívida técnica listadas na skill `vertice-frontend`:
  renomear `package.json` (hoje `my-app`), remover `info.md`/resíduos do template do gerador, e
  dividir `workspace.tsx` em hooks (`useAgents`, `useWork`, `useSessions`, `useRuntimes`) se necessário.
  - **Aceite:** build e lint limpos; sem resíduos do template; store organizada.

### Ajustes Finos da Auditoria (para fechar `E1` e `SYNC-D`)

- [x] **E3** (FRONT) — Alinhar runtime da equipe proposta pelo Gerente com `approvedRuntimes` padrão do seed:
  em `app/src/store/workspace.tsx` (template do `Analista` em `delegateToManager`) e em `app/src/components/AgentDialogs.tsx` (`ManagerDialog`), trocar `Ollama` por `Kimi CLI` (`model: 'kimi-k2'`), pois `approvedRuntimes` inicial no `db.js` é `['claude', 'codex', 'kimi', 'powershell']` (com `Ollama`, a delegação online retorna 403 até o usuário aprovar manualmente). Também ajustar o limite `maxAgents` default em `POST /api/orchestrator/delegate` (`core/src/index.js`) de `6` para `12` (o seed já inicia com 4 workers, então criar +3 estourava `4 + 3 > 6`). — *(06/11/2026)*
  - **Aceite:** clicar em "Delegar ao Gerente → Criar equipe" com o banco recém-criado funciona de primeira (HTTP 200) sem exigir configuração prévia.

- [x] **E4** (FRONT) — Corrigir cabeçalho de 7 colunas na tabela de CLIs e prompt do terminal:
  em `app/src/pages/Org.tsx`, adicionar `<span>Aprovada</span>` antes de `<span>Ação</span>` dentro de `.cli-row--head` (hoje o cabeçalho tem 6 colunas e as linhas têm 7); em `app/src/components/TerminalPanel.tsx`, receber `workspacePath` (ou usar o path do projeto ativo) no lugar do texto fixo `PS C:\work\atlas>`. — *(06/11/2026)*
  - **Aceite:** colunas da tabela `CLI's` perfeitamente alinhadas com os títulos e prompt do terminal exibindo o diretório real do projeto ativo.

- [x] **E5** (FRONT) — Escutar evento `task-updated` no WebSocket:
  em `app/src/store/workspace.tsx` (dentro de `connectEvents`), tratar `(event.type === 'workspace-updated' || event.type === 'task-updated') && event.snapshot` chamando `applySnapshot`. — *(06/11/2026)*
  - **Aceite:** despachar ou concluir tarefa atualiza todas as abas abertas em tempo real via WebSocket.

- [~] **E6** (QA + PKG — 06/11/2026: itens 1 e 3 feitos. Item 2 resolvido diferente do pedido: `electron@45.2.1` EXISTE no npm e foi mantido (a 45 traz o Node 24 que o `node:sqlite` exige; `^35` seria downgrade); o pacote inexistente era `electron-builder@27.0.1`, trocado por `26.18.0`. Aceite pendente: `smoke-core.ps1` 100% `[OK]` só confirmável numa máquina normal) — Atualizar `smoke-core.ps1` para o confinamento ativo, ajustar versão do Electron e commitar Blocos D/E:
  1. Em `.agents/skills/vertice-verificacao/scripts/smoke-core.ps1` (linha 43), usar `$ws.allowedWorkspaces[0].path` como `cwd` da sessão de teste (em vez de `(Get-Location).Path`, que agora retorna 403 corretamente pelo confinamento) e adicionar asserção explícita esperando 403 para `C:\Windows`.
  2. Em `installers/electron/package.json`, trocar `"electron": "45.2.1"` (versão inexistente no registro npm) por uma versão estável real (ex.: `"^35.0.0"`).
  3. Commitar todas as alterações pendentes dos Blocos D e E no Git com Conventional Commits. — *(06/11/2026)*
  - **Aceite:** `smoke-core.ps1` passa 100% `[OK]` e `git status` fica limpo.

- [x] **E7** (FRONT — 06/11/2026: implementado e verificado com `npm install` + `npm run build` + `eslint` na máquina real) — **Navegação interativa por teclado (estilo Maestri) para menus de CLIs no Terminal (`TerminalPanel.tsx` + `workspace.tsx`):**
  Quando o usuário abre uma sessão real de uma CLI de IA (ex.: Antigravity `agy`, Claude Code `claude`, Kimi `kimi`, Codex `codex`), a CLI exibe prompts interativos de confirmação ("Trust this folder?", "Allow tool execution?", escolha de tema/login) navegados por **Setas (`↑` `↓` `←` `→`), `Enter`, `Espaço`, `Esc` e `Ctrl+C`**.
  Hoje o `TerminalPanel.tsx` só envia linhas de texto após digitar caracteres + `Enter` (`if (!command.trim()) return`), impedindo usar as setas ou confirmar com `Enter` vazio.
  - **O que implementar:**
    1. Em `workspace.tsx`, expor `sendRawKey(data: string)` que envia os bytes/sequências ANSI diretamente para a sessão PTY ativa (`api.sendInput(liveSessions[agentId].id, data)`), sem adicionar `\r` extra e sem exigir texto. Também liberar comandos com `/` (ex.: `/login`, `/trust`) para irem à sessão viva se não forem os 5 comandos internos reservados (`/help`, `/status`, `/agents`, `/create`, `/delegate`, `/clear`).
    2. Em `TerminalPanel.tsx` (tanto na área `.terminal-output` com `tabIndex={0}` quanto no `<input>` quando estiver vazio), capturar `onKeyDown` quando houver sessão real ativa (`hasLiveSession`) e enviar imediatamente as sequências ANSI do PTY:
       - `ArrowUp` → `\x1b[A`
       - `ArrowDown` → `\x1b[B`
       - `ArrowRight` → `\x1b[C`
       - `ArrowLeft` → `\x1b[D`
       - `Enter` (com input vazio) → `\r`
       - `Escape` → `\x1b`
       - `Tab` → `\t`
       - `Ctrl+C` → `\x03`
    3. Adicionar uma barra compacta de controles interativos no cabeçalho/rodapé do terminal (visível quando `hasLiveSession` for `true`) com botões clicáveis: `↑`, `↓`, `Enter ↵`, `Esc`, `Ctrl+C` (para quem preferir clicar com o mouse ou usar o teclado).
  - **Aceite:** Em uma sessão real de CLI que pede confirmação (como o menu de Trust/Approve do vídeo de referência do Maestri), o usuário consegue subir/descer nas opções usando as **setas do teclado** e confirmar apertando **`Enter`** (sem precisar digitar `1` ou `sim`).

- [x] **E8** (FRONT — 06/11/2026: `@xterm/xterm@6.0.0` e `@xterm/addon-fit@0.11.0` instalados na máquina com rede, `npm run build` (`tsc -b && vite build`) e `npm run lint` passaram com 0 erros) — **Renderizar a saída da sessão real com emulador de terminal (`@xterm/xterm`)**, complemento da E7:
  hoje `appendSessionOutput` aplica `stripAnsi` e cria uma linha de texto por trecho; menus de CLIs que se redesenham com sequências de cursor/cor (opção destacada) aparecem duplicados e sem destaque. Trocar o corpo do `TerminalPanel` por um `Terminal` do xterm.js alimentado pelo `output` bruto do WebSocket (com `resize` já suportado em `POST /api/sessions/:id/resize`), mantendo as linhas de texto só para a simulação/offline. Fixar versão exata da dependência.
  - **Aceite:** num menu "Trust this folder?" de uma CLI real, a opção destacada se move visualmente ao usar as setas e `Enter` confirma.

- [x] **E9** (CORE + FRONT — 06/11/2026; core validado por HTTP contra o servidor real; frontend validado por `tsc`+`eslint` e NÃO testado no navegador; `core/data/vertice.db` limpo com backup `vertice.db.bak-20261106-182153`) — **Limpar todas as infos de Agentes, Projetos, Tarefas e Workspace mantendo apenas as CLIs (Estado Limpo / Operação do Zero):**
  O usuário quer simular uma operação real do zero: **nenhum agente pré-criado, nenhum projeto/workspace pré-carregado, nenhuma tarefa/meta/conexão/evento de demonstração**, mantendo **apenas a aba `CLI's` (`settings` de `approvedRuntimes` e `policies` + detecção real das CLIs)**.
  A auditoria identificou **4 bloqueios no código atual** que impedem limpar o banco simplesmente com `DELETE`:
  1. **Auto-reseed forçado no boot (`core/src/db.js`, linhas 240–280):**
     `seedInitialData(false)` roda em todo boot e checa `if (projectCount === 0)`, `if (agentCount === 0)`, `if (connCount === 0)`, `if (goalCount === 0)`, `if (wiCount === 0)` e `seedSettingsAndWorkspaces()` (`if (wsCount === 0)`), reinserindo os 5 agentes, 2 projetos (`Atlas`, `Intranet`), 4 conexões, 2 metas, 6 tarefas e 2 workspaces permitidos sempre que as tabelas ficam vazias!
     - **Correção no `core/src/db.js`:**
       - Adicionar `clearWorkspaceData()` que apaga `projects`, `agents`, `connections`, `goals`, `work_items`, `allowed_workspaces`, `events` e `sessions` (mantendo `settings` intacta com `approvedRuntimes` e `policies`) e grava `INSERT OR REPLACE INTO meta (key, value) VALUES ('workspace_mode', 'clean')`.
       - Fazer `seedInitialData(false)` NÃO popular `projects`, `agents`, `connections`, `goals`, `work_items` nem `allowed_workspaces` por padrão (ou checar `meta.key = 'seeded'` / iniciar já limpo, mantendo apenas `seedSettingsOnly()` para garantir `approvedRuntimes` e `policies` das CLIs). Executar a limpeza no `core/data/vertice.db` atual para que o banco já inicie zerado (0 agentes, 0 projetos, 0 metas, 0 tarefas, 0 workspaces).
       - Expor rota `POST /api/workspace/clear` em `core/src/index.js` (que encerra sessões ativas, chama `clearWorkspaceData()` e faz `broadcastSnapshot()`) para o usuário poder limpar tudo a qualquer momento pela UI, mantendo `POST /api/workspace/reset` para caso queira carregar os dados de demonstração.
  2. **Criação do primeiro Projeto a partir do zero (`core/src/db.js` + `core/src/index.js`):**
     Hoje `createProject` insere sempre com `active = 0` e NÃO adiciona o `path` em `allowed_workspaces`. Se o banco começar com 0 projetos e 0 `allowed_workspaces` e o usuário criar seu primeiro projeto na aba `Projects`, ele nasce inativo e qualquer sessão real falha com `403 Fora dos diretórios permitidos`.
     - **Correção:** Em `createProject` / `POST /api/projects`, se não houver nenhum projeto ativo (`SELECT COUNT(*) FROM projects WHERE active = 1` for `0`), criar o projeto já com `active = 1`. Além disso, ao criar ou ativar um projeto, registrar automaticamente seu `path` em `allowed_workspaces` (`addAllowedWorkspace({ id: project.id, path: project.path })`) para que o confinamento (`assertAllowedCwd`) autorize imediatamente o diretório do projeto criado pelo usuário.
  3. **Criação do primeiro Agente / Gerente quando `agents = []` (`app/src/components/AgentDialogs.tsx` + `app/src/store/workspace.tsx` + `core/src/index.js`):**
     - Em `CreateAgentDialog` (`AgentDialogs.tsx`): hoje `parentId` inicia em `'gerente'` e o `<select>` de Supervisor só lista `agents.map(...)`. Quando `agents` está vazio (`[]`), o `<select>` fica vazio e `workspace.tsx` força `kind: 'worker'` e cria uma conexão `source: 'gerente'` inexistente!
       - **Correção:** Permitir escolher o papel/tipo (`Gerente / Orquestrador` vs `Especialista / Worker`) ou, quando `agents.length === 0` (ou `parentId === ''`), exibir `<option value="">Nenhum (Agente Principal / Gerente)</option>` no Supervisor. Quando não houver supervisor (`parentId === ''` ou `agents.length === 0`), criar o agente com `kind: 'manager'` (ou `id: 'gerente'` se for o primeiro gerente), posição no topo (`x: 280, y: 0`), `createdBy: undefined`, e **não** criar conexão órfã.
     - Em `delegateToManager` (`workspace.tsx` linha 274) e `POST /api/orchestrator/delegate` (`core/src/index.js` linha 255):
       - Hoje `const manager = agents.find((agent) => agent.kind === 'manager') ?? agents[0]` — se `agents` for `[]`, `manager` é `undefined` e `manager.id` causa crash (`TypeError`)!
       - **Correção:** Se ainda não existir nenhum agente `manager` quando o usuário clicar em **"Delegar ao Gerente"**, auto-criar automaticamente o `Gerente` (`id: 'gerente'`, `name: 'Gerente'`, `role: 'Orquestrador principal'`, `kind: 'manager'`, `runtime: 'Claude Code'`, `model: 'claude-sonnet'`) tanto no backend (`POST /api/orchestrator/delegate`) quanto no frontend antes de delegar os subagentes (ou proteger contra `manager === undefined`).
  4. **Estado inicial e sincronização de listas vazias no Frontend (`app/src/store/workspace.tsx` + `app/src/data/initial.ts`):**
     - Em `workspace.tsx` linha 132: trocar `if (snapshot.events?.length) setEvents(snapshot.events)` por `if (snapshot.events) setEvents(snapshot.events)` para que, quando o banco estiver limpo (`events: []`), os eventos falsos de demonstração sejam limpos.
     - Em `workspace.tsx`, quando `applySnapshot` receber `agents: []`, limpar também `selectedId` (`setSelectedId(snapshot.agents[0]?.id ?? null)`) e `terminalLines` iniciais falsas, e adicionar `clearWorkspace()` (chamando `POST /api/workspace/clear` e limpando o `localStorage`) acessível no modal de Preferências / Command Palette (`Ctrl+K` → "Limpar workspace (operar do zero)").
     - Deixar `initialAgents`, `initialConnections`, `initialGoals`, `initialWorkItems`, `initialProjects` e `initialEvents` vazios por padrão no boot do frontend (ou sincronizar imediatamente com o snapshot vazio do `vertice-core`), mantendo `initialCliRuntimes` intacto.
  - **Aceite:** Ao abrir o app com `vertice-core` rodando, `Agentes` mostra `0` agentes, `Work` mostra `0` tarefas e `0` metas, `Projects` mostra `0` projetos, `Organograma` mostra o canvas limpo (`0 agentes · 0 conexões`) e `CLI's` mostra todas as CLIs reais detectadas e aprovadas. O usuário consegue criar um Projeto, criar um Agente (ou usar "Delegar ao Gerente") e iniciar uma sessão real sem erro 403 ou crash.

- [x] **E10** (CORE + PKG + FRONT — 06/11/2026, revisão de código; testado contra o core real) — **Segurança do serviço local:** (1) WebSocket e HTTP validam Origin/Host (`core/src/security.js`): origens `localhost` e requisições sem Origin passam; `file://`/`null` (app Electron) só com o token da execução; qualquer outra origem → 403 (HTTP) / 401 (WS); Host ≠ localhost → 403 (DNS rebinding). (2) POST sem corpo de sites externos (ex.: `/api/workspace/clear`) deixa de executar. (3) `assertSafeProjectPath` recusa pasta que contém o home (`C:\\Users`) e pastas de outros usuários (`Public`, outros perfis). (4) Electron: token aleatório por execução (`main.js` → `--vertice-token` → `preload.cjs` → `window.vertice.token` → cabeçalho `X-Vertice-Token`/`?token=`); `preload.js` virou `preload.cjs` (preload em sandbox não aceita ESM). PENDENTE: testar o app empacotado (token e preload) numa máquina com Build Tools.

- [x] **E11** (CORE + FRONT — 06/11/2026, revisão de código; lógica testada isoladamente e via HTTP; despacho com CLI real NÃO testado) — **Despacho e boot:** (1) `dispatchWorkItem` envia a instrução em UMA linha (quebras viravam Enter e enviavam o prompt picado), espera a CLI de uma sessão NOVA terminar de subir (saída quieta por 800 ms, máx. 10 s) e manda o Enter em escrita separada após 200 ms; se a sessão morrer, falha com mensagem em vez de marcar `doing`. (2) Sem projeto ativo o despacho responde 400 claro (antes 403 "Caminho ausente"). (3) `complete` de tarefa inexistente responde 404 (antes devolvia ok / requisição pendurada). (4) `detectRuntimes` ganhou cache de 20 s + deduplicação de chamadas simultâneas; `GET /api/runtimes?refresh=1` e a instalação ignoram o cache. (5) O boot do frontend aplica o snapshot e abre o WebSocket ANTES da detecção de CLIs (lenta), que agora tem timeout próprio de 90 s (antes abortava em 8 s e as CLIs "sumiam").

- [x] **E12** (PKG + CORE + FRONT — 09/11/2026: CONCLUÍDO E VALIDADO EM EXECUÇÃO REAL. `npm run build` em `app/` + `electron-builder` geraram `Vertice-Setup-0.1.0.exe` (133 MB); `Vértice.exe` empacotado iniciou `vertice-core` na `:7845` com `stderr` vazio, respondeu `/api/health`, `/api/workspace` (limpo) e `/api/runtimes` (`claude(2.1.318), codex(0.167.0), kimi(2.5.2), antigravity(1.5.3)`), e criou `%APPDATA%\Vértice\data\vertice.db`) — **Correções para o instalador `Vertice-Setup-0.1.0.exe` (Electron) e `GET /api/runtimes` rodarem de ponta a ponta:**
  Ao rodar `npm install` + `npm run dist` em `installers/electron` e executar o binário gerado (`out\win-unpacked\Vértice.exe` e `electron .`), a auditoria encontrou **4 bugs reais** (o `node-pty@1.1.0` já usa N-API pré-compilado e rodou nativamente no Electron 45 `ABI=150 Node 24.22.1` sem precisar de C++ Build Tools!):
  1. **[CRÍTICO — CORE] `ReferenceError: req is not defined` em `GET /api/runtimes` (`core/src/index.js` linhas 57–60):**
     Introduzido na E11: a assinatura da rota está `app.get('/api/runtimes', async (_req, res) => {` mas na linha 59 chama `req.query.refresh === '1'`. Isso lança `UnhandledPromiseRejectionWarning: ReferenceError: req is not defined at core/src/index.js:59:54` em toda chamada a `/api/runtimes`, travando a detecção de CLIs!
     - **Correção:** Trocar `async (_req, res)` por `async (req, res)` na linha 57 de `core/src/index.js`.
  2. **[CRÍTICO — INSTALADOR] `out\win-unpacked\resources\core\node_modules` não é copiado pelo `electron-builder` (`installers/electron/package.json`):**
     O `electron-builder` exclui `node_modules` por padrão dentro de qualquer item de `extraResources` (`!**/node_modules/**/*`), mesmo com `filter: ["**/*", "!data/**", "!node_modules/.cache/**"]`. Ao abrir o `Vértice.exe` empacotado, o `vertice-core` falha ao subir com:
     `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from ...\resources\core\src\index.js`.
     - **Correção:** Adicionar em `extraResources` do `installers/electron/package.json` uma entrada explícita apontando direto para `../../core/node_modules` (ou copiar/declarar as deps):
       ```json
       {
         "from": "../../core/node_modules",
         "to": "core/node_modules",
         "filter": ["**/*", "!.bin/**", "!.cache/**"]
       }
       ```
       e adicionar `"npmRebuild": false` no bloco `"build"` (já que `node-pty@1.1.0` usa N-API pré-compilado compatível com o Electron 45 e não há dependências nativas no `installers/electron`).
  3. **[CRÍTICO — FRONT NO ELECTRON] `<BrowserRouter>` quebra navegação e reload em `file://` (`app/src/main.tsx`):**
     No Electron (`mainWindow.loadFile(APP_INDEX)`), a janela abre em `file:///.../app/dist/index.html`. Com `BrowserRouter`, o `<Navigate to="/agentes" replace />` muda a URL para `file:///C:/agentes`; se o usuário der `Ctrl+R` / `F5` na janela do Electron, o Chromium tenta abrir `C:\agentes` no disco e a tela fica em branco (`ERR_FILE_NOT_FOUND`).
     - **Correção:** Em `app/src/main.tsx`, usar `HashRouter` quando `window.location.protocol === 'file:'` (ou usar `HashRouter` sempre) e recompilar `app/dist` (`npm run build`).
  4. **[BUILD / DX] `electron@45.2.1` não baixa o binário `electron.exe` no `npm install` + `.gitignore` (`installers/electron/package.json` + `.gitignore`):**
     No Electron 45 o pacote removeu o `postinstall` automático e expõe `"install-electron": "install.js"`.
     - **Correção:** Adicionar `"postinstall": "node node_modules/electron/install.js"` nos `scripts` de `installers/electron/package.json` e adicionar `out/` ao `.gitignore` da raiz.
  - **Aceite:** `npm run dist` (ou `npm run pack`) gera `out\win-unpacked\Vértice.exe` contendo `resources\core\node_modules\express`, `ws` e `node-pty`; ao iniciar `Vértice.exe`, `GET http://localhost:7845/api/health` e `GET http://localhost:7845/api/runtimes` respondem `200 OK` sem `ReferenceError` e a janela navega entre as 5 abas sem quebrar no reload.

- [x] **E13** (ORQ + FRONT — 09/11/2026: IMPLEMENTADO E VALIDADO EM EXECUÇÃO REAL NO `Vértice.exe` EMPACOTADO. Ajustado `echoMs` em `task-monitor.js` para iniciar após o envio da instrução (`\r`) e unificado `registerAgentSession`/`trackedBroadcast` em `index.js`; testado `doing` → `review` automático com captura de `result` e retorno do agente para `idle`) — **Mover automaticamente as tarefas em andamento (`doing`) para "Aguardando aprovação" (`review`) assim que a IA terminar a execução (`core/src/orchestrator.js` + `app/src/store/workspace.tsx` + `app/src/pages/Work.tsx`):**
  Hoje, quando uma tarefa é despachada (`dispatchWorkItem`), ela entra em `doing` ("Em andamento") e envia a instrução para a sessão PTY da CLI do agente, mas **nunca avança sozinha para `review` ("Aguardando aprovação")** quando a IA termina de responder/executar — exigindo que o usuário mova o card manualmente.
  - **O que implementar no Backend (`core/src/orchestrator.js`):**
    1. **Rastreador de tarefa ativa por sessão (`activeSessionTasks`):**
       Ao despachar uma tarefa em `dispatchWorkItem(workItemId)` (após enviar a instrução e o `\r`), registrar a tarefa em execução naquela sessão (`sessionId → { workItemId, agentId, sentAt, instruction, rawChunks, responseStarted, quietTimer }`).
    2. **Instrução com marcador explícito de conclusão (sem depender só de heurística de tempo):**
       Incluir no final da instrução enviada ao agente um protocolo simples, por exemplo:
       `Ao finalizar esta tarefa, escreva na última linha exatamente: [TAREFA_CONCLUIDA]`
       - **Cuidado essencial com o eco do PTY:** quando `writeToSession` envia a instrução, o próprio terminal ecoa a linha digitada nos primeiros milissegundos! Portanto, o detector **não** deve disparar no eco do comando enviado (ignorar saída nos primeiros ~800ms ou descartar o trecho que contém a própria string `instruction` / `Ao finalizar esta tarefa, escreva`).
    3. **Três gatilhos automáticos para chamar `completeWorkItem(workItemId, { result })` (movendo `doing` → `review` / "Aguardando aprovação"):**
       - **Gatilho 1 (Marcador explícito na resposta da IA):** Assim que a saída da IA (após o eco inicial) contiver `[TAREFA_CONCLUIDA]` (ou retorno ao prompt do PowerShell `PS ...>` quando o runtime for `powershell`), concluir imediatamente a tarefa com os últimos ~1500 caracteres limpos (sem ANSI) como `result`.
       - **Gatilho 2 (Encerramento da sessão — `event.type === 'exit'`):** Se o processo da CLI encerrar (`exitCode === 0`) enquanto houver tarefa ativa naquela sessão, chamar `completeWorkItem(workItemId, { result })` automaticamente (se `exitCode !== 0` sem saída útil, registrar `error: "Processo encerrado com código X"` ou mover para `review` com aviso).
       - **Gatilho 3 (Fim de turno / Silêncio pós-resposta nas TUIs interativas — Claude, Kimi, Codex, Antigravity):** Como as CLIs interativas continuam abertas esperando o próximo comando depois de terminar a resposta, iniciar/resetar um timer de conclusão por inatividade (`IDLE_COMPLETE_MS`, ex.: `4500ms` sem novos chunks) **somente depois** que a IA já tiver produzido resposta real (após o eco inicial do comando) **e desde que** as últimas linhas da saída **não** sejam um prompt interativo de bloqueio aguardando confirmação do usuário (ex.: `Trust this folder`, `Allow`, `[y/n]`, `(y/n)`, `Yes, I trust`). Quando o timer disparar, chamar `completeWorkItem(workItemId, { result })` e registrar evento `"Tarefa concluída pelo agente e movida para Aguardando aprovação: <título>"`.
    4. **Limpeza ao concluir manualmente:** Se `completeWorkItem(workItemId)` for chamado manualmente antes (ou se a tarefa mudar de status), cancelar o monitor/timer daquela tarefa para não concluir duas vezes.
  - **O que implementar no Frontend (`app/src/store/workspace.tsx` + `app/src/pages/Work.tsx`):**
    1. Em `workspace.tsx`: ao receber o evento WebSocket `task-updated` (quando uma tarefa que estava em `doing` passa para `review`), exibir um toast informativo (`toast.success('Tarefa concluída pela IA → Aguardando aprovação')`).
    2. Em `Work.tsx` (`WorkCard`): quando `item.status === 'review'` (ou `done`) e `item.result` existir, exibir um pequeno resumo/prévia limpa (1–2 linhas truncadas) no card para o gestor ver o que a IA entregou antes de aprovar (`→ Concluído`).
  - **Aceite:** Ao despachar uma tarefa para um agente (`doing`), assim que o agente/CLI termina a execução da entrega (seja por `[TAREFA_CONCLUIDA]`, retorno de prompt ou fim do stream da resposta da IA), o card migra sozinho em tempo real para a coluna **"Aguardando aprovação" (`review`)**, o status do agente volta a **"Disponível" (`idle`)** e o evento/resultado fica salvo no SQLite.

- [x] **E14** (CORE + FRONT — 10/11/2026: CONCLUÍDO E AUDITADO. Backend testado e validado (`agent-memory.js`, `db.js`, `orchestrator.js`, `index.js`, `task-monitor.js`), frontend compilado com `npm run lint` + `vite build`, banco do usuário em `%APPDATA%\Vértice\data\vertice.db` limpo/restaurado e `Vertice-Setup-0.1.0.exe` regerado) — **Correção do terminal fantasma na reabertura + Edição completa de Agentes, Tarefas e Projetos + Biblioteca de Prompts Salvos (`core/src/db.js`, `core/src/index.js`, `workspace.tsx`, `AgentDialogs.tsx`, `Agentes.tsx`, `Inspector.tsx`, `Work.tsx`, `Projects.tsx`):**
  O usuário testou o aplicativo instalado, fechou e reabriu, e reportou **3 problemas**:

  1. **Bug 1 — Ao reabrir com apenas 1 agente criado (`Tester`), o terminal dele exibe texto falso de demonstração (`"Vértice shell — ambiente de demonstração / Workspace: C:\work\atlas / 5 agentes · 3 executando..."`) e agentes ficam com status `"working"` fantasma sem sessão:**
     - **Causa raiz identificada:**
       - Em `workspace.tsx` linha 267, quando o usuário cria o 1º agente principal (ex.: `Tester`), `createAgent` força `id = 'gerente'`.
       - Em `workspace.tsx` linha 114, `terminalLines` inicia com `{ gerente: initialTerminalLines }` (que contém `Workspace: C:\work\atlas` e `5 agentes · 3 executando...`).
       - Ao reabrir o programa com 1 agente (`snapshot.agents.length === 1`), `if (snapshot.agents.length === 0) setTerminalLines({})` na linha 138 **não roda**, fazendo o agente `Tester` (`id: 'gerente'`) herdar as linhas falsas de `initialTerminalLines`!
       - Além disso, no boot do `core/src/db.js`, agentes que estavam `status = 'working'` antes de fechar o app continuam marcados como `working` no SQLite mesmo sem nenhuma sessão PTY viva na memória.
     - **Correção obrigatória:**
       - Em `workspace.tsx`: inicializar `terminalLines` como `{}` vazio (`useState<Record<string, TerminalLine[]>>({})`), usando `initialTerminalLines` **apenas** dentro de `resetDemo()`.
       - Em `workspace.tsx` (`createAgent`): gerar sempre o `id` a partir do `slug` do nome do agente (`${slug}-${Date.now().toString(36)}`), sem forçar `id = 'gerente'` quando o usuário deu outro nome (como `Tester`).
       - Em `core/src/db.js` (no boot, logo após `runMigrations()`): resetar `UPDATE agents SET status = 'idle' WHERE status = 'working'` e `UPDATE sessions SET status = 'ended', ended_at = ? WHERE status = 'running'` (já que processos PTY não sobrevivem ao fechamento do processo).

  2. **Bug 2 — Depois de criados, não é possível editar Tarefas, Agentes nem Projetos:**
     - **Causa raiz:** Faltam os botões/modais de edição na UI e as rotas de edição/exclusão de projetos e tarefas no backend.
     - **O que implementar:**
       - **Editar Agente (`AgentDialogs.tsx` + `Agentes.tsx` + `Inspector.tsx` + `workspace.tsx`):**
         - Criar `EditAgentDialog` (ou modo de edição no `CreateAgentDialog`) permitindo editar **Nome (`name`), Função (`role`), Runtime (`runtime`), Modelo (`model`), Supervisor (`parentId` / conexão) e Instrução de sistema (`prompt`)** via `PATCH /api/agents/:id` (`api.patchAgent`).
         - Se o supervisor (`parentId`) mudar, atualizar a conexão correspondente no backend/store.
         - Adicionar botão **"Editar"** no card do agente em `Agentes.tsx` (inclusive no card do `manager`!) e no painel `Inspector.tsx` (no `Organograma`). Também permitir remover qualquer agente (inclusive se for `manager`, ajustando `deleteAgent` em `core/src/db.js` e `workspace.tsx` para permitir excluir ou editar o gerente).
       - **Editar e Excluir Tarefas e Metas (`Work.tsx` + `core/src/db.js` + `core/src/index.js` + `api.ts` + `workspace.tsx`):**
         - No backend (`db.js` + `index.js`), adicionar `DELETE /api/work-items/:id` (`deleteWorkItem`), `PATCH /api/goals/:id` (`patchGoal`) e `DELETE /api/goals/:id` (`deleteGoal` — limpando `goal_id` das tarefas vinculadas). (O `PATCH /api/work-items/:id` já existe no backend!).
         - Na UI (`Work.tsx`), adicionar botão **"Editar"** (e botão de excluir) em cada `WorkCard`, abrindo um modal para alterar **Título (`title`), Responsável (`assigneeId`), Meta (`goalId`), Prioridade (`priority`) e Status (`status`)**, além de permitir editar/excluir metas nos `goal-card`.
       - **Editar e Excluir Projetos (`Projects.tsx` + `core/src/db.js` + `core/src/index.js` + `api.ts` + `workspace.tsx`):**
         - No backend (`db.js` + `index.js`), adicionar `PATCH /api/projects/:id` (`patchProject`: valida `path` com `assertSafeProjectPath`, atualiza `name`, `path`, `description` e registra o novo `path` em `allowed_workspaces`) e `DELETE /api/projects/:id` (`deleteProject`: se era o ativo e restar outro projeto, ativa o próximo).
         - Na UI (`Projects.tsx`), adicionar botões **"Editar"** e **"Excluir"** em cada card de projeto.

  3. **Item 3 — Biblioteca de Prompts Salvos + "Memória Viva" Contínua da Conversa entre Reinicializações:**
     - **Por que apenas salvar o `prompt` inicial não basta para manter o contexto da conversa:**
       Quando o aplicativo fecha ou o PC reinicia, o processo PTY da CLI encerra. Se ao reabrir o programa e iniciar a sessão a CLI subir em branco, tanto a tela do terminal quanto a IA terão esquecido tudo o que foi conversado na sessão anterior!
     - **O que implementar para garantir "Memória Viva" (Contexto Persistente da Conversa):**
       1. **Persistência automática da conversa e memória no SQLite + Arquivo no Workspace (`core/src/db.js`, `core/src/sessions.js`, `core/src/orchestrator.js`):**
          - Adicionar na tabela `agents` (via migração em `db.js`) as colunas `memory TEXT` (resumo vivo de entregas/contexto acumulado) e `last_transcript TEXT` (últimos ~15.000 caracteres limpos do terminal daquele agente).
          - Durante qualquer sessão ativa (`onData` / `trackedBroadcast`), salvar com debounce (~2s) e também no encerramento da sessão (`exit` / `killSession` / `endAllSessions`) a transcrição limpa da conversa em `agents.last_transcript` no SQLite e espelhar num arquivo real dentro do workspace do projeto ativo: `.vertice/memory/<agentId>.md` (contendo: Papel e Prompt do agente + Tarefas já realizadas com resultados + Última conversa do terminal antes de fechar).
          - Ao concluir qualquer tarefa (`completeWorkItem`), anexar automaticamente em `agents.memory` (e no `.vertice/memory/<agentId>.md`) o registro `[Data/Hora] Tarefa concluída: <título> → <resumo do result>`.
       2. **Restauração visual do histórico do terminal ao reabrir o programa (`workspace.tsx` + `TerminalPanel.tsx`):**
          - Incluir `memory` e `lastTranscript` no `mapAgent` (`WorkspaceSnapshot`).
          - No `applySnapshot` (`workspace.tsx`), para cada agente que tenha `lastTranscript` salvo no SQLite e ainda não tenha linhas carregadas na sessão atual, popular `terminalLines[agent.id]` com as linhas da conversa anterior seguidas de `— Memória Viva carregada · contexto anterior preservado —` (e também pré-carregar no buffer do `LiveTerminal` quando aplicável), para que o usuário reabra o programa e veja imediatamente toda a conversa de onde parou!
       3. **Injeção automática da Memória Viva ao reabrir uma sessão da CLI (`core/src/orchestrator.js` + `core/src/index.js`):**
          - Quando uma nova sessão PTY é iniciada para um agente (seja via `POST /api/sessions` no botão "Iniciar sessão real" do Inspector, seja via `dispatchWorkItem` no quadro Work) e o agente já possui `memory` ou `last_transcript` de antes de fechar o programa:
          - Assim que a CLI terminar de subir (`waitForSessionReady`), enviar automaticamente (ou injetar no primeiro turno/despacho) o contexto de retomada da **Memória Viva** (referenciando `.vertice/memory/<agentId>.md` e os últimos trechos da conversa/tarefas anteriores), para que **a IA continue exatamente com o contexto da conversa que tinha antes de fechar o programa**!
          - No `Inspector.tsx` (e no modal de editar agente), exibir a seção/aba **"Memória Viva"** mostrando o contexto acumulado do agente e permitindo editá-lo manualmente ou clicar em "Limpar memória deste agente".
       4. **Biblioteca de Prompts Salvos (`promptTemplates` em `settings`):**
          - No modal de **Criar / Editar Agente** (`AgentDialogs.tsx`), adicionar seletor **"Carregar prompt salvo"** + botão **"Salvar prompt na biblioteca"** persistido em `settings.promptTemplates` no SQLite (nunca apagado nem ao usar `clearWorkspaceData()`).
       5. **Persistência robusta no boot (`workspace.tsx`):**
          - Adicionar retry automático de conexão no boot do `workspace.tsx` (a cada 1.5s caso o `vertice-core` ainda esteja subindo) para garantir que os agentes e sua Memória Viva sempre carreguem do SQLite.
  - **Aceite:**
    1. Criar 1 agente (`Tester`), conversar com ele no terminal (ou executar uma tarefa), **fechar o programa e abrir de novo**:
       - O agente `Tester` continua lá com seu histórico de conversa visível no terminal (sem texto falso `5 agentes · 3 executando`);
       - Ao iniciar novamente a sessão real de `Tester` (ou enviar nova tarefa), a IA recebe automaticamente a **Memória Viva** (`.vertice/memory/<agentId>.md` + contexto da conversa anterior) e sabe responder sobre o que foi conversado antes de fechar!
    2. Conseguir editar (e excluir) qualquer Agente, Tarefa, Meta e Projeto pela UI, com tudo persistido no SQLite.
    3. Conseguir salvar um prompt na biblioteca de prompts da tela de criar/editar agente e reutilizá-lo com 1 clique.

---

## Possível trabalho futuro (fora do escopo mínimo de "funcional")

- [ ] **F1** (SEG + PKG) — Skill e módulo de **autenticação das CLIs** (`vertice-autenticacao-cli`):
  login do Claude/Codex/Kimi antes do modo não interativo, com segredos no Windows Credential Manager
  (fora do SQLite e do frontend). Criar quando B3 exigir login para rodar tarefas.
- [ ] **F2** (SEG) — Confinamento de processo em nível de SO (usuário restrito / Job Objects /
  AppContainer ou sandbox nativa da CLI), documentando o nível real de garantia na UI e no `AGENTS.md`.


