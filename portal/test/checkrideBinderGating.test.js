// Checkride Binder Builder -- Phase 1 (schema + gating skeleton)
// regression coverage. site/portal-stable.js is a huge browser IIFE that
// expects a full portal.html DOM (same reasoning as staticPortalAuth.
// test.js/checkoutObservability.test.js), so this asserts against the
// real source text/structure rather than trying to execute it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const portalStableSource = readFileSync(path.join(REPO_ROOT, 'site/portal-stable.js'), 'utf8')
const portalHtmlSource = readFileSync(path.join(REPO_ROOT, 'site/portal.html'), 'utf8')
const analyticsEventsSource = readFileSync(path.join(REPO_ROOT, 'site/analytics-events.js'), 'utf8')
const edgeFunctionSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/get-checkride-binder-content/index.ts'), 'utf8')

function findMatchingBrace(source, openIdx) {
  let depth = 0
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return i }
  }
  throw new Error('No matching closing brace found')
}

describe('GATED_SECTIONS: checkride-binder is gated behind Checkride Prep, no new entitlement', () => {
  it('checkride-binder is in GATED_SECTIONS', () => {
    const idx = portalStableSource.indexOf('var GATED_SECTIONS = [')
    expect(idx).toBeGreaterThan(-1)
    const line = portalStableSource.slice(idx, portalStableSource.indexOf(';', idx))
    expect(line).toContain("'checkride-binder'")
  })

  it('runSectionEnterEffects() calls loadCheckrideBinder() for id === "checkride-binder"', () => {
    const marker = 'function runSectionEnterEffects(id) {'
    const start = portalStableSource.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const braceOpen = start + marker.length - 1
    const braceClose = findMatchingBrace(portalStableSource, braceOpen)
    const body = portalStableSource.slice(braceOpen + 1, braceClose)
    expect(body).toContain("if (id === 'checkride-binder') loadCheckrideBinder();")
  })
})

describe('portal.html: nav item + section container wiring', () => {
  it('nav item is gated (data-gated="true" + a lock icon), same convention as DPE Library/Scenario Center', () => {
    const idx = portalHtmlSource.indexOf('data-section="checkride-binder"')
    expect(idx).toBeGreaterThan(-1)
    const block = portalHtmlSource.slice(idx, idx + 500)
    expect(block).toContain('data-gated="true"')
    expect(block).toContain('data-lock-icon')
    expect(block).toContain('Checkride Binder Builder')
  })

  it('section container is a single mount point (matches Study Packs\' minimal-container pattern, not 20 separate portal-sections)', () => {
    const idx = portalHtmlSource.indexOf('id="section-checkride-binder"')
    expect(idx).toBeGreaterThan(-1)
    const block = portalHtmlSource.slice(idx, idx + 200)
    expect(block).toContain('id="checkrideBinderRoot"')
    // exactly one top-level section for the whole feature, not one per
    // workbook section
    const allSectionIds = portalHtmlSource.match(/id="section-checkride-binder[a-z0-9-]*"/g) || []
    expect(allSectionIds.length).toBe(1)
  })
})

describe('loadCheckrideBinder(): entitlement check + content/response/tracker fetch', () => {
  function functionBody() {
    const marker = 'function loadCheckrideBinder() {'
    const start = portalStableSource.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const braceOpen = start + marker.length - 1
    const braceClose = findMatchingBrace(portalStableSource, braceOpen)
    return portalStableSource.slice(braceOpen + 1, braceClose)
  }

  it('bails out if the member has not unlocked Checkride Prep -- client-side convenience on top of the real server-side check', () => {
    const body = functionBody()
    expect(body).toContain('!member.checkridePrepUnlocked')
  })

  it('fetches content through the gated Edge Function, not a direct table select', () => {
    const body = functionBody()
    expect(body).toContain("apexSupabase.functions.invoke('get-checkride-binder-content'")
    expect(body).not.toMatch(/apexSupabase\.from\(['"]checkride_binder_content['"]\)/)
  })

  it('fetches the student\'s own responses and tracker entries directly (RLS-scoped), not through an Edge Function', () => {
    const body = functionBody()
    expect(body).toContain("apexSupabase.from('checkride_binder_responses')")
    expect(body).toContain("apexSupabase.from('checkride_binder_tracker_entries')")
    expect(body).toContain(".eq('profile_id', member.id)")
  })

  it('fires checkride_binder_opened', () => {
    const body = functionBody()
    expect(body).toContain("apexTrack('checkride_binder_opened'")
  })
})

describe('EVENT_ALLOWLIST includes the new event', () => {
  it('declares checkride_binder_opened', () => {
    expect(analyticsEventsSource).toContain("'checkride_binder_opened'")
  })
})

describe('get-checkride-binder-content Edge Function: server-side entitlement enforcement', () => {
  it('checks checkride_prep_unlocked (or a portal_access_purchases row) before returning content, same as get-premium-content', () => {
    expect(edgeFunctionSource).toContain('requirePremiumAccess(supabase,')
    expect(edgeFunctionSource).toContain("select('checkride_prep_unlocked')")
    expect(edgeFunctionSource).toContain("from('portal_access_purchases')")
  })

  it('throws a 403 PremiumAccessError when unlocked is false -- never returns partial content', () => {
    const idx = edgeFunctionSource.indexOf('if (!unlocked)')
    expect(idx).toBeGreaterThan(-1)
    expect(edgeFunctionSource.slice(idx, idx + 120)).toContain('throw new PremiumAccessError')
  })

  it('only ever selects from checkride_binder_content via the service-role client, never exposing it to a direct client grant', () => {
    expect(edgeFunctionSource).toContain("from('checkride_binder_content')")
    expect(edgeFunctionSource).toContain('SERVICE_ROLE_KEY')
  })
})
