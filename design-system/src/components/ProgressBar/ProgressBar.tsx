import { cx } from '../../utils/cx'
import './ProgressBar.css'

export interface ProgressBarProps {
  /** 0-100 */
  percent: number
  className?: string
}

/** Gold-gradient linear progress bar — syllabus/lesson completion. */
export function ProgressBar({ percent, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div
      className={cx('apex-progress-bar', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="apex-progress-bar__fill" style={{ width: `${clamped}%` }} />
    </div>
  )
}
