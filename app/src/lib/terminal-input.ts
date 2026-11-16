/**
 * Achata quebras de linha em espaços simples, preservando a ordem das palavras.
 * Arquivo mantido puro, sem imports e apenas com sintaxe TypeScript apagável
 * para execução direta pelo Node nos testes automatizados.
 */
export function flattenTextForPaste(text: string): string {
  const body = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
  return body.split(/\s*\n\s*/).filter(Boolean).join(' ')
}

/**
 * Formata o texto enviado pela barra inferior para uma sessão de terminal real.
 * Garante exatamente um `\r` no final e evita que quebras de linha virem múltiplos Enters
 * quando a CLI não ativou bracketed paste.
 */
export function formatTextForSession(text: string, bracketedPaste: boolean): string {
  if (bracketedPaste) {
    const body = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '')
    return `\x1b[200~${body}\x1b[201~\r`
  }
  return flattenTextForPaste(text) + '\r'
}
