// AndrewOS Apex Metrics Collector
// --------------------------------
// Collects a small set of operational KPIs from the Apex Advantage /
// flight-training Supabase project and writes one snapshot page per KPI
// into a Notion "Metric Snapshots" data source, so AndrewOS can track
// business health over time without querying Supabase directly.
//
// Meant to run on a daily schedule (pg_cron + pg_net -- see
// schedule.sql in this folder), not per-request from a browser. Auth is
// therefore a shared cron secret, not a Supabase user session -- see
// supabase/config.toml, which disables platform JWT verification for
// this function the same way it does for the other server-to-server
// functions in this repo.
//
// No personally identifiable information is ever read or sent: every
// Supabase query below is either a `head: true` count (no rows
// returned at all) or a select of a single non-identifying numeric
// column (logbook_entries.duration_hours). Only aggregate numbers ever
// leave this function.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// Notion mapping -- CONFIGURABLE. This repo has no pre-existing Notion
// integration or documented "Metric Snapshots" schema to match, so these
// property names/types are assumed from the task spec. Verify them
// against the real data source in Notion before relying on this in
// production; adjust the values below rather than the logic further
// down the file. See README.md's "Notion property names to verify".
// ---------------------------------------------------------------------------
const NOTION_API_VERSION = '2025-09-03' // first version with /data_sources endpoints

const NOTION_PROPERTIES = {
  metric: 'Metric', // title
  value: 'Value', // number
  snapshotDate: 'Snapshot Date', // date
  business: 'Business',
  source: 'Source',
  period: 'Period',
  status: 'Status',
  notes: 'Notes', // rich_text
} as const

// Business/Source/Period/Status are commonly modeled as Notion "select"
// properties in trackers like this one; flip any of these to 'rich_text'
// here (no other code changes needed) if the real data source instead
// stores them as plain text.
type NotionPropType = 'select' | 'rich_text'
const NOTION_PROPERTY_TYPES: Record<'business' | 'source' | 'period' | 'status', NotionPropType> = {
  business: 'select',
  source: 'select',
  period: 'select',
  status: 'select',
}

const BUSINESS_NAME = 'Apex Aviation'
const SOURCE_NAME = 'Apex Supabase'

const NOTION_WRITE_CONCURRENCY = 2
const NOTION_TIMEOUT_MS = 10_000
const NOTION_MAX_RETRIES = 4

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const NOTION_TOKEN = Deno.env.get('NOTION_TOKEN')
const NOTION_METRIC_SNAPSHOTS_DATA_SOURCE_ID = Deno.env.get('NOTION_METRIC_SNAPSHOTS_DATA_SOURCE_ID')
const ANDREWOS_CRON_SECRET = Deno.env.get('ANDREWOS_CRON_SECRET')

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// Auth -- accepts either `Authorization: Bearer <secret>` (matches the
// convention already used by send-lifecycle-emails/LIFECYCLE_CRON_SECRET
// in this repo) or `x-cron-secret: <secret>` (simpler for pg_net calls).
// ---------------------------------------------------------------------------
function authorizeRequest(req: Request, secret: string): boolean {
  const authHeader = req.headers.get('authorization') || ''
  if (authHeader === `Bearer ${secret}`) return true
  const cronHeader = req.headers.get('x-cron-secret') || ''
  if (cronHeader && cronHeader === secret) return true
  return false
}

// ---------------------------------------------------------------------------
// Small no-dependency concurrency limiter, so N Notion writes don't all
// fire via an uncontrolled Promise.all.
// ---------------------------------------------------------------------------
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000)
  return base + Math.random() * 250 // jitter, avoids synchronized retries
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text()
  } catch {
    return '<unreadable response body>'
  }
}

// ---------------------------------------------------------------------------
// Notion request helper: timeout + bounded exponential backoff on 429 and
// transient 5xx. Permanent 4xx errors are not retried.
// ---------------------------------------------------------------------------
const NOTION_BASE_URL = 'https://api.notion.com/v1'

async function notionRequest(path: string, init: RequestInit, token: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), NOTION_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(`${NOTION_BASE_URL}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': NOTION_API_VERSION,
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      })
    } catch (err) {
      clearTimeout(timeoutId)
      if (attempt > NOTION_MAX_RETRIES) {
        throw new Error(`Notion request to ${path} failed after ${attempt} attempts: ${String(err)}`)
      }
      await sleep(backoffMs(attempt))
      continue
    }
    clearTimeout(timeoutId)

    if (res.status === 429 || res.status >= 500) {
      if (attempt > NOTION_MAX_RETRIES) {
        throw new Error(`Notion request to ${path} failed permanently (${res.status}): ${await safeText(res)}`)
      }
      const retryAfterHeader = res.headers.get('retry-after')
      const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : backoffMs(attempt)
      await sleep(waitMs)
      continue
    }

    if (!res.ok) {
      // Permanent client error (bad request, missing property, auth, etc.) -- do not retry.
      throw new Error(`Notion request to ${path} failed (${res.status}): ${await safeText(res)}`)
    }

    return res.json()
  }
}

function selectOrTextProperty(type: NotionPropType, value: string): Record<string, unknown> {
  if (type === 'select') return { select: { name: value } }
  return { rich_text: [{ text: { content: value } }] }
}

function selectOrTextFilter(type: NotionPropType, propertyName: string, value: string): Record<string, unknown> {
  if (type === 'select') return { property: propertyName, select: { equals: value } }
  return { property: propertyName, rich_text: { equals: value } }
}

// ---------------------------------------------------------------------------
// Duplicate-check strategy: the daily snapshot key is
// (metric name + business + UTC date). Rather than storing a separate
// key column, we query the data source for a page whose Metric title,
// Business, and Snapshot Date (within the UTC calendar day) all match
// before creating a new one -- as preferred over inventing a synthetic
// idempotency column not in the (unverified) real schema.
// ---------------------------------------------------------------------------
async function queryExistingSnapshot(
  dataSourceId: string,
  token: string,
  metricName: string,
  business: string,
  utcDate: string,
): Promise<boolean> {
  const dayStart = `${utcDate}T00:00:00.000Z`
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString()

  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = {
      page_size: 1,
      filter: {
        and: [
          { property: NOTION_PROPERTIES.metric, title: { equals: metricName } },
          selectOrTextFilter(NOTION_PROPERTY_TYPES.business, NOTION_PROPERTIES.business, business),
          { property: NOTION_PROPERTIES.snapshotDate, date: { on_or_after: dayStart } },
          { property: NOTION_PROPERTIES.snapshotDate, date: { before: dayEnd } },
        ],
      },
    }
    if (cursor) body.start_cursor = cursor

    const result = await notionRequest(`/data_sources/${dataSourceId}/query`, { method: 'POST', body: JSON.stringify(body) }, token)
    if (Array.isArray(result.results) && result.results.length > 0) return true
    cursor = result.has_more ? result.next_cursor : undefined
  } while (cursor)

  return false
}

interface SnapshotInput {
  name: string
  value: number | null
  period: string
  status: 'Healthy' | 'Error'
  notes: string
}

async function createSnapshot(dataSourceId: string, token: string, snapshot: SnapshotInput, snapshotIso: string): Promise<string> {
  const properties: Record<string, unknown> = {
    [NOTION_PROPERTIES.metric]: { title: [{ text: { content: snapshot.name } }] },
    [NOTION_PROPERTIES.value]: { number: snapshot.value },
    [NOTION_PROPERTIES.snapshotDate]: { date: { start: snapshotIso } },
    [NOTION_PROPERTIES.business]: selectOrTextProperty(NOTION_PROPERTY_TYPES.business, BUSINESS_NAME),
    [NOTION_PROPERTIES.source]: selectOrTextProperty(NOTION_PROPERTY_TYPES.source, SOURCE_NAME),
    [NOTION_PROPERTIES.period]: selectOrTextProperty(NOTION_PROPERTY_TYPES.period, snapshot.period),
    [NOTION_PROPERTIES.status]: selectOrTextProperty(NOTION_PROPERTY_TYPES.status, snapshot.status),
    [NOTION_PROPERTIES.notes]: { rich_text: snapshot.notes ? [{ text: { content: snapshot.notes.slice(0, 1900) } }] : [] },
  }

  const page = await notionRequest(
    '/pages',
    {
      method: 'POST',
      body: JSON.stringify({
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties,
      }),
    },
    token,
  )

  return page.id
}

// ---------------------------------------------------------------------------
// KPI definitions
// ---------------------------------------------------------------------------
function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10) // YYYY-MM-DD
}

function utcMonthStartTimestamp(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

function utcMonthStartDate(now: Date): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

interface MetricDefinition {
  name: string
  period: 'Current' | 'Month to Date'
  collect: (supabase: SupabaseClient) => Promise<number>
}

const METRICS: MetricDefinition[] = [
  {
    name: 'Active Flight Students',
    period: 'Current',
    // Definition: mirrors the admin dashboard's existing "Active
    // Students" count exactly (portal/src/pages/Dashboard.jsx,
    // portal/src/pages/Students.jsx) -- profiles.role = 'student', with
    // no further filter. The schema has no explicit active/inactive
    // status column on profiles, so per the task's own fallback rule
    // ("use the dashboard definition unless the schema provides a
    // better explicit active-status field") this is the correct match,
    // not a simplification. Note profiles.student_type
    // ('apex_advantage' | 'flight_student') does exist, but the
    // dashboard itself does not filter on it for this count either, so
    // this number includes both real flight students and Apex
    // Advantage portal-only members marked role='student' -- flagged
    // explicitly in the README as something to verify with the business
    // owner if a narrower "flight student" definition is wanted later.
    collect: async (supabase) => {
      const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'student')
      if (error) throw new Error(`profiles query failed: ${error.message}`)
      return count ?? 0
    },
  },
  {
    name: 'Instructional Hours MTD',
    period: 'Month to Date',
    collect: async (supabase) => {
      const monthStart = utcMonthStartDate(new Date()) // logbook_entries.date is a `date` column, not timestamptz
      const { data, error } = await supabase.from('logbook_entries').select('duration_hours').gte('date', monthStart)
      if (error) throw new Error(`logbook_entries query failed: ${error.message}`)
      const sum = (data ?? []).reduce((total: number, row: { duration_hours: number | string }) => total + (Number(row.duration_hours) || 0), 0)
      return Math.round(sum * 10) / 10 // duration_hours is numeric(5,1); avoid float drift beyond one decimal
    },
  },
  {
    name: 'Upcoming Lessons',
    period: 'Current',
    collect: async (supabase) => {
      const nowIso = new Date().toISOString()
      const { count, error } = await supabase.from('lessons').select('*', { count: 'exact', head: true }).gte('starts_at', nowIso)
      if (error) throw new Error(`lessons query failed: ${error.message}`)
      return count ?? 0
    },
  },
  {
    name: 'Ground School Registrations',
    period: 'Month to Date',
    // Fallback: ground_registrations has no CREATE TABLE in this repo
    // and, per GROUND_SCHOOL_RLS_AUDIT.md's live column list, no
    // created_at column at all. registered_at (timestamptz, defaults to
    // now() when a registration is submitted) is the closest available
    // equivalent and is used here instead.
    collect: async (supabase) => {
      const monthStart = utcMonthStartTimestamp(new Date())
      const { count, error } = await supabase.from('ground_registrations').select('*', { count: 'exact', head: true }).gte('registered_at', monthStart)
      if (error) throw new Error(`ground_registrations query failed: ${error.message}`)
      return count ?? 0
    },
  },
]

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
type MetricResult =
  | { metric: string; status: 'created'; value: number; notionPageId: string }
  | { metric: string; status: 'skipped'; value: number | null; error?: string }
  | { metric: string; status: 'failed'; value: number | null; error: string; notionPageId?: string }

async function collectMetrics(supabase: SupabaseClient, notionToken: string, dataSourceId: string, executedAt: Date) {
  const utcDate = utcDateKey(executedAt)
  const snapshotIso = executedAt.toISOString()

  const results = await mapWithConcurrency<MetricDefinition, MetricResult>(METRICS, NOTION_WRITE_CONCURRENCY, async (metric) => {
    let value: number
    try {
      value = await metric.collect(supabase)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`andrewos-metrics: collection failed for "${metric.name}": ${message}`)
      // Collection failed -- still try to leave a visible Error row in
      // Notion (deduped the same way as a healthy snapshot) so a broken
      // metric doesn't just silently disappear from the tracker.
      try {
        const exists = await queryExistingSnapshot(dataSourceId, notionToken, metric.name, BUSINESS_NAME, utcDate)
        if (exists) return { metric: metric.name, status: 'skipped', value: null, error: message }
        const pageId = await createSnapshot(
          dataSourceId,
          notionToken,
          { name: metric.name, value: null, period: metric.period, status: 'Error', notes: `Collection failed: ${message}` },
          snapshotIso,
        )
        return { metric: metric.name, status: 'failed', value: null, error: message, notionPageId: pageId }
      } catch (writeErr) {
        const writeMessage = writeErr instanceof Error ? writeErr.message : String(writeErr)
        return { metric: metric.name, status: 'failed', value: null, error: `${message}; Notion write also failed: ${writeMessage}` }
      }
    }

    try {
      const exists = await queryExistingSnapshot(dataSourceId, notionToken, metric.name, BUSINESS_NAME, utcDate)
      if (exists) return { metric: metric.name, status: 'skipped', value }

      const pageId = await createSnapshot(dataSourceId, notionToken, { name: metric.name, value, period: metric.period, status: 'Healthy', notes: '' }, snapshotIso)
      return { metric: metric.name, status: 'created', value, notionPageId: pageId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`andrewos-metrics: Notion write failed for "${metric.name}": ${message}`)
      return { metric: metric.name, status: 'failed', value, error: message }
    }
  })

  return {
    collected: results.length,
    created: results.filter((r) => r.status === 'created').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    executedAt: snapshotIso,
    details: results,
  }
}

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: `Method ${req.method} not allowed. Use POST.` }, 405)
  }

  let supabaseUrl: string, serviceRoleKey: string, notionToken: string, dataSourceId: string, cronSecret: string
  try {
    supabaseUrl = requireEnv('SUPABASE_URL', SUPABASE_URL)
    serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)
    notionToken = requireEnv('NOTION_TOKEN', NOTION_TOKEN)
    dataSourceId = requireEnv('NOTION_METRIC_SNAPSHOTS_DATA_SOURCE_ID', NOTION_METRIC_SNAPSHOTS_DATA_SOURCE_ID)
    cronSecret = requireEnv('ANDREWOS_CRON_SECRET', ANDREWOS_CRON_SECRET)
  } catch (err) {
    // Never echo the actual error (it names the missing var, not a secret
    // value, but keep the response generic regardless).
    console.error('andrewos-metrics: startup configuration error', err instanceof Error ? err.message : err)
    return jsonResponse({ error: 'Server misconfiguration: a required environment variable is missing.' }, 500)
  }

  if (!authorizeRequest(req, cronSecret)) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const summary = await collectMetrics(supabase, notionToken, dataSourceId, new Date())
    return jsonResponse(summary, 200)
  } catch (err) {
    console.error('andrewos-metrics: unhandled error', err instanceof Error ? err.message : err)
    return jsonResponse({ error: 'Internal error collecting metrics.' }, 500)
  }
})
