---
name: vertice-empacotamento
description: >-
  Use ao empacotar o Vértice como aplicativo desktop Windows para distribuição na intranet
  (Electron, instalador, serviço local embutido, atualização de manifestos via git) ou ao
  trabalhar na pasta vertice/installers.
---

# Vértice — empacotamento e distribuição (roadmap item 5)

## Decisões já tomadas (docs/alinhamento.md)
- Somente Windows. Distribuição via **intranet**, sem nuvem externa.
- Git interno para versionar a ferramenta e os manifestos de CLI.
- Backend local separado do frontend (a mesma API pode virar serviço de rede).

## Decisão pendente — confirmar com o usuário antes de implementar
| Opção | Prós | Contras |
|---|---|---|
| **Electron** (main process roda o core) | Node embutido → `node-pty` e `node:sqlite` funcionam; ecossistema maduro (electron-builder, NSIS/MSI) | Instalador ~100 MB; `node-pty` precisa ser recompilado para o ABI do Electron (`@electron/rebuild`) |
| Tauri + sidecar Node | Leve | Precisa empacotar Node separado como sidecar; mais peças |
| Core como serviço Windows + app web local | Simples para TI | Sem janela nativa; gerenciamento de serviço |

## Se Electron (caminho recomendado)
1. Pasta `installers/electron/` com `main.js` que importa/inicia o `core` e abre
   `BrowserWindow` carregando `app/dist/index.html` (já usa `base: './'`).
2. Verificar se o Node embutido no Electron suporta `node:sqlite`; caso não, trocar
   `db.js` para `better-sqlite3` (também nativo → rebuild).
3. `@electron/rebuild` para `node-pty`. Testar ConPTY no binário empacotado.
4. `electron-builder` com alvo `nsis` ou `msi`; dados do usuário em `%APPDATA%\Vertice`
   (mover `core/data` para `app.getPath('userData')`).
5. Assinatura de código se exigida pela TI; publicação em compartilhamento da intranet.
6. Atualização: canal interno (pasta de rede/HTTP intranet) com `electron-updater`
   configurado para provedor genérico.

## Verificação
Instalar em máquina limpa (ou Windows Sandbox), abrir o app, confirmar
"Serviço local conectado", detectar CLIs e abrir uma sessão real.
