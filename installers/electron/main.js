// Processo main do Electron para o Vértice.
// Responsabilidades:
//   1. Apontar os dados do core para o userData do app (gravável).
//   2. Apontar o catálogo de runtimes para a pasta de manifestos embarcada.
//   3. Subir o vertice-core (HTTP + WebSocket na :7845) in-process.
//   4. Abrir a janela carregando o build do frontend (app/dist).
import { app, BrowserWindow, shell } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isPackaged = app.isPackaged

// Em dev: o código-fonte está em vertice/{core,app,runtimes}.
// Empacotado (electron-builder): esses diretórios são copiados para resources/ via extraResources.
const resourcesRoot = isPackaged ? process.resourcesPath : join(__dirname, '..', '..')

const CORE_ENTRY = join(resourcesRoot, 'core', 'src', 'index.js')
const RUNTIMES_DIR = join(resourcesRoot, 'runtimes')
const APP_INDEX = join(resourcesRoot, 'app', 'dist', 'index.html')

// Dados do SQLite em %APPDATA%\Vertice (userData), nunca dentro do programa.
process.env.VERTICE_DATA_DIR = join(app.getPath('userData'), 'data')
process.env.VERTICE_RUNTIMES_DIR = RUNTIMES_DIR

let mainWindow = null

async function startCoreService() {
  if (!existsSync(CORE_ENTRY)) {
    throw new Error(`core não encontrado em ${CORE_ENTRY}. Rode o build/copy de assets antes de empacotar.`)
  }
  // Import dinâmico: o core usa node:sqlite e node-pty, que exigem o runtime do Electron.
  // pathToFileURL garante um import() válido a partir de caminho absoluto no Windows.
  const core = await import(pathToFileURL(CORE_ENTRY).href)
  await core.startCore()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0f17',
    title: 'Vértice',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Abrir links externos no navegador padrão, não dentro da janela.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (existsSync(APP_INDEX)) {
    mainWindow.loadFile(APP_INDEX)
  } else {
    // Fallback honesto em dev se o build do frontend ainda não existe.
    mainWindow.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="background:#0b0f17;color:#e5e7eb;font-family:sans-serif;padding:40px">' +
      '<h2>Build do frontend ausente</h2>' +
      '<p>Rode <code>npm run build</code> em <code>vertice/app</code> para gerar <code>app/dist</code>.</p></body>'
    ))
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  try {
    await startCoreService()
  } catch (error) {
    console.error('[vertice] Falha ao iniciar o core:', error)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Windows: encerra o app (e o core in-process junto) ao fechar a janela.
  if (process.platform !== 'darwin') app.quit()
})
