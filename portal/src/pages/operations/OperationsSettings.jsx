import OperationsLayout from '../../components/OperationsLayout'
import { operationsSettings } from '../../lib/operationsData'

export default function OperationsSettings() {
  return (
    <OperationsLayout>
      <div className="operations-page-header"><p className="operations-eyebrow">Operations configuration</p><h1>Settings</h1><p>Future settings for location rules, scheduling policy, permissions, resources, and notifications.</p></div>
      <section className="operations-card"><div className="operations-list">{operationsSettings.map(setting => <div className="operations-list__row" key={setting}><strong>{setting}</strong><span>Not configured</span><p>Placeholder for future Apex Operations settings.</p><em>Future</em></div>)}</div></section>
    </OperationsLayout>
  )
}
