import OperationsLayout from '../../components/OperationsLayout'
import { instructorList } from '../../lib/operationsData'

export default function OperationsInstructors() {
  return (
    <OperationsLayout>
      <div className="operations-page-header"><p className="operations-eyebrow">Instructor management</p><h1>Instructors</h1><p>Instructor list, ratings/certificates, availability, and assigned students foundation.</p></div>
      <section className="operations-card"><div className="operations-card__head"><h2>Instructor List</h2><span>Ratings and assignments pending</span></div><div className="operations-list">{instructorList.map(instructor => <div className="operations-list__row" key={instructor.name}><strong>{instructor.name}</strong><span>{instructor.role}</span><p>Certificates, availability, and assigned students placeholder.</p><em>{instructor.status}</em></div>)}</div></section>
    </OperationsLayout>
  )
}
