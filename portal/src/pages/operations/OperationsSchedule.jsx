import { useEffect, useState } from 'react'
import OperationsLayout from '../../components/OperationsLayout'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const filters = [
  { label: 'Flights', type: 'flight' },
  { label: 'Simulator sessions', type: 'simulator' },
  { label: 'Ground lessons', type: 'ground' },
  { label: 'Instructor availability', type: 'availability' },
]

const BLANK_EVENT = {
  event_type: 'flight',
  title: '',
  event_date: '',
  start_time: '',
  end_time: '',
  resource_name: '',
  notes: '',
}

function formatEventTime(event) {
  return `${event.event_date} · ${event.start_time?.slice(0, 5)}–${event.end_time?.slice(0, 5)}`
}

export default function OperationsSchedule() {
  const { profile } = useAuth()
  const [events, setEvents] = useState([])
  const [activeType, setActiveType] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(BLANK_EVENT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    setLoading(true)
    const { data, error: loadError } = await supabase
      .from('operations_events')
      .select('*')
      .gte('event_date', new Date().toISOString().slice(0, 10))
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(50)

    if (loadError) setError(loadError.message)
    else setEvents(data ?? [])
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!form.title || !form.event_date || !form.start_time || !form.end_time) {
      setError('Title, date, start time, and end time are required.')
      return
    }
    if (form.end_time <= form.start_time) {
      setError('End time must be after start time.')
      return
    }

    setSaving(true)
    const payload = {
      ...form,
      created_by: profile?.id,
      resource_name: form.resource_name || null,
      notes: form.notes || null,
    }
    const { error: saveError } = await supabase.from('operations_events').insert(payload)
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setForm(BLANK_EVENT)
    setShowForm(false)
    await loadEvents()
  }

  const visibleEvents = activeType === 'all' ? events : events.filter(event => event.event_type === activeType)

  return (
    <OperationsLayout>
      <div className="operations-page-header operations-page-header--row">
        <div>
          <p className="operations-eyebrow">Scheduling foundation</p>
          <h1>Operations Schedule</h1>
          <p>Create and view internal events for flights, simulator sessions, ground lessons, maintenance, and instructor availability.</p>
        </div>
        <button className="btn-primary" type="button" onClick={() => setShowForm(open => !open)}>{showForm ? 'Close Form' : 'Create Event'}</button>
      </div>

      <section className="operations-panel">
        <div className="operations-filter-bar" aria-label="Schedule filters">
          <button type="button" className={activeType === 'all' ? 'is-active' : ''} onClick={() => setActiveType('all')}>All</button>
          {filters.map(filter => (
            <button type="button" className={activeType === filter.type ? 'is-active' : ''} key={filter.type} onClick={() => setActiveType(filter.type)}>{filter.label}</button>
          ))}
        </div>

        {showForm && (
          <form className="operations-event-form" onSubmit={handleSubmit}>
            {error && <div className="operations-form-error">{error}</div>}
            <label>Type<select value={form.event_type} onChange={e => setForm({ ...form, event_type: e.target.value })}>{filters.map(filter => <option key={filter.type} value={filter.type}>{filter.label}</option>)}<option value="maintenance">Maintenance</option><option value="other">Other</option></select></label>
            <label>Title<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Discovery flight" required /></label>
            <label>Date<input type="date" value={form.event_date} onChange={e => setForm({ ...form, event_date: e.target.value })} required /></label>
            <label>Start<input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} required /></label>
            <label>End<input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} required /></label>
            <label>Resource<input value={form.resource_name} onChange={e => setForm({ ...form, resource_name: e.target.value })} placeholder="Aircraft, simulator, room" /></label>
            <label className="operations-event-form__wide">Notes<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Internal operations notes" /></label>
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Event'}</button>
          </form>
        )}

        {!showForm && error && <div className="operations-form-error">{error}</div>}
        {loading && <div className="operations-empty-state"><p>Loading operations schedule…</p></div>}
        {!loading && visibleEvents.length === 0 && (
          <div className="operations-empty-state">
            <h2>No operations events yet</h2>
            <p>Create the first Operations event, or adjust filters to see upcoming activity.</p>
          </div>
        )}
        {!loading && visibleEvents.length > 0 && (
          <div className="operations-list">
            {visibleEvents.map(event => (
              <div className="operations-list__row" key={event.id}>
                <strong>{formatEventTime(event)}</strong>
                <span>{event.event_type}</span>
                <p>{event.title}{event.resource_name ? ` · ${event.resource_name}` : ''}</p>
                <em>{event.status}</em>
              </div>
            ))}
          </div>
        )}
      </section>
    </OperationsLayout>
  )
}
