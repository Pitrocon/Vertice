---
name: vertice-orquestracao
description: >-
  Use ao implementar a orquestração real do Vértice: o agente Gerente criando subagentes
  reais, delegação de tarefas, fila de tarefas ligando Work (issues/goals) às sessões dos
  agentes, conexões do organograma como rotas de mensagens, e status reais dos agentes.
---

# Vértice — orquestração (Gerente, subagentes, fila)

## Estado atual
- `delegateToManager()` em `workspace.tsx` cria 3 agentes fictícios (Estrategista, Analista,
  Executor) — **simulação**, com aviso "Nenhum processo externo foi iniciado".
- `WorkItem` (Work) não tem ligação com sessões; `status`/`progress` de agentes são visuais.
- Sessões reais existem (`POST /api/sessions`), uma por agente, guardadas em `liveSessions`.

## Arquitetura alvo (no `core/`, não no frontend)
1. **Persistência primeiro** (`vertice-core-backend`): `agents`, `connections`,
   `work_items`, `goals` no SQLite.
2. **Tabela `tasks`/`work_items`** com: `id, title, assignee_id, goal_id, status
   (todo|doing|review|done|failed|cancelled), parent_task_id, depends_on, result, error,
   created_by, timestamps`.
3. **Despachante** (`core/src/orchestrator.js`): ao mover uma tarefa para `doing` com
   responsável, garante sessão do agente (cria se preciso, cwd confinado), envia o prompt
   da tarefa, marca `doing`, emite `task-updated` por WS.
4. **Conclusão:** detectar fim de tarefa por modo não interativo quando a CLI suportar
   (ex.: execução com prompt único e saída por exit code/JSON), em vez de interpretar
   a saída do PTY. Pesquise as flags oficiais de cada CLI antes de implementar.
   Resultado → `review` (aguardando aprovação humana) ou `done`.
5. **Gerente cria subagentes:** o Gerente propõe a equipe em formato estruturado (JSON),
   o core valida (runtime aprovado, cwd dentro do workspace, limite de agentes) e cria
   agentes + conexões + tarefas. Tudo registrado em `events` (`create`, `delegate`).
6. **Conexões do organograma** = quem pode delegar a quem. O despachante recusa
   delegação sem conexão `source → target`.
7. **Status de agente derivado do real:** `working` se tem tarefa `doing` e sessão viva;
   `paused` só se a sessão foi pausada de fato; `idle` caso contrário.

## Pausar / retomar
Não existe "pausa" nativa de PTY. Opções: parar de despachar novas tarefas (pausa lógica)
ou encerrar a sessão e recriá-la com o contexto. Deixar claro na UI qual comportamento ocorre.

## Critério de sucesso (docs/transferencia-prototipo.txt §8)
Detectar runtime → criar agente → iniciar sessão real → enviar tarefa → stream de saída →
atualizar nó no canvas → persistir agente/sessão/eventos → Gerente cria subagente real e
delega dentro do workspace.

## Regras
- Autonomia total só dentro do workspace validado pelo core.
- Nada de "progresso" inventado: sem métrica real, mostrar estado (em andamento) sem %.
- Toda delegação, erro e cancelamento vira evento persistido.
