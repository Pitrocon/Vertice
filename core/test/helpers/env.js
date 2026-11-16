import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Primeiro import de todo teste do Core: isola banco, variáveis de ambiente e porta.
// Nunca usa a porta 7845 nem o banco real (%APPDATA%\Vértice\data\vertice.db).
export const testDir = mkdtempSync(join(tmpdir(), 'vertice-test-'))

const dataDir = join(testDir, 'data')
const localAppData = join(testDir, 'localappdata')
const appData = join(testDir, 'appdata')
const userProfile = join(testDir, 'users', 'vertice')
const programFiles = join(testDir, 'programfiles')

for (const dir of [dataDir, localAppData, appData, userProfile, programFiles]) {
  mkdirSync(dir, { recursive: true })
}

process.env.VERTICE_DATA_DIR = dataDir
process.env.LOCALAPPDATA = localAppData
process.env.APPDATA = appData
process.env.USERPROFILE = userProfile
process.env.ProgramFiles = programFiles
process.env.PORT = '7899'
process.env.VERTICE_SKIP_PATH_SYNC = '1'

const DB_CLOSERS_KEY = Symbol.for('vertice.dbClosers')

export function cleanup() {
  const closers = globalThis[DB_CLOSERS_KEY]
  if (closers) {
    for (const close of [...closers]) {
      try { close() } catch { /* já fechado */ }
    }
  }
  try {
    rmSync(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  } catch { /* melhor esforço na limpeza */ }
}
