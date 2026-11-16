// Recursos que só existem no app desktop (Electron). O preload expõe `window.vertice`; no navegador
// (Vite em localhost) o objeto não existe e a interface esconde esses recursos.
interface VerticeBridge {
  packaged?: boolean
  token?: string
  pickFolder?: (defaultPath?: string) => Promise<string | null>
}

const bridge = (window as unknown as { vertice?: VerticeBridge }).vertice

/** true quando o seletor nativo de pastas do Windows está disponível (app desktop). */
export const canPickFolder = typeof bridge?.pickFolder === 'function'

/** Abre o seletor nativo de pastas. Devolve o caminho escolhido ou null (cancelado/indisponível). */
export async function pickFolder(defaultPath?: string): Promise<string | null> {
  if (!bridge?.pickFolder) return null
  try {
    return await bridge.pickFolder(defaultPath)
  } catch {
    return null
  }
}