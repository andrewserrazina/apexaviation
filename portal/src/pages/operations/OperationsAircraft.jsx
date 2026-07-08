import OperationsLayout from '../../components/OperationsLayout'
import { aircraftList } from '../../lib/operationsData'

export default function OperationsAircraft() {
  return (
    <OperationsLayout>
      <div className="operations-page-header"><p className="operations-eyebrow">Fleet operations</p><h1>Aircraft</h1><p>Aircraft status, maintenance due, squawks, and availability foundation.</p></div>
      <section className="operations-card"><div className="operations-card__head"><h2>Aircraft List / Status</h2><span>Future data model ready</span></div><div className="operations-list">{aircraftList.map(aircraft => <div className="operations-list__row" key={aircraft.tail}><strong>{aircraft.tail}</strong><span>{aircraft.model}</span><p>{aircraft.due}</p><em>{aircraft.status}</em></div>)}</div></section>
    </OperationsLayout>
  )
}
