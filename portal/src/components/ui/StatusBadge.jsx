const TONES = ['success', 'warning', 'danger', 'info']

export default function StatusBadge({ children, tone = 'neutral' }) {
  const suffix = TONES.includes(tone) ? ` status-badge--${tone}` : ''
  return <span className={`status-badge${suffix}`}>{children}</span>
}
