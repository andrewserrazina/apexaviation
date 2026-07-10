import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

function formatEventTime(event) {
  return `${event.event_date} · ${event.start_time?.slice(0, 5)}–${event.end_time?.slice(0, 5)}`
}

export default function OperationsSimulator() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('operations_events')
      .select('*')
      .eq('event_type', 'simulator')
      .gte('event_date', new Date().toISOString().slice(0, 10))
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(50)

    if (loadError) setError(loadError.message)
    else setEvents(data ?? [])
    setLoading(false)
  }

  return (
    <Layout>
      <div className="operations-page-header operations-page-header--row">
        <div>
          <p className="operations-eyebrow">Redbird FMX / AATD workflow</p>
          <h1>Simulator</h1>
          <p>Upcoming simulator sessions, pulled from the Operations Schedule.</p>
        </div>
        <Link className="btn-primary" to="/operations/schedule">Schedule a Session</Link>
      </div>

      <section className="operations-panel">
        {error && <div className="operations-form-error">{error}</div>}
        {loading && <div className="operations-empty-state"><p>Loading simulator sessions…</p></div>}
        {!loading && events.length === 0 && (
          <div className="operations-empty-state">
            <h2>No simulator sessions scheduled</h2>
            <p>Create one from the Operations Schedule and it will show up here automatically.</p>
          </div>
        )}
        {!loading && events.length > 0 && (
          <div className="operations-list">
            {events.map(event => (
              <div className="operations-list__row" key={event.id}>
                <strong>{formatEventTime(event)}</strong>
                <span>{event.resource_name || 'Simulator'}</span>
                <p>{event.title}</p>
                <em>{event.status}</em>
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  )
}
