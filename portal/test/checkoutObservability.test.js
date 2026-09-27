// Revenue Funnel + Attribution Integrity sprint (Section 4/6/9) --
// regression coverage for the Checkride Prep checkout-lifecycle
// instrumentation gaps closed this sprint. Same static-source-assertion
// approach as staticPortalAuth.test.js/gatedSectionFallback.test.js:
// site/portal-stable.js and site/portal-login.html are huge browser IIFEs
// that expect a full portal.html/portal-login.html DOM (unlike
// analytics-events.js, which only touches window/document/localStorage
// and gets real jsdom execution in attributionPersistence.test.js), so
// this asserts against the real source text/structure rather than trying
// to execute it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const portalStableSource = readFileSync(path.join(REPO_ROOT, 'site/portal-stable.js'), 'utf8')
const portalLoginSource = readFileSync(path.join(REPO_ROOT, 'site/portal-login.html'), 'utf8')
const createCheckoutSessionSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/create-checkout-session/index.ts'), 'utf8')

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

describe('portal-stable.js: openUnlockModal() fires one canonical offer-viewed event for every trigger (Section 4)', () => {
  it('fires checkride_prep_offer_viewed unconditionally, before the personalized/generic branch', () => {
    const body = extractFunctionBody(portalStableSource, 'function openUnlockModal(readinessContext) {')
    const canonicalIdx = body.indexOf("apexTrack('checkride_prep_offer_viewed'")
    // Post Checkride Prep Personalized Pitch A/B test: the personalized-
    // vs-generic branch is now gated on the experiment's assigned variant
    // (pitchVariant === 'personalized'), not directly on eligibility --
    // but checkride_prep_offer_viewed still fires unconditionally, before
    // that branch, for every openUnlockModal() call site.
    const branchIdx = body.indexOf("if (pitchVariant === 'personalized')")
    expect(canonicalIdx).toBeGreaterThan(-1)
    expect(branchIdx).toBeGreaterThan(-1)
    expect(canonicalIdx).toBeLessThan(branchIdx)
  })

  it('the personalized readiness_checkride_prep_offer_viewed event is preserved, not replaced', () => {
    const body = extractFunctionBody(portalStableSource, 'function openUnlockModal(readinessContext) {')
    expect(body).toContain("apexTrack('readiness_checkride_prep_offer_viewed'")
  })
})

describe('portal-stable.js: unlockModalCta click handler (the actual "Unlock Now" purchase button) (Section 4/8)', () => {
  function ctaHandlerBody() {
    const marker = "unlockModalCta.addEventListener('click', function () {"
    const start = portalStableSource.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const braceOpen = start + marker.length - 1
    const braceClose = findMatchingBrace(portalStableSource, braceOpen)
    return portalStableSource.slice(braceOpen + 1, braceClose)
  }

  it('fires checkout_started BEFORE invoking create-checkout-session -- previously fired nothing at all until Stripe redirected back', () => {
    const body = ctaHandlerBody()
    const startedIdx = body.indexOf("apexTrack('checkout_started'")
    const invokeIdx = body.indexOf("functions.invoke('create-checkout-session'")
    expect(startedIdx).toBeGreaterThan(-1)
    expect(invokeIdx).toBeGreaterThan(-1)
    expect(startedIdx).toBeLessThan(invokeIdx)
    expect(body.slice(startedIdx, invokeIdx)).toContain("product: 'checkride_prep'")
  })

  it('fires checkout_session_create_failed on a create-checkout-session error response', () => {
    const body = ctaHandlerBody()
    const errorBranchIdx = body.indexOf('if (res.error || !res.data || !res.data.url)')
    expect(errorBranchIdx).toBeGreaterThan(-1)
    const nextCatch = body.indexOf('}).catch(function ()', errorBranchIdx)
    expect(body.slice(errorBranchIdx, nextCatch)).toContain("apexTrack('checkout_session_create_failed'")
  })

  it('fires checkout_session_create_failed on a network/invoke throw too, not just an error response', () => {
    const body = ctaHandlerBody()
    const catchIdx = body.indexOf('}).catch(function ()')
    expect(catchIdx).toBeGreaterThan(-1)
    expect(body.slice(catchIdx)).toContain("apexTrack('checkout_session_create_failed'")
  })
})

describe('portal-stable.js: checkout_cancelled return-trip tracking (Section 4/7)', () => {
  it('reads ?checkout_cancelled=1&product=... and fires checkout_cancelled, then cleans the URL', () => {
    const marker = "if (params.get('checkout_cancelled') !== '1') return;"
    const idx = portalStableSource.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const block = portalStableSource.slice(idx, idx + 600)
    expect(block).toContain("apexTrack('checkout_cancelled'")
    expect(block).toContain('history.replaceState')
  })
})

describe('create-checkout-session/index.ts: cancel_url now carries the checkout_cancelled marker (Section 4/7)', () => {
  it('unlock-checkride-prep cancel_url includes checkout_cancelled=1&product=checkride_prep', () => {
    const idx = createCheckoutSessionSource.indexOf("metadata: { purpose: 'unlock-checkride-prep', profile_id: profileId, tier: pricing.tier }")
    expect(idx).toBeGreaterThan(-1)
    const nearby = createCheckoutSessionSource.slice(idx, idx + 1500)
    const cancelLine = nearby.match(/cancel_url: `[^`]+`/)
    expect(cancelLine).toBeTruthy()
    expect(cancelLine[0]).toContain('checkout_cancelled=1')
    expect(cancelLine[0]).toContain('product=checkride_prep')
  })

  it('signup-and-unlock-checkride-prep cancel_url also includes the marker', () => {
    const idx = createCheckoutSessionSource.indexOf("metadata: { purpose: 'unlock-checkride-prep', profile_id: newProfileId, tier: pricing.tier }")
    expect(idx).toBeGreaterThan(-1)
    const nearby = createCheckoutSessionSource.slice(idx, idx + 1500)
    const cancelLine = nearby.match(/cancel_url: `[^`]+`/)
    expect(cancelLine).toBeTruthy()
    expect(cancelLine[0]).toContain('checkout_cancelled=1')
    expect(cancelLine[0]).toContain('product=checkride_prep')
  })
})

describe('portal-login.html: instant-access signup+purchase path (Section 6 reconciliation fix)', () => {
  it('fireSignupPurchasePixel now also fires the funnel purchase_completed event, not just the Meta pixel', () => {
    const start = portalLoginSource.indexOf('var fireSignupPurchasePixel = function (amountCents) {')
    expect(start).toBeGreaterThan(-1)
    const braceOpen = portalLoginSource.indexOf('{', start)
    const braceClose = findMatchingBrace(portalLoginSource, braceOpen)
    const body = portalLoginSource.slice(braceOpen + 1, braceClose)
    expect(body).toContain("apexTrack('purchase_completed'")
    // Own dedupe key, distinct from the fbq dedupe key, so page refresh /
    // back-button can't double-count either signal independently.
    expect(body).toMatch(/apex_funnel_purchase_.*sessionId/)
  })

  it('has its own checkout_cancelled tracking IIFE for the signup-and-unlock-checkride-prep cancel return trip', () => {
    const occurrences = portalLoginSource.split("apexTrack('checkout_cancelled'").length - 1
    expect(occurrences).toBeGreaterThan(0)
  })
})

describe('site/analytics-events.js EVENT_ALLOWLIST (cross-file consistency)', () => {
  const analyticsEventsSource = readFileSync(path.join(REPO_ROOT, 'site/analytics-events.js'), 'utf8')
  it('declares every new event name actually used in portal-stable.js/portal-login.html/create-checkout-session', () => {
    for (const name of ['checkride_prep_offer_viewed', 'checkout_session_create_failed', 'checkout_cancelled']) {
      expect(analyticsEventsSource, `${name} missing from EVENT_ALLOWLIST`).toContain(`'${name}'`)
    }
  })
})
