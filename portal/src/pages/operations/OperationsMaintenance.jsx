import OperationsLayout from '../../components/OperationsLayout'
import { maintenanceItems } from '../../lib/operationsData'

export default function OperationsMaintenance() {
  return (
    <OperationsLayout>
      <div className="operations-page-header"><p className="operations-eyebrow">Maintenance tracking</p><h1>Maintenance</h1><p>Aircraft inspections, simulator maintenance, open squawks, and upcoming due item foundation.</p></div>
      <section className="operations-widget-grid">{maintenanceItems.map(item => <article className="operations-widget" key={item.item}><span>{item.item}</span><strong>Pending</strong><p>{item.status}</p></article>)}</section>
    </OperationsLayout>
  )
}
