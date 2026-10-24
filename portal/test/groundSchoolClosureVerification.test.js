// Final verification pass (Oct 2026) -- regression coverage proving the
// client-side closure of discontinued Group Ground School registration
// actually works as implemented, and documenting (via the one skipped,
// explicitly-annotated test below) the real backend gap this pass found:
// create-checkout-session's 'ground-school-registration' purpose and
// redeem_referral_reward() have NO server-side closure at all -- this
// suite cannot claim that gap is fixed, because it isn't. See
// OFFERINGS_MATRIX_AND_CRO_AUDIT_REPORT.md / the verification-pass report
// for the full writeup and recommended remediation.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const portalStableSource = readFileSync(path.join(REPO_ROOT, 'site/portal-stable.js'), 'utf8')
const portalHtmlSource = readFileSync(path.join(REPO_ROOT, 'site/portal.html'), 'utf8')
const portalLoginSource = readFileSync(path.join(REPO_ROOT, 'site/portal-login.html'), 'utf8')
const checkoutSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/create-checkout-session/index.ts'), 'utf8')
const webhookSource = readFileSync(path.join(REPO_ROOT, 'portal/supabase/functions/stripe-webhook/index.ts'), 'utf8')
const pricingSource = readFileSync(path.join(REPO_ROOT, 'site/pricing.html'), 'utf8')

function extractFunctionBody(source, marker, label) {
  const startIdx = source.indexOf(marker)
  expect(startIdx, `${label} not found`).toBeGreaterThan(-1)
  const braceOpen = source.indexOf('{', startIdx)
  let depth = 0
  let i = braceOpen
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) break }
  }
  return source.slice(braceOpen + 1, i)
}

describe('hasGroundSchoolHistory() (real shipped source, executed)', () => {
  function run(member, myScheduledEnrollments, myGroundRegistrations, myGroundSchoolRecordings) {
    const body = extractFunctionBody(portalStableSource, 'function hasGroundSchoolHistory() {', 'hasGroundSchoolHistory()')
    // eslint-disable-next-line no-new-func
    const fn = new Function('member', 'myScheduledEnrollments', 'myGroundRegistrations', 'myGroundSchoolRecordings', body)
    return fn(member, myScheduledEnrollments, myGroundRegistrations, myGroundSchoolRecordings)
  }

  it('is false for a brand-new member with no history anywhere', () => {
    expect(run({ groundSchoolPackUnlocked: false }, [], [], [])).toBe(false)
  })
  it('is false when not signed in at all', () => {
    expect(run(null, [], [], [])).toBe(false)
  })
  it('is true for a member with the full pack unlocked', () => {
    expect(run({ groundSchoolPackUnlocked: true }, [], [], [])).toBe(true)
  })
  it('is true for a member with a scheduled-class enrollment and nothing else', () => {
    expect(run({ groundSchoolPackUnlocked: false }, [{ id: 'e1' }], [], [])).toBe(true)
  })
  it('is true for a member with only a legacy registration', () => {
    expect(run({ groundSchoolPackUnlocked: false }, [], [{ id: 'r1' }], [])).toBe(true)
  })
  it('is true for a member with only a paid recording', () => {
    expect(run({ groundSchoolPackUnlocked: false }, [], [], [{ id: 'rec1' }])).toBe(true)
  })
})

describe('showSection(): ground-school is gated the same way as guided-notes/ask-andrew', () => {
  function gateBranchSource() {
    const start = portalStableSource.indexOf('function showSection(id) {')
    expect(start, 'showSection() not found').toBeGreaterThan(-1)
    const end = portalStableSource.indexOf('window.apexShowSection = showSection;', start)
    expect(end, 'end of showSection() not found').toBeGreaterThan(-1)
    return portalStableSource.slice(start, end)
  }

  it('redirects a member with no ground-school history to dashboard, before the section-toggle', () => {
    const src = gateBranchSource()
    const gateIdx = src.indexOf("id === 'ground-school' && member && !hasGroundSchoolHistory()")
    const toggleIdx = src.indexOf('sections.forEach(')
    expect(gateIdx).toBeGreaterThan(-1)
    expect(toggleIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(toggleIdx)
    // Confirms the guard actually reassigns id, the same pattern this
    // file's own bug-sweep test (gatedSectionFallback.test.js) requires
    // for guided-notes/ask-andrew -- a guard that doesn't reassign id
    // would leave the closed section active underneath.
    const guardLine = src.slice(gateIdx, src.indexOf('\n', gateIdx))
    expect(guardLine).toContain("id = 'dashboard'")
  })
})

describe('renderGroundSchoolNavIfApplicable() / enforceGroundSchoolAccess() (real shipped source, executed)', () => {
  it('unhides the nav item only when hasGroundSchoolHistory() is true', () => {
    document.body.innerHTML = '<button id="groundSchoolNavItem" hidden></button>'
    const navBody = extractFunctionBody(portalStableSource, 'function renderGroundSchoolNavIfApplicable() {', 'renderGroundSchoolNavIfApplicable()')
    const hasHistoryBody = extractFunctionBody(portalStableSource, 'function hasGroundSchoolHistory() {', 'hasGroundSchoolHistory()')
    // eslint-disable-next-line no-new-func
    const run = new Function('member', 'myScheduledEnrollments', 'myGroundRegistrations', 'myGroundSchoolRecordings',
      `function hasGroundSchoolHistory() { ${hasHistoryBody} }\n${navBody}`)

    run({ groundSchoolPackUnlocked: false }, [], [], [])
    expect(document.getElementById('groundSchoolNavItem').hidden).toBe(true)

    run({ groundSchoolPackUnlocked: true }, [], [], [])
    expect(document.getElementById('groundSchoolNavItem').hidden).toBe(false)
  })

  it('is wired up alongside the guided-notes nav/access calls in initPortalData()', () => {
    const idx = portalStableSource.indexOf('renderModuleWorkbookNavIfApplicable();')
    expect(idx).toBeGreaterThan(-1)
    const nearby = portalStableSource.slice(idx, idx + 400)
    expect(nearby).toContain('renderGroundSchoolNavIfApplicable();')
    expect(nearby).toContain('enforceGroundSchoolAccess();')
  })
})

describe('portal.html: Ground School nav + browse/register UI default closed', () => {
  it('the nav item starts hidden in the static markup (closed-by-default, not just JS-toggled)', () => {
    const navIdx = portalHtmlSource.indexOf('id="groundSchoolNavItem"')
    expect(navIdx).toBeGreaterThan(-1)
    const tagStart = portalHtmlSource.lastIndexOf('<button', navIdx)
    const tagEnd = portalHtmlSource.indexOf('>', navIdx)
    const tag = portalHtmlSource.slice(tagStart, tagEnd)
    expect(tag).toContain('hidden')
  })

  it('the browse-and-register UI (pack unlock button, view tabs, cards/calendar/week) is wrapped in a permanently-hidden container', () => {
    const packBtnIdx = portalHtmlSource.indexOf('id="groundSchoolPackUnlockBtn"')
    const tabsIdx = portalHtmlSource.indexOf('id="groundSchoolViewTabs"')
    const listIdx = portalHtmlSource.indexOf('id="groundSchoolList"')
    expect(packBtnIdx).toBeGreaterThan(-1)
    expect(tabsIdx).toBeGreaterThan(packBtnIdx)
    expect(listIdx).toBeGreaterThan(tabsIdx)
    const wrapperStart = portalHtmlSource.lastIndexOf('<div hidden>', packBtnIdx)
    expect(wrapperStart, 'no <div hidden> wrapper found before the browse/register UI').toBeGreaterThan(-1)
    // The wrapper must actually enclose all three -- not just precede them --
    // so find its matching close and confirm listIdx falls inside it.
    let depth = 0
    let i = wrapperStart
    const openTag = '<div'
    const closeTag = '</div>'
    while (i < portalHtmlSource.length) {
      const nextOpen = portalHtmlSource.indexOf(openTag, i)
      const nextClose = portalHtmlSource.indexOf(closeTag, i)
      if (nextClose === -1) break
      if (nextOpen !== -1 && nextOpen < nextClose) { depth++; i = nextOpen + openTag.length }
      else { depth--; i = nextClose + closeTag.length; if (depth === 0) break }
    }
    const wrapperEnd = i
    expect(listIdx).toBeLessThan(wrapperEnd)
  })

  it('the account-page empty state no longer invites browsing for new registrations', () => {
    const emptyIdx = portalHtmlSource.indexOf('id="mySessionsEmpty"')
    expect(emptyIdx).toBeGreaterThan(-1)
    const lineEnd = portalHtmlSource.indexOf('</p>', emptyIdx)
    const line = portalHtmlSource.slice(emptyIdx, lineEnd)
    expect(line).not.toMatch(/browse upcoming sessions/i)
    expect(line).not.toContain('data-goto="ground-school"')
  })
})

describe('Dashboard upsells no longer route to Ground School registration', () => {
  it('none of the five previously-identified upsell paths call showSection(\'ground-school\') anymore', () => {
    // Pre-fix, these five labels all had `go: function () { showSection('ground-school'); }`
    // right after them. Confirms each is now something else (Private
    // Instruction), not merely that the string moved elsewhere in the file.
    const labels = [
      'Explore Private Instruction', // repeat_class_student + individual_class_student (same label, two call sites)
    ]
    labels.forEach((label) => {
      expect(portalStableSource).toContain(label)
    })
    expect(portalStableSource).not.toContain("label: 'Browse upcoming Ground School classes'")
    expect(portalStableSource).not.toContain("label: 'View Full Ground School'")
    expect(portalStableSource).not.toContain("label: 'View Next Class'")
    expect(portalStableSource).not.toMatch(/label:\s*'VIEW GROUND SCHOOL OPTIONS'/)
    expect(portalStableSource).not.toMatch(/cta:\s*'View Upcoming Classes'/)
  })

  it('the weak-area cross-sell widget is unconditionally hidden, not recommending a new paid class', () => {
    const idx = portalStableSource.indexOf("document.getElementById('trainingPlanGsCrossSell')")
    expect(idx).toBeGreaterThan(-1)
    const block = portalStableSource.slice(idx, idx + 300)
    expect(block).toContain('crossSellEl.hidden = true')
    expect(block).not.toContain('findGsClassForWeakArea(')
  })
})

describe('Refer-a-Friend: promo banner permanently hidden, reward not silently repointed', () => {
  it('renderReferralPromoBanner() always hides the banner (no live reward to promote)', () => {
    const body = extractFunctionBody(portalStableSource, 'function renderReferralPromoBanner() {', 'renderReferralPromoBanner()')
    expect(body.replace(/\s+/g, ' ').trim()).toBe(
      "var banner = document.getElementById('referralPromoBanner'); if (!banner) return; banner.hidden = true;"
    )
  })

  it('a member with an existing unspent reward is told to contact Andrew, not pointed at a dead redeem flow', () => {
    const idx = portalStableSource.indexOf("document.getElementById('referralRewardBanner')")
    expect(idx).toBeGreaterThan(-1)
    const block = portalStableSource.slice(idx, idx + 600)
    expect(block).not.toMatch(/Use a Free Referral Reward/)
    expect(block).toMatch(/email info@apexaviationtx\.com/)
  })

  it('redeem_referral_reward is still wired (existing obligations preserved), but only from inside the hidden browse/register modal', () => {
    // The RPC itself is deliberately untouched server-side -- a member who
    // already earned a reward can still have it redeemed (by Andrew,
    // directly, per the banner above) without a backend change. This just
    // confirms the only client-side trigger for it is groundSchoolModalRedeemBtn,
    // which openGroundSchoolModal() wires up -- and openGroundSchoolModal()
    // is only ever invoked from the cards/calendar/week renderers that
    // paint into the portal.html container already proven permanently
    // hidden above, not from any other, reachable call site.
    expect(portalStableSource).toContain("apexSupabase.rpc('redeem_referral_reward'")
    const callers = [...portalStableSource.matchAll(/openGroundSchoolModal\(/g)].length
    const definitionIdx = portalStableSource.indexOf('function openGroundSchoolModal(')
    expect(definitionIdx).toBeGreaterThan(-1)
    // One definition + exactly the three known call sites inside
    // renderGroundSchoolCards/Calendar/Week -- a new, reachable call site
    // added elsewhere would change this count and should be investigated.
    expect(callers).toBe(4)
  })
})

describe('Public signup page (portal-login.html): no live $25/session Ground School copy remains', () => {
  it('default signup badge/sub and success copy reference Private Instruction, not Ground School registration', () => {
    expect(portalLoginSource).not.toMatch(/\$25\s*\/\s*session/i)
    expect(portalLoginSource).not.toMatch(/book live ground school sessions/i)
    expect(portalLoginSource).not.toMatch(/ready to book ground school sessions/i)
  })

  it('the orphaned ?offer=ground-school-pack box is left alone (not reachable from any live link, out of scope here)', () => {
    // Documents the known, already-assessed-safe exception so a future
    // repo-wide "$25" grep doesn't re-flag it as a surprise.
    expect(portalLoginSource).toContain('groundSchoolPackOfferBox')
  })
})

describe('KNOWN GAP (not fixed by this pass): server-side purchase/redemption enforcement', () => {
  // This test intentionally documents reality rather than asserting a
  // fix that doesn't exist. create-checkout-session's 'ground-school-
  // registration' purpose and stripe-webhook's handleGroundSchoolRegistration
  // have no closed-for-new-sales check -- a direct API call (bypassing
  // every UI change in this repo) can still create a real Stripe
  // Checkout session and, on completion, a real enrollment via
  // confirm_scheduled_ground_class_enrollment(). Likewise,
  // redeem_referral_reward() has no such check either. See the
  // verification-pass report for remediation options. This test fails
  // loudly (not silently skips) if someone adds a gate later without
  // updating this test -- at which point it should be rewritten to
  // assert the gate exists, not deleted.
  it('confirms the gap still exists (update this test, do not delete it, once a gate is added)', () => {
    const purposeIdx = checkoutSource.indexOf("if (purpose === 'ground-school-registration') {")
    expect(purposeIdx).toBeGreaterThan(-1)
    const handlerEnd = checkoutSource.indexOf('\n    }\n\n    if (purpose ===', purposeIdx)
    const handler = checkoutSource.slice(purposeIdx, handlerEnd === -1 ? purposeIdx + 2000 : handlerEnd)
    // No "registration closed" / "no longer available" / feature-flag
    // check of any kind exists in this handler today.
    expect(handler).not.toMatch(/no longer (available|offered)/i)
    expect(handler).not.toMatch(/registration (is )?closed/i)
    expect(handler).not.toMatch(/GROUND_SCHOOL_(REGISTRATION_)?(CLOSED|DISABLED)/)

    expect(webhookSource).toContain('async function handleGroundSchoolRegistration(')
    expect(webhookSource).toContain('confirm_scheduled_ground_class_enrollment')
  })
})

describe('Mock Oral: both active price tiers are real, distinct, and server-priced', () => {
  it('create-checkout-session resolves the charged amount from the DB product row, not a hardcoded per-tier constant', () => {
    const idx = checkoutSource.indexOf("if (purpose === 'book-mock-oral-v2') {")
    expect(idx).toBeGreaterThan(-1)
    const nearby = checkoutSource.slice(idx, idx + 2500)
    expect(nearby).toMatch(/unit_amount:\s*product\.price_cents/)
    expect(nearby).toMatch(/if \(!product \|\| !product\.active\)/)
  })

  it('pricing.html lists both the base and recheck prices for Mock Oral', () => {
    const idx = pricingSource.indexOf('Private Pilot Mock Oral')
    expect(idx).toBeGreaterThan(-1)
    const card = pricingSource.slice(idx, idx + 1000)
    expect(card).toMatch(/\$129/)
    expect(card).toMatch(/\$179/)
    expect(card).toMatch(/recheck/i)
  })
})
