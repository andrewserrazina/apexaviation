// Revenue Funnel + Attribution Integrity sprint (Section 2/9) --
// regression coverage for site/analytics-events.js's first-touch/
// last-touch capture. Unlike portal-stable.js (a huge IIFE that expects a
// full portal.html DOM), analytics-events.js only touches
// window/document/localStorage -- all real in vitest's jsdom
// environment -- so this loads and executes the ACTUAL file source
// directly (via `new Function(source)()`) rather than statically
// asserting against its text, giving real behavioral coverage of the
// exact code that ships.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(path.join(REPO_ROOT, 'site/analytics-events.js'), 'utf8')

// Re-loads the script fresh against whatever URL/localStorage state the
// test has already set up -- mirrors a real page load, where
// analytics-events.js's own top-level utmProps()/captureRef() calls run
// immediately as the script tag executes.
function loadScript() {
  // eslint-disable-next-line no-new-func
  new Function(source)()
}

// jsdom's real navigation APIs (history.pushState) enforce same-origin,
// which blocks the exact cross-subdomain scenario Section 2C needs to
// exercise (readiness-assessment.apexaviationtx.com -> portal on
// apexaviationtx.com) -- stubbing the global `location` (== window.
// location, since window IS globalThis under vitest's jsdom environment)
// sidesteps that without weakening what's actually being tested: the
// script only ever reads location.search/hostname/href, never navigates.
function setUrl(urlStr) {
  const u = new URL(urlStr)
  vi.stubGlobal('location', { href: u.href, search: u.search, hostname: u.hostname, pathname: u.pathname, hash: u.hash })
}

beforeEach(() => {
  localStorage.clear()
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim()
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
  })
  delete window.apexTrack
  delete window.gtag
  delete window.fbq
  delete window.apexSupabase
  setUrl('http://localhost/readiness-assessment.html')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('analytics-events.js: event-level attribution properties (Section 2E)', () => {
  it('utmProps()/track() attach traffic_content and traffic_term, not just source/medium/campaign', () => {
    setUrl('http://localhost/readiness-assessment.html?utm_source=facebook&utm_medium=paid_social&utm_campaign=CQ01&utm_content=ad_variant_a&utm_term=checkride+prep')
    loadScript()
    let sentProps = null
    window.gtag = (_action, _name, props) => { sentProps = props }
    window.apexTrack('readiness_assessment_viewed', {})
    expect(sentProps).toBeTruthy()
    expect(sentProps.traffic_source).toBe('facebook')
    expect(sentProps.traffic_medium).toBe('paid_social')
    expect(sentProps.campaign).toBe('CQ01')
    // The actual bug this closes: these two were captured into
    // localStorage from day one but never attached to the per-event
    // properties every apexTrack() call sends.
    expect(sentProps.traffic_content).toBe('ad_variant_a')
    expect(sentProps.traffic_term).toBe('checkride prep')
  })

  it('a later page view with no utm params still carries the earlier-captured traffic_content/term forward', () => {
    setUrl('http://localhost/readiness-assessment.html?utm_source=facebook&utm_medium=paid_social&utm_content=ad_variant_a&utm_term=checkride+prep')
    loadScript()
    setUrl('http://localhost/readiness-assessment.html') // same session, later event, no fresh utm
    let sentProps = null
    window.gtag = (_a, _n, props) => { sentProps = props }
    window.apexTrack('readiness_assessment_completed', {})
    expect(sentProps.traffic_content).toBe('ad_variant_a')
    expect(sentProps.traffic_term).toBe('checkride prep')
  })
})

describe('analytics-events.js: first-touch capture never overwritten (Section 2A)', () => {
  it('apex_utm_source_first stays the FIRST campaign even after a later visit carries a different one', () => {
    setUrl('http://localhost/readiness-assessment.html?utm_source=facebook&utm_medium=paid_social&utm_campaign=CQ01')
    loadScript()
    expect(window.apexGetFirstTouchUtm().source).toBe('facebook')
    expect(window.apexGetFirstTouchUtm().campaign).toBe('CQ01')

    // A second, later visit with a DIFFERENT campaign -- must update
    // "latest touch" (getUtm()) but never touch "first touch".
    setUrl('http://localhost/readiness-assessment.html?utm_source=google&utm_medium=cpc&utm_campaign=YT01')
    loadScript()
    expect(window.apexGetFirstTouchUtm().source).toBe('facebook')
    expect(window.apexGetFirstTouchUtm().campaign).toBe('CQ01')
    expect(window.apexGetUtm().source).toBe('google')
    expect(window.apexGetUtm().campaign).toBe('YT01')
  })

  it('first_touch_landing_page/at are captured once and never overwritten by a later visit', () => {
    setUrl('http://localhost/readiness-assessment.html?utm_source=facebook')
    loadScript()
    const firstLanding = window.apexGetFirstTouchLanding()
    expect(firstLanding.landing_page).toContain('utm_source=facebook')
    expect(firstLanding.at).toBeTruthy()

    setUrl('http://localhost/checkride-prep.html?utm_source=google')
    loadScript()
    const stillFirstLanding = window.apexGetFirstTouchLanding()
    expect(stillFirstLanding.landing_page).toBe(firstLanding.landing_page)
    expect(stillFirstLanding.at).toBe(firstLanding.at)
  })
})

describe('analytics-events.js: last-touch sync on a fresh tagged return visit (Section 2B)', () => {
  it('only calls update_last_touch_attribution when THIS load actually carried a fresh utm param', async () => {
    const rpcCalls = []
    const flushMicrotasks = () => Promise.resolve().then(() => Promise.resolve())
    const fakeSupabase = () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      rpc: (name, args) => { rpcCalls.push([name, args]); return { catch: () => {} } },
    })

    // apexSupabase loaded BEFORE analytics-events.js on every real page
    // (portal-supabase.js is included first) -- set it before loadScript()
    // so the script's own automatic top-level utmProps()/
    // syncLastTouchIfFresh() call runs exactly like it does on a real page
    // load, instead of a second, artificial manual call.
    window.apexSupabase = fakeSupabase()
    loadScript() // no fresh utm on this load -- must not sync
    await flushMicrotasks()
    expect(rpcCalls.length).toBe(0)

    // Now a fresh tagged visit.
    setUrl('http://localhost/portal.html?utm_source=email&utm_medium=email&utm_campaign=new_member_activation')
    window.apexSupabase = fakeSupabase()
    loadScript()
    await flushMicrotasks()
    expect(rpcCalls.length).toBe(1)
    expect(rpcCalls[0][0]).toBe('update_last_touch_attribution')
    expect(rpcCalls[0][1].p_source).toBe('email')
    expect(rpcCalls[0][1].p_campaign).toBe('new_member_activation')
  })
})

describe('analytics-events.js: anon_id survives across the readiness->portal subdomain boundary (Section 2C)', () => {
  // Genuine cross-subdomain cookie SHARING is a browser-level guarantee,
  // not something one jsdom document can exercise (jsdom's cookie jar,
  // like a real browser, validates a cookie's domain= attribute against
  // the page's actual origin, which this test can't repoint without a
  // second document). What IS unit-testable, and is the actual bug-fix
  // logic: cookieDomain() must resolve to the SHARED PARENT domain
  // (.apexaviationtx.com) for both the marketing-site hostname and any
  // subdomain of it, not just an exact match -- extracted directly from
  // source so a future edit to the regex is caught here.
  function extractCookieDomainFn() {
    const marker = 'function cookieDomain() {'
    const start = source.indexOf(marker)
    expect(start, 'cookieDomain() not found').toBeGreaterThan(-1)
    let depth = 0
    const braceOpen = start + marker.length - 1
    let i = braceOpen
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') { depth--; if (depth === 0) break }
    }
    const body = source.slice(braceOpen + 1, i)
    // eslint-disable-next-line no-new-func
    return new Function('location', body)
  }

  it('resolves to the shared parent domain for the apex root domain and every subdomain of it', () => {
    const cookieDomain = extractCookieDomainFn()
    expect(cookieDomain({ hostname: 'apexaviationtx.com' })).toBe('.apexaviationtx.com')
    expect(cookieDomain({ hostname: 'portal.apexaviationtx.com' })).toBe('.apexaviationtx.com')
    expect(cookieDomain({ hostname: 'readiness-assessment.apexaviationtx.com' })).toBe('.apexaviationtx.com')
  })

  it('resolves to null for an unrelated host (never sets a cookie domain= it has no right to)', () => {
    const cookieDomain = extractCookieDomainFn()
    expect(cookieDomain({ hostname: 'evil-apexaviationtx.com.attacker.example' })).toBeNull()
    expect(cookieDomain({ hostname: 'localhost' })).toBeNull()
  })

  it('anon_id is actually written to document.cookie (mechanism sanity check)', () => {
    // Deliberately left on the beforeEach default (non-apex) host: jsdom's
    // cookie jar -- like a real browser -- validates a cookie's domain=
    // attribute against the page's REAL origin, which stubbing `location`
    // (used only for the app's own hostname-based branching, above) can't
    // repoint. On a host cookieDomain() returns null for, setCookie()
    // writes a plain same-origin cookie, which jsdom's real localhost
    // origin accepts -- proving the write mechanism itself works, which
    // is what this check is actually for.
    loadScript()
    const id = window.apexGetAnonId()
    expect(id).toBeTruthy()
    expect(document.cookie).toContain('apex_anon_id=')
  })
})

describe('analytics-events.js: EVENT_ALLOWLIST includes the new checkout-observability events (Section 4)', () => {
  it('does not console.warn for checkride_prep_offer_viewed/checkout_session_create_failed/checkout_cancelled', () => {
    loadScript()
    const warnings = []
    const originalWarn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      window.apexTrack('checkride_prep_offer_viewed', {})
      window.apexTrack('checkout_session_create_failed', {})
      window.apexTrack('checkout_cancelled', {})
    } finally {
      console.warn = originalWarn
    }
    expect(warnings).toEqual([])
  })

  it('still warns for a genuinely unlisted event name (allowlist is not a no-op)', () => {
    loadScript()
    const warnings = []
    const originalWarn = console.warn
    console.warn = (...args) => warnings.push(args.join(' '))
    try {
      window.apexTrack('totally_made_up_event_name', {})
    } finally {
      console.warn = originalWarn
    }
    expect(warnings.length).toBe(1)
  })
})
