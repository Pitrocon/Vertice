---
name: vertice
description: >-
  Ponto de entrada para qualquer trabalho no projeto Vértice (orquestrador local de
  agentes de IA para Windows, em vertice/). Use antes de alterar app/ ou core/, para
  entender estrutura, como rodar, regras do projeto, o que é real vs simulado e qual
  skill especializada carregar em seguida.
---

# Vértice — skill principal

Orquestrador local de agentes de IA para **Windows**, voltado a **pessoas não técnicas**.
Modelo mental: o usuário **gerencia uma equipe** (referência: Paperclip.ing), não opera CLIs.

## Antes de começar
1. **Leia `memory.md` e `tasks.md`** (na raiz de `vertice/`) — são a memória contínua e a lista de tarefas do projeto.
2. Leia `AGENTS.md` e `docs/alinhamento.md`.
3. `git log --oneline -10` e `git status` para saber o ponto atual.
4. Carregue a skill especializada da tarefa (tabela abaixo).

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `app/` | Frontend React 19 + TS + Vite 7 + React Flow. Estado único em `src/store/workspace.tsx`. |
| `core/` | Serviço local Node (ESM) — Express + `ws` na porta **7845**, `node-pty`, `node:sqlite`. |
| `runtimes/` | (futuro) manifestos declarativos de CLIs. |
| `installers/` | (futuro) empacotamento para intranet. |
| `docs/` | Decisões de produto. |

## Como rodar (PowerShell)
```powershell
cd vertice\core; npm install; npm start      # http://localhost:7845  (ws: /ws)
cd vertice\app;  npm install; npm run dev    # http://localhost:3000
```
Requisitos: Node ≥ 22.5 (usa `node:sqlite`; máquina atual tem Node 26), Git, Windows 10+ (ConPTY).

## Regras inegociáveis
1. **Nunca apresentar simulação como execução real.** Tudo simulado mantém banner/aviso
   ("demonstração", "nenhum processo externo foi iniciado").
2. **Permissões e confinamento são código do backend (`core/`), nunca prompt nem frontend.**
3. **Linguagem de gestor na UI** (cargos, tarefas, aprovações). Terminal = modo avançado.
4. **Cores:** azul (`--accent`) = ações/navegação; laranja (`--accent-warm`) = atividade/alerta. Base escura.
5. **Conventional Commits** em português: `feat(core): ...`, `fix(app): ...`, `docs: ...`.
6. Textos da interface em **português do Brasil**.

## Real vs simulado (atualize ao mudar)
- **Real:** detecção de CLIs (com versão real em `.cmd`), sessões PTY, streaming WS, instalação via PowerShell, SQLite completo (`projects`, `agents`, `connections`, `goals`, `work_items`, `sessions`, `events`) sincronizado via REST/WS.
- **Simulado:** progresso/status automático de tarefas, delegação do Gerente (cria agentes no banco, mas ainda não inicia processos reais), confinamento técnico de workspace e políticas da página CLI's, `checkCli`/`installCli` de fallback offline.

## Qual skill usar
| Tarefa | Skill |
|---|---|
| Endpoints, WebSocket, SQLite, sincronizar store com backend | `vertice-core-backend` |
| Adicionar/detectar/instalar CLIs, spawn no Windows | `vertice-runtimes` |
| Confinamento de workspace, políticas, segurança | `vertice-workspace-seguranca` |
| Telas, componentes, store, identidade visual | `vertice-frontend` |
| Gerente, subagentes, fila de tarefas, delegação | `vertice-orquestracao` |
| Build, lint, smoke tests, teste no navegador | `vertice-verificacao` |
| Electron/instalador/intranet | `vertice-empacotamento` |

## Ao terminar uma tarefa
- **OBRIGATÓRIO:** Registre toda informação relevante e tudo o que foi feito em `memory.md` e marque a tarefa correspondente como `[x]` em `tasks.md`.
- Rode a verificação (`vertice-verificacao`).
- Atualize a seção "Estado atual" do `AGENTS.md` se algo passou de simulado para real.
- Faça commit com Conventional Commits.
