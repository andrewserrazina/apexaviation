// One shared push-registration/preferences state for the whole
// authenticated app, mirroring BootstrapContext's own reasoning exactly:
// mounting usePushRegistration once here (rather than once per screen
// that needs it) is what makes the silent re-register-on-launch effect
// run exactly once per app session instead of once per mounting screen,
// which is what actually prevents the same-frame duplicate-registration
// class of bug Sprint 1C's test list calls out.
import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { usePushRegistration } from '../hooks/usePushRegistration'

type NotificationsContextValue = ReturnType<typeof usePushRegistration>

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const value = usePushRegistration(user?.id ?? null)
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotificationsContext(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotificationsContext must be used within a NotificationsProvider')
  return ctx
}
