import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'
import './StatTile.css'

export interface StatTileProps {
  icon?: ReactNode
  value: ReactNode
  label: ReactNode
  className?: string
}

/** Dashboard stat block — "256 DPE Questions Available", "10 Training
 * Scenarios", etc. */
export function StatTile({ icon, value, label, className }: StatTileProps) {
  return (
    <div className={cx('apex-stat', className)}>
      {icon && <div className="apex-stat__icon">{icon}</div>}
      <div className="apex-stat__value">{value}</div>
      <div className="apex-stat__label">{label}</div>
    </div>
  )
}
