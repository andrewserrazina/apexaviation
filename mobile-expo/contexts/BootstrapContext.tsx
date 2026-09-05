// One shared mobile-bootstrap result for the whole authenticated app,
// instead of Home and the Practice tab each independently calling
// mobile-bootstrap. This exists specifically so entitlement (`access.
// checkride_prep`) and loading state are known ONCE and consistently to
// every screen that needs to decide whether it's safe to call
// mobile-daily-drill (Sprint 1A Rev2 section 2/3): a screen must never
// fetch/create a Daily Drill before it knows bootstrap has resolved and
// the learner is actually entitled.
//
// Wraps the existing, independently-tested useBootstrap() hook rather
// than reimplementing its load/refresh/dedupe logic -- this file is only
// the Context plumbing around it.
import { createContext, useContext, type ReactNode } from 'react'
import { useBootstrap } from '../hooks/useBootstrap'
import type { MobileBootstrapDTO } from '../../shared/mobile-dto'
import type { ApiError } from '../lib/api/errors'

interface BootstrapContextValue {
  data: MobileBootstrapDTO | null
  loading: boolean
  refreshing: boolean
  error: ApiError | null
  refresh: () => Promise<void>
  // True once bootstrap has resolved (succeeded or failed) at least once
  // -- distinct from `!loading` only during the very first render, but
  // named separately so callers gating a fetch on "we actually know the
  // answer yet" don't have to reason about `loading`'s initial value.
  ready: boolean
  entitled: boolean
}

const BootstrapContext = createContext<BootstrapContextValue | null>(null)

export function BootstrapProvider({ children }: { children: ReactNode }) {
  const bootstrap = useBootstrap()
  const ready = !bootstrap.loading && (bootstrap.data !== null || bootstrap.error !== null)
  const entitled = bootstrap.data?.access.checkride_prep ?? false

  const value: BootstrapContextValue = {
    ...bootstrap,
    ready,
    entitled,
  }

  return <BootstrapContext.Provider value={value}>{children}</BootstrapContext.Provider>
}

export function useBootstrapContext(): BootstrapContextValue {
  const ctx = useContext(BootstrapContext)
  if (!ctx) throw new Error('useBootstrapContext must be used within a BootstrapProvider')
  return ctx
}
