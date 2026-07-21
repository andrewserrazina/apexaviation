import { useState } from 'react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Generic month-grid calendar, extracted from the hand-rolled pattern in
// Schedule.jsx (flight lesson booking) so ground-school scheduling can
// reuse the same look/behavior instead of a second implementation. No
// calendar library exists in this repo -- this stays consistent with
// that choice rather than introducing one.
export default function CalendarGrid({ events, getEventDate, renderEvent, onDayClick, initialDate }) {
  const [current, setCurrent] = useState(initialDate ?? new Date())

  const year = current.getFullYear()
  const month = current.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  function eventsOnDay(day) {
    return events.filter(event => {
      const d = getEventDate(event)
      return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year
    })
  }

  function prevMonth() { setCurrent(new Date(year, month - 1, 1)) }
  function nextMonth() { setCurrent(new Date(year, month + 1, 1)) }

  return (
    <div>
      <div className="cal-nav" style={{ marginBottom: 16 }}>
        <button type="button" className="cal-nav__btn" onClick={prevMonth}>‹</button>
        <span className="cal-nav__label">{MONTHS[month]} {year}</span>
        <button type="button" className="cal-nav__btn" onClick={nextMonth}>›</button>
      </div>
      <div className="calendar">
        <div className="calendar__header">
          {DAYS.map(d => <div key={d} className="calendar__day-label">{d}</div>)}
        </div>
        <div className="calendar__grid">
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty${i}`} className="calendar__cell calendar__cell--empty" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1
            const dayEvents = eventsOnDay(day)
            const today = new Date()
            const isToday = today.getDate() === day && today.getMonth() === month && today.getFullYear() === year
            return (
              <div
                key={day}
                className={`calendar__cell${isToday ? ' calendar__cell--today' : ''}${onDayClick ? ' calendar__cell--clickable' : ''}`}
                onClick={() => onDayClick && onDayClick(new Date(year, month, day))}
              >
                <span className="calendar__cell-num">{day}</span>
                {dayEvents.map(event => renderEvent(event))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
