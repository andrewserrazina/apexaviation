// Email audit follow-up: the redesign shipped a footer link to
// email-preferences.html that never existed anywhere in the repo, with
// no consent/suppression state behind it. These tests guard the fix:
// the migration adding the column, the page itself, the login redirect
// that gets a member back to it, and the marketing/transactional split
// applied in both the server cron and the client-triggered sender.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const lifecycleSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/send-lifecycle-emails/index.ts'), 'utf8')
const portalStableSource = readFileSync(path.join(REPO_ROOT, 'site/portal-stable.js'), 'utf8')
const portalLoginSource = readFileSync(path.join(REPO_ROOT, 'site/portal-login.html'), 'utf8')
const preferencesPageSource = readFileSync(path.join(REPO_ROOT, 'site/email-preferences.html'), 'utf8')
const migrationSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase-portal-schema-v141-email-marketing-preferences.sql'), 'utf8')

describe('migration: profiles.email_marketing_opt_out', () => {
  it('adds the column as a non-null boolean defaulting to false', () => {
    expect(migrationSource).toMatch(/add column if not exists email_marketing_opt_out boolean not null default false/)
  })

  it('targets public.profiles', () => {
    expect(migrationSource).toContain('alter table public.profiles')
  })
})

describe('site/email-preferences.html exists and actually persists a change', () => {
  it('checks for a real session before showing preferences', () => {
    expect(preferencesPageSource).toContain('apexSupabase.auth.getSession()')
  })

  it('prompts sign-in when signed out, rather than silently failing or exposing the form', () => {
    expect(preferencesPageSource).toContain('signedOutState');
    expect(preferencesPageSource).toContain('portal-login.html?dest=email-preferences')
  })

  it('reads and writes the real profiles column, scoped to the signed-in member', () => {
    expect(preferencesPageSource).toMatch(/\.from\('profiles'\)\s*\.select\('email,email_marketing_opt_out'\)/)
    expect(preferencesPageSource).toMatch(/\.from\('profiles'\)\s*\.update\(\{\s*email_marketing_opt_out:/)
    expect(preferencesPageSource).toContain(".eq('id', session.user.id)")
  })

  it('sets expectations that transactional email cannot be turned off here', () => {
    expect(preferencesPageSource.toLowerCase()).toContain('receipts')
  })
})

describe('portal-login.html redirects back to the preferences page after sign-in', () => {
  it('special-cases dest=email-preferences instead of treating it as a portal.html#section', () => {
    const fnSource = portalLoginSource.slice(portalLoginSource.indexOf('function portalDestUrl'), portalLoginSource.indexOf('function portalDestUrl') + 2000)
    expect(fnSource).toContain("safeDest === 'email-preferences'")
    expect(fnSource).toContain("'email-preferences.html'")
  })
})

describe('email suppression: server-side cron respects email_marketing_opt_out', () => {
  it('the main profiles query loads the opt-out flag', () => {
    expect(lifecycleSource).toContain('email_marketing_opt_out')
  })

  it('computes a single marketingSuppressed flag from it', () => {
    expect(lifecycleSource).toContain('const marketingSuppressed = !!profile.email_marketing_opt_out')
  })

  // Engagement/promotional sequences -- must be gated.
  const suppressedCalls = [
    'await processInactivity(supabase, profile, results)',
    'await processReactivationInactive(supabase, profile, results)',
    'await processWeeklyProgress(supabase, profile, allQuestions, categoryIds, results)',
    'await processWeakArea(supabase, profile, allQuestions, categoryIds, results)',
    'await processCheckrideUpsell(supabase, profile, results)',
  ]
  it.each(suppressedCalls)('%s is only reached when marketingSuppressed is false', (callText) => {
    const idx = lifecycleSource.indexOf(callText)
    expect(idx, `call site not found: ${callText}`).toBeGreaterThan(-1)
    // The nearest preceding `if (` on the marketingSuppressed flag must
    // be closer than the nearest preceding closing of that same if-block
    // (a plain "}" at the matching indent) -- i.e. the call is still
    // lexically inside it. Cheap proxy: require the guard text to appear
    // within 400 chars before the call with no intervening function
    // boundary ("async function ").
    const window = lifecycleSource.slice(Math.max(0, idx - 400), idx)
    expect(window, `no marketingSuppressed guard found before: ${callText}`).toMatch(/marketingSuppressed\)/)
    expect(window.includes('async function')).toBe(false)
  })

  // Relationship/milestone sequences -- must NOT be gated by the opt-out.
  it('processFirstQuestionMilestone runs unconditionally (no marketingSuppressed guard immediately before it)', () => {
    const marker = 'await processFirstQuestionMilestone(supabase, profile, results)'
    const idx = lifecycleSource.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const window = lifecycleSource.slice(Math.max(0, idx - 150), idx)
    expect(window).not.toMatch(/marketingSuppressed\)\s*\{?\s*$/)
  })

  it('processMilestones and processCountdown run without a marketingSuppressed guard', () => {
    for (const marker of ['await processMilestones(supabase, profile, allQuestions, categoryIds, results)', 'await processCountdown(supabase, profile, results)']) {
      const idx = lifecycleSource.indexOf(marker)
      expect(idx, marker).toBeGreaterThan(-1)
      const window = lifecycleSource.slice(Math.max(0, idx - 150), idx)
      expect(window, marker).not.toMatch(/marketingSuppressed\)\s*\{?\s*$/)
    }
  })

  it('processGroundSchoolFollowUps and abandoned-checkout recovery check the linked profile\'s opt-out', () => {
    const groundBlock = lifecycleSource.slice(lifecycleSource.indexOf('async function processGroundSchoolFollowUps'), lifecycleSource.indexOf('async function processGroundSchoolFollowUps') + 1200)
    expect(groundBlock).toContain('email_marketing_opt_out')

    const abandonedBlock = lifecycleSource.slice(lifecycleSource.indexOf('async function processAbandonedCheckouts'), lifecycleSource.indexOf('async function processAbandonedCheckouts') + 1500)
    expect(abandonedBlock).toContain('email_marketing_opt_out')
  })

  it('time-sensitive service notices (mock oral reminder, recovery sortie) are documented as intentionally exempt, not silently missed', () => {
    const mockOralBlock = lifecycleSource.slice(Math.max(0, lifecycleSource.indexOf('async function processMockOralReminders') - 300), lifecycleSource.indexOf('async function processMockOralReminders'))
    expect(mockOralBlock).toContain('Not gated by email_marketing_opt_out')

    const sortieBlock = lifecycleSource.slice(Math.max(0, lifecycleSource.indexOf('async function processRecoverySortieNotifications') - 400), lifecycleSource.indexOf('async function processRecoverySortieNotifications'))
    expect(sortieBlock).toContain('Not gated by email_marketing_opt_out')
  })
})

describe('email suppression: client-triggered weak-area send respects the same flag', () => {
  it('member object carries emailMarketingOptOut from the real profiles row', () => {
    expect(portalStableSource).toContain('emailMarketingOptOut: !!(profile && profile.email_marketing_opt_out)')
  })

  it('checkWeakAreaEmail() bails out when the member opted out', () => {
    const fnStart = portalStableSource.indexOf('function checkWeakAreaEmail()')
    const fnBody = portalStableSource.slice(fnStart, fnStart + 300)
    expect(fnBody).toContain('member.emailMarketingOptOut')
  })
})
