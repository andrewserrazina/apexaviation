import OperationsLayout from '../../components/OperationsLayout'

const filters = ['Flights', 'Simulator sessions', 'Ground lessons', 'Instructor availability']

export default function OperationsSchedule() {
  return (
    <OperationsLayout>
      <div className="operations-page-header operations-page-header--row">
        <div>
          <p className="operations-eyebrow">Scheduling foundation</p>
          <h1>Schedule</h1>
          <p>Calendar/list foundation for future flight, simulator, ground lesson, and instructor availability scheduling.</p>
        </div>
        <button className="btn-primary" type="button">Create Event</button>
      </div>
      <section className="operations-card">
        <div className="operations-filter-bar" aria-label="Schedule filters">
          {filters.map(filter => <button type="button" key={filter}>{filter}</button>)}
        </div>
        <div className="operations-empty-state">
          <h2>No operations events connected yet</h2>
          <p>Future scheduling records can populate this calendar/list view without changing the page structure.</p>
        </div>
      </section>
    </OperationsLayout>
  )
}
