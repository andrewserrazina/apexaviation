// Growth analytics finding (Oct 2026) -- regression coverage for the
// portal.html dashboard's consolidated "secondary metrics" locked-widget
// group (streak/weak-areas/pilot-rank folded into one unlock prompt --
// upgrade_prompt_viewed/clicked data showed each converting under 1.5%
// individually vs readiness's 7.6%). That group wraps THREE
// .portal-locked-widget__content blocks under a single [data-locked-widget]
// card with one shared overlay, which applyUnlockState() (site/portal-
// stable.js) previously could not handle correctly -- it used
// card.querySelector('.portal-locked-widget__content') (singular), so only
// the FIRST widget in a multi-widget group ever got blurred/unblurred; the
// other two would silently stay in whatever state they rendered in. Fixed
// to querySelectorAll + forEach.
//
// site/portal-stable.js is a classic non-module browser script with no
// build tooling of its own -- same approach as staticPortalAuth.test.js:
// extract the ACTUAL function body out of the real shipped file and
// execute it, so this tests the exact code that ships.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const STATIC_PORTAL_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../site/portal-stable.js'
)
const fullSource = readFileSync(STATIC_PORTAL_JS, 'utf8')

function extractApplyUnlockState() {
  const marker = 'function applyUnlockState()'
  const startIdx = fullSource.indexOf(marker)
  if (startIdx === -1) {
    throw new Error('applyUnlockState() not found in site/portal-stable.js -- it may have moved or been reworded; update this test to match.')
  }
  const braceOpen = fullSource.indexOf('{', startIdx)
  let depth = 0
  let i = braceOpen
  for (; i < fullSource.length; i++) {
    if (fullSource[i] === '{') depth++
    else if (fullSource[i] === '}') { depth--; if (depth === 0) break }
  }
  return fullSource.slice(braceOpen + 1, i)
}

// The real function closes over a module-level `member` variable rather
// than taking it as a parameter -- supplied here as an actual parameter
// instead, which resolves identically for every reference inside the body.
function runApplyUnlockState(member) {
  const body = extractApplyUnlockState()
  // eslint-disable-next-line no-new-func
  const fn = new Function('member', body)
  fn(member)
}

function buildDashboardDom() {
  document.body.innerHTML = `
    <div class="portal-card portal-locked-widget" data-locked-widget data-widget="readiness">
      <div class="portal-locked-widget__content" id="readinessContent"></div>
      <div class="portal-locked-widget__overlay" data-unlock-trigger id="readinessOverlay" style="display:none"></div>
    </div>
    <div class="portal-locked-widget-group portal-locked-widget" data-locked-widget data-widget="secondary-metrics">
      <div class="portal-locked-widget-group__grid">
        <div class="portal-card"><div class="portal-locked-widget__content" id="streakContent"></div></div>
        <div class="portal-card"><div class="portal-locked-widget__content" id="weakAreasContent"></div></div>
        <div class="portal-card"><div class="portal-locked-widget__content" id="pilotRankContent"></div></div>
      </div>
      <div class="portal-locked-widget__overlay" data-unlock-trigger id="groupOverlay" style="display:none"></div>
    </div>
  `
}

describe('portal-stable.js applyUnlockState() (real shipped source)', () => {
  it('blurs and locks every widget in the consolidated group, not just the first, for a free member', () => {
    buildDashboardDom()
    runApplyUnlockState({ checkridePrepUnlocked: false })

    ;['streakContent', 'weakAreasContent', 'pilotRankContent'].forEach((id) => {
      const el = document.getElementById(id)
      expect(el.style.filter).not.toBe('none')
      expect(el.style.pointerEvents).toBe('none')
    })
    expect(document.getElementById('groupOverlay').style.display).toBe('flex')

    // The standalone readiness widget is unaffected by the group fix.
    expect(document.getElementById('readinessContent').style.pointerEvents).toBe('none')
    expect(document.getElementById('readinessOverlay').style.display).toBe('flex')
  })

  it('unblurs and unlocks every widget in the group for an unlocked member', () => {
    buildDashboardDom()
    runApplyUnlockState({ checkridePrepUnlocked: true })

    ;['streakContent', 'weakAreasContent', 'pilotRankContent'].forEach((id) => {
      const el = document.getElementById(id)
      expect(el.style.filter).toBe('none')
      expect(el.style.pointerEvents).toBe('auto')
    })
    expect(document.getElementById('groupOverlay').style.display).toBe('none')
  })

  it('handles a null member (logged out / not yet loaded) the same as locked', () => {
    buildDashboardDom()
    runApplyUnlockState(null)

    expect(document.getElementById('streakContent').style.pointerEvents).toBe('none')
    expect(document.getElementById('groupOverlay').style.display).toBe('flex')
  })
})
