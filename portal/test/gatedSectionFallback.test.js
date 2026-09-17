// Bug sweep: a locked member deep-linking straight to a GATED_SECTIONS
// hash (portal.html#dpe-library, a bookmark or shared link) triggered
// showSection()'s gate branch, which opened the unlock modal and
// returned -- but never reassigned which section had the .active class,
// so the empty gated section stayed visible underneath/behind the modal
// once it was dismissed. Fixed by falling through to 'dashboard' just
// like the guided-notes/ask-andrew guards immediately below it already
// do, instead of returning early.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const portalStableSource = readFileSync(path.join(REPO_ROOT, 'site/portal-stable.js'), 'utf8')

describe('showSection(): gated-section deep link falls through to dashboard', () => {
  function gateBranchSource() {
    const start = portalStableSource.indexOf('function showSection(id) {')
    expect(start, 'showSection() not found').toBeGreaterThan(-1)
    const end = portalStableSource.indexOf('window.apexShowSection = showSection;', start)
    expect(end, 'end of showSection() not found').toBeGreaterThan(-1)
    return portalStableSource.slice(start, end)
  }

  it('reassigns id to dashboard on gate-deny instead of returning early', () => {
    const src = gateBranchSource()
    const gateIdx = src.indexOf('GATED_SECTIONS.indexOf(id) !== -1')
    expect(gateIdx).toBeGreaterThan(-1)
    const gateBlockEnd = src.indexOf('\n    }', gateIdx)
    const gateBlock = src.slice(gateIdx, gateBlockEnd)

    expect(gateBlock).toContain("id = 'dashboard'")
    expect(gateBlock).not.toMatch(/\breturn;/)
  })

  it('still closes the sidebar and opens the unlock modal on gate-deny', () => {
    const src = gateBranchSource()
    const gateIdx = src.indexOf('GATED_SECTIONS.indexOf(id) !== -1')
    const gateBlockEnd = src.indexOf('\n    }', gateIdx)
    const gateBlock = src.slice(gateIdx, gateBlockEnd)

    expect(gateBlock).toContain('closeSidebar();')
    expect(gateBlock).toContain('openUnlockModal();')
  })

  it('the dashboard fallback reaches the same section-toggle logic as guided-notes/ask-andrew', () => {
    const src = gateBranchSource()
    // Every guard that redirects to dashboard must resolve before the
    // single sections.forEach() toggle -- otherwise a gated id could
    // still end up marked .active.
    const toggleIdx = src.indexOf('sections.forEach(')
    const gateIdx = src.indexOf('GATED_SECTIONS.indexOf(id) !== -1')
    const guidedNotesIdx = src.indexOf("id === 'guided-notes'")
    const askAndrewIdx = src.indexOf("id === 'ask-andrew'")
    expect(toggleIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeLessThan(toggleIdx)
    expect(guidedNotesIdx).toBeLessThan(toggleIdx)
    expect(askAndrewIdx).toBeLessThan(toggleIdx)
  })
})
