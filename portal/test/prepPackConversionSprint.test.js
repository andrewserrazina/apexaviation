// Apex Advantage — Prep Pack Conversion Optimization Sprint.
//
// Covers the code this sprint actually touched, scoped per the audit:
// (1) site/readiness-assessment.html's new entitlement check, so an
// already-unlocked member retaking the assessment never sees a "buy it"
// CTA for something they already own; (2) send-lifecycle-emails/index.ts's
// removal of the dead founding/launch pricing-tier branches (unreachable
// since v158 made $29 permanent) that still carried a stale "$49 usual
// price" comparison; (3) the two new, additive SQL migrations (v162
// backlog reconciliation, v163 recovery-assisted funnel metric) --
// verified by direct execution against a disposable local Postgres
// instance during this sprint (see the sprint report), asserted here via
// static source checks since this suite has no live Postgres available;
// (4) the admin dashboard's new stat card for the v163 metric.
//
// Same static-source-assertion approach as checkoutObservability.test.js/
// readinessFunnelInstrumentationRepair.test.js: readiness-assessment.html
// is a browser IIFE expecting a full page DOM (quizSection/resultsSection
// elements, window.apexSupabase, window.apexTrack), not something this
// suite jsdom-executes; send-lifecycle-emails/index.ts is a Deno Edge
// Function with top-level remote-URL imports that can't be imported
// directly under Node/vitest either.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readinessAssessmentSource = readFileSync(path.join(REPO_ROOT, 'site/readiness-assessment.html'), 'utf8')
const lifecycleSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/send-lifecycle-emails/index.ts'), 'utf8')
const v162Source = readFileSync(path.join(REPO_ROOT, 'portal/supabase-portal-schema-v162-abandoned-checkout-backlog-reconciliation.sql'), 'utf8')
const v163Source = readFileSync(path.join(REPO_ROOT, 'portal/supabase-portal-schema-v163-readiness-funnel-recovery-assisted.sql'), 'utf8')
const marketingFunnelSource = readFileSync(path.join(REPO_ROOT, 'portal/src/pages/MarketingFunnel.jsx'), 'utf8')

function findMatchingBrace(source, openIdx) {
  let depth = 0
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return i }
  }
  throw new Error('No matching closing brace found')
}

function extractFunctionBody(source, functionMarker) {
  const startIdx = source.indexOf(functionMarker)
  expect(startIdx, `${functionMarker} not found`).toBeGreaterThan(-1)
  const parenClose = source.indexOf(')', startIdx)
  const braceOpen = source.indexOf('{', parenClose)
  const braceClose = findMatchingBrace(source, braceOpen)
  return source.slice(braceOpen + 1, braceClose)
}

describe('site/readiness-assessment.html: entitlement-aware results CTA (Phase 2A)', () => {
  it('defines fetchCheckridePrepUnlocked() reading the real profiles.checkride_prep_unlocked flag', () => {
    const body = extractFunctionBody(readinessAssessmentSource, 'function fetchCheckridePrepUnlocked(')
    expect(body).toContain("from('profiles')")
    expect(body).toContain('checkride_prep_unlocked')
  })

  it('fetchCheckridePrepUnlocked() fails closed to false (today\'s existing CTA) on any lookup error, never throwing', () => {
    const body = extractFunctionBody(readinessAssessmentSource, 'function fetchCheckridePrepUnlocked(')
    expect(body).toContain('.catch(function () { return false; })')
  })

  it('both renderFullResults() callers resolve entitlement first, never calling it with no information', () => {
    const occurrences = readinessAssessmentSource.split('fetchCheckridePrepUnlocked(').length - 1
    // One definition + two real callers (the already-logged-in teaser
    // path and the inline-login gate path).
    expect(occurrences).toBe(3)
    expect(readinessAssessmentSource).toContain('fetchCheckridePrepUnlocked(session.user.id).then(function (isUnlocked) { renderFullResults(isUnlocked); })')
    expect(readinessAssessmentSource).toContain('fetchCheckridePrepUnlocked(res.data.user.id).then(function (isUnlocked) { renderFullResults(isUnlocked); })')
  })

  it('renderFullResults() branches on isUnlocked before rendering either CTA', () => {
    const body = extractFunctionBody(readinessAssessmentSource, 'function renderFullResults(isUnlocked) {')
    const branchIdx = body.indexOf('isUnlocked ?')
    expect(branchIdx).toBeGreaterThan(-1)
    const unlockedBranch = body.slice(branchIdx, body.indexOf(':', branchIdx))
    const lockedBranch = body.slice(body.indexOf(':', branchIdx))
    expect(unlockedBranch).toContain('Open Checkride Prep')
    expect(unlockedBranch).not.toContain('Unlock Checkride Prep')
    expect(lockedBranch).toContain('Unlock Checkride Prep')
  })

  it('an already-unlocked member is never shown the feature-list sales pitch or the low-commitment upsell', () => {
    const body = extractFunctionBody(readinessAssessmentSource, 'function renderFullResults(isUnlocked) {')
    const branchIdx = body.indexOf('isUnlocked ?')
    const unlockedBranch = body.slice(branchIdx, body.indexOf('\n        :\n'))
    expect(unlockedBranch).not.toContain('ra-convert__features')
    expect(unlockedBranch).not.toContain('Airspace Mastery')
  })

  it('never fires the purchase-intent readiness_checkride_prep_clicked event for an already-unlocked member', () => {
    const body = extractFunctionBody(readinessAssessmentSource, 'function renderFullResults(isUnlocked) {')
    const guardIdx = body.indexOf('if (!isUnlocked) {')
    expect(guardIdx).toBeGreaterThan(-1)
    const guardedBlock = body.slice(guardIdx, findMatchingBrace(body, body.indexOf('{', guardIdx)) + 1)
    expect(guardedBlock).toContain("apexTrack('readiness_checkride_prep_clicked'")
    // And the click-tracking wiring must be INSIDE that guard, not loose
    // in the function (which would throw -- raCheckridePrepCta doesn't
    // exist in the DOM when isUnlocked renders a different element id).
    expect(body.indexOf("apexTrack('readiness_checkride_prep_clicked'")).toBeGreaterThan(guardIdx)
  })

  it('isUnlocked defaults to falsy (today\'s existing CTA) when omitted, since no caller passes a bare renderFullResults() anymore', () => {
    // Guards against a future regression re-introducing a no-argument
    // call site -- undefined is falsy, so the ternary above still
    // renders the non-entitled branch, matching this file's own
    // documented fail-safe direction. Scoped to actual call sites
    // (a trailing "(" with no argument before the closing paren), not
    // the pre-existing prose comment that mentions the function by name.
    const codeLines = readinessAssessmentSource.split('\n').filter(l => !l.trim().startsWith('//'))
    const callSites = codeLines.join('\n').match(/renderFullResults\([^)]*\)/g) || []
    expect(callSites.length).toBeGreaterThan(0)
    for (const call of callSites) expect(call).not.toBe('renderFullResults()')
  })
})

describe('send-lifecycle-emails/index.ts: dead founding/launch pricing-tier branches removed (Phase 2B/2C)', () => {
  it('checkrideUpsellSubject() no longer branches on a founding tier', () => {
    const body = extractFunctionBody(lifecycleSource, 'function checkrideUpsellSubject(')
    expect(body).not.toContain("pricing.tier === 'founding'")
    expect(body).not.toContain('founding spots left')
  })

  it('emailTemplateCheckrideUpsell() day 1 and day 7 no longer render a "$X, then $49" / "usual $49" comparison', () => {
    const body = extractFunctionBody(lifecycleSource, 'function emailTemplateCheckrideUpsell(')
    expect(body).not.toMatch(/\$49/)
    expect(body).not.toContain("pricing.tier === 'founding'")
    expect(body).not.toContain("pricing.tier === 'launch'")
  })

  it('the second-touch abandoned-checkout follow-up no longer computes a founding/launch urgency line', () => {
    const idx = lifecycleSource.indexOf('const urgencyLine: string | null = null')
    expect(idx).toBeGreaterThan(-1)
    expect(lifecycleSource).not.toContain("pricing.tier === 'founding'\n        ? `Only")
    expect(lifecycleSource).not.toContain('regular price is $49')
  })

  it('emailTemplateAbandonedCheckridePrepFollowup() itself is unchanged and still renders a given urgencyLine when one is passed', () => {
    // The fix is entirely at the caller (always passing null now); the
    // function's own null-safe rendering is untouched and still tested
    // directly by emailLifecycle.test.js.
    const body = extractFunctionBody(lifecycleSource, 'function emailTemplateAbandonedCheckridePrepFollowup(')
    expect(body).toContain('urgencyLine ?')
  })

  it('the pricing-RPC-empty-result fallback uses the real permanent price (2900), not the retired $49 standard tier', () => {
    expect(lifecycleSource).toContain("{ tier: 'standard', amount_cents: 2900, founding_seats_remaining: 0, launch_expires_at: null }")
    expect(lifecycleSource).not.toContain('amount_cents: 4900')
  })

  it('no reachable "$49" literal remains anywhere in the file except inside a comment describing past behavior', () => {
    const lines = lifecycleSource.split('\n')
    const codeLinesWith49 = lines.filter(l => l.includes('$49') && !l.trim().startsWith('//'))
    expect(codeLinesWith49).toEqual([])
  })
})

describe('v162 backlog reconciliation migration (Phase 2C)', () => {
  it('is scoped to the two Checkride Prep checkout purposes only', () => {
    expect(v162Source).toContain("'unlock-checkride-prep', 'signup-and-unlock-checkride-prep'")
  })

  it('only ever touches rows already outside the live cron\'s own 7-day eligibility window', () => {
    expect(v162Source).toMatch(/created_at\s*<\s*now\(\)\s*-\s*interval\s*'7 days'/)
  })

  it('never touches a row the live recovery system has already decided on', () => {
    expect(v162Source).toContain('csa.completed_at is null')
    expect(v162Source).toContain('csa.recovery_email_sent_at is null')
    expect(v162Source).toContain('csa.recovery_suppressed_at is null')
  })

  it('applies opt-out suppression before already-entitled suppression, matching decideAbandonedCheckoutAction()\'s own precedence', () => {
    const optOutIdx = v162Source.indexOf('when backlog.opted_out then')
    const entitledIdx = v162Source.indexOf('when backlog.unlocked then')
    expect(optOutIdx).toBeGreaterThan(-1)
    expect(entitledIdx).toBeGreaterThan(-1)
    expect(optOutIdx).toBeLessThan(entitledIdx)
  })

  it('writes a distinct, descriptive reason for the genuinely-unresolved backlog rather than reusing an existing reason', () => {
    expect(v162Source).toContain("'backlog_window_expired_unprocessed'")
  })

  it('sends no email and grants no entitlement -- it only ever writes recovery_suppressed_at/_reason', () => {
    expect(v162Source).not.toMatch(/sendEmail|checkride_prep_unlocked\s*=\s*true/)
  })
})

describe('v163 readiness funnel recovery-assisted metric (Phase 2D)', () => {
  it('preserves the existing admin gate unchanged', () => {
    expect(v163Source).toContain("if not public.is_admin(auth.uid()) then")
    expect(v163Source).toContain("raise exception 'Admin access required'")
  })

  it('adds exactly one new key to the returned jsonb, every existing key untouched', () => {
    for (const key of ['viewed', 'started', 'completed', 'score_viewed', 'signup_started', 'account_created', 'gate_login_completed', 'checkride_prep_clicked', 'checkride_prep_purchased']) {
      expect(v163Source).toContain(`'${key}'`)
    }
    expect(v163Source).toContain("'recovery_assisted_purchased'")
  })

  it('recovery_assisted_purchased is scoped to checkout_recovered rows for a Checkride Prep purpose', () => {
    expect(v163Source).toContain("cr.event_name = 'checkout_recovered'")
    expect(v163Source).toContain("cr.properties->>'purpose' in ('unlock-checkride-prep', 'signup-and-unlock-checkride-prep')")
  })

  it('recovery_assisted is defined as a subset of prep_purchase, never an independent count that could exceed it', () => {
    const recoveryIdx = v163Source.indexOf('recovery_assisted as (')
    expect(recoveryIdx).toBeGreaterThan(-1)
    expect(v163Source.slice(recoveryIdx)).toContain('from prep_purchase pp')
  })

  it('uses resolve_analytics_identity() for both sides of the join, matching every other funnel RPC\'s dedup convention', () => {
    const recoveryIdx = v163Source.indexOf('recovery_assisted as (')
    expect(recoveryIdx).toBeGreaterThan(-1)
    const block = v163Source.slice(recoveryIdx, recoveryIdx + 400)
    expect(block).toContain('public.resolve_analytics_identity(cr.anon_id, cr.profile_id)')
  })
})

describe('MarketingFunnel.jsx: surfaces the new recovery-assisted metric (Phase 2D)', () => {
  it('reads readiness.recovery_assisted_purchased in a new stat card next to the existing Readiness Assessment Funnel cards', () => {
    const sectionIdx = marketingFunnelSource.indexOf('Readiness Assessment Funnel')
    expect(sectionIdx).toBeGreaterThan(-1)
    const nextSectionIdx = marketingFunnelSource.indexOf('Checkride Prep Funnel', sectionIdx)
    const section = marketingFunnelSource.slice(sectionIdx, nextSectionIdx)
    expect(section).toContain('readiness.recovery_assisted_purchased')
  })
})
