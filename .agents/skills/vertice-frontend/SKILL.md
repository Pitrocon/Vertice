---
name: vertice-frontend
description: >-
  Use ao criar ou alterar telas, componentes, estado ou estilos do frontend do Vértice
  (vertice/app): páginas Agentes, Work, Projects, Organograma (React Flow) e CLI's,
  o store workspace.tsx, a identidade visual azul/laranja e a linguagem para não técnicos.
---

# Vértice — frontend (`app/`)

## Stack
React 19, TypeScript ~5.9, Vite 7 (porta 3000, `base: './'`), React Router 7 (`react-router`),
`@xyflow/react` 12, `lucide-react`, `sonner`, fontes Geist locais. Alias `@` → `src/`.
Há componentes shadcn em `src/components/ui/`, mas as telas usam **CSS próprio** em
`src/index.css` (classes como `page`, `page-header`, `button button--primary`, `demo-banner`).
Siga o padrão existente das páginas; não misture estilos novos sem necessidade.

## Mapa
| Caminho | Papel |
|---|---|
| `src/App.tsx` | Shell: topbar, nav-rail (5 seções + Terminal), rotas, modais, atalhos (Ctrl+K, G, T) |
| `src/store/workspace.tsx` | **Estado único** (Context). Ações reais e simuladas convivem aqui |
| `src/lib/api.ts` | Cliente HTTP/WS do core (`BASE = http://localhost:7845`) |
| `src/types/agent.ts` | Tipos + rótulos em português (`statusLabels`, `workStatusLabels`) |
| `src/data/initial.ts` | Seed de demonstração |
| `src/pages/*` | Agentes, Work (kanban), Projects, Organograma (canvas + terminal), Org (CLI's) |
| `src/components/*` | AgentNode, Inspector, TerminalPanel, AgentDialogs, CommandPalette, Modal |

## Convenções
- **Linguagem de gestor:** "Executando tarefa X", "Aguardando aprovação", verbos Pausar,
  Retomar, Reatribuir, Encerrar. Evitar stdout, processo, runtime na UI principal
  (permitido no Terminal/modo avançado e na página CLI's).
- **Cores (tokens em `index.css`):** `--accent` (azul) ações/navegação; `--accent-warm`
  (laranja) atividade/alertas; base `--background` escura. Use os tokens, não cores soltas.
- **Honestidade:** dado vindo do backend vs demonstração precisa ser distinguível
  (`demo-banner`, `demo-banner--online`, selo da topbar, statusbar).
- Novas ações vão no `WorkspaceValue` do store; componentes consomem via `useWorkspace()`.
- Ao migrar algo para o backend: carregar via `api.ts` quando `serviceOnline`; manter
  fallback local apenas para demonstração.
- Ícones: `lucide-react`, `size` 13–17, `strokeWidth` 1.8 na navegação.

## Dívidas conhecidas
- `workspace.tsx` (~430 linhas) mistura domínios — ao crescer, dividir em hooks
  (`useAgents`, `useWork`, `useSessions`, `useRuntimes`).
- `RUNTIME_NAME_TO_ID` é recriado a cada render e duplica o catálogo do core.
- Terminal usa `stripAnsi` e linhas de texto; para CLIs interativas, considerar `@xterm/xterm`.
- `package.json` ainda se chama `my-app`; `info.md`/`README.md` são do template;
  `kimi-plugin-inspect-react` no Vite é resquício do gerador.

## Verificação
`npm run build` e `npm run lint` em `app/` sem erros, e teste visual no navegador
(skill `chrome-devtools`) — ver `vertice-verificacao`.
