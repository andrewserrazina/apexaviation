import { useState } from 'react'
import {
  addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek,
  format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek,
} from 'date-fns'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The one calendar primitive for the portal -- month and week grids both
// live here so scheduling surfaces (flight lessons, ground classes,
// private instruction, mock orals) share a single date-math
// implementation via date-fns instead of each hand-rolling its own.
export default function CalendarGrid({
  events, getEventDate, renderEvent, onDayClick, initialDate,
  view: controlledView, defaultView = 'month', onViewChange, showViewToggle = false,
}) {
  const [current, setCurrent] = useState(initialDate ?? new Date())
  const [internalView, setInternalView] = useState(defaultView)
  const view = controlledView ?? internalView

  function setView(next) {
    if (onViewChange) onViewChange(next)
    else setInternalView(next)
  }

  function eventsOnDay(day) {
    return events.filter(event => isSameDay(getEventDate(event), day))
  }

  function goPrev() { setCurrent(view === 'week' ? addWeeks(current, -1) : addMonths(current, -1)) }
  function goNext() { setCurrent(view === 'week' ? addWeeks(current, 1) : addMonths(current, 1)) }

  const rangeStart = view === 'week' ? startOfWeek(current) : startOfWeek(startOfMonth(current))
  const rangeEnd = view === 'week' ? endOfWeek(current) : endOfWeek(endOfMonth(current))
  const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd })
  const navLabel = view === 'week'
    ? `${format(startOfWeek(current), 'MMM d')} – ${format(endOfWeek(current), 'MMM d')}`
    : format(current, 'MMMM yyyy')

  return (
    <div>
      <div className="cal-nav" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <div className="cal-nav" style={{ gap: 16 }}>
          <button type="button" className="cal-nav__btn" onClick={goPrev}>‹</button>
          <span className="cal-nav__label">{navLabel}</span>
          <button type="button" className="cal-nav__btn" onClick={goNext}>›</button>
        </div>
        {showViewToggle && (
          <div className="pill-bar">
            <button type="button" className={`pill-btn${view === 'month' ? ' pill-btn--active' : ''}`} onClick={() => setView('month')}>Month</button>
            <button type="button" className={`pill-btn${view === 'week' ? ' pill-btn--active' : ''}`} onClick={() => setView('week')}>Week</button>
          </div>
        )}
      </div>
      <div className="calendar">
        <div className="calendar__header">
          {DAY_LABELS.map(d => <div key={d} className="calendar__day-label">{d}</div>)}
        </div>
        <div className="calendar__grid" style={view === 'week' ? { gridTemplateRows: '1fr' } : undefined}>
          {days.map(day => {
            const dayEvents = eventsOnDay(day)
            const outsideMonth = view === 'month' && !isSameMonth(day, current)
            return (
              <div
                key={day.toISOString()}
                className={[
                  'calendar__cell',
                  view === 'week' ? 'calendar__cell--week' : '',
                  outsideMonth ? 'calendar__cell--empty' : '',
                  isToday(day) ? 'calendar__cell--today' : '',
                  onDayClick ? 'calendar__cell--clickable' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => onDayClick && onDayClick(day)}
              >
                <span className="calendar__cell-num">{format(day, 'd')}</span>
                {dayEvents.map(event => renderEvent(event))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
