import OperationsLayout from '../../components/OperationsLayout'
import { operationsStudents } from '../../lib/operationsData'

export default function OperationsStudents() {
  return (
    <OperationsLayout>
      <div className="operations-page-header"><p className="operations-eyebrow">Operations student management</p><h1>Students</h1><p>Physical-location training status, documents, and upcoming lesson workflow — separate from LMS course progress.</p></div>
      <section className="operations-card"><div className="operations-card__head"><h2>Active Student List</h2><span>Documents and lessons pending</span></div><div className="operations-list">{operationsStudents.map(student => <div className="operations-list__row" key={student.name}><strong>{student.name}</strong><span>{student.stage}</span><p>{student.next}</p><em>Active</em></div>)}</div></section>
    </OperationsLayout>
  )
}
