// Pure helpers for the CRM 0.2 unified lead pipeline (pages/CRM.jsx,
// GitHub issue #311). No supabase import here on purpose -- everything
// here is plain data transformation/validation, unit-testable without a
// network mock, same convention as audienceSegment.js /
// mockOralAvailability.js in this directory.

// Mirrors the exact `check (pipeline_stage in (...))` constraint added
// to `leads` in supabase/migrations/20261113_crm_v02_unified_lead_pipeline.sql.
export const PIPELINE_STAGE_OPTIONS = [
  { value: 'new',         label: 'New',         color: '#94a3b8' },
  { value: 'contacted',   label: 'Contacted',   color: '#60a5fa' },
  { value: 'qualified',   label: 'Qualified',   color: '#a78bfa' },
  { value: 'offer_sent',  label: 'Offer Sent',  color: '#F4B400' },
  { value: 'won',         label: 'Won',         color: '#4ade80' },
  { value: 'lost',        label: 'Lost',        color: '#f87171' },
  { value: 'nurture',     label: 'Nurture',     color: '#38bdf8' },
]
export const PIPELINE_STAGE_LABELS = Object.fromEntries(PIPELINE_STAGE_OPTIONS.map(s => [s.value, s.label]))

// Mirrors `check (origin_platform in (...))` in the same migration.
export const ORIGIN_PLATFORM_OPTIONS = [
  { value: 'tiktok',    label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook',  label: 'Facebook' },
  { value: 'manychat',  label: 'ManyChat' },
  { value: 'website',   label: 'Website' },
  { value: 'referral',  label: 'Referral' },
  { value: 'other',     label: 'Other' },
]
export const ORIGIN_PLATFORM_LABELS = Object.fromEntries(ORIGIN_PLATFORM_OPTIONS.map(s => [s.value, s.label]))

// Mirrors `check (capture_method in (...))` in the same migration.
// Deliberately a different list from origin_platform -- "capture
// method" is HOW the lead entered our system, not WHERE they
// originally came from (issue #311: a TikTok follower may message us
// through ManyChat; origin_platform=tiktok, capture_method=manychat).
export const CAPTURE_METHOD_OPTIONS = [
  { value: 'manual',        label: 'Manual Entry' },
  { value: 'manychat',      label: 'ManyChat' },
  { value: 'website_form',  label: 'Website Form' },
  { value: 'referral',      label: 'Referral' },
  { value: 'walk_in',       label: 'Walk-in' },
  { value: 'phone',         label: 'Phone Call' },
  { value: 'email',         label: 'Email' },
  { value: 'other',         label: 'Other' },
]
export const CAPTURE_METHOD_LABELS = Object.fromEntries(CAPTURE_METHOD_OPTIONS.map(s => [s.value, s.label]))

// Free text in the DB (no CHECK constraint -- staff may type something
// outside this list), but the dropdown offers the same ratings/programs
// used everywhere else in the portal (RatingSyllabus.jsx's
// RATING_CONFIGS keys) plus two lead-specific options.
export const TRAINING_INTEREST_OPTIONS = [
  'Private Pilot', 'Instrument Rating', 'Commercial Pilot',
  'Apex Advantage', 'Mock Oral / Checkride Prep', 'Not sure yet',
]

export const CONTACT_METHOD_OPTIONS = [
  { value: 'call',      label: 'Phone Call' },
  { value: 'text',      label: 'Text' },
  { value: 'email',     label: 'Email' },
  { value: 'dm',        label: 'Social DM' },
  { value: 'in_person', label: 'In Person' },
  { value: 'other',     label: 'Other' },
]
export const OUTCOME_OPTIONS = [
  { value: 'no_answer',        label: 'No Answer' },
  { value: 'left_message',     label: 'Left Message' },
  { value: 'connected',        label: 'Connected' },
  { value: 'scheduled',        label: 'Scheduled' },
  { value: 'not_interested',   label: 'Not Interested' },
  { value: 'follow_up_needed', label: 'Follow-Up Needed' },
  { value: 'other',            label: 'Other' },
]

// The pre-existing `leads.stage` lifecycle column (inquiry/discovery/
// enrolled/active/graduated/inactive) -- shown read-only where present,
// never written by the new Quick Add / pipeline UI.
export const LEGACY_STAGE_LABELS = {
  inquiry: 'Inquiry', discovery: 'Discovery Flight', enrolled: 'Enrolled',
  active: 'Active Student', graduated: 'Graduated', inactive: 'Inactive',
}

// Backfill mapping exercised once by the migration's `update` statement.
// Kept here (a) as the single documented source of truth for that
// mapping and (b) to drive the read-only legacy-stage badge for any
// lead whose pipeline_stage was derived from it. Must stay in sync with
// the literal CASE in supabase/migrations/20261113_crm_v02_unified_lead_pipeline.sql
// -- leads.test.js asserts the migration file contains this exact mapping.
export function mapLegacyStageToPipeline(stage) {
  switch (stage) {
    case 'inquiry':   return 'new'
    case 'discovery': return 'contacted'
    case 'enrolled':  return 'qualified'
    case 'active':    return 'won'
    case 'graduated': return 'won'
    case 'inactive':  return 'lost'
    default:          return 'new'
  }
}

// --- Validation / payload builders ------------------------------------

// "Name or social media username (at least one required)" -- issue #311
// phase 3. Matches the leads_name_or_handle_required CHECK constraint.
export function hasNameOrHandle(form) {
  return Boolean(form?.full_name?.trim() || form?.social_username?.trim())
}

export function validateLeadForm(form) {
  if (!hasNameOrHandle(form)) {
    return { valid: false, error: 'Enter a name or a social media username.' }
  }
  return { valid: true, error: '' }
}

// Trims strings and turns '' into null so optional columns store NULL
// rather than empty strings (matches the rest of this codebase's
// convention, e.g. CRM.jsx's existing handleSave).
function emptyToNull(v) {
  if (typeof v !== 'string') return v ?? null
  const t = v.trim()
  return t === '' ? null : t
}

export function buildLeadInsertPayload(form) {
  return {
    full_name: emptyToNull(form.full_name),
    email: emptyToNull(form.email),
    phone: emptyToNull(form.phone),
    origin_platform: emptyToNull(form.origin_platform),
    capture_method: emptyToNull(form.capture_method),
    social_username: emptyToNull(form.social_username),
    profile_url: emptyToNull(form.profile_url),
    training_interest: emptyToNull(form.training_interest),
    aircraft_interest: emptyToNull(form.aircraft_interest),
    checkride_date: emptyToNull(form.checkride_date),
    source_campaign: emptyToNull(form.source_campaign),
    source_content: emptyToNull(form.source_content),
    assigned_to: emptyToNull(form.assigned_to),
    next_follow_up_at: form.next_follow_up_at ? new Date(form.next_follow_up_at).toISOString() : null,
    pipeline_stage: form.pipeline_stage || 'new',
    notes: emptyToNull(form.notes),
    referral_source: emptyToNull(form.referral_source),
  }
}

export function buildNoteInsertPayload(leadId, authorId, { body, contactMethod, outcome }) {
  return {
    lead_id: leadId,
    author_id: authorId,
    body,
    contact_method: emptyToNull(contactMethod),
    outcome: emptyToNull(outcome),
  }
}

// --- Normalization for duplicate detection ------------------------------

export function normalizeEmail(email) {
  if (!email) return null
  const t = email.trim().toLowerCase()
  return t === '' ? null : t
}

// Strips everything but digits and drops a leading US/CA country code,
// so "(512) 555-0100", "512-555-0100" and "+1 512 555 0100" all
// normalize the same way. Deliberately loose (not full E.164 parsing) --
// this is a duplicate-warning heuristic, not a validator.
export function normalizePhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits === '' ? null : digits
}

// Never merges or blocks -- only surfaces what to look at. "Do not
// automatically merge people based only on names or usernames" (issue
// #311) means a name match alone is never a trigger here.
export function findDuplicateMatches(candidate, { leads = [], readinessLeads = [], excludeLeadId = null } = {}) {
  const matches = []
  const candEmail = normalizeEmail(candidate.email)
  const candPhone = normalizePhone(candidate.phone)
  const candPlatform = candidate.origin_platform
  const candHandle = candidate.social_username?.trim().toLowerCase().replace(/^@/, '')

  for (const lead of leads) {
    if (excludeLeadId && lead.id === excludeLeadId) continue
    const reasons = []
    if (candEmail && normalizeEmail(lead.email) === candEmail) reasons.push('email')
    if (candPhone && normalizePhone(lead.phone) === candPhone) reasons.push('phone')
    if (
      candPlatform && candHandle &&
      lead.origin_platform === candPlatform &&
      lead.social_username?.trim().toLowerCase().replace(/^@/, '') === candHandle
    ) reasons.push('platform_handle')
    if (reasons.length) matches.push({ type: 'lead', record: lead, reasons })
  }

  for (const rl of readinessLeads) {
    if (candEmail && normalizeEmail(rl.email) === candEmail) {
      matches.push({ type: 'readiness', record: rl, reasons: ['email'] })
    }
  }

  return matches
}

// --- Unified directory ---------------------------------------------------

// Produces one array mixing `leads` rows and `readiness_assessment_leads`
// rows for display, each clearly tagged with its source and original id
// -- never copies/mutates a readiness record into a lead row. A
// readiness record stays in the list even once a lead links to it
// (issue #311 acceptance: "194 assessment records remain ... visible in
// unified directory"); it's just annotated with which lead links to it.
export function mergeDirectoryRecords(leads = [], readinessLeads = []) {
  const linkedByReadinessId = new Map()
  for (const lead of leads) {
    if (lead.linked_readiness_lead_id) linkedByReadinessId.set(lead.linked_readiness_lead_id, lead.id)
  }

  const leadRecords = leads.map(lead => ({
    recordType: 'lead',
    id: lead.id,
    sourceId: lead.id,
    displayName: lead.full_name || (lead.social_username ? `@${lead.social_username}` : 'Unknown'),
    email: lead.email,
    phone: lead.phone,
    originPlatform: lead.origin_platform,
    captureMethod: lead.capture_method,
    pipelineStage: lead.pipeline_stage,
    trainingInterest: lead.training_interest,
    assignedTo: lead.assigned_to,
    nextFollowUpAt: lead.next_follow_up_at,
    createdAt: lead.created_at,
    raw: lead,
  }))

  const readinessRecords = readinessLeads.map(rl => ({
    recordType: 'readiness',
    id: `readiness:${rl.id}`,
    sourceId: rl.id,
    displayName: rl.full_name || rl.email,
    email: rl.email,
    phone: null,
    originPlatform: null,
    captureMethod: 'readiness_assessment',
    pipelineStage: null,
    trainingInterest: null,
    assignedTo: null,
    nextFollowUpAt: null,
    createdAt: rl.created_at,
    linkedLeadId: linkedByReadinessId.get(rl.id) ?? null,
    raw: rl,
  }))

  return [...leadRecords, ...readinessRecords].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

// --- Filtering -------------------------------------------------------------

// `filters`: { stage, source, trainingInterest, assignedTo, followUp,
// search }. Every key is optional; an unset/'' filter passes everything.
// `followUp` is one of 'overdue' | 'today' | 'upcoming' | 'none' | undefined.
export function filterDirectoryRecords(records, filters = {}, now = new Date()) {
  const search = filters.search?.trim().toLowerCase()
  return records.filter(r => {
    if (filters.stage && r.pipelineStage !== filters.stage) return false
    if (filters.source && r.originPlatform !== filters.source && !(filters.source === 'readiness_assessment' && r.recordType === 'readiness')) return false
    if (filters.trainingInterest && r.trainingInterest !== filters.trainingInterest) return false
    if (filters.assignedTo && r.assignedTo !== filters.assignedTo) return false
    if (filters.followUp) {
      const bucket = followUpBucket(r.nextFollowUpAt, now)
      if (filters.followUp === 'none' ? bucket !== null : bucket !== filters.followUp) return false
    }
    if (search) {
      const hay = [r.displayName, r.email, r.phone].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })
}

// --- Follow-ups --------------------------------------------------------

// null = no follow-up set. Otherwise 'overdue' | 'today' | 'upcoming'.
export function followUpBucket(nextFollowUpAt, now = new Date()) {
  if (!nextFollowUpAt) return null
  const due = new Date(nextFollowUpAt)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000)
  if (due < startOfToday) return 'overdue'
  if (due < startOfTomorrow) return 'today'
  return 'upcoming'
}

export function groupFollowUps(leads, now = new Date()) {
  const groups = { overdue: [], today: [], upcoming: [] }
  for (const lead of leads) {
    const bucket = followUpBucket(lead.next_follow_up_at, now)
    if (bucket) groups[bucket].push(lead)
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => new Date(a.next_follow_up_at) - new Date(b.next_follow_up_at))
  }
  return groups
}
