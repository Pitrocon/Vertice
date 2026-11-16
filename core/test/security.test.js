import { cleanup } from './helpers/env.js'
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  isFileOrigin,
  isLocalOrigin,
  isLocalHost,
  isValidToken,
  checkRequestOrigin,
  tokenFromRequest,
} from '../src/security.js'

after(() => {
  cleanup()
})

test('isLocalHost aceita localhost, 127.0.0.1 e [::1] com/sem porta e rejeita domínios externos', () => {
  for (const valid of [
    'localhost',
    'LOCALHOST',
    'localhost:7845',
    'localhost:7899',
    '127.0.0.1',
    '127.0.0.1:7845',
    '[::1]',
    '[::1]:7845',
  ]) {
    assert.equal(isLocalHost(valid), true, `deveria aceitar host ${valid}`)
  }

  for (const invalid of [
    '',
    null,
    undefined,
    123,
    'evil.com',
    'evil.com:7845',
    'localhost.evil.com',
    'sub.localhost',
    '127.0.0.2',
    '0.0.0.0:7845',
    '192.168.0.10:7845',
    '::1',
    'http://localhost:7845',
    'localhost:abc',
  ]) {
    assert.equal(isLocalHost(invalid), false, `deveria rejeitar host ${String(invalid)}`)
  }
})

test('isLocalOrigin e isFileOrigin classificam origens corretamente', () => {
  assert.equal(isLocalOrigin('http://localhost:3000'), true)
  assert.equal(isLocalOrigin('https://127.0.0.1:5173'), true)
  assert.equal(isLocalOrigin('http://[::1]:7845'), true)
  assert.equal(isLocalOrigin('https://evil.com'), false)
  assert.equal(isLocalOrigin('http://localhost.evil.com'), false)
  assert.equal(isLocalOrigin('file://'), false)
  assert.equal(isLocalOrigin('null'), false)

  assert.equal(isFileOrigin('null'), true)
  assert.equal(isFileOrigin('file://'), true)
  assert.equal(isFileOrigin('file:///C:/Program%20Files/Vertice/index.html'), true)
  assert.equal(isFileOrigin('FILE:///index.html'), true)
  assert.equal(isFileOrigin('http://localhost:3000'), false)
  assert.equal(isFileOrigin('https://null.example.com'), false)
})

test('criação e validação de token por execução (VERTICE_API_TOKEN) e extração via tokenFromRequest', () => {
  const prevToken = process.env.VERTICE_API_TOKEN
  try {
    // Sem token configurado na execução, nada valida
    delete process.env.VERTICE_API_TOKEN
    assert.equal(isValidToken('qualquer'), false)

    // Token aleatório por execução (padrão do processo main)
    const run1Token = randomBytes(32).toString('hex')
    const run2Token = randomBytes(32).toString('hex')
    assert.notEqual(run1Token, run2Token)

    process.env.VERTICE_API_TOKEN = run1Token
    assert.equal(isValidToken(run1Token), true)
    assert.equal(isValidToken(run2Token), false)
    assert.equal(isValidToken(run1Token.slice(0, -1)), false)
    assert.equal(isValidToken(`${run1Token}00`), false)
    assert.equal(isValidToken(''), false)
    assert.equal(isValidToken(null), false)
    assert.equal(isValidToken(12345), false)

    // Nova execução com novo token invalida o token anterior
    process.env.VERTICE_API_TOKEN = run2Token
    assert.equal(isValidToken(run1Token), false)
    assert.equal(isValidToken(run2Token), true)

    // tokenFromRequest aceita header X-Vertice-Token ou query ?token= (WebSocket)
    assert.equal(tokenFromRequest({ headers: { 'x-vertice-token': run2Token }, url: '/api/health' }), run2Token)
    assert.equal(tokenFromRequest({ headers: {}, url: `/ws?token=${run2Token}` }), run2Token)
    assert.equal(tokenFromRequest({ headers: { 'x-vertice-token': 'header-win' }, url: '/ws?token=query' }), 'header-win')
    assert.equal(tokenFromRequest({ headers: {}, url: '/ws' }), '')
  } finally {
    if (prevToken === undefined) delete process.env.VERTICE_API_TOKEN
    else process.env.VERTICE_API_TOKEN = prevToken
  }
})

test('checkRequestOrigin permite localhost e sem Origin, exige token para file:// e null, e bloqueia origem/host externo', () => {
  const prevToken = process.env.VERTICE_API_TOKEN
  const token = randomBytes(32).toString('hex')
  process.env.VERTICE_API_TOKEN = token

  try {
    // Host inválido (defesa DNS rebinding) é bloqueado mesmo sem Origin ou com token válido
    assert.deepEqual(checkRequestOrigin({ origin: undefined, host: 'evil.com', token }), {
      ok: false,
      reason: 'Host não permitido.',
    })
    assert.deepEqual(checkRequestOrigin({ origin: 'http://localhost:3000', host: 'localhost.evil.com', token }), {
      ok: false,
      reason: 'Host não permitido.',
    })

    // Sem Origin (curl / scripts locais) é permitido em host local
    assert.deepEqual(checkRequestOrigin({ origin: undefined, host: 'localhost:7899' }), { ok: true })
    assert.deepEqual(checkRequestOrigin({ origin: '', host: '127.0.0.1:7899' }), { ok: true })

    // Origem localhost é permitida sem token
    assert.deepEqual(checkRequestOrigin({ origin: 'http://localhost:3000', host: 'localhost:7899' }), { ok: true })
    assert.deepEqual(checkRequestOrigin({ origin: 'http://127.0.0.1:5173', host: '127.0.0.1:7899' }), { ok: true })
    assert.deepEqual(checkRequestOrigin({ origin: 'https://[::1]:8443', host: '[::1]:7899' }), { ok: true })

    // file:// e "null" exigem token válido da execução
    for (const fileOrig of ['null', 'file://', 'file:///C:/app/dist/index.html']) {
      assert.deepEqual(checkRequestOrigin({ origin: fileOrig, host: 'localhost:7899', token }), { ok: true })
      assert.deepEqual(checkRequestOrigin({ origin: fileOrig, host: 'localhost:7899', token: '' }), {
        ok: false,
        reason: 'Token do aplicativo ausente ou inválido.',
      })
      assert.deepEqual(checkRequestOrigin({ origin: fileOrig, host: 'localhost:7899', token: 'token-errado' }), {
        ok: false,
        reason: 'Token do aplicativo ausente ou inválido.',
      })
    }

    // Origem externa é sempre bloqueada, mesmo com token válido
    for (const external of ['https://evil.com', 'http://localhost.evil.com:3000', 'http://192.168.1.50:3000']) {
      assert.deepEqual(checkRequestOrigin({ origin: external, host: 'localhost:7899', token }), {
        ok: false,
        reason: 'Origem não permitida.',
      })
    }
  } finally {
    if (prevToken === undefined) delete process.env.VERTICE_API_TOKEN
    else process.env.VERTICE_API_TOKEN = prevToken
  }
})
