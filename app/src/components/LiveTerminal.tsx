import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { RawOutputListener } from '@/store/workspace'

interface LiveTerminalProps {
  agentId: string
  /** Saída bruta já recebida (replay ao montar ou ao trocar de agente). */
  getBuffer: (agentId: string) => string
  /** Assina novos chunks do PTY; `data === null` significa "sessão nova, limpar". */
  subscribe: (listener: RawOutputListener) => () => void
  /** Bytes digitados no terminal, enviados direto ao PTY (setas, Enter, Esc, Ctrl+C...). */
  onData: (data: string) => void
  /** Dimensões do emulador, para o PTY acompanhar. */
  onResize: (cols: number, rows: number) => void
}

// Cores aproximadas (hex) da paleta do Vértice; o xterm não interpreta oklch().
const THEME = {
  background: '#00000000',
  foreground: '#e9edf3',
  cursor: '#e8963c',
  cursorAccent: '#1a1b1e',
  selectionBackground: '#4c8fe066',
}

/**
 * Renderiza a sessão real com um emulador de terminal (xterm.js): cores, cursor e redesenho de
 * menus interativos das CLIs (a opção destacada se move ao usar as setas).
 */
export function LiveTerminal({ agentId, getBuffer, subscribe, onData, onResize }: LiveTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Callbacks em ref: o terminal é criado uma vez por agente e não deve ser recriado a cada render.
  const handlers = useRef({ getBuffer, subscribe, onData, onResize })
  useEffect(() => { handlers.current = { getBuffer, subscribe, onData, onResize } })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const monoFont = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
    const term = new Terminal({
      allowTransparency: true,
      cursorBlink: true,
      fontFamily: monoFont || 'Consolas, "Cascadia Mono", monospace',
      fontSize: 12,
      scrollback: 5000,
      theme: THEME,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)

    // Teclado: deixa o navegador tratar "copiar" (Ctrl+C com seleção) e Shift+Tab (sair do terminal
    // pelo teclado). Retornar false = o xterm NÃO processa a tecla.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      if (event.key === 'Tab' && event.shiftKey) return false
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && term.hasSelection()) return false
      return true
    })

    let resizeTimer: number | undefined
    const notifyResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => handlers.current.onResize(term.cols, term.rows), 120)
    }
    const safeFit = () => {
      // Só ajusta quando o contêiner está visível (painel colapsado tem tamanho 0).
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        try { fit.fit() } catch { /* terminal ainda não renderizado */ }
      }
    }

    safeFit()
    const initial = handlers.current.getBuffer(agentId)
    if (initial) term.write(initial)
    // O PTY nasce com 120x30: sincroniza com o tamanho real, mesmo que o fit não dispare onResize.
    handlers.current.onResize(term.cols, term.rows)

    const dataSub = term.onData((data) => handlers.current.onData(data))
    const resizeSub = term.onResize(notifyResize)
    const unsubscribe = handlers.current.subscribe((id, data) => {
      if (id !== agentId) return
      if (data === null) term.reset()
      else term.write(data)
    })
    const observer = new ResizeObserver(safeFit)
    observer.observe(container)

    return () => {
      window.clearTimeout(resizeTimer)
      observer.disconnect()
      unsubscribe()
      dataSub.dispose()
      resizeSub.dispose()
      term.dispose()
    }
  }, [agentId])

  return (
    <div
      className="live-terminal"
      ref={containerRef}
      role="group"
      aria-label="Terminal da sessão real. Use o teclado para navegar nos menus da CLI; Shift+Tab sai do terminal."
    />
  )
}
