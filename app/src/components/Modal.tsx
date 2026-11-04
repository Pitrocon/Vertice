import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  eyebrow?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}

export function Modal({ title, eyebrow, children, onClose, wide = false }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${wide ? 'modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div>{eyebrow && <span className="section-label">{eyebrow}</span>}<h2 id="modal-title">{title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}
