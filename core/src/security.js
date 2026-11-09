import { timingSafeEqual } from 'node:crypto'

// Política de origem do serviço local. O core escuta em localhost, mas QUALQUER página aberta no
// navegador do usuário consegue (a) abrir um WebSocket para ele (WebSocket não passa por CORS) e
// (b) enviar POSTs "simples" sem corpo (não geram preflight). Por isso a origem é validada
// explicitamente, em todas as requisições HTTP e no handshake do WebSocket.
//
//  - Sem cabeçalho Origin (curl, smoke test, scripts locais): permitido.
//  - http(s)://localhost|127.0.0.1[:porta] (Vite em dev, preview): permitido.
//  - file:// ou "null" (app empacotado no Electron): SÓ com o token da execução
//    (VERTICE_API_TOKEN, gerado pelo processo main e exposto apenas à janela do app). Sem o token
//    a origem "null" também é a de iframes sandboxed de sites maliciosos, então é recusada.
//  - Qualquer outra origem: recusada.

const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

export function isFileOrigin(origin) {
  return origin === 'null' || /^file:\/\//i.test(origin)
}

export function isLocalOrigin(origin) {
  return LOCAL_ORIGIN.test(origin)
}

// Defesa contra DNS rebinding: o cabeçalho Host precisa ser o do próprio localhost.
export function isLocalHost(host) {
  return typeof host === 'string' && LOCAL_HOST.test(host)
}

export function isValidToken(token) {
  const expected = process.env.VERTICE_API_TOKEN
  if (!expected || typeof token !== 'string' || token.length === 0) return false
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Decide se uma requisição (HTTP ou handshake WS) é confiável.
 * Retorna { ok: true } ou { ok: false, reason }.
 */
export function checkRequestOrigin({ origin, host, token }) {
  if (!isLocalHost(host)) return { ok: false, reason: 'Host não permitido.' }
  if (!origin) return { ok: true }
  if (isLocalOrigin(origin)) return { ok: true }
  if (isFileOrigin(origin)) {
    return isValidToken(token) ? { ok: true } : { ok: false, reason: 'Token do aplicativo ausente ou inválido.' }
  }
  return { ok: false, reason: 'Origem não permitida.' }
}

// Extrai o token de `X-Vertice-Token` (HTTP) ou de `?token=` (handshake do WebSocket).
export function tokenFromRequest(req) {
  const header = req.headers?.['x-vertice-token']
  if (typeof header === 'string' && header) return header
  try {
    return new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? ''
  } catch {
    return ''
  }
}