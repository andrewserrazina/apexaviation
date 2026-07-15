import type { MouseEvent, ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './Modal.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  icon?: ReactNode
  title?: ReactNode
  children?: ReactNode
  className?: string
}

/** The gold-bordered overlay dialog used for the Checkride Prep unlock
 * flow. Clicking the dimmed backdrop closes it, same as the original. */
export function Modal({ open, onClose, icon, title, children, className }: ModalProps) {
  if (!open) return null

  function handleOverlayClick(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="apex-modal-overlay" onClick={handleOverlayClick}>
      <div className={cx('apex-modal', className)}>
        <button type="button" className="apex-modal__close" onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {icon && <div className="apex-modal__icon">{icon}</div>}
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  )
}
