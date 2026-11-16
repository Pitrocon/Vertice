# Vértice — Local Agent OS

Orquestrador local de agentes de IA para Windows, com foco em pessoas não técnicas.
Referência de produto: Paperclip.ing (modelo "gerenciar uma equipe", não "operar CLIs").

## Estrutura

```
app/          Frontend — React 19 + TS + Vite 7 + React Flow (@xyflow/react)
core/         Serviço local — Express + WebSocket (porta 7845) + node-pty + node:sqlite
runtimes/     manifestos declarativos das CLIs (um JSON por runtime; ver runtimes/README.md)
installers/   empacotamento desktop Windows (Electron em installers/electron/)
docs/         decisões e contexto (ler alinhamento.md primeiro)
.agents/skills/  skills do projeto para agentes de IA (índice em SKILLS.md)
memory.md     MEMÓRIA VIVA: histórico completo e contexto (LEITURA E ATUALIZAÇÃO OBRIGATÓRIA)
tasks.md      QUADRO DE TAREFAS: checklist de progresso do projeto (ATUALIZAÇÃO OBRIGATÓRIA)
```

> **REGRA #1 DE CONTINUIDADE:** Antes de qualquer tarefa, leia `memory.md` e `tasks.md`, e carregue a skill `vertice` (`.agents/skills/vertice/SKILL.md`). Ao concluir qualquer avanço, **registre tudo o que foi feito em `memory.md` e marque a tarefa como concluída (`[x]`) em `tasks.md`**.

## Como rodar

```bash
cd core && npm install && npm start     # serviço local em :7845
cd app  && npm install && npm run dev   # frontend
```

## Estado atual (o que já é REAL, não simulado)

- Detecção honesta de CLIs instaladas (where + diretórios padrão do Windows + --version com suporte a `.cmd`; HTTP p/ Ollama/LM Studio)
- Sessões de terminal reais via node-pty/ConPTY (cmd.exe /c para shims .cmd)
- Streaming de saída via WebSocket; terminal do app envia input para a sessão viva
- Instalação guiada de CLIs (Claude, Codex, Kimi, GLM/Z.ai, Antigravity, OpenCode; Ollama via winget)
- Persistência completa e isolamento multi-projeto em SQLite (`core/data/vertice.db`): projetos, agentes, conexões, metas e tarefas (`work_items`) isolados por `project_id` (troca e exclusão com `?confirm=true` encerram sessões/monitores e marcam tarefas em andamento como `failed`; clonagem de equipe copia agentes e conexões limpos), além de sessões e eventos sincronizados em tempo real via REST + WebSocket
- Segurança do serviço local: o core valida Origin/Host (HTTP e WebSocket) — sites abertos no navegador não conseguem ouvir terminais nem disparar ações; no Electron a janela (`file://`) usa um token por execução
- Início LIMPO: o core não repovoa dados de demonstração no boot (só as configurações das CLIs). `POST /api/workspace/clear` apaga tudo menos as `settings`; `POST /api/workspace/reset` carrega a demo. Criar um projeto o torna workspace permitido (após validar o caminho: pastas de sistema, raiz de disco e a pasta pessoal inteira são recusadas)

- Confinamento de workspace no backend (`core/src/workspace.js`): cwd fora do workspace permitido → HTTP 403, sem fallback para `homedir()`
- Aprovação de CLIs e políticas do setor aplicadas (`core/src/policies.js`): runtime não aprovado não inicia sessão (403); `PATCH /api/settings` mescla políticas (`allowDestructiveCommands`, `allowNetwork`, `allowCredentials`) e injeta flags técnicas suportadas pelo runtime (como `--sandbox workspace-write` no Codex) além de diretivas na memória viva e nas instruções de despacho
- Instalação de CLIs via `POST /api/runtimes/:id/install` (só comando oficial do catálogo + revalida a versão)
- Catálogo de runtimes em manifestos declarativos `runtimes/<id>.json`
- Orquestração e execução: `dispatch`/`complete`/`approve`/`reject` ligam tarefas do Work a sessões reais (com dependências `dependsOn` e modo headless estruturado opcional via `stdin` para `claude` e `codex`), reinício de sessão via `POST /api/agents/:id/session/restart` preserva pasta e retoma memória viva, e comunicação entre agentes conectados funciona por `POST /api/agents/:id/message`, marcador `[PARA: Nome]` no terminal e arquivos `.vertice/handoff*.md`
- Empacotamento: scaffold Electron em `installers/electron/` (o `.exe` ainda precisa ser gerado numa máquina com Build Tools)

## O que ainda NÃO é automático / simulado

- Conclusão automática de tarefa (B3/E13): INFERIDA por heurística no terminal interativo (marcador `[TAREFA_CONCLUIDA]`, fim da sessão ou silêncio após a resposta); não foi validada com uma CLI real e pode concluir cedo ou tarde demais. Por isso a tarefa vai para "Aguardando aprovação", etapa de revisão humana
- Modo offline (core desligado): o app mostra o banner "AMBIENTE DE DEMONSTRAÇÃO" e opera com dados locais simulados
- Confinamento é por caminho (cwd), não por sandbox de SO: um processo de CLI já iniciado pode acessar o disco conforme as permissões do usuário Windows (ver F2 em `tasks-agentes.md`)

## Regras do projeto

1. Nunca apresentar simulação como execução real (banners de "demonstração").
2. Permissões e confinamento de workspace são código do backend, nunca prompt.
3. Linguagem de gestor na UI (cargos, tarefas); terminal é modo avançado.
4. Cores: azul = ações/navegação; laranja = atividade. Base escura.
5. Conventional Commits (`feat:`, `fix:`, `chore:`).

## Próximos passos (roadmap)

Itens 1 a 5 do roadmap original (persistência SQLite, subagentes reais, fila de tarefas, confinamento, empacotamento) estão implementados. Pendentes:

1. Gerar e validar o instalador Electron (`npm run dist`) numa máquina Windows com Build Tools e testar em máquina limpa
2. Validar a conclusão automática (E13) com CLIs reais autenticadas e ajustar os tempos (`task-monitor.js`)
3. Autenticação das CLIs com segredos no Windows Credential Manager (F1)
4. Confinamento de processo em nível de SO (F2)
5. Atualização de manifestos de CLI via git
