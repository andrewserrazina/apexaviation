// Wraps the .stat-grid/.stat-card pattern already used on Dashboard,
// Reports, Analytics, etc. `stats` is [{ label, value, sub? }].
export default function StatsRow({ stats, size }) {
  return (
    <div className={`stat-grid${size === 'sm' ? ' stat-grid--sm' : ''}`}>
      {stats.map(stat => (
        <div className="stat-card" key={stat.label}>
          <div className="stat-card__label">{stat.label}</div>
          <div className="stat-card__value">{stat.value}</div>
          {stat.sub && <div className="stat-card__sub">{stat.sub}</div>}
        </div>
      ))}
    </div>
  )
}
