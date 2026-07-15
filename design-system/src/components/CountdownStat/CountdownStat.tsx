import { cx } from '../../utils/cx'
import './CountdownStat.css'

export interface CountdownStatProps {
  /** Days remaining. Drives the color state: >14 gold, 4-14 gold-light
   * ("soon"), <=3 red ("urgent") — matching the dashboard's countdown
   * card thresholds. */
  daysRemaining: number
  label?: string
  className?: string
}

/** Dashboard "Checkride Countdown" widget. */
export function CountdownStat({ daysRemaining, label = 'Checkride Countdown', className }: CountdownStatProps) {
  const urgency = daysRemaining <= 3 ? 'urgent' : daysRemaining <= 14 ? 'soon' : 'normal'
  return (
    <div className={cx('apex-countdown', urgency !== 'normal' && `apex-countdown--${urgency}`, className)}>
      <div className="apex-countdown__eyebrow">{label}</div>
      <div className="apex-countdown__value">
        {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}
      </div>
    </div>
  )
}
