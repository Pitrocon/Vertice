# Vértice — Empacotamento Desktop (Electron)

Empacota o Vértice como um aplicativo Windows único que, ao abrir:

1. sobe o **vertice-core** (HTTP + WebSocket na porta `7845`) dentro do processo main do Electron;
2. abre uma janela nativa carregando o build do frontend (`app/dist`);
3. grava os dados do SQLite em `%APPDATA%\Vertice\data` (fora da pasta de programas).

> **Caminho escolhido (D2):** Electron, conforme a skill `vertice-empacotamento`.
> O Node embutido no Electron executa `node-pty` e `node:sqlite`, que são as dependências
> nativas do core — por isso é a opção com menos peças móveis.

## Pré-requisitos

- Windows x64.
- Node.js instalado (para rodar `npm`/`electron-builder`).
- Ferramentas de build nativas (Visual Studio Build Tools com C++), exigidas pelo
  `@electron/rebuild` ao recompilar o `node-pty` para o ABI do Electron.

## Estrutura

```
installers/electron/
  main.js        processo main: define VERTICE_DATA_DIR/VERTICE_RUNTIMES_DIR, sobe o core, abre a janela
  preload.cjs    ponte mínima em CommonJS (contextIsolation ligado, nodeIntegration desligado); expõe o token da execução
  package.json   deps do Electron + configuração do electron-builder (alvo NSIS x64)
```

O core, o frontend compilado e os manifestos de runtime **não** ficam aqui — são
copiados para `resources/` no empacotamento via `extraResources` (ver `package.json`).

## Build passo a passo

```powershell
# 1. Compilar o frontend (gera app/dist)
cd ..\..\app
npm install
npm run build

# 2. Instalar as dependências do core (inclui node-pty)
cd ..\core
npm install

# 3. Instalar as deps do Electron e recompilar os módulos nativos do core
#    para o ABI do Electron (node-pty)
cd ..\installers\electron
npm install
npm run rebuild

# 4. Gerar o instalador NSIS (saída em installers/electron/out)
npm run dist
```

Para testar sem empacotar (modo dev, usa os diretórios de origem):

```powershell
cd installers\electron
npm start
```

## Pontos de atenção

- **`node:sqlite`:** o core usa o módulo nativo embutido do Node. O Electron 45 traz
  Node 24, onde `node:sqlite` existe. Se um downgrade de Electron trouxer um Node sem
  esse módulo, migrar `core/src/db.js` para `better-sqlite3` (também nativo → rebuild).
- **`node-pty`:** precisa ser recompilado para o ABI do Electron (`npm run rebuild`).
  Sem isso, o core cai no modo `pipe` (sem interatividade completa de terminal).
- **Token da execução:** o `main.js` gera um token aleatório a cada abertura (`VERTICE_API_TOKEN`) e o passa à janela por `--vertice-token`; o core só aceita requisições de `file://` que o apresentem (cabeçalho `X-Vertice-Token` / `?token=` no WebSocket). Impede que sites no navegador do usuário falem com o serviço local.
- **Confinamento:** o empacotamento não altera as regras de segurança do backend
  (`assertAllowedCwd`, runtimes aprovados). Os dados ficam em `%APPDATA%\Vertice`.
- **Assinatura de código:** adicionar certificado se a TI exigir, antes de distribuir
  no compartilhamento da intranet.

## Verificação (SYNC-D)

Instalar em uma máquina limpa (ou Windows Sandbox), abrir o app e confirmar:

- selo **"AMBIENTE REAL · vertice-core"** (serviço local conectado);
- a página **CLI's** detecta os runtimes instalados com versão;
- abrir uma sessão real de terminal dentro do workspace confinado;
- o banco aparece em `%APPDATA%\Vertice\data\vertice.db`.
