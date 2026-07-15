import { cx } from '../../utils/cx'
import './Avatar.css'

export interface AvatarProps {
  name: string
  size?: 'sm' | 'lg'
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

/** Gold-gradient initials circle — top bar and Account Management avatar. */
export function Avatar({ name, size = 'sm', className }: AvatarProps) {
  return <div className={cx('apex-avatar', `apex-avatar--${size}`, className)}>{initials(name)}</div>
}
