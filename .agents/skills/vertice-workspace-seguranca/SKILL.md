---
name: vertice-workspace-seguranca
description: >-
  Use ao implementar ou revisar confinamento de agentes ao workspace, validação de
  caminhos, políticas do setor (comandos destrutivos, rede, credenciais), aprovação de
  CLIs pelo TI, ou qualquer rota do vertice/core que receba caminhos ou comandos.
---

# Vértice — workspace e segurança

Princípio: **o Gerente tem autonomia total dentro do workspace configurado e nenhuma fora dele.**
A garantia é técnica, no `core/`. Prompt e frontend apenas exibem.

## Situação atual (pontos a corrigir)
- `safeCwd()` em `core/src/sessions.js` aceita qualquer caminho existente e, se não existir,
  usa `homedir()` — **sem confinamento**.
- `POST /api/sessions/:id/input` aceita texto livre (necessário para terminal interativo,
  mas sem política).
- Políticas da página CLI's (`app/src/pages/Org.tsx`) são checkboxes sem efeito.
- Aprovação de CLIs (`toggleCliApproved`) só existe no estado do frontend.

## Implementação alvo
1. **Configuração** em `core/vertice.config.json` (já no `.gitignore`) ou tabela `settings`:
   `{ allowedWorkspaces: string[], approvedRuntimes: string[], policies: {...} }`.
2. **Módulo `core/src/workspace.js`** com:
   - `resolveInside(root, p)`: `path.resolve` + `fs.realpathSync.native` (resolve junctions/
     symlinks) e verifica que o resultado começa com `root + path.sep` (comparação
     **case-insensitive** no Windows). Rejeita `..`, caminhos UNC (`\\server`) e
     dispositivos (`\\.\`, `\\?\`) fora da lista.
   - `assertAllowedCwd(cwd)`: lança erro se fora de `allowedWorkspaces`.
     **Nunca** cair silenciosamente para `homedir()` — responder `403`.
3. **Aplicar** em `POST /api/sessions` (cwd), futuras rotas de arquivo e criação de subagentes.
4. **Runtimes aprovados:** `POST /api/sessions` recusa `runtimeId` fora de `approvedRuntimes`.
5. **Ambiente do processo:** passar `env` filtrado (sem variáveis de segredo do Vértice);
   definir `cwd` sempre como o workspace validado.
6. **Políticas** (persistidas e lidas pelo core): comandos destrutivos, rede, credenciais.
   Onde não for possível bloquear tecnicamente (shell interativo), registrar em eventos e
   sinalizar na UI como "política declarativa" — não prometer bloqueio que não existe.

## Limites honestos
Um PTY com PowerShell/CLI pode executar `cd ..` ou acessar caminhos absolutos. O confinamento
real de processo exige mecanismos do SO (usuário restrito, AppContainer, Job Objects, ou
CLIs com sandbox própria — ex.: modos sandbox do Codex/Claude Code). Documente o nível de
garantia efetivo na UI e no `AGENTS.md`.

## Checklist de revisão
- [ ] Toda entrada de caminho passa por `resolveInside`.
- [ ] Testes com: `..\..`, `C:\Windows`, junction apontando para fora, letra de unidade
      diferente, maiúsculas/minúsculas, caminho UNC.
- [ ] Erros retornam `403` com mensagem clara em português.
- [ ] Nenhum segredo em logs, eventos, SQLite em texto aberto ou respostas da API.
