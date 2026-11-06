// Preload mínimo. O frontend fala com o core via HTTP/WebSocket (localhost:7845),
// então não é necessário expor APIs Node ao renderer. Mantido com contextIsolation
// ligado e nodeIntegration desligado por segurança.
import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('vertice', {
  packaged: true,
  coreBaseUrl: 'http://localhost:7845',
})
