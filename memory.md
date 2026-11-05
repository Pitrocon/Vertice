# Vértice — Memory (Memória Viva do Projeto)

> **REGRA #1 (OBRIGATÓRIA PARA TODAS AS IAs E SESSÕES):**
> Toda informação relevante para o avanço da tarefa e **tudo o que foi feito** DEVE ser registrado neste arquivo (`memory.md`) antes de encerrar qualquer etapa ou turno de implementação, e a respectiva tarefa deve ser marcada como concluída em `tasks.md`. Mesmo que a conversa seja compactada, reiniciada ou assumida por outra IA, a leitura de `memory.md` + `tasks.md` deve ser suficiente para retomar o trabalho exatamente de onde parou, sem perda de contexto.

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

## 5. Qual é o Próximo Passo Imediato (Fase 2)

**Fase 2 — Confinamento de Workspace e Políticas Reais no Backend (`2.1` a `2.4`):**
Criar `core/src/workspace.js` para validar tecnicamente os diretórios de projetos (`resolveInside`, `assertAllowedCwd`), bloquear acessos fora do workspace com HTTP `403` (removendo o fallback silencioso para `homedir()`), persistir a aprovação de CLIs e políticas da tela `CLI's` no SQLite e mover a instalação de CLIs para um endpoint dedicado (`POST /api/runtimes/:id/install`).
