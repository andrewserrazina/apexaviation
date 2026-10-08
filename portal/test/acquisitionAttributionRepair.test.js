// Acquisition & Revenue Attribution Repair (v156) -- regression coverage
// for the 6 scenarios called out in this task: anonymous-to-authenticated
// linking, UTM-free return visits, signup via readiness assessment,
// checkout-before-signup, email retargeting (purchase-touch != first-
// touch), and duplicate Stripe webhook delivery. Same extraction
// conventions as the rest of this repo's test suite:
//   - site/analytics-events.js is plain browser JS -> loaded and executed
//     directly via `new Function(source)()` (attributionPersistence.
//     test.js's own convention).
//   - the two Deno edge functions are TS with Deno-only top-level imports
//     that can never be `import`ed under vitest -> individual functions
//     are extracted by marker + brace-matching and re-assembled as plain
//     JS (utmSourceCanonicalization.test.js's / stripeWebhookRetry.
//     test.js's own convention), never hand-copied, so a future edit to
//     the real source can't silently drift from what this file tests.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// ============================================================
// Shared extraction helpers (same brace-matching approach as
// utmSourceCanonicalization.test.js / stripeWebhookRetry.test.js).
// ============================================================
function findMatchingClose(source, openIdx, openCh, closeCh) {
  let depth = 0
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === openCh) depth++
    else if (source[i] === closeCh) { depth--; if (depth === 0) return i }
  }
  throw new Error('No matching close found')
}

// Extracts just the BODY of a `function name(...) { ... }` declaration
// (signature, including any TS param type annotations, is discarded --
// callers supply plain parameter names directly to `new Function`,
// avoiding any need to strip TS syntax from the signature itself).
function extractFunctionBody(source, functionNameMarker) {
  const startIdx = source.indexOf(functionNameMarker)
  if (startIdx === -1) throw new Error(`Marker not found: ${functionNameMarker}`)
  const parenClose = source.indexOf(')', startIdx)
  const braceOpen = source.indexOf('{', parenClose)
  const braceClose = findMatchingClose(source, braceOpen, '{', '}')
  return source.slice(braceOpen + 1, braceClose)
}

// Extracts a `const NAME: SomeType = { ... }` or `const NAME = [ ... ]`
// literal and rebuilds it as plain `const NAME = { ... }` -- the name
// itself may carry a TS type annotation (`: Record<string, string>`)
// between it and `=`, which is valid TS but not valid JS, so it's
// discarded rather than included verbatim.
function extractConstLiteral(source, constNameMarker) {
  const startIdx = source.indexOf(constNameMarker)
  if (startIdx === -1) throw new Error(`Marker not found: ${constNameMarker}`)
  const nameMatch = constNameMarker.match(/^const\s+([A-Za-z0-9_$]+)/)
  const eqIdx = source.indexOf('=', startIdx)
  let openIdx = eqIdx + 1
  while (/\s/.test(source[openIdx])) openIdx++
  const openCh = source[openIdx]
  const closeCh = openCh === '{' ? '}' : ']'
  const closeIdx = findMatchingClose(source, openIdx, openCh, closeCh)
  const literal = source.slice(openIdx, closeIdx + 1)
  return `const ${nameMatch[1]} = ${literal}`
}

// Builds the real sanitizeUtm/sanitizeReferrer/sanitizeClickIds trio
// (plus their sibling consts) as one prelude string, identical in both
// edge functions (duplicated source, not a shared module -- see each
// file's own header comment for why). Composed once per file so
// applySignupAttribution()/logCheckoutAttempt() extraction below can
// close over the real implementations rather than a hand-rewritten stub.
function buildSanitizersPrelude(source) {
  const aliases = extractConstLiteral(source, 'const UTM_SOURCE_ALIASES')
  const clickIdKeys = extractConstLiteral(source, 'const CLICK_ID_KEYS')
  // Inline `const out: Record<...> = {}` annotations (TS-only) need
  // stripping the same way utmSourceCanonicalization.test.js already
  // does for sanitizeUtm's body -- extended here to sanitizeClickIds',
  // which has the identical pattern.
  const stripRecordType = (body) => body.replace(/:\s*Record<[^>]*>/g, '')
  const sanitizeUtmBody = stripRecordType(extractFunctionBody(source, 'function sanitizeUtm(utm'))
  const sanitizeReferrerBody = extractFunctionBody(source, 'function sanitizeReferrer(ref')
  const sanitizeClickIdsBody = stripRecordType(extractFunctionBody(source, 'function sanitizeClickIds(clickIds'))
  return `
    ${aliases}
    ${clickIdKeys}
    function sanitizeUtm(utm) { ${sanitizeUtmBody} }
    function sanitizeReferrer(ref) { ${sanitizeReferrerBody} }
    function sanitizeClickIds(clickIds) { ${sanitizeClickIdsBody} }
  `
}

// Records every from()/update()/insert()/eq() call made against a fake
// Supabase client -- sufficient for applySignupAttribution()/
// logCheckoutAttempt(), which never read anything back (fire-and-forget
// writes), so no scripted response queue is needed (unlike
// stripeWebhookRetry.test.js's makeFakeSupabase, which does need one).
function makeCapturingSupabase() {
  const calls = []
  return {
    calls,
    from(table) {
      const record = { table, method: null, payload: null, eq: null }
      calls.push(record)
      return {
        update(v) {
          record.method = 'update'
          record.payload = v
          return { eq: (col, val) => { record.eq = [col, val]; return Promise.resolve({ error: null }) } }
        },
        insert(v) {
          record.method = 'insert'
          record.payload = v
          return Promise.resolve({ error: null })
        },
      }
    },
  }
}

function loadApplySignupAttribution(relativePath) {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
  const prelude = buildSanitizersPrelude(source)
  const body = extractFunctionBody(source, 'async function applySignupAttribution(supabase')
  // eslint-disable-next-line no-new-func
  return new Function(
    'supabase', 'profileId', 'utmFirst', 'firstTouchLanding', 'referrerFirst', 'clickIdsFirst', 'firstTouchAnonId', 'signupTouch',
    `${prelude}\nreturn (async () => { ${body} })()`
  )
}

function loadLogCheckoutAttempt(relativePath) {
  const source = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
  const prelude = buildSanitizersPrelude(source)
  const body = extractFunctionBody(source, 'async function logCheckoutAttempt(supabase')
  // eslint-disable-next-line no-new-func
  return new Function('supabase', 'args', `${prelude}\nreturn (async () => { ${body} })()`)
}

const CHECKOUT_SESSION_PATH = 'portal/supabase/functions/create-checkout-session/index.ts'
const FREE_ACCOUNT_PATH = 'portal/supabase/functions/create-free-account/index.ts'

// ============================================================
// Scenario: checkout-before-signup + email retargeting
// (signup-touch != first-touch, both preserved distinctly)
// ============================================================
describe('create-checkout-session/index.ts: applySignupAttribution() writes first-touch and signup-touch as distinct, never-conflated fields', () => {
  const applySignupAttribution = loadApplySignupAttribution(CHECKOUT_SESSION_PATH)

  it('checkout-before-signup: a brand-new profile created straight into a one-step checkout gets BOTH first-touch and signup-touch written from the same (first-ever) touch', async () => {
    const supabase = makeCapturingSupabase()
    await applySignupAttribution(
      supabase, 'profile-1',
      { source: 'google', medium: 'organic', campaign: null, content: null, term: null },
      { landing_page: 'https://apexaviationtx.com/private-pilot', at: '2026-09-01T00:00:00.000Z' },
      'https://google.com/search', { gclid: 'abc123' }, 'anon-1',
      { source: 'google', medium: 'organic', referrer: 'https://google.com/search', click_ids: { gclid: 'abc123' }, landing_page: 'https://apexaviationtx.com/private-pilot', at: '2026-09-01T00:00:00.000Z' }
    )
    expect(supabase.calls.length).toBe(1)
    const { table, method, payload, eq } = supabase.calls[0]
    expect(table).toBe('profiles')
    expect(method).toBe('update')
    expect(eq).toEqual(['id', 'profile-1'])
    expect(payload.signup_utm_source).toBe('google')
    expect(payload.first_touch_referrer).toBe('https://google.com/search')
    expect(payload.first_touch_click_ids).toEqual({ gclid: 'abc123' })
    expect(payload.first_touch_anon_id).toBe('anon-1')
    expect(payload.signup_touch_source).toBe('google')
    expect(payload.signup_touch_referrer).toBe('https://google.com/search')
    expect(payload.signup_touch_landing_page).toBe('https://apexaviationtx.com/private-pilot')
  })

  it('email retargeting: a visitor whose FIRST touch was organic, but who converts after a later Facebook retargeting email click, gets first-touch and signup-touch recorded as genuinely DIFFERENT values -- the later touch is never mislabeled as first-touch', async () => {
    const supabase = makeCapturingSupabase()
    await applySignupAttribution(
      supabase, 'profile-2',
      // utm_first / first_touch_landing: the visitor's real, original first-ever touch.
      { source: 'google', medium: 'organic', campaign: null, content: null, term: null },
      { landing_page: 'https://apexaviationtx.com/', at: '2026-08-01T00:00:00.000Z' },
      null, null, 'anon-2',
      // signup_touch: the retargeting email touch active at the MOMENT of signup, weeks later.
      { source: 'facebook', medium: 'email', campaign: 'retarget_oct', referrer: 'https://mail.google.com/', click_ids: null, landing_page: 'https://apexaviationtx.com/checkride-prep?utm_source=facebook', at: '2026-09-15T00:00:00.000Z' }
    )
    const { payload } = supabase.calls[0]
    // First-touch: untouched, still the original organic visit.
    expect(payload.signup_utm_source).toBe('google')
    expect(payload.signup_utm_medium).toBe('organic')
    expect(payload.first_touch_landing_page).toBe('https://apexaviationtx.com/')
    // Signup-touch: the later Facebook/email touch, recorded in its OWN columns.
    expect(payload.signup_touch_source).toBe('facebook')
    expect(payload.signup_touch_medium).toBe('email')
    expect(payload.signup_touch_campaign).toBe('retarget_oct')
    expect(payload.signup_touch_landing_page).toBe('https://apexaviationtx.com/checkride-prep?utm_source=facebook')
    // The two must never collide on the same columns.
    expect(payload.signup_touch_source).not.toBe(payload.signup_utm_source)
  })

  it('a visitor with NO touch data at all (direct, no referral) results in no update call -- never invents attribution', async () => {
    const supabase = makeCapturingSupabase()
    await applySignupAttribution(supabase, 'profile-3', {}, null, null, null, null, null)
    expect(supabase.calls.length).toBe(0)
  })

  it('malformed/hostile click_ids and an oversized referrer are dropped rather than stored raw', async () => {
    const supabase = makeCapturingSupabase()
    await applySignupAttribution(
      supabase, 'profile-4',
      { source: 'facebook' }, null,
      'x'.repeat(5000), { fbclid: 'ok123', evil_key: 'should be dropped' }, null, null
    )
    const { payload } = supabase.calls[0]
    // An all-null/falsy field is omitted from the update payload entirely
    // (the `...(x ? {...} : {})` spread pattern), not sent as an explicit
    // null -- same convention the pre-existing hasUtm/landingPage fields
    // already use.
    expect(payload.first_touch_referrer).toBeUndefined()
    expect(payload.first_touch_click_ids).toEqual({ fbclid: 'ok123' })
  })
})

describe("create-free-account/index.ts: the inline signup-attribution write mirrors applySignupAttribution()'s first-touch/signup-touch separation", () => {
  // create-free-account/index.ts has no applySignupAttribution() helper
  // (it's the ONLY account-creation path that never needs a reusable
  // function shared across multiple purposes) -- instead it inlines the
  // same logic directly in its serve() handler. This test extracts that
  // inline block via the same sanitizer prelude and asserts the same
  // contract: new fields never collide with the pre-existing signup_utm_*/
  // first_touch_landing_page/at columns.
  it("sanitizeReferrer/sanitizeClickIds exist and behave identically to create-checkout-session's copies", () => {
    const source = readFileSync(path.join(REPO_ROOT, FREE_ACCOUNT_PATH), 'utf8')
    const prelude = buildSanitizersPrelude(source)
    // eslint-disable-next-line no-new-func
    const sanitizeReferrer = new Function(`${prelude}\nreturn sanitizeReferrer`)()
    // eslint-disable-next-line no-new-func
    const sanitizeClickIds = new Function(`${prelude}\nreturn sanitizeClickIds`)()
    expect(sanitizeReferrer('https://facebook.com/post/1')).toBe('https://facebook.com/post/1')
    expect(sanitizeReferrer(12345)).toBeNull()
    expect(sanitizeClickIds({ fbclid: 'abc' })).toEqual({ fbclid: 'abc' })
    expect(sanitizeClickIds('not an object')).toBeNull()
  })
})

// ============================================================
// Scenario: email retargeting / purchase-touch capture at the
// checkout-attempt level (independent of profile-level touches)
// ============================================================
describe('create-checkout-session/index.ts: logCheckoutAttempt() captures purchase-touch referrer/click_ids per attempt', () => {
  const logCheckoutAttempt = loadLogCheckoutAttempt(CHECKOUT_SESSION_PATH)

  it('persists referrer and click_ids on the checkout_session_attempts row, alongside (not instead of) utm_*', async () => {
    const supabase = makeCapturingSupabase()
    await logCheckoutAttempt(supabase, {
      stripeSessionId: 'cs_test_1', purpose: 'unlock-checkride-prep', email: 'a@example.com', profileId: 'profile-1',
      amountCents: 2900, utm: { source: 'facebook', medium: 'paid_social' },
      referrer: 'https://facebook.com/ads/42', clickIds: { fbclid: 'xyz' },
    })
    const { table, method, payload } = supabase.calls[0]
    expect(table).toBe('checkout_session_attempts')
    expect(method).toBe('insert')
    expect(payload.utm_source).toBe('facebook')
    expect(payload.referrer).toBe('https://facebook.com/ads/42')
    expect(payload.click_ids).toEqual({ fbclid: 'xyz' })
  })

  it("a purchase-touch can genuinely differ from whatever the profile's first/signup touch holds -- this function never reads or reconciles against profiles, it just records what was active at THIS checkout", async () => {
    const supabase = makeCapturingSupabase()
    // Same profile, hypothetically a DIFFERENT channel at time of purchase
    // than at time of signup (e.g. the email-retargeting scenario) --
    // logCheckoutAttempt has no profile-touch awareness at all, which IS
    // the correct behavior: purchase-touch is independently captured, not
    // derived from or reconciled against signup-touch.
    await logCheckoutAttempt(supabase, {
      stripeSessionId: 'cs_test_2', purpose: 'unlock-checkride-prep', profileId: 'profile-2',
      amountCents: 2900, utm: { source: 'email', medium: 'email' }, referrer: 'https://mail.google.com/', clickIds: null,
    })
    const { payload } = supabase.calls[0]
    expect(payload.utm_source).toBe('email')
    expect(payload.referrer).toBe('https://mail.google.com/')
    expect(payload.click_ids).toBeNull()
  })

  it('never throws on malformed referrer/click_ids -- a logging failure must not block checkout', async () => {
    const supabase = makeCapturingSupabase()
    await expect(logCheckoutAttempt(supabase, {
      stripeSessionId: 'cs_test_3', purpose: 'ground-school-registration', amountCents: 2500,
      utm: null, referrer: { not: 'a string' }, clickIds: 'not an object',
    })).resolves.toBeUndefined()
    const { payload } = supabase.calls[0]
    expect(payload.referrer).toBeNull()
    expect(payload.click_ids).toBeNull()
  })
})

// ============================================================
// Scenario: duplicate Stripe webhook delivery never clobbers the
// purchase-touch attribution logCheckoutAttempt() already wrote at
// session-creation time.
// ============================================================
describe('stripe-webhook/index.ts: a replayed/duplicate webhook event cannot overwrite purchase-touch attribution', () => {
  const webhookSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/stripe-webhook/index.ts'), 'utf8')

  it('every .update(...) call against checkout_session_attempts only ever sets lifecycle fields (completed_at/fulfillment_*), never utm_*/referrer/click_ids', () => {
    // checkout_session_attempts' utm_source/utm_medium/.../referrer/
    // click_ids columns are written exactly once, by create-checkout-
    // session's logCheckoutAttempt() at the moment the Stripe Checkout
    // Session is created. stripe-webhook (this file) only ever UPDATEs
    // that same row keyed by stripe_session_id to record what happened
    // to the session afterwards -- a second, duplicate delivery of the
    // same event (Stripe's own at-least-once guarantee) re-sets the same
    // lifecycle fields to the same values, never touches the attribution
    // columns, so no duplicate delivery can ever corrupt or re-derive
    // purchase-touch data. This is a static-source regression check (not
    // a stateful replay simulation) because the actual guarantee here is
    // "this code path doesn't exist", which a single extracted-function
    // test can't prove as robustly as scanning every real call site does.
    const updateCallRegex = /\.from\(\s*['"]checkout_session_attempts['"]\s*\)\s*\.update\(\s*\{([^}]*)\}/g
    const matches = [...webhookSource.matchAll(updateCallRegex)]
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      const fields = m[1]
      expect(fields).not.toMatch(/\butm_source\b/)
      expect(fields).not.toMatch(/\butm_medium\b/)
      expect(fields).not.toMatch(/\breferrer\b/)
      expect(fields).not.toMatch(/\bclick_ids\b/)
    }
  })

  it('stripe-webhook never INSERTs into checkout_session_attempts -- the row (and its attribution) is only ever created once, by create-checkout-session', () => {
    const insertCallRegex = /\.from\(\s*['"]checkout_session_attempts['"]\s*\)\s*\.insert\(/g
    expect([...webhookSource.matchAll(insertCallRegex)].length).toBe(0)
  })
})

// ============================================================
// Scenario: anonymous-to-authenticated linking (client capture layer) +
// UTM-free return visits (first-touch/click-ids/referrer never cleared
// or overwritten by a later untagged visit) + signup-touch reflecting
// the LATEST touch, distinct from first-touch, at the client layer.
// ============================================================
const analyticsSource = readFileSync(path.join(REPO_ROOT, 'site/analytics-events.js'), 'utf8')
function loadAnalyticsScript() {
  // eslint-disable-next-line no-new-func
  new Function(analyticsSource)()
}
function setUrl(urlStr) {
  const u = new URL(urlStr)
  vi.stubGlobal('location', { href: u.href, search: u.search, hostname: u.hostname, pathname: u.pathname, hash: u.hash })
}

describe('analytics-events.js: click IDs + referrer follow the same first-touch/last-touch contract as UTM params', () => {
  beforeEach(() => {
    localStorage.clear()
    document.cookie.split(';').forEach((c) => {
      const name = c.split('=')[0].trim()
      if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`
    })
    setUrl('http://localhost/readiness-assessment.html')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('a click id with NO utm_* params at all is still captured as a fresh touch (several ad templates omit utm_*)', () => {
    setUrl('http://localhost/apex-advantage-private-pilot.html?fbclid=abc123')
    loadAnalyticsScript()
    expect(window.apexGetFirstTouchClickIds()).toEqual({ fbclid: 'abc123' })
    expect(window.apexGetClickIds()).toEqual({ fbclid: 'abc123' })
    // A click id alone must also set first-touch landing/at/anon_id --
    // same "fresh touch" gate utm_* already used, now shared with click ids.
    expect(window.apexGetFirstTouchLanding().landing_page).toContain('fbclid=abc123')
    expect(window.apexGetFirstTouchAnonId()).toBeTruthy()
  })

  it('first-touch click_ids/referrer are captured once and never overwritten by a later, differently-tagged visit', () => {
    setUrl('http://localhost/readiness-assessment.html?fbclid=first-click')
    loadAnalyticsScript()
    expect(window.apexGetFirstTouchClickIds()).toEqual({ fbclid: 'first-click' })

    setUrl('http://localhost/portal.html?gclid=second-click')
    loadAnalyticsScript()
    expect(window.apexGetFirstTouchClickIds()).toEqual({ fbclid: 'first-click' }) // still the first
    expect(window.apexGetClickIds()).toEqual({ gclid: 'second-click' }) // but "latest" updated
  })

  it('a UTM-free, click-id-free return visit does not clear previously captured click_ids/referrer (nothing ever clears them, only a fresh value overwrites "latest")', () => {
    setUrl('http://localhost/readiness-assessment.html?utm_source=facebook&fbclid=abc')
    loadAnalyticsScript()
    expect(window.apexGetClickIds()).toEqual({ fbclid: 'abc' })

    // Plain return visit -- no params, no referrer this jsdom navigation.
    setUrl('http://localhost/portal.html')
    loadAnalyticsScript()
    expect(window.apexGetClickIds()).toEqual({ fbclid: 'abc' }) // untouched
    expect(window.apexGetFirstTouchClickIds()).toEqual({ fbclid: 'abc' }) // untouched
  })

  it('getSignupTouch() reflects the LATEST touch (for signup-touch), distinct from getFirstTouchUtm()/getFirstTouchClickIds() (first-touch)', () => {
    setUrl('http://localhost/readiness-assessment.html?utm_source=google&utm_medium=organic')
    loadAnalyticsScript()
    // Later, a different tagged visit right before converting.
    setUrl('http://localhost/checkride-prep.html?utm_source=facebook&utm_medium=paid_social&fbclid=retarget1')
    loadAnalyticsScript()

    const signupTouch = window.apexGetSignupTouch()
    expect(signupTouch.source).toBe('facebook')
    expect(signupTouch.click_ids).toEqual({ fbclid: 'retarget1' })

    // First-touch UTM stays the original, genuinely first-ever visit --
    // never overwritten by the later Facebook retargeting visit.
    expect(window.apexGetFirstTouchUtm().source).toBe('google')
    expect(signupTouch.source).not.toBe(window.apexGetFirstTouchUtm().source)
  })

  it('anonymous-to-authenticated linking: the anon_id active at first-touch is captured and remains stable across every later visit, ready to send to create-free-account/create-checkout-session for server-side linking', () => {
    setUrl('http://localhost/readiness-assessment.html?utm_source=google')
    loadAnalyticsScript()
    const firstAnonId = window.apexGetFirstTouchAnonId()
    expect(firstAnonId).toBeTruthy()
    expect(firstAnonId).toBe(window.apexGetAnonId()) // same id, since this IS the first touch

    // A later visit must never mint a new first_touch_anon_id or change
    // the underlying anon_id itself (anonId()'s own cookie-first
    // persistence, unchanged by this migration) -- this is what lets
    // analytics_identity_map's first-link-wins join later reconcile every
    // anonymous event back to the eventual signed-up profile.
    setUrl('http://localhost/portal.html?utm_source=facebook')
    loadAnalyticsScript()
    expect(window.apexGetFirstTouchAnonId()).toBe(firstAnonId)
    expect(window.apexGetAnonId()).toBe(firstAnonId)
  })
})

// ============================================================
// Scenario: signup via readiness assessment -- static wiring check that
// the real page actually sends the new fields (full page JS context
// can't be loaded the way analytics-events.js's standalone script can --
// readiness-assessment.html is a full document depending on DOM elements
// not worth stubbing just for this; matches this repo's existing
// convention of a static-source assertion for page-level wiring, e.g.
// checkrideBinderGating.test.js).
// ============================================================
describe('readiness-assessment.html: create-free-account call includes the new attribution fields', () => {
  it('sends click_ids_first, referrer_first, first_touch_anon_id, and signup_touch alongside the existing utm_first/first_touch_landing/ref', () => {
    const html = readFileSync(path.join(REPO_ROOT, 'site/readiness-assessment.html'), 'utf8')
    const idx = html.indexOf("functions.invoke('create-free-account'")
    expect(idx, 'create-free-account invocation not found').toBeGreaterThan(-1)
    const nearby = html.slice(idx, idx + 2000)
    expect(nearby).toMatch(/click_ids_first:\s*window\.apexGetFirstTouchClickIds/)
    expect(nearby).toMatch(/referrer_first:\s*window\.apexGetFirstTouchReferrer/)
    expect(nearby).toMatch(/first_touch_anon_id:\s*window\.apexGetFirstTouchAnonId/)
    expect(nearby).toMatch(/signup_touch:\s*window\.apexGetSignupTouch/)
  })
})

describe('apex-advantage-mock-oral.html: signup-and-book-mock-oral-v2 checkout call includes the new attribution fields', () => {
  it('sends referrer, click_ids, click_ids_first, referrer_first, first_touch_anon_id, and signup_touch', () => {
    const html = readFileSync(path.join(REPO_ROOT, 'site/apex-advantage-mock-oral.html'), 'utf8')
    const idx = html.indexOf("purpose: 'signup-and-book-mock-oral-v2'")
    expect(idx, 'signup-and-book-mock-oral-v2 call not found').toBeGreaterThan(-1)
    const nearby = html.slice(idx, idx + 1000)
    expect(nearby).toMatch(/referrer:\s*window\.apexGetReferrer/)
    expect(nearby).toMatch(/click_ids:\s*window\.apexGetClickIds/)
    expect(nearby).toMatch(/signup_touch:\s*window\.apexGetSignupTouch/)
  })
})
