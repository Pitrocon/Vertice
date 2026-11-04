# Vértice — Local Agent OS

Orquestrador local de agentes de IA para Windows, com foco em pessoas não técnicas.
Referência de produto: Paperclip.ing (modelo "gerenciar uma equipe", não "operar CLIs").

## Estrutura

```
app/          Frontend — React 19 + TS + Vite 7 + React Flow (@xyflow/react)
core/         Serviço local — Express + WebSocket (porta 7845) + node-pty + node:sqlite
runtimes/     (futuro) manifestos declarativos das CLIs
installers/   (futuro) empacotamento para a intranet
docs/         decisões e contexto (ler alinhamento.md primeiro)
```

## Como rodar

```bash
cd core && npm install && npm start     # serviço local em :7845
cd app  && npm install && npm run dev   # frontend
```

## Estado atual (o que já é REAL, não simulado)

- Detecção honesta de CLIs instaladas (where + --version; HTTP p/ Ollama/LM Studio)
- Sessões de terminal reais via node-pty/ConPTY (cmd.exe /c para shims .cmd)
- Streaming de saída via WebSocket; terminal do app envia input para a sessão viva
- Instalação guiada de CLIs (Claude, Codex, Kimi, GLM/Z.ai, Antigravity, OpenCode; Ollama via winget)
- Persistência local em SQLite (core/data/vertice.db): sessões e eventos

## O que ainda é simulado

- Agentes, conexões, tarefas, metas e projetos (localStorage; seed em app/src/data/initial.ts)
- Estados/progresso dos agentes; delegação do Gerente cria equipe fictícia
- Políticas da página CLI's (checkboxes sem efeito)

## Regras do projeto

1. Nunca apresentar simulação como execução real (banners de "demonstração").
2. Permissões e confinamento de workspace são código do backend, nunca prompt.
3. Linguagem de gestor na UI (cargos, tarefas); terminal é modo avançado.
4. Cores: azul = ações/navegação; laranja = atividade. Base escura.
5. Conventional Commits (`feat:`, `fix:`, `chore:`).

## Próximos passos (roadmap)

1. Sincronizar agentes/tarefas com o SQLite do core (substituir localStorage)
2. Gerente criar subagentes reais (spawn de sessão por subagente, confinado ao workspace)
3. Fila de tarefas ligando Work (issues) às sessões dos agentes
4. Confinamento de caminhos ao workspace configurado no core
5. Empacotamento (Electron ou instalador) + distribuição na intranet
6. Atualização de manifestos de CLI via git
