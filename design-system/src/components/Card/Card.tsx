import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './Card.css'

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> {
  /** Gold-gradient highlight treatment, used for the dashboard welcome
   * banner and the Checkride Prep offer card. */
  featured?: boolean
  /** Adds hover lift + border glow for clickable quicklink-style cards. */
  interactive?: boolean
  eyebrow?: ReactNode
  title?: ReactNode
  children?: ReactNode
  className?: string
}

/** The base surface used everywhere in the portal — dashboard panels,
 * program cards, offer boxes. Compose `eyebrow`/`title` for the common
 * header pattern, or pass arbitrary children for a fully custom layout. */
export function Card({ featured = false, interactive = false, eyebrow, title, children, className, ...rest }: CardProps) {
  return (
    <div
      className={cx('apex-card', featured && 'apex-card--featured', interactive && 'apex-card--interactive', className)}
      {...rest}
    >
      {eyebrow && <div className="apex-card__eyebrow">{eyebrow}</div>}
      {title && <h3 className="apex-card__title">{title}</h3>}
      {children && <div className="apex-card__body">{children}</div>}
    </div>
  )
}
