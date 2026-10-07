// Growth analytics finding (Oct 2026) -- regression coverage for
// portal-login.html's dest=checkride-prep promotion: every CTA on
// checkride-prep.html (and the readiness assessment's paid
// recommendation) already landed here with ?dest=checkride-prep before
// this change, but the page always led with the free-signup form and
// buried the matching $29 Instant Access option below an "or" divider.
// Checkout data showed the one-step signup-and-unlock-checkride-prep
// purpose completing at ~71% vs ~40% for a free member coming back
// later to unlock, so this block promotes the Instant Access box (and
// its divider) above the free form specifically when the referring CTA
// already signaled purchase intent.
//
// site/portal-login.html is a classic non-module browser script with no
// build tooling of its own -- same approach as staticPortalAuth.test.js:
// extract the ACTUAL block between stable anchors out of the real
// shipped file and execute it against real jsdom elements, so this
// tests the exact code that ships, not a hand-copied reimplementation.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PORTAL_LOGIN_HTML = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../site/portal-login.html'
)
const fullSource = readFileSync(PORTAL_LOGIN_HTML, 'utf8')

const START_MARKER = 'var signupDest = (new URLSearchParams'
const END_ANCHOR = 'cpForm.parentNode.insertBefore(cpInstantBox, cpDivider)'

function extractPromotionBlock() {
  const startIdx = fullSource.indexOf(START_MARKER)
  if (startIdx === -1) {
    throw new Error('START_MARKER not found in site/portal-login.html -- the signupDest block may have moved or been reworded; update this test to match.')
  }
  const anchorIdx = fullSource.indexOf(END_ANCHOR, startIdx)
  if (anchorIdx === -1) {
    throw new Error('END_ANCHOR not found in site/portal-login.html -- the checkride-prep promotion block may have moved or been reworded; update this test to match.')
  }
  // From the insertBefore line, the source is exactly two closing braces
  // (the inner `if (cpForm && ...)` guard, then the outer
  // `if (signupDest === 'checkride-prep')`) at 4-space indent for the
  // outer one -- this captures through that outer close.
  const outerCloseIdx = fullSource.indexOf('\n    }', anchorIdx)
  if (outerCloseIdx === -1) {
    throw new Error('Could not find the promotion block\'s closing brace -- update this test to match the current source.')
  }
  return fullSource.slice(startIdx, outerCloseIdx + '\n    }'.length)
}

function setUrl(search) {
  vi.stubGlobal('location', { href: 'http://localhost/portal-login.html' + search, search })
}

function buildSignupDom() {
  document.body.innerHTML = `
    <h1 id="signupHeadline">Join Apex Advantage.</h1>
    <div id="signupBadge">✓ Free to join — register for live ground school sessions right away</div>
    <p id="signupSub">original sub copy</p>
    <div id="signupViewContainer">
      <form id="signupForm">free form</form>
      <p id="loginNote">no payment required note</p>
      <div id="checkridePrepDivider">or</div>
      <div id="checkridePrepInstantBox">instant access box</div>
    </div>
  `
}

function runPromotionBlock() {
  const block = extractPromotionBlock()
  // The extracted block's first branch (unchanged real code, not under
  // test here) reads the real file's FREE_GUIDE_COPY lookup table,
  // defined earlier in portal-login.html outside this extracted range --
  // stubbed as empty so dest values it doesn't recognize (including
  // every dest this test exercises) fall through exactly as they do in
  // the real page, without needing to pull in that whole table.
  // eslint-disable-next-line no-new-func
  const fn = new Function('FREE_GUIDE_COPY', block)
  fn({})
}

describe('portal-login.html: dest=checkride-prep Instant Access promotion', () => {
  beforeEach(() => {
    buildSignupDom()
  })

  it('promotes the Instant Access box and divider above the free form when dest=checkride-prep', () => {
    setUrl('?view=signup&dest=checkride-prep')
    runPromotionBlock()

    expect(document.getElementById('signupHeadline').textContent).toBe('Unlock Checkride Prep.')
    expect(document.getElementById('signupSub').textContent).toContain('one step')

    const order = Array.from(document.getElementById('signupViewContainer').children).map((el) => el.id)
    expect(order.indexOf('checkridePrepInstantBox')).toBeLessThan(order.indexOf('checkridePrepDivider'))
    expect(order.indexOf('checkridePrepDivider')).toBeLessThan(order.indexOf('signupForm'))
  })

  it('leaves the default free-first layout and copy untouched for a plain signup (no dest)', () => {
    setUrl('?view=signup')
    runPromotionBlock()

    expect(document.getElementById('signupHeadline').textContent).toBe('Join Apex Advantage.')

    const order = Array.from(document.getElementById('signupViewContainer').children).map((el) => el.id)
    expect(order).toEqual(['signupForm', 'loginNote', 'checkridePrepDivider', 'checkridePrepInstantBox'])
  })

  it('leaves the layout untouched for an unrelated dest value (e.g. a lead-magnet guide)', () => {
    setUrl('?view=signup&dest=dpe-questions')
    runPromotionBlock()

    expect(document.getElementById('signupHeadline').textContent).toBe('Join Apex Advantage.')
    const order = Array.from(document.getElementById('signupViewContainer').children).map((el) => el.id)
    expect(order).toEqual(['signupForm', 'loginNote', 'checkridePrepDivider', 'checkridePrepInstantBox'])
  })
})
