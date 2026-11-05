# Skills do Vértice

Documento de referência das **skills** (instruções sob demanda para agentes de IA) necessárias
para continuar o desenvolvimento do Vértice. Data: 05/11/2026.

## Como funcionam
- Ficam em `vertice/.agents/skills/<nome>/SKILL.md` e são **versionadas no git** junto com o projeto.
- O Antigravity as descobre automaticamente ao trabalhar dentro de `vertice/`. Só o nome e a
  descrição entram no contexto; o conteúdo completo é carregado quando a tarefa pede.
- A skill `vertice` é o **ponto de entrada**: indica qual skill especializada usar.
- `AGENTS.md` continua sendo a regra sempre ativa. As skills detalham *como* executar.

## Skills do projeto (instaladas)

| Skill | Quando usar | Cobre |
|---|---|---|
| [`vertice`](.agents/skills/vertice/SKILL.md) | Sempre, antes de qualquer tarefa | Estrutura, como rodar, regras inegociáveis, real vs simulado, roteamento para as outras skills |
| [`vertice-core-backend`](.agents/skills/vertice-core-backend/SKILL.md) | Rotas, WebSocket, SQLite, migração do localStorage | Mapa do `core/`, rotas e eventos atuais, padrão para nova entidade, ordem de migração, cuidados com segredos |
| [`vertice-runtimes`](.agents/skills/vertice-runtimes/SKILL.md) | Adicionar/detectar/instalar CLIs | Catálogo, campos, passo a passo, peculiaridades do Windows (`.cmd`, node-pty, PATH), instalação alvo via backend, manifestos |
| [`vertice-workspace-seguranca`](.agents/skills/vertice-workspace-seguranca/SKILL.md) | Confinamento e políticas | Falhas atuais, módulo `workspace.js`, validação de caminhos no Windows, runtimes aprovados, limites honestos, checklist |
| [`vertice-frontend`](.agents/skills/vertice-frontend/SKILL.md) | Telas, componentes, store, estilo | Stack, mapa de arquivos, linguagem de gestor, tokens azul/laranja, banners de demonstração, dívidas técnicas |
| [`vertice-orquestracao`](.agents/skills/vertice-orquestracao/SKILL.md) | Gerente, subagentes, fila de tarefas | Estado atual simulado, arquitetura alvo (despachante, tabela de tarefas, conexões como rotas), pausa/retomada, critério de sucesso |
| [`vertice-verificacao`](.agents/skills/vertice-verificacao/SKILL.md) | Antes de concluir/commitar | Build e lint, **script `smoke-core.ps1`** (testado ✅), teste no navegador, checklist de commit |
| [`vertice-empacotamento`](.agents/skills/vertice-empacotamento/SKILL.md) | Instalador / intranet | Comparativo Electron × Tauri × serviço Windows, passos com Electron, rebuild de módulos nativos |

## Skills globais já instaladas que o projeto aproveita

| Skill | Uso no Vértice |
|---|---|
| `chrome-devtools` | Testar o frontend no navegador: console, rede, interação (Etapa 3 da verificação) |
| `a11y-debugging` | Acessibilidade e contraste da paleta azul/laranja |
| `memory-leak-debugging` | Sessões PTY longas e streaming WS no frontend/core |
| `debug-optimize-lcp` | Desempenho de carregamento do app (secundário) |
| `agy-customizations` | Criar ou ajustar novas skills/regras do projeto |

## Marketplace
Foi feita uma busca no Agent Marketplace (React, SQLite, Electron, Node, Windows, terminal,
testes, git, segurança). **Nenhum plugin cobre a stack específica do Vértice** (Express + node-pty +
node:sqlite + React Flow no Windows). Por isso as skills foram escritas sob medida para o projeto.
Plugins como Figma ou Canva só serão úteis se o design passar a ser feito nessas ferramentas.

## Mapa skill × roadmap (AGENTS.md)

| # | Item do roadmap | Skills |
|---|---|---|
| 1 | Agentes/tarefas no SQLite | `vertice-core-backend`, `vertice-frontend` |
| 2 | Gerente cria subagentes reais | `vertice-orquestracao`, `vertice-runtimes`, `vertice-workspace-seguranca` |
| 3 | Fila de tarefas Work → sessões | `vertice-orquestracao`, `vertice-core-backend` |
| 4 | Confinamento ao workspace | `vertice-workspace-seguranca` |
| 5 | Empacotamento e intranet | `vertice-empacotamento` |
| 6 | Manifestos de CLI via git | `vertice-runtimes` |
| — | Toda entrega | `vertice`, `vertice-verificacao` |

## Manutenção
- Ao mudar algo de simulado para real, atualize `AGENTS.md` e a seção "Real vs simulado" da skill `vertice`.
- Ao criar uma área nova (ex.: autenticação de CLIs), crie `.agents/skills/vertice-<area>/SKILL.md`
  com `name` e `description` no frontmatter e registre-a aqui e na tabela da skill `vertice`.
