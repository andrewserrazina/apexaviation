import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  PIPELINE_STAGE_OPTIONS, ORIGIN_PLATFORM_OPTIONS, CAPTURE_METHOD_OPTIONS,
  mapLegacyStageToPipeline, hasNameOrHandle, validateLeadForm,
  buildLeadInsertPayload, buildNoteInsertPayload,
  normalizeEmail, normalizePhone, findDuplicateMatches,
  mergeDirectoryRecords, filterDirectoryRecords,
  followUpBucket, groupFollowUps,
} from './leads'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MIGRATION_PATH = path.join(REPO_ROOT, 'supabase/migrations/20261113_crm_v02_unified_lead_pipeline.sql')
const migrationSource = readFileSync(MIGRATION_PATH, 'utf8')

describe('mapLegacyStageToPipeline', () => {
  it('maps every legacy leads.stage value', () => {
    expect(mapLegacyStageToPipeline('inquiry')).toBe('new')
    expect(mapLegacyStageToPipeline('discovery')).toBe('contacted')
    expect(mapLegacyStageToPipeline('enrolled')).toBe('qualified')
    expect(mapLegacyStageToPipeline('active')).toBe('won')
    expect(mapLegacyStageToPipeline('graduated')).toBe('won')
    expect(mapLegacyStageToPipeline('inactive')).toBe('lost')
  })

  it('falls back to new for an unrecognized or missing legacy stage', () => {
    expect(mapLegacyStageToPipeline(null)).toBe('new')
    expect(mapLegacyStageToPipeline(undefined)).toBe('new')
    expect(mapLegacyStageToPipeline('something_unexpected')).toBe('new')
  })

  it('matches the exact CASE mapping committed in the migration SQL (prevents SQL/JS drift)', () => {
    const mapping = { inquiry: 'new', discovery: 'contacted', enrolled: 'qualified', active: 'won', graduated: 'won', inactive: 'lost' }
    for (const [legacy, pipeline] of Object.entries(mapping)) {
      const pattern = new RegExp(`when '${legacy}'\\s+then '${pipeline}'`)
      expect(migrationSource, `migration should map ${legacy} -> ${pipeline}`).toMatch(pattern)
    }
  })

  it('matches the real 3 production leads (all stage=inquiry as of the 2026-11-13 audit)', () => {
    // Every production row this migration will backfill maps to 'new' --
    // the only legacy value actually present in `leads` today.
    expect(mapLegacyStageToPipeline('inquiry')).toBe('new')
  })
})

describe('migration RLS / authorization (text-verified against the committed SQL)', () => {
  it('widens readiness_assessment_leads read access to staff/office_manager only, not students or anon', () => {
    const policyBlock = migrationSource.slice(
      migrationSource.indexOf('create policy "Staff can view readiness assessment leads"')
    )
    expect(policyBlock).toContain('is_staff() or is_office_manager(auth.uid())')
  })

  it('does not touch the existing self-view or admin-only readiness_assessment_leads policies', () => {
    expect(migrationSource).not.toMatch(/drop policy.*Admins can view readiness assessment leads/i)
    expect(migrationSource).not.toMatch(/drop policy.*Users can view their own readiness assessments/i)
  })

  it('gates lead_booking_indicators() on is_staff()/is_office_manager() before touching any table', () => {
    const fnBody = migrationSource.slice(
      migrationSource.indexOf('create or replace function public.lead_booking_indicators'),
      migrationSource.indexOf('revoke all on function public.lead_booking_indicators')
    )
    const authCheckIdx = fnBody.indexOf('not (is_staff() or is_office_manager(auth.uid()))')
    const firstQueryIdx = fnBody.indexOf('select id into v_profile_id')
    expect(authCheckIdx).toBeGreaterThan(-1)
    expect(firstQueryIdx).toBeGreaterThan(-1)
    expect(authCheckIdx).toBeLessThan(firstQueryIdx)
  })

  it('revokes public execute and only grants lead_booking_indicators() to authenticated', () => {
    expect(migrationSource).toMatch(/revoke all on function public\.lead_booking_indicators\(text\) from public/)
    expect(migrationSource).toMatch(/grant execute on function public\.lead_booking_indicators\(text\) to authenticated/)
  })

  it('never drops or widens the leads/lead_notes staff-only policies', () => {
    expect(migrationSource).not.toMatch(/drop policy.*on public\.leads/i)
    expect(migrationSource).not.toMatch(/drop policy.*on public\.lead_notes/i)
  })

  it('never disables RLS or drops an existing table/column', () => {
    // Strip `--`-comment lines first -- the rollback plan documented at
    // the top of the file (not executed SQL) legitimately mentions
    // "drop column" for anyone reversing this migration by hand.
    const executableSql = migrationSource
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n')
    expect(executableSql).not.toMatch(/disable row level security/i)
    expect(executableSql).not.toMatch(/drop table/i)
    expect(executableSql).not.toMatch(/drop column/i)
  })
})

describe('hasNameOrHandle / validateLeadForm', () => {
  it('accepts a lead with only a full name', () => {
    expect(hasNameOrHandle({ full_name: 'Jane Smith', social_username: '' })).toBe(true)
    expect(validateLeadForm({ full_name: 'Jane Smith' })).toEqual({ valid: true, error: '' })
  })

  it('accepts a lead with only a social username (the TikTok-handle-only case)', () => {
    expect(hasNameOrHandle({ full_name: '', social_username: '@flygirl512' })).toBe(true)
    expect(validateLeadForm({ social_username: '@flygirl512', origin_platform: 'tiktok' })).toEqual({ valid: true, error: '' })
  })

  it('rejects a lead with neither', () => {
    expect(hasNameOrHandle({ full_name: '  ', social_username: '' })).toBe(false)
    const result = validateLeadForm({ full_name: '', social_username: '' })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/name or a social media username/i)
  })
})

describe('buildLeadInsertPayload', () => {
  it('builds a username-only lead with every optional field null', () => {
    const payload = buildLeadInsertPayload({
      full_name: '', social_username: '@flygirl512', origin_platform: 'tiktok', capture_method: 'manychat',
      email: '', phone: '', profile_url: '', training_interest: '', aircraft_interest: '',
      checkride_date: '', source_campaign: '', source_content: '', assigned_to: '',
      next_follow_up_at: '', pipeline_stage: 'new', notes: '', referral_source: '',
    })
    expect(payload).toMatchObject({
      full_name: null, social_username: '@flygirl512', origin_platform: 'tiktok', capture_method: 'manychat',
      email: null, phone: null, pipeline_stage: 'new', next_follow_up_at: null,
    })
  })

  it('defaults pipeline_stage to new when unset', () => {
    const payload = buildLeadInsertPayload({ full_name: 'Jane' })
    expect(payload.pipeline_stage).toBe('new')
  })

  it('converts a follow-up date/time to an ISO timestamp', () => {
    const payload = buildLeadInsertPayload({ full_name: 'Jane', next_follow_up_at: '2026-12-01T09:00' })
    expect(payload.next_follow_up_at).toBe(new Date('2026-12-01T09:00').toISOString())
  })

  it('distinguishes origin_platform from capture_method (TikTok origin via ManyChat capture)', () => {
    const payload = buildLeadInsertPayload({ social_username: '@a', origin_platform: 'tiktok', capture_method: 'manychat' })
    expect(payload.origin_platform).toBe('tiktok')
    expect(payload.capture_method).toBe('manychat')
    expect(payload.origin_platform).not.toBe(payload.capture_method)
  })
})

describe('buildNoteInsertPayload', () => {
  it('builds an activity note with contact method and outcome', () => {
    const payload = buildNoteInsertPayload('lead-1', 'staff-1', { body: 'Called, no answer', contactMethod: 'call', outcome: 'no_answer' })
    expect(payload).toEqual({ lead_id: 'lead-1', author_id: 'staff-1', body: 'Called, no answer', contact_method: 'call', outcome: 'no_answer' })
  })

  it('allows a plain note with no contact method or outcome', () => {
    const payload = buildNoteInsertPayload('lead-1', 'staff-1', { body: 'Just a note' })
    expect(payload.contact_method).toBeNull()
    expect(payload.outcome).toBeNull()
  })
})

describe('normalizeEmail / normalizePhone', () => {
  it('lowercases and trims email', () => {
    expect(normalizeEmail('  Jane@Example.com ')).toBe('jane@example.com')
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('normalizes phone numbers to bare 10-digit form, stripping a leading US country code', () => {
    expect(normalizePhone('(512) 555-0100')).toBe('5125550100')
    expect(normalizePhone('512-555-0100')).toBe('5125550100')
    expect(normalizePhone('+1 512 555 0100')).toBe('5125550100')
    expect(normalizePhone('1-512-555-0100')).toBe('5125550100')
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})

describe('findDuplicateMatches', () => {
  const leads = [
    { id: 'l1', email: 'jane@example.com', phone: '(512) 555-0100', origin_platform: 'tiktok', social_username: '@flygirl512' },
    { id: 'l2', email: null, phone: null, origin_platform: 'instagram', social_username: 'pilot_sam' },
  ]
  const readinessLeads = [
    { id: 'r1', email: 'jane@example.com' },
  ]

  it('flags a match on normalized email across both leads and readiness records', () => {
    const matches = findDuplicateMatches({ email: 'Jane@Example.com  ' }, { leads, readinessLeads })
    expect(matches).toHaveLength(2)
    expect(matches.find(m => m.type === 'lead').record.id).toBe('l1')
    expect(matches.find(m => m.type === 'readiness').record.id).toBe('r1')
    expect(matches.every(m => m.reasons.includes('email'))).toBe(true)
  })

  it('flags a match on normalized phone even with different formatting', () => {
    const matches = findDuplicateMatches({ phone: '512.555.0100' }, { leads, readinessLeads })
    expect(matches).toHaveLength(1)
    expect(matches[0].record.id).toBe('l1')
    expect(matches[0].reasons).toContain('phone')
  })

  it('flags a match on platform+handle, case- and @-insensitively', () => {
    const matches = findDuplicateMatches({ origin_platform: 'instagram', social_username: 'Pilot_Sam' }, { leads, readinessLeads })
    expect(matches).toHaveLength(1)
    expect(matches[0].record.id).toBe('l2')
    expect(matches[0].reasons).toContain('platform_handle')
  })

  it('does NOT flag a match on name alone ("do not automatically merge based only on names")', () => {
    const matches = findDuplicateMatches({ full_name: 'Someone With A Different Email', email: 'nobody@nowhere.com' }, { leads, readinessLeads })
    expect(matches).toHaveLength(0)
  })

  it('does not flag two different people on two different platforms with the same-looking handle', () => {
    const matches = findDuplicateMatches({ origin_platform: 'tiktok', social_username: 'pilot_sam' }, { leads, readinessLeads })
    expect(matches).toHaveLength(0) // pilot_sam exists on instagram, not tiktok -- never conflate different platforms
  })

  it('excludes the lead being edited from its own duplicate check', () => {
    const matches = findDuplicateMatches({ id: 'l1', email: 'jane@example.com' }, { leads, readinessLeads, excludeLeadId: 'l1' })
    expect(matches.find(m => m.type === 'lead')).toBeUndefined()
    expect(matches.find(m => m.type === 'readiness')).toBeDefined()
  })

  it('returns nothing for a lead with no email, phone, or handle to compare', () => {
    expect(findDuplicateMatches({ full_name: 'Jane' }, { leads, readinessLeads })).toHaveLength(0)
  })
})

describe('mergeDirectoryRecords', () => {
  const leads = [
    { id: 'l1', full_name: 'Jane Smith', email: 'jane@example.com', created_at: '2026-11-10T00:00:00Z', pipeline_stage: 'new', linked_readiness_lead_id: 'r1' },
  ]
  const readinessLeads = [
    { id: 'r1', full_name: 'Jane S.', email: 'jane@example.com', created_at: '2026-11-01T00:00:00Z' },
    { id: 'r2', full_name: 'Someone Else', email: 'else@example.com', created_at: '2026-11-05T00:00:00Z' },
  ]

  it('includes every lead and every readiness record without copying one into the other', () => {
    const merged = mergeDirectoryRecords(leads, readinessLeads)
    expect(merged).toHaveLength(3)
    expect(merged.filter(r => r.recordType === 'lead')).toHaveLength(1)
    expect(merged.filter(r => r.recordType === 'readiness')).toHaveLength(2)
  })

  it('keeps a linked readiness record visible, annotated with the lead that links to it', () => {
    const merged = mergeDirectoryRecords(leads, readinessLeads)
    const linked = merged.find(r => r.recordType === 'readiness' && r.sourceId === 'r1')
    expect(linked.linkedLeadId).toBe('l1')
    const unlinked = merged.find(r => r.recordType === 'readiness' && r.sourceId === 'r2')
    expect(unlinked.linkedLeadId).toBeNull()
  })

  it('preserves the original source id on every record', () => {
    const merged = mergeDirectoryRecords(leads, readinessLeads)
    expect(merged.find(r => r.recordType === 'lead').sourceId).toBe('l1')
    expect(merged.find(r => r.sourceId === 'r2').sourceId).toBe('r2')
  })

  it('sorts newest first', () => {
    const merged = mergeDirectoryRecords(leads, readinessLeads)
    expect(merged.map(r => r.sourceId)).toEqual(['l1', 'r2', 'r1'])
  })

  it('falls back to @handle for a lead with no full_name', () => {
    const merged = mergeDirectoryRecords([{ id: 'l2', social_username: 'flygirl512', created_at: '2026-11-11T00:00:00Z' }], [])
    expect(merged[0].displayName).toBe('@flygirl512')
  })
})

describe('filterDirectoryRecords', () => {
  const now = new Date('2026-11-13T12:00:00Z')
  const records = mergeDirectoryRecords(
    [
      { id: 'l1', full_name: 'Jane', email: 'jane@example.com', origin_platform: 'tiktok', pipeline_stage: 'new', training_interest: 'Private Pilot', assigned_to: 'staff-1', next_follow_up_at: '2026-11-12T00:00:00Z', created_at: '2026-11-10T00:00:00Z' },
      { id: 'l2', full_name: 'Sam', email: 'sam@example.com', origin_platform: 'instagram', pipeline_stage: 'contacted', training_interest: 'Instrument Rating', assigned_to: 'staff-2', next_follow_up_at: null, created_at: '2026-11-09T00:00:00Z' },
    ],
    [{ id: 'r1', full_name: 'Riley', email: 'riley@example.com', created_at: '2026-11-08T00:00:00Z' }]
  )

  it('filters by pipeline stage', () => {
    expect(filterDirectoryRecords(records, { stage: 'contacted' })).toHaveLength(1)
  })

  it('filters by source, including readiness_assessment as a selectable source', () => {
    expect(filterDirectoryRecords(records, { source: 'tiktok' })).toHaveLength(1)
    expect(filterDirectoryRecords(records, { source: 'readiness_assessment' })).toHaveLength(1)
  })

  it('filters by training interest', () => {
    expect(filterDirectoryRecords(records, { trainingInterest: 'Instrument Rating' })).toHaveLength(1)
  })

  it('filters by assigned staff member', () => {
    expect(filterDirectoryRecords(records, { assignedTo: 'staff-1' })).toHaveLength(1)
  })

  it('filters by follow-up status (overdue relative to `now`)', () => {
    expect(filterDirectoryRecords(records, { followUp: 'overdue' }, now)).toHaveLength(1)
    expect(filterDirectoryRecords(records, { followUp: 'none' }, now)).toHaveLength(2) // l2 + the readiness record
  })

  it('filters by free-text search across name, email, phone', () => {
    expect(filterDirectoryRecords(records, { search: 'riley' })).toHaveLength(1)
    expect(filterDirectoryRecords(records, { search: 'sam@example' })).toHaveLength(1)
    expect(filterDirectoryRecords(records, { search: 'nobody' })).toHaveLength(0)
  })

  it('combines multiple filters with AND semantics', () => {
    expect(filterDirectoryRecords(records, { stage: 'new', source: 'tiktok' })).toHaveLength(1)
    expect(filterDirectoryRecords(records, { stage: 'new', source: 'instagram' })).toHaveLength(0)
  })
})

describe('followUpBucket', () => {
  const now = new Date('2026-11-13T15:00:00')

  it('returns null when no follow-up is set', () => {
    expect(followUpBucket(null, now)).toBeNull()
  })

  it('classifies a past date as overdue', () => {
    expect(followUpBucket('2026-11-12T09:00:00', now)).toBe('overdue')
  })

  it('classifies a time later today as today', () => {
    expect(followUpBucket('2026-11-13T18:00:00', now)).toBe('today')
    expect(followUpBucket('2026-11-13T08:00:00', now)).toBe('today') // earlier today, still "today" not overdue by date bucket
  })

  it('classifies a future date as upcoming', () => {
    expect(followUpBucket('2026-11-20T09:00:00', now)).toBe('upcoming')
  })
})

describe('groupFollowUps', () => {
  const now = new Date('2026-11-13T12:00:00')
  const leads = [
    { id: 'a', next_follow_up_at: '2026-11-10T09:00:00' }, // overdue
    { id: 'b', next_follow_up_at: '2026-11-13T18:00:00' }, // today
    { id: 'c', next_follow_up_at: '2026-11-20T09:00:00' }, // upcoming
    { id: 'd', next_follow_up_at: null },                  // none -- excluded entirely
    { id: 'e', next_follow_up_at: '2026-11-09T09:00:00' }, // overdue, earlier than 'a'
  ]

  it('buckets leads into overdue/today/upcoming and drops leads with no follow-up set', () => {
    const groups = groupFollowUps(leads, now)
    expect(groups.overdue.map(l => l.id)).toEqual(['e', 'a']) // sorted soonest-first
    expect(groups.today.map(l => l.id)).toEqual(['b'])
    expect(groups.upcoming.map(l => l.id)).toEqual(['c'])
  })
})

describe('option lists stay in sync with the migration CHECK constraints', () => {
  it('every PIPELINE_STAGE_OPTIONS value appears in the pipeline_stage CHECK constraint', () => {
    const checkBlock = migrationSource.slice(migrationSource.indexOf('constraint leads_pipeline_stage_check'))
    for (const { value } of PIPELINE_STAGE_OPTIONS) {
      expect(checkBlock).toContain(`'${value}'`)
    }
  })

  it('every ORIGIN_PLATFORM_OPTIONS value appears in the origin_platform CHECK constraint', () => {
    const checkBlock = migrationSource.slice(migrationSource.indexOf('constraint leads_origin_platform_check'))
    for (const { value } of ORIGIN_PLATFORM_OPTIONS) {
      expect(checkBlock).toContain(`'${value}'`)
    }
  })

  it('every CAPTURE_METHOD_OPTIONS value appears in the capture_method CHECK constraint', () => {
    const checkBlock = migrationSource.slice(migrationSource.indexOf('constraint leads_capture_method_check'))
    for (const { value } of CAPTURE_METHOD_OPTIONS) {
      expect(checkBlock).toContain(`'${value}'`)
    }
  })
})
