import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './Toast.css'

export interface ToastProps {
  children: ReactNode
  /** Renders inline instead of fixed-positioned — for previews/stories
   * where a fixed overlay would escape the frame. */
  static?: boolean
  className?: string
}

/** Bottom-right confirmation toast — "Saved", achievement unlocks, etc. */
export function Toast({ children, static: isStatic = false, className }: ToastProps) {
  return <div className={cx('apex-toast', isStatic && 'apex-toast--static', className)}>{children}</div>
}
