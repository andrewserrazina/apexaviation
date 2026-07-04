import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const NotifContext = createContext(null)

export function NotifProvider({ children }) {
  const { profile } = useAuth()
  const [notifications, setNotifications] = useState([])

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications(data ?? [])
  }, [profile])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  async function markRead(id) {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications(n => n.map(x => x.id === id ? { ...x, read: true } : x))
  }

  async function markAllRead() {
    if (!profile) return
    await supabase.from('notifications').update({ read: true }).eq('user_id', profile.id).eq('read', false)
    setNotifications(n => n.map(x => ({ ...x, read: true })))
  }

  async function notify(userId, title, body, type = 'info', link = null) {
    await supabase.from('notifications').insert({ user_id: userId, title, body, type, link })
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <NotifContext.Provider value={{ notifications, unreadCount, markRead, markAllRead, notify, reload: load }}>
      {children}
    </NotifContext.Provider>
  )
}

export const useNotifications = () => useContext(NotifContext)
