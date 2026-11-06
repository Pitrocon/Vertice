# Vértice — Frontend (app)

Interface do Vértice (Local Agent OS). React 19 + TypeScript + Vite 7 + Tailwind
e `@xyflow/react` para o Organograma. Fala com o serviço local `vertice-core`
(`http://localhost:7845`) por REST + WebSocket.

## Rodar em desenvolvimento

```powershell
npm install
npm run dev     # http://localhost:3000
```

O `vertice-core` precisa estar rodando para operar sobre dados/sessões reais
(`cd ..\core; npm start`). Sem o core, o app mostra o banner honesto de
"AMBIENTE DE DEMONSTRAÇÃO".

## Scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Servidor de desenvolvimento Vite na porta 3000. |
| `npm run build` | Type-check (`tsc -b`) + build de produção em `dist/` (`base: './'`). |
| `npm run lint` | ESLint em todo o projeto. |
| `npm run preview` | Serve o build de produção localmente. |

## Estrutura

```
src/
  components/   Componentes (inclui ui/ do shadcn)
  pages/        Telas: Agentes, Work, Projects, Organograma, CLI's (Org)
  store/        Estado central (workspace.tsx) e sincronização com o core
  lib/          Cliente HTTP/WS (api.ts) apontando para localhost:7845
  types/        Definições de tipos
```

## Build para empacotamento

O `dist/` gerado aqui é embarcado pelo instalador Electron
(`vertice/installers/electron`). Como o build usa `base: './'`, ele carrega
corretamente via `file://` dentro do app empacotado.

## Identidade visual

Base escura; **azul** para ações/navegação, **laranja** para atividade/alertas.
Linguagem de gestão na UI (cargos, tarefas, metas); o terminal é modo avançado.
