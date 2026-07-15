import { cx } from '../../utils/cx'
import './Tabs.css'

export interface TabItem {
  id: string
  label: string
}

export interface TabsProps {
  items: TabItem[]
  activeId: string
  onChange: (id: string) => void
  className?: string
}

/** Pill-style sub-filter tabs — Private/Instrument/Commercial in the
 * Checkride Prep section, ground-school categories, etc. */
export function Tabs({ items, activeId, onChange, className }: TabsProps) {
  return (
    <div className={cx('apex-tabs', className)}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cx('apex-tab', item.id === activeId && 'apex-tab--active')}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
