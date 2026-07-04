import { useEffect, useRef, useState } from 'react'
import { useNotifications } from '../context/NotificationContext'

export default function NotificationBell() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div className="notif-bell" ref={ref}>
      <button className="notif-bell__btn" onClick={() => setOpen(o => !o)} aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && <span className="notif-bell__badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown__header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button className="btn-link" style={{ fontSize: 12 }} onClick={markAllRead}>Mark all read</button>
            )}
          </div>
          <div className="notif-dropdown__list">
            {notifications.length === 0 ? (
              <p className="notif-empty">No notifications yet.</p>
            ) : notifications.map(n => (
              <div
                key={n.id}
                className={`notif-item${n.read ? '' : ' notif-item--unread'}`}
                onClick={() => { markRead(n.id); if (n.link) window.location.href = n.link }}
              >
                <div className="notif-item__dot" />
                <div>
                  <p className="notif-item__title">{n.title}</p>
                  {n.body && <p className="notif-item__body">{n.body}</p>}
                  <p className="notif-item__time">{new Date(n.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
