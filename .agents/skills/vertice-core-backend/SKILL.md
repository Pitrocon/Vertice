---
name: vertice-core-backend
description: >-
  Use ao criar ou alterar o serviço local do Vértice (vertice/core): rotas Express,
  eventos WebSocket, tabelas SQLite via node:sqlite, e ao migrar dados do frontend
  (localStorage) para o backend, mantendo app/src/lib/api.ts e o store sincronizados.
---

# Vértice — serviço local (`core/`)

## Mapa
| Arquivo | Responsabilidade |
|---|---|
| `src/index.js` | Express + CORS restrito a localhost + rotas REST + `WebSocketServer` em `/ws` + `broadcast()` |
| `src/db.js` | `DatabaseSync` em `core/data/vertice.db`; schema via `CREATE TABLE IF NOT EXISTS` |
| `src/sessions.js` | Sessões PTY/pipe em memória (`Map`) + gravação no banco |
| `src/runtimes.js` | Catálogo e detecção de CLIs (ver `vertice-runtimes`) |

ESM puro (`"type": "module"`), sem TypeScript, sem build. Dev com `npm run dev` (`node --watch`).

## Rotas atuais
`GET /api/health` · `GET /api/runtimes` · `GET /api/catalog` · `POST /api/sessions` ·
`GET /api/sessions` · `POST /api/sessions/:id/input` · `POST /api/sessions/:id/resize` ·
`DELETE /api/sessions/:id` · `GET /api/events`

Eventos WS (servidor → cliente): `hello`, `session-started`, `output`, `exit`, `session-ended`.
Cliente → servidor: `{type:'input', sessionId, data}`, `{type:'resize', sessionId, cols, rows}`.

## Padrão para nova entidade (ex.: agentes, tarefas, projetos)
1. **Schema** em `db.js`: `CREATE TABLE IF NOT EXISTS ...`. Para colunas novas em tabelas
   existentes, use uma tabela `meta(schema_version)` e `ALTER TABLE` condicional — nunca apague `data/`.
2. **Funções de acesso** em `db.js` (ou `src/repos/<entidade>.js` se crescer) usando
   `db.prepare(...).run/get/all` com parâmetros `?` — **nunca** interpolar strings em SQL.
3. **Rotas** em `index.js` (ou `src/routes/<entidade>.js` com `express.Router()`):
   validar `req.body` explicitamente, responder `400` com `{ error }` em português.
4. **Broadcast** de mudanças: `broadcast({ type: '<entidade>-updated', ... })` para todas as abas.
5. **Frontend:** adicionar tipos e métodos em `app/src/lib/api.ts`; no `workspace.tsx`,
   carregar do backend quando `serviceOnline` e cair para localStorage/seed quando offline
   (mantendo o aviso de demonstração).
6. Registrar ações relevantes com `recordEvent(agentId, mensagem, tipo)`.

## Ordem sugerida de migração (roadmap item 1)
`projects` → `agents` (+ `connections`) → `goals` → `work_items` → `events` unificados.
Chaves estrangeiras: `sessions.agent_id` deve passar a referenciar `agents.id`.

## Cuidados
- Segredos/tokens de CLIs **não** vão para o SQLite em texto aberto nem para o frontend.
  Use o armazenamento da própria CLI ou o Windows Credential Manager.
- CORS: manter a regex de localhost; se virar serviço de rede, adicionar autenticação antes.
- `core/data/` e `core.log` estão no `.gitignore` — não commitar o banco.
- Toda rota que recebe caminho (`cwd`, arquivo) passa pela validação de `vertice-workspace-seguranca`.

## Verificação rápida
```powershell
Invoke-RestMethod http://localhost:7845/api/health
Invoke-RestMethod http://localhost:7845/api/sessions
```
Ou o script `../vertice-verificacao/scripts/smoke-core.ps1`.
