import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDays, format, isSameDay } from 'date-fns'
import Layout from '../components/Layout'
import CalendarGrid from '../components/CalendarGrid'
import Modal from '../components/Modal'
import { PageHeader, EmptyState } from '../components/ui'
import {
  EVENT_TYPES, EVENT_TYPE_LABELS, EVENT_TYPE_TONES, EVENT_TYPE_LINKS, fetchOperationsEvents,
} from '../lib/operationsEvents'

// The two event types that can actually be created for a single date in
// one step -- private instruction and mock orals are availability-slot
// systems (students book themselves against a range), not a "schedule
// one event on this day" flow, so they don't get a quick-create action
// here; their own pages are still reachable from the nav as usual.
const QUICK_SCHEDULE_TYPES = [EVENT_TYPES.LESSON, EVENT_TYPES.GROUND_CLASS]

const ALL_TYPES = Object.values(EVENT_TYPES)

function toneClass(type, prefix) {
  const tone = EVENT_TYPE_TONES[type]
  return tone ? ` ${prefix}--${tone}` : ''
}

// The portal's new scheduling home: one calendar aggregating flight
// lessons, ground classes, private instruction, and mock orals (read
// side only -- each still lives in its own table and is still managed
// on its own page; see the portal overhaul plan for why merging those
// schemas is out of scope for this pass). Replaces Schedule/
// GroundSchedule/PrivateInstructionDashboard/MockOralDashboard as the
// day-to-day scheduling landing page.
export default function OperationsCalendar() {
  const navigate = useNavigate()
  const [activeTypes, setActiveTypes] = useState(new Set(ALL_TYPES))
  const [range, setRange] = useState(null)
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDay, setSelectedDay] = useState(null)

  useEffect(() => {
    if (!range) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetchOperationsEvents({ from: range.start, to: addDays(range.end, 1), types: [...activeTypes] })
      .then(data => { if (!cancelled) setEvents(data) })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range?.start?.getTime(), range?.end?.getTime(), [...activeTypes].join(',')])

  function scheduleOnSelectedDay(type) {
    if (!selectedDay) return
    navigate(EVENT_TYPE_LINKS[type], { state: { prefillDate: format(selectedDay, 'yyyy-MM-dd') } })
  }

  function toggleType(type) {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  const dayEvents = selectedDay
    ? events.filter(e => isSameDay(e.date, selectedDay)).sort((a, b) => a.date - b.date)
    : []

  return (
    <Layout>
      <PageHeader
        eyebrow="Apex Operations"
        title="Scheduling"
        description="Flight lessons, ground classes, private instruction, and mock orals in one calendar."
      />

      <div className="event-type-filters">
        {ALL_TYPES.map(type => {
          const on = activeTypes.has(type)
          const tone = EVENT_TYPE_TONES[type]
          return (
            <button
              key={type}
              type="button"
              className={`event-type-filter${on ? '' : ' event-type-filter--off'}`}
              onClick={() => toggleType(type)}
              aria-pressed={on}
            >
              <span
                className="event-type-filter__dot"
                style={{ background: tone ? `var(--tone-${tone})` : 'var(--gold)' }}
              />
              {EVENT_TYPE_LABELS[type]}
            </button>
          )
        })}
      </div>

      {error && <div className="form-error" style={{ marginBottom: 16 }}>{error}</div>}

      <CalendarGrid
        events={events}
        getEventDate={e => e.date}
        onDayClick={setSelectedDay}
        onRangeChange={setRange}
        showViewToggle
        renderEvent={event => (
          <div
            key={event.id}
            className={`cal-event${toneClass(event.type, 'cal-event')}${event.status === 'canceled' || event.status === 'no_show' ? ' cal-event--canceled' : ''}`}
            onClick={e => { e.stopPropagation(); navigate(event.link) }}
            title={`${EVENT_TYPE_LABELS[event.type]}: ${event.title}`}
          >
            <span>{format(event.date, 'h:mm a')} — {event.title}</span>
            <span>{event.sub}</span>
          </div>
        )}
      />

      {loading && <p className="empty-state">Loading…</p>}

      {selectedDay && (
        <Modal title={format(selectedDay, 'EEEE, MMMM d, yyyy')} onClose={() => setSelectedDay(null)} wide>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {QUICK_SCHEDULE_TYPES.map(type => (
              <button key={type} type="button" className="btn-secondary" onClick={() => scheduleOnSelectedDay(type)}>
                + {EVENT_TYPE_LABELS[type]}
              </button>
            ))}
          </div>

          {dayEvents.length === 0 ? (
            <EmptyState title="Nothing scheduled" description="No lessons, classes, or bookings on this day yet." />
          ) : (
            <div className="agenda-list">
              {dayEvents.map(event => (
                <div key={event.id} className={`agenda-row${toneClass(event.type, 'agenda-row')}`}>
                  <div>
                    <div className="agenda-row__title">{event.title}</div>
                    <div className="agenda-row__sub">{EVENT_TYPE_LABELS[event.type]} · {event.sub}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <span className="agenda-row__time">{format(event.date, 'h:mm a')}</span>
                    <button className="btn-link" onClick={() => navigate(event.link)}>Manage →</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </Layout>
  )
}
