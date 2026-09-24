// Pure helpers for the Audience Builder (pages/Broadcast.jsx). No
// supabase import here on purpose -- everything in this file is plain
// data transformation, unit-testable without a network mock. The actual
// audience matching happens server-side in
// admin_match_broadcast_audience() (supabase-portal-schema-v145); this
// file only builds the segment_definition jsonb that function consumes
// and produces the human-facing summary/label from it.

// Enum options mirror the exact `check (col in (...))` constraints on
// profiles (v29/v39/v52/v70/v75/v112) -- never invented, never a
// superset of what the column actually allows.
export const CURRENT_RATING_OPTIONS = [
  { value: 'private', label: 'Private' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'commercial', label: 'Commercial' },
]
export const TRAINING_STAGE_OPTIONS = [
  { value: 'just_starting', label: 'Just Starting' },
  { value: 'pre_solo', label: 'Pre-Solo' },
  { value: 'cross_country', label: 'Cross-Country' },
  { value: 'preparing_for_written', label: 'Preparing for Written' },
  { value: 'written_passed', label: 'Written Passed' },
  { value: 'checkride_preparation', label: 'Checkride Preparation' },
]
export const STUDENT_TYPE_OPTIONS = [
  { value: 'apex_advantage', label: 'Apex Advantage Student' },
  { value: 'flight_student', label: 'Flight Student' },
]
export const NEXT_RATING_INTEREST_OPTIONS = [
  { value: 'build_confidence', label: 'Build Confidence' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'cross_country_experience', label: 'Cross-Country Experience' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'stay_current', label: 'Stay Current' },
  { value: 'not_sure', label: 'Not Sure' },
]
export const PRIMARY_FOCUS_AREA_OPTIONS = [
  { value: 'airspace', label: 'Airspace' },
  { value: 'weather', label: 'Weather' },
  { value: 'aircraft_systems', label: 'Aircraft Systems' },
  { value: 'regulations', label: 'Regulations' },
  { value: 'performance', label: 'Performance' },
  { value: 'weight_balance', label: 'Weight & Balance' },
  { value: 'navigation', label: 'Navigation' },
  { value: 'adm', label: 'ADM' },
  { value: 'not_sure', label: 'Not Sure' },
]
export const PRIMARY_AIRCRAFT_CLASS_OPTIONS = [
  { value: 'ASEL', label: 'ASEL (Single-Engine Land)' },
  { value: 'AMEL', label: 'AMEL (Multi-Engine Land)' },
  { value: 'ASES', label: 'ASES (Single-Engine Sea)' },
  { value: 'AMES', label: 'AMES (Multi-Engine Sea)' },
]
export const CHECKRIDE_TIMING_OPTIONS = [
  { value: 'within_14_days', label: 'Within 14 Days' },
  { value: 'within_30_days', label: 'Within 30 Days' },
  { value: 'within_60_days', label: 'Within 60 Days' },
  { value: 'more_than_60_days', label: 'More Than 60 Days' },
  { value: 'not_scheduled', label: 'Not Scheduled' },
]
// readiness-assessment.html's own band labels (`band` variable) -- the
// only 5 values readiness_assessment_leads.readiness_level ever holds.
export const READINESS_LEVEL_OPTIONS = [
  'Strong Readiness', 'Nearly Ready', 'Getting Close',
  'Significant Review Recommended', 'Foundation Needs Work',
].map(v => ({ value: v, label: v }))
// readiness-assessment.html's CATEGORIES map -- the fixed 9-category
// taxonomy strongest_category/weakest_category_1/2 are drawn from.
export const READINESS_CATEGORY_OPTIONS = [
  { value: 'eligibility', label: 'Eligibility & Documents' },
  { value: 'airworthiness', label: 'Airworthiness' },
  { value: 'privileges', label: 'Privileges & Limitations' },
  { value: 'airspace', label: 'Airspace' },
  { value: 'weather', label: 'Weather' },
  { value: 'performance', label: 'Performance & W&B' },
  { value: 'aeromedical', label: 'Aeromedical Factors' },
  { value: 'crosscountry', label: 'Cross-Country Planning' },
  { value: 'emergency', label: 'Emergency Operations' },
]
export const CHECKRIDE_WITHIN_DAYS_OPTIONS = [7, 14, 30, 45, 60, 90]
export const ENGAGEMENT_DAY_OPTIONS = [7, 14, 30, 60, 90]

// A broad, unfiltered audience is allowed (the brief explicitly permits
// "all marketing-eligible members") but must be called out clearly
// before send, per the brief's own example threshold.
export const BROAD_AUDIENCE_WARNING_THRESHOLD = 200

const GROUP_ORDER = ['checkride', 'acquisition', 'training', 'products', 'engagement', 'readiness', 'suppression']

// Strips empty groups/keys so an audience with nothing set serializes to
// `{}` (matches admin_match_broadcast_audience()'s "absent key = no
// filter" contract) rather than a tree of empty objects.
function pruneEmpty(value) {
  if (Array.isArray(value)) return value.length ? value : undefined
  if (value && typeof value === 'object') {
    const cleaned = {}
    for (const [k, v] of Object.entries(value)) {
      const p = pruneEmpty(v)
      if (p !== undefined && p !== null && p !== '') cleaned[k] = p
    }
    return Object.keys(cleaned).length ? cleaned : undefined
  }
  return value === '' || value === null || value === undefined ? undefined : value
}

// builderState shape: { checkride: {...} | null, acquisition: {...},
// training: {...}, products: {...}, engagement: {...}, readiness: {...},
// suppression: {...} } -- each group's own shape matches
// admin_match_broadcast_audience()'s p_segment->'<group>' expectations
// exactly (this function is intentionally a thin pass-through + prune,
// not a translation layer, so the UI and the RPC never drift apart).
export function buildSegmentDefinition(builderState) {
  const segment = {}
  for (const group of GROUP_ORDER) {
    const cleaned = pruneEmpty(builderState?.[group])
    if (cleaned) segment[group] = cleaned
  }
  return segment
}

export function isSegmentEmpty(segment) {
  return !segment || Object.keys(segment).length === 0
}

function joinValues(values) {
  return Array.isArray(values) ? values.join(', ') : values
}

// Produces the human-facing audience label shown in the summary card
// and the send-confirmation modal, e.g. "Checkride within 45 days —
// Checkride Prep: owns — Mock Oral: none". Falls back to a plain
// statement when no filters are set, per the brief's explicit
// requirement to make an unfiltered "all eligible members" audience
// obvious rather than silently implicit.
export function describeAudience(segment) {
  if (isSegmentEmpty(segment)) return 'All marketing-eligible members'
  const parts = []

  const c = segment.checkride
  if (c) {
    if (c.mode === 'within_days') parts.push(`Checkride within ${c.within_days} days`)
    else if (c.mode === 'exact_range') parts.push(`Checkride ${c.from ?? '…'} to ${c.to ?? '…'}`)
    else if (c.mode === 'past') parts.push('Checkride date has passed')
    else if (c.mode === 'none_set') parts.push('No checkride date set')
    else if (c.mode === 'timing_value') parts.push(`Checkride timing: ${c.timing_value}`)
  }

  const p = segment.products
  if (p?.checkride_prep) parts.push(`Checkride Prep: ${p.checkride_prep}`)
  if (p?.ground_school) parts.push(`Ground School: ${p.ground_school}`)
  if (p?.study_pack) {
    if (p.study_pack.mode === 'owns_any') parts.push('Owns any Study Pack')
    else if (p.study_pack.mode === 'owns_specific') parts.push(`Owns ${p.study_pack.pack_id}`)
    else if (p.study_pack.mode === 'not_owns_specific') parts.push(`Does not own ${p.study_pack.pack_id}`)
  }
  if (p?.mock_oral) parts.push(`Mock Oral: ${p.mock_oral}`)
  if (p?.customer_status) parts.push(p.customer_status === 'purchased_any' ? 'Has purchased' : 'Never purchased')

  const e = segment.engagement
  if (e?.active_within_days) parts.push(`Active within ${e.active_within_days} days`)
  if (e?.inactive_at_least_days) parts.push(`Inactive ${e.inactive_at_least_days}+ days`)
  if (e?.never_logged_in) parts.push('Never logged in')
  if (e?.activated === true) parts.push('Activated')
  if (e?.activated === false) parts.push('Not activated')
  if (e?.signed_up_within_days) parts.push(`Signed up within ${e.signed_up_within_days} days`)

  const r = segment.readiness
  if (r?.completed === true) parts.push('Readiness completed')
  if (r?.completed === false) parts.push('No readiness assessment')
  if (r?.score_min != null || r?.score_max != null) parts.push(`Readiness score ${r.score_min ?? 0}-${r.score_max ?? 100}`)
  if (r?.readiness_level) parts.push(`Readiness level: ${joinValues(r.readiness_level)}`)
  if (r?.strongest_category) parts.push(`Strongest: ${joinValues(r.strongest_category)}`)
  if (r?.weakest_category) parts.push(`Weakest: ${joinValues(r.weakest_category)}`)

  const a = segment.acquisition
  if (a) {
    for (const [key, label] of [
      ['signup_utm_source', 'Signup source'], ['signup_utm_medium', 'Signup medium'],
      ['signup_utm_campaign', 'Signup campaign'], ['signup_utm_content', 'Signup content'],
      ['first_touch_landing_page', 'First-touch page'], ['last_touch_source', 'Last-touch source'],
      ['last_touch_campaign', 'Last-touch campaign'], ['last_touch_landing_page', 'Last-touch page'],
    ]) {
      if (a[key]) parts.push(`${label}: ${joinValues(a[key])}`)
    }
  }

  const t = segment.training
  if (t) {
    for (const [key, label] of [
      ['current_rating', 'Rating'], ['training_stage', 'Stage'], ['student_type', 'Student type'],
      ['next_rating_interest', 'Next rating interest'], ['primary_focus_area', 'Focus area'],
      ['primary_aircraft_class', 'Aircraft class'],
    ]) {
      if (t[key]) parts.push(`${label}: ${joinValues(t[key])}`)
    }
  }

  return parts.length ? parts.join(' — ') : 'All marketing-eligible members'
}

export function isBroadAudience(eligibleCount) {
  return typeof eligibleCount === 'number' && eligibleCount >= BROAD_AUDIENCE_WARNING_THRESHOLD
}

// A preview becomes stale the instant the segment used to produce it no
// longer matches the segment currently being edited -- compared by
// value, not reference, since the builder state object is recreated on
// every filter edit.
export function isPreviewStale(previewedSegment, currentSegment) {
  if (!previewedSegment) return true
  return JSON.stringify(previewedSegment) !== JSON.stringify(currentSegment)
}
