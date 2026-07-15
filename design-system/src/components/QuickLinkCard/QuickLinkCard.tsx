import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './QuickLinkCard.css'

export interface QuickLinkCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  icon: ReactNode
  title: ReactNode
  description: ReactNode
  className?: string
}

/** Dashboard "Jump back in" quicklink — icon, title, one-line description. */
export function QuickLinkCard({ icon, title, description, className, ...rest }: QuickLinkCardProps) {
  return (
    <button type="button" className={cx('apex-quicklink', className)} {...rest}>
      <div className="apex-quicklink__icon">{icon}</div>
      <div>
        <div className="apex-quicklink__title">{title}</div>
        <div className="apex-quicklink__desc">{description}</div>
      </div>
    </button>
  )
}
