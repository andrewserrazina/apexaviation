import OperationsLayout from '../../components/OperationsLayout'
import { operationsStats, todaySchedule } from '../../lib/operationsData'

export default function OperationsDashboard() {
  return (
    <OperationsLayout>
      <div className="operations-page-header">
        <p className="operations-eyebrow">Apex Operations</p>
        <h1>Operations Dashboard</h1>
        <p>Internal flight school management workspace for daily location operations.</p>
      </div>
      <section className="operations-widget-grid">
        {operationsStats.map(stat => (
          <article className="operations-widget" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <p>{stat.detail}</p>
          </article>
        ))}
      </section>
      <section className="operations-card">
        <div className="operations-card__head">
          <h2>Today’s Schedule</h2>
          <span>Placeholder-ready</span>
        </div>
        <div className="operations-list">
          {todaySchedule.map(item => (
            <div className="operations-list__row" key={`${item.time}-${item.type}`}>
              <strong>{item.time}</strong>
              <span>{item.type}</span>
              <p>{item.resource}</p>
              <em>{item.status}</em>
            </div>
          ))}
        </div>
      </section>
    </OperationsLayout>
  )
}
