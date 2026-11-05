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

- [~] **B3** (ORQ, PREPARADO — aguardando CLI de IA autenticada) — Detecção de conclusão via modo não interativo da CLI (pesquisar as flags oficiais
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

- [ ] **D1** (PKG) — Extrair o `RUNTIME_CATALOG` de `core/src/runtimes.js` para manifestos declarativos
  `vertice/runtimes/<id>.json` (comando de instalação, verificação, autenticação, `sessionArgs`);
  `runtimes.js` passa a ler os manifestos. Não quebrar a detecção atual.
  - **Aceite:** a detecção continua funcionando lendo os JSON; adicionar uma CLI = criar um arquivo.

- [ ] **D2** (PKG) — Definir e implementar o empacotamento desktop Windows (Electron ou instalador
  local) em `vertice/installers/`, com rebuild dos módulos nativos (`node-pty`, `node:sqlite`) e
  inicialização do core + app juntos.
  - **Aceite:** artefato instalável que sobe o core e abre o app.
  - **Demo:** instalar numa máquina limpa da intranet e abrir o Vértice.

- [ ] **SYNC-D** (QA) — Verificar os manifestos (detecção intacta) e o smoke test dentro do pacote.

---

## Bloco E — Fechamento

- [ ] **E1** (QA) — Varredura final de honestidade: nada simulado aparece como real em nenhuma tela;
  `AGENTS.md`, `memory.md` e o `tasks.md` original (Fases 2–5) refletem o estado real e estão marcados.
  - **Aceite:** checklist de commit da skill `vertice-verificacao` 100% atendido.

- [ ] **E2** (BACKEND + FRONT) — Limpezas de dívida técnica listadas na skill `vertice-frontend`:
  renomear `package.json` (hoje `my-app`), remover `info.md`/resíduos do template do gerador, e
  dividir `workspace.tsx` em hooks (`useAgents`, `useWork`, `useSessions`, `useRuntimes`) se necessário.
  - **Aceite:** build e lint limpos; sem resíduos do template; store organizada.

---

## Possível trabalho futuro (fora do escopo mínimo de "funcional")

- [ ] **F1** (SEG + PKG) — Skill e módulo de **autenticação das CLIs** (`vertice-autenticacao-cli`):
  login do Claude/Codex/Kimi antes do modo não interativo, com segredos no Windows Credential Manager
  (fora do SQLite e do frontend). Criar quando B3 exigir login para rodar tarefas.
- [ ] **F2** (SEG) — Confinamento de processo em nível de SO (usuário restrito / Job Objects /
  AppContainer ou sandbox nativa da CLI), documentando o nível real de garantia na UI e no `AGENTS.md`.


