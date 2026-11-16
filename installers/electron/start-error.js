// Descrição pura dos erros de inicialização do vertice-core no processo main do Electron.
// Isolada do módulo `electron` para permitir importação e testes diretos em Node.

function extractReason(error) {
  if (typeof error === 'string') return error.trim() || 'erro desconhecido'
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) return error.message.trim()
    if (typeof error.code === 'string' && error.code.trim()) return error.code.trim()
    return 'erro desconhecido'
  }
  if (error !== null && error !== undefined) {
    const text = String(error).trim()
    if (text) return text
  }
  return 'erro desconhecido'
}

export function describeStartError(error, port = 7845) {
  const displayPort = port || 7845
  const rawCode = error && typeof error === 'object' ? error.code : undefined
  const code = typeof rawCode === 'string'
    ? (rawCode.trim() || 'UNKNOWN')
    : (rawCode ?? 'UNKNOWN')

  if (code === 'EADDRINUSE') {
    return {
      code: 'EADDRINUSE',
      title: 'Serviço local não pôde iniciar',
      message: `A porta ${displayPort} já está em uso.`,
      detail: `Não foi possível iniciar o serviço local na porta ${displayPort}, provavelmente há outra janela do Vértice aberta. Você pode tentar de novo, abrir em modo offline (somente demonstração) ou sair.`,
    }
  }

  const reason = extractReason(error)
  return {
    code,
    title: 'Serviço local não pôde iniciar',
    message: `Falha ao iniciar o serviço local na porta ${displayPort}.`,
    detail: `Causa: ${reason}. Você pode tentar de novo, abrir em modo offline (somente demonstração) ou sair.`,
  }
}
