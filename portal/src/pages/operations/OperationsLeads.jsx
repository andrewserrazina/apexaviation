import OperationsLayout from '../../components/OperationsLayout'
import { leadPipeline } from '../../lib/operationsData'

export default function OperationsLeads() {
  return (
    <OperationsLayout>
      <div className="operations-page-header"><p className="operations-eyebrow">Enrollment pipeline</p><h1>Leads / CRM</h1><p>Future enrollment pipeline for discovery calls, tours, enrollment follow-up, and outcomes.</p></div>
      <section className="operations-pipeline">{leadPipeline.map(status => <article className="operations-card operations-pipeline__column" key={status}><h2>{status}</h2><div className="operations-empty-state operations-empty-state--compact"><p>No leads in this stage yet.</p></div></article>)}</section>
    </OperationsLayout>
  )
}
