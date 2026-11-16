// Preload mínimo em CommonJS (preloads em sandbox, o padrão do Electron, não aceitam ESM).
// O frontend fala com o core por HTTP/WebSocket em localhost:7845. Como a janela é carregada de
// file://, o core só aceita requisições que apresentem o token da execução (gerado no main e
// passado por --vertice-token). Nenhuma API Node é exposta ao renderer; só o seletor nativo de
// pastas (G8), que devolve o caminho escolhido ou null.
const { contextBridge, ipcRenderer } = require('electron')

const arg = process.argv.find((item) => item.startsWith('--vertice-token='))

contextBridge.exposeInMainWorld('vertice', {
  packaged: true,
  coreBaseUrl: 'http://localhost:7845',
  token: arg ? arg.slice('--vertice-token='.length) : '',
  pickFolder: (defaultPath) => ipcRenderer.invoke('vertice:pick-folder', { defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined }),
})