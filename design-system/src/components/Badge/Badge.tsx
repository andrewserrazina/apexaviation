import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './Badge.css'

export type BadgeVariant = 'live' | 'gold' | 'locked' | 'outline'

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

/** Small status pill — "Live Today" program badges, the locked-content
 * indicator on gated portal nav items, or a plain gold accent label. */
export function Badge({ variant = 'gold', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx('apex-badge', `apex-badge--${variant}`, className)} {...rest}>
      {children}
    </span>
  )
}
