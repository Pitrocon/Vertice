import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeStartError } from '../../installers/electron/start-error.js'

test('describeStartError descreve EADDRINUSE com porta, causa e dica de outra janela', () => {
  const err = Object.assign(new Error('listen EADDRINUSE: address already in use :::7845'), {
    code: 'EADDRINUSE',
  })

  const info = describeStartError(err)
  assert.equal(info.code, 'EADDRINUSE')
  assert.equal(info.title, 'Serviço local não pôde iniciar')
  assert.equal(info.message, 'A porta 7845 já está em uso.')
  assert.match(info.detail, /\b7845\b/)
  assert.match(info.detail, /provavelmente há outra janela do Vértice aberta/)
  assert.match(info.detail, /tentar de novo/i)
  assert.match(info.detail, /modo offline/i)

  const customPortInfo = describeStartError({ code: 'EADDRINUSE' }, 7899)
  assert.equal(customPortInfo.code, 'EADDRINUSE')
  assert.equal(customPortInfo.message, 'A porta 7899 já está em uso.')
  assert.match(customPortInfo.detail, /\b7899\b/)
  assert.match(customPortInfo.detail, /provavelmente há outra janela do Vértice aberta/)
})

test('describeStartError descreve erro genérico com porta, código e causa', () => {
  const eacces = Object.assign(new Error('permissão negada ao abrir socket'), { code: 'EACCES' })
  const info = describeStartError(eacces, 7899)

  assert.equal(info.code, 'EACCES')
  assert.equal(info.title, 'Serviço local não pôde iniciar')
  assert.equal(info.message, 'Falha ao iniciar o serviço local na porta 7899.')
  assert.match(info.detail, /Causa: permissão negada ao abrir socket\./)
  assert.match(info.detail, /tentar de novo/i)
  assert.match(info.detail, /modo offline/i)

  const plainError = new Error('core não encontrado em recursos')
  const plainInfo = describeStartError(plainError)
  assert.equal(plainInfo.code, 'UNKNOWN')
  assert.match(plainInfo.message, /\b7845\b/)
  assert.match(plainInfo.detail, /Causa: core não encontrado em recursos\./)

  const codeOnlyInfo = describeStartError({ code: 'EPERM' }, 7845)
  assert.equal(codeOnlyInfo.code, 'EPERM')
  assert.match(codeOnlyInfo.detail, /Causa: EPERM\./)
})

test('describeStartError trata erro nulo, indefinido ou string sem falhar', () => {
  for (const emptyInput of [null, undefined, '', '   ', {}]) {
    const info = describeStartError(emptyInput, 7845)
    assert.equal(info.code, 'UNKNOWN')
    assert.equal(info.title, 'Serviço local não pôde iniciar')
    assert.equal(info.message, 'Falha ao iniciar o serviço local na porta 7845.')
    assert.match(info.detail, /Causa: erro desconhecido\./)
  }

  const stringInfo = describeStartError('falha inesperada de inicialização', 9001)
  assert.equal(stringInfo.code, 'UNKNOWN')
  assert.equal(stringInfo.message, 'Falha ao iniciar o serviço local na porta 9001.')
  assert.match(stringInfo.detail, /Causa: falha inesperada de inicialização\./)
})
