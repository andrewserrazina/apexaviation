import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './Alert.css'

export type AlertVariant = 'error' | 'success'

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  variant?: AlertVariant
  children: ReactNode
  className?: string
}

/** Inline form feedback banner — sign-in errors, password-reset
 * confirmations, checkout error messages. */
export function Alert({ variant = 'error', children, className, ...rest }: AlertProps) {
  return (
    <div role={variant === 'error' ? 'alert' : 'status'} className={cx('apex-alert', `apex-alert--${variant}`, className)} {...rest}>
      {children}
    </div>
  )
}
