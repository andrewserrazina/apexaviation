import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './NavItem.css'

export interface NavItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon?: ReactNode
  active?: boolean
  /** Shows a lock glyph — the portal's gated-section indicator (Checkride
   * Prep, DPE Library, etc. before the member unlocks). */
  gated?: boolean
  children: ReactNode
  className?: string
}

/** Sidebar navigation button — the portal's dashboard/checkride-prep/
 * ground-school style nav items. */
export function NavItem({ icon, active = false, gated = false, children, className, ...rest }: NavItemProps) {
  return (
    <button type="button" className={cx('apex-nav-item', active && 'apex-nav-item--active', className)} {...rest}>
      {icon}
      {children}
      {gated && (
        <svg className="apex-nav-item__lock" width="14" height="14" viewBox="0 0 24 24" fill="none">
          <rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}
