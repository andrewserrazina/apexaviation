import { Link } from 'react-router-dom'
import OperationsLayout from '../../components/OperationsLayout'

const widgets = [
  { label: 'Today’s Schedule', value: 'Open schedule', detail: 'Create and review internal Operations events.', to: '/operations/schedule' },
  { label: 'Ground School', value: 'Manage sessions', detail: 'Create sessions, assign instructors, and manage registrants.', to: '/ground-schedule' },
  { label: 'Simulator / Fleet', value: 'View resources', detail: 'Use Fleet for current aircraft and simulator resource tracking.', to: '/aircraft' },
  { label: 'Instructors', value: 'Manage roster', detail: 'Create and edit instructor profiles, certificates, and bios.', to: '/instructors' },
  { label: 'Students', value: 'Manage students', detail: 'Review active student records and training activity.', to: '/students' },
  { label: 'Leads / CRM', value: 'Open CRM', detail: 'Track prospective students and enrollment pipeline.', to: '/crm' },
]

export default function OperationsDashboard() {
  return (
    <OperationsLayout>
      <div className="operations-page-header">
        <p className="operations-eyebrow">Internal workspace</p>
        <h1>Apex Operations</h1>
        <p>Flight school management tools for scheduling, ground school, instructor management, resources, students, and CRM.</p>
      </div>
      <section className="operations-widget-grid">
        {widgets.map(widget => (
          <Link className="operations-widget" key={widget.label} to={widget.to}>
            <span>{widget.label}</span>
            <strong>{widget.value}</strong>
            <p>{widget.detail}</p>
          </Link>
        ))}
      </section>
    </OperationsLayout>
  )
}
