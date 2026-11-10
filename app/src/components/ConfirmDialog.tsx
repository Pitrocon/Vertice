import { useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from './Modal'

interface ConfirmDialogProps {
  title: string
  eyebrow?: string
  children: ReactNode
  confirmLabel: string
  /** Retornar `false` mantém o diálogo aberto (ex.: o core recusou a operação). */
  onConfirm: () => Promise<boolean> | boolean | void
  onClose: () => void
}

/** Confirmação de ações destrutivas (excluir tarefa, meta, projeto). */
export function ConfirmDialog({ title, eyebrow, children, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    const result = await onConfirm()
    setBusy(false)
    if (result !== false) onClose()
  }

  return (
    <Modal title={title} eyebrow={eyebrow} onClose={onClose}>
      <div className="confirm-copy">{children}</div>
      <footer className="modal-footer">
        <button className="button button--secondary" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="button button--danger-solid" onClick={() => void confirm()} disabled={busy}><Trash2 size={15} /> {confirmLabel}</button>
      </footer>
    </Modal>
  )
}