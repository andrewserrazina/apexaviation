// Checkride Prep Personalized Pitch A/B test -- regression coverage for
// the deterministic bucketing (experimentVariant()), the treatment copy
// (checkridePrepPersonalizedCopy()), and openUnlockModal()'s wiring of
// both into the existing eligibility gate, plus the experiment-metadata
// tagging on checkride_prep_offer_viewed/checkout_started/checkout_
// session_create_failed/purchase_completed. site/portal-stable.js is a
// huge browser IIFE that expects a full portal.html DOM (same reasoning
// as staticPortalAuth.test.js/checkoutObservability.test.js), so the two
// pure helper functions are extracted and REALLY EXECUTED via
// new Function() (giving real behavioral coverage, not just a text
// match), while the wiring inside openUnlockModal()/the CTA click
// handler is verified via static-source assertions, matching this
// repo's established convention for this file.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(path.join(REPO_ROOT, 'site/portal-stable.js'), 'utf8')
const analyticsEventsSource = readFileSync(path.join(REPO_ROOT, 'site/analytics-events.js'), 'utf8')

function findMatchingBrace(str, openIdx) {
  let depth = 0
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '{') depth++
    else if (str[i] === '}') { depth--; if (depth === 0) return i }
  }
  throw new Error('No matching closing brace found')
}

function extractFunction(marker) {
  const start = source.indexOf(marker)
  expect(start, `${marker} not found`).toBeGreaterThan(-1)
  const braceOpen = source.indexOf('{', start)
  const braceClose = findMatchingBrace(source, braceOpen)
  const fnSrc = source.slice(start, braceClose + 1)
  // eslint-disable-next-line no-new-func
  return new Function('return (' + fnSrc + ')')()
}

const experimentVariant = extractFunction('function experimentVariant(experimentKey, subjectId) {')
const checkridePrepPersonalizedCopy = extractFunction('function checkridePrepPersonalizedCopy(effectiveContext, weakLabels) {')

const EXPERIMENT_KEY = 'checkride_prep_personalized_pitch_v1'

describe('experimentVariant(): deterministic 50/50 bucketing (Section: Assignment)', () => {
  it('is a pure function -- the SAME (key, id) always returns the SAME variant, called repeatedly', () => {
    const id = 'c3333333-3333-3333-3333-333333333333'
    const results = new Set()
    for (let i = 0; i < 50; i++) results.add(experimentVariant(EXPERIMENT_KEY, id))
    expect(results.size).toBe(1)
    expect(['control', 'personalized']).toContain([...results][0])
  })

  it('returns null for a missing/falsy subject id -- never buckets an anonymous or not-yet-loaded member', () => {
    expect(experimentVariant(EXPERIMENT_KEY, null)).toBeNull()
    expect(experimentVariant(EXPERIMENT_KEY, undefined)).toBeNull()
    expect(experimentVariant(EXPERIMENT_KEY, '')).toBeNull()
  })

  it('matches known golden values for two fixed profile ids (catches an accidental change to the hash algorithm itself)', () => {
    expect(experimentVariant(EXPERIMENT_KEY, 'a1111111-1111-1111-1111-111111111111')).toBe('personalized')
    expect(experimentVariant(EXPERIMENT_KEY, 'b2222222-2222-2222-2222-222222222222')).toBe('control')
  })

  it('distributes roughly 50/50 across a large population of distinct ids (never a fixed constant, never all-one-bucket)', () => {
    const counts = { control: 0, personalized: 0 }
    for (let i = 0; i < 5000; i++) {
      const id = 'uuid-' + i + '-' + Math.random().toString(36).slice(2)
      counts[experimentVariant(EXPERIMENT_KEY, id)]++
    }
    const personalizedShare = counts.personalized / (counts.control + counts.personalized)
    expect(personalizedShare).toBeGreaterThan(0.45)
    expect(personalizedShare).toBeLessThan(0.55)
  })

  it('a different experiment key can bucket the same subject id differently -- salted per-experiment, not one global coin flip', () => {
    let differs = 0
    for (let i = 0; i < 200; i++) {
      const id = 'uuid-' + i
      if (experimentVariant('other_experiment_v1', id) !== experimentVariant(EXPERIMENT_KEY, id)) differs++
    }
    expect(differs).toBeGreaterThan(0)
  })
})

describe('checkridePrepPersonalizedCopy(): treatment copy guardrails (Section: Treatment variant / guardrails)', () => {
  it('below the 80% high-readiness threshold, uses gaps-focused framing and names the real weak areas', () => {
    const copy = checkridePrepPersonalizedCopy({ score: 62, band: 'Significant Review Recommended' }, ['Airspace', 'Weather'])
    expect(copy.summary).toContain('Airspace and Weather')
    expect(copy.heading.toLowerCase()).not.toContain('sharp')
  })

  it('at or above 80%, uses a "stay sharp"/consistency framing, never a gaps/fixing framing', () => {
    const copy = checkridePrepPersonalizedCopy({ score: 92, band: 'Strong Readiness' }, ['Airspace', 'Weather'])
    expect(copy.heading).toContain('Consistent')
    expect(copy.summary.toLowerCase()).toContain('scoring well')
  })

  it('exactly at the 80 boundary uses the high-readiness framing (>= 80, not > 80)', () => {
    const copy = checkridePrepPersonalizedCopy({ score: 80, band: 'Nearly Ready' }, ['Weather'])
    expect(copy.heading).toContain('Consistent')
  })

  it('never fabricates a category -- only ever echoes back exactly the labels it was given', () => {
    const copy = checkridePrepPersonalizedCopy({ score: 55, band: 'Foundation Needs Work' }, ['Airworthiness'])
    expect(copy.summary).toContain('Airworthiness')
    expect(copy.summary).not.toMatch(/weather|airspace|navigation/i)
  })

  it('never implies failure, guarantees success, or manufactures fear, in either framing', () => {
    const lowCopy = checkridePrepPersonalizedCopy({ score: 40, band: 'Foundation Needs Work' }, ['Airspace'])
    const highCopy = checkridePrepPersonalizedCopy({ score: 95, band: 'Strong Readiness' }, ['Airspace'])
    for (const copy of [lowCopy, highCopy]) {
      const text = (copy.heading + ' ' + copy.summary + ' ' + copy.ctaLabel).toLowerCase()
      expect(text).not.toMatch(/fail|unprepared|not ready|guarantee|pass your checkride|will pass/i)
    }
  })
})

describe('openUnlockModal(): experiment wiring preserves the control experience exactly (Section: Control variant)', () => {
  function modalBody() {
    const marker = 'function openUnlockModal(readinessContext) {'
    const start = source.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const braceOpen = start + marker.length - 1
    const braceClose = findMatchingBrace(source, braceOpen)
    return source.slice(braceOpen + 1, braceClose)
  }

  it('pitchVariant is only computed when isEligible -- an ineligible member is never bucketed at all', () => {
    const body = modalBody()
    const idx = body.indexOf('var pitchVariant = isEligible ? experimentVariant(')
    expect(idx).toBeGreaterThan(-1)
  })

  it('the control/ineligible branch renders the exact unchanged generic copy -- never "improved" during the experiment', () => {
    const body = modalBody()
    const elseIdx = body.indexOf('} else {')
    expect(elseIdx).toBeGreaterThan(-1)
    const controlBlock = body.slice(elseIdx)
    expect(controlBlock).toContain("headingEl.textContent = 'Unlock the Checkride Prep System';")
    expect(controlBlock).toContain("unlockModalCtaLabel = 'Unlock Now';")
    expect(controlBlock).toContain('ctxEl.hidden = true;')
  })

  it('the personalized branch is gated on pitchVariant === \'personalized\', not just eligibility', () => {
    const body = modalBody()
    expect(body).toContain("if (pitchVariant === 'personalized') {")
  })

  it('checkride_prep_offer_viewed only carries experiment/variant when pitchVariant is truthy', () => {
    const body = modalBody()
    const idx = body.indexOf("apexTrack('checkride_prep_offer_viewed'")
    expect(idx).toBeGreaterThan(-1)
    const block = body.slice(idx, idx + 400)
    expect(block).toContain('pitchVariant ? { experiment: CHECKRIDE_PREP_PITCH_EXPERIMENT, variant: pitchVariant } : {}')
  })

  it('readiness_checkride_prep_offer_viewed (personalized branch) also carries the experiment tag', () => {
    const body = modalBody()
    const idx = body.indexOf("apexTrack('readiness_checkride_prep_offer_viewed'")
    expect(idx).toBeGreaterThan(-1)
    const block = body.slice(idx, idx + 400)
    expect(block).toContain('experiment: CHECKRIDE_PREP_PITCH_EXPERIMENT')
    expect(block).toContain('variant: pitchVariant')
  })

  it('activeUnlockModalVariant is set from pitchVariant so the later CTA click can read it', () => {
    const body = modalBody()
    expect(body).toContain('activeUnlockModalVariant = pitchVariant;')
  })
})

describe('unlockModalCta click handler: checkout_started/checkout_session_create_failed carry the experiment tag (Section: Experiment metadata)', () => {
  function ctaHandlerBody() {
    const marker = "unlockModalCta.addEventListener('click', function () {"
    const start = source.indexOf(marker)
    expect(start).toBeGreaterThan(-1)
    const braceOpen = start + marker.length - 1
    const braceClose = findMatchingBrace(source, braceOpen)
    return source.slice(braceOpen + 1, braceClose)
  }

  it('builds expTag from activeUnlockModalVariant before firing checkout_started', () => {
    const body = ctaHandlerBody()
    const expTagIdx = body.indexOf('var expTag = activeUnlockModalVariant ?')
    const checkoutStartedIdx = body.indexOf("apexTrack('checkout_started'")
    expect(expTagIdx).toBeGreaterThan(-1)
    expect(checkoutStartedIdx).toBeGreaterThan(-1)
    expect(expTagIdx).toBeLessThan(checkoutStartedIdx)
    expect(body.slice(checkoutStartedIdx, checkoutStartedIdx + 200)).toContain('expTag')
  })

  it('both checkout_session_create_failed call sites (error response and network throw) also merge expTag', () => {
    const body = ctaHandlerBody()
    const occurrences = body.split("apexTrack('checkout_session_create_failed'").length - 1
    expect(occurrences).toBe(2)
    let idx = -1
    for (let i = 0; i < occurrences; i++) {
      idx = body.indexOf("apexTrack('checkout_session_create_failed'", idx + 1)
      expect(body.slice(idx, idx + 200)).toContain('expTag')
    }
  })
})

describe('purchase_completed (?unlocked=1 return trip): best-effort experiment tagging (Section: secondary question)', () => {
  it('resolveCheckridePrepPitchExperimentTag() is called before firing purchase_completed, and dedupe is claimed first', () => {
    const marker = 'var funnelDedupeKey = sessionId ?'
    const idx = source.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const block = source.slice(idx, idx + 700)
    const dedupeSetIdx = block.indexOf("localStorage.setItem(funnelDedupeKey, '1')")
    const resolveIdx = block.indexOf('resolveCheckridePrepPitchExperimentTag()')
    const trackIdx = block.indexOf("apexTrack('purchase_completed'")
    expect(dedupeSetIdx).toBeGreaterThan(-1)
    expect(resolveIdx).toBeGreaterThan(dedupeSetIdx)
    expect(trackIdx).toBeGreaterThan(resolveIdx)
  })

  it('resolveCheckridePrepPitchExperimentTag() only tags a profile that actually has usable readiness context', () => {
    const marker = 'function resolveCheckridePrepPitchExperimentTag() {'
    const idx = source.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    const braceOpen = idx + marker.length - 1
    const braceClose = findMatchingBrace(source, braceOpen)
    const body = source.slice(braceOpen + 1, braceClose)
    expect(body).toContain('hasUsableContext')
    expect(body).toContain("if (!hasUsableContext) return null")
  })
})

describe('cross-file consistency: no duplicate event names were created for this experiment', () => {
  it('EVENT_ALLOWLIST is unchanged by this experiment -- no new event name like "*_experiment*" or "*_variant*" was added', () => {
    const suspicious = analyticsEventsSource.match(/'[a-z_]*(experiment|variant)[a-z_]*'/gi) || []
    // The only mentions should be inside the explanatory comment this
    // experiment added, never as a quoted string inside EVENT_ALLOWLIST's
    // array itself.
    expect(suspicious.length).toBe(0)
  })

  it('documents the experiment/variant properties next to EVENT_ALLOWLIST for future readers', () => {
    expect(analyticsEventsSource).toContain('checkride_prep_personalized_pitch_v1')
  })
})
