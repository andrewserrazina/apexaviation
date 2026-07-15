import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './SectionHeader.css'

export interface SectionHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  /** Renders in the gold italic accent typeface (Playfair Display) —
   * wrap the emphasized portion of `title` in this instead. */
  accent?: ReactNode
  desc?: ReactNode
  /** Centered (marketing sections) or left-aligned (portal section headers). */
  align?: 'center' | 'left'
  className?: string
}

/** The eyebrow + headline + description pattern used to open every major
 * section on the marketing site and every portal page. */
export function SectionHeader({ eyebrow, title, accent, desc, align = 'center', className }: SectionHeaderProps) {
  return (
    <div
      className={cx(
        'apex-section-header',
        align === 'center' ? 'apex-section-header--centered' : 'apex-section-header--left',
        className,
      )}
    >
      {eyebrow && <div className="apex-section-header__eyebrow">{eyebrow}</div>}
      <h2 className="apex-section-header__title">
        {title}
        {accent && <em>{accent}</em>}
      </h2>
      {desc && <p className="apex-section-header__desc">{desc}</p>}
    </div>
  )
}
