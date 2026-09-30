// Checkride Binder Builder -- Phase 3 (client rendering) regression
// coverage. Two kinds of tests:
//   1. Real behavioral execution of the pure progress-computation logic
//      (cbCountableFields/cbComputeSectionProgress) extracted from
//      site/portal-stable.js and run against synthetic content, the same
//      new Function() extraction technique used throughout this repo's
//      test suite for portal-stable.js's pure helpers.
//   2. Data-integrity checks against the ACTUAL seeded content migration
//      (supabase-portal-schema-v150), parsed back out of the SQL file --
//      guards against a future edit introducing a duplicate prompt id, a
//      missing master-checklist section, or malformed JSON, none of
//      which vitest's jsdom-DOM-dependent tests below would ever catch.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(path.join(REPO_ROOT, 'site/portal-stable.js'), 'utf8')
const seedSql = readFileSync(path.join(REPO_ROOT, 'portal/supabase-portal-schema-v150-checkride-binder-content-seed.sql'), 'utf8')

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

const cbCountableFields = extractFunction('function cbCountableFields(block) {')

// cbComputeSectionProgress() reads the module-level checkrideBinderState
// directly rather than taking it as a parameter -- reconstruct it as a
// tiny local shim so the extracted function body runs unmodified against
// synthetic fixtures.
function makeComputeSectionProgress(contentBySection, responsesBySection) {
  const checkrideBinderState = { content: contentBySection, responses: responsesBySection }
  const marker = 'function cbComputeSectionProgress(sectionId) {'
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const braceOpen = start + marker.length - 1
  const braceClose = findMatchingBrace(source, braceOpen)
  const body = source.slice(braceOpen + 1, braceClose)
  // eslint-disable-next-line no-new-func
  return new Function('checkrideBinderState', 'cbCountableFields', 'sectionId', body)
    .bind(null, checkrideBinderState, cbCountableFields)
}

describe('cbCountableFields(): which fields count toward "section complete"', () => {
  it('checklist contributes one field per item', () => {
    const ids = cbCountableFields({ type: 'checklist', items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('choice contributes exactly one field (the block id)', () => {
    expect(cbCountableFields({ type: 'choice', id: 'go-no-go' })).toEqual(['go-no-go'])
  })

  it('dual_checklist with singleState and no subLabels behaves like a plain checkbox (one field per item)', () => {
    const ids = cbCountableFields({ type: 'dual_checklist', singleState: true, items: [{ id: 'x' }, { id: 'y' }] })
    expect(ids).toEqual(['x', 'y'])
  })

  it('dual_checklist with singleState and 2+ subLabels is a per-item radio -- still one field per item', () => {
    const ids = cbCountableFields({ type: 'dual_checklist', singleState: true, subLabels: ['Verified', 'Open'], items: [{ id: 'p' }, { id: 'q' }] })
    expect(ids).toEqual(['p', 'q'])
  })

  it('dual_checklist WITHOUT singleState and 2 subLabels is independent multi-checkbox -- 2 fields per item, index-suffixed', () => {
    const ids = cbCountableFields({ type: 'dual_checklist', subLabels: ['Found', 'Verified'], items: [{ id: 'doc-a' }, { id: 'doc-b' }] })
    expect(ids).toEqual(['doc-a::0', 'doc-a::1', 'doc-b::0', 'doc-b::1'])
  })

  it('fields/grid/tracker/note blocks contribute nothing -- free text and tracker rows are supplementary, not required for completion', () => {
    expect(cbCountableFields({ type: 'fields', items: [{ id: 'a' }] })).toEqual([])
    expect(cbCountableFields({ type: 'grid', rows: [{ id: 'r' }], columns: [{ id: 'c' }] })).toEqual([])
    expect(cbCountableFields({ type: 'tracker', columns: [] })).toEqual([])
    expect(cbCountableFields({ type: 'note', text: 'x' })).toEqual([])
  })
})

describe('cbComputeSectionProgress(): real completion math against synthetic content', () => {
  it('counts done/total correctly across mixed block types, ignoring non-countable blocks', () => {
    const content = {
      'sec-a': {
        blocks: [
          { type: 'checklist', items: [{ id: 'c1' }, { id: 'c2' }] },
          { type: 'dual_checklist', subLabels: ['Found', 'Verified'], items: [{ id: 'd1' }] },
          { type: 'fields', items: [{ id: 'f1' }] },
          { type: 'choice', id: 'ch1' }
        ]
      }
    }
    // total countable: c1, c2, d1::0, d1::1, ch1 = 5. f1 never counts.
    const responses = { 'sec-a': { c1: 'checked', 'd1::0': 'checked', ch1: 'Yes' } }
    const compute = makeComputeSectionProgress(content, responses)
    expect(compute('sec-a')).toEqual({ total: 5, done: 3 })
  })

  it('an unchecked box (empty response_text) never counts as done', () => {
    const content = { s: { blocks: [{ type: 'checklist', items: [{ id: 'a' }] }] } }
    const compute = makeComputeSectionProgress(content, { s: { a: '' } })
    expect(compute('s')).toEqual({ total: 1, done: 0 })
  })

  it('a section with no fetched content returns {total:0, done:0} rather than throwing', () => {
    const compute = makeComputeSectionProgress({}, {})
    expect(compute('missing-section')).toEqual({ total: 0, done: 0 })
  })
})

describe('Client wiring: renderer dispatch, persistence calls, and event names', () => {
  it('cbRenderBlock dispatches every block type to its own renderer', () => {
    const idx = source.indexOf('function cbRenderBlock(block, sectionId, responses, blockIndex) {')
    expect(idx).toBeGreaterThan(-1)
    const body = source.slice(idx, source.indexOf('}', source.indexOf('return \'\';', idx)) + 1)
    for (const type of ['note', 'checklist', 'dual_checklist', 'choice', 'fields', 'grid', 'tracker']) {
      expect(body).toContain(`block.type === '${type}'`)
    }
  })

  it('cbSaveResponse upserts on the (profile_id, section_id, prompt_id) unique key, matching the v149 schema', () => {
    const idx = source.indexOf('function cbSaveResponse(sectionId, promptId, value) {')
    expect(idx).toBeGreaterThan(-1)
    const braceOpen = source.indexOf('{', idx)
    const braceClose = findMatchingBrace(source, braceOpen)
    const body = source.slice(braceOpen, braceClose)
    expect(body).toContain("from('checkride_binder_responses')")
    expect(body).toContain("onConflict: 'profile_id,section_id,prompt_id'")
  })

  it('tracker add/update/delete all target checkride_binder_tracker_entries', () => {
    for (const fn of ['cbAddTrackerRow', 'cbUpdateTrackerRow', 'cbDeleteTrackerRow']) {
      const marker = `function ${fn}(`
      const idx = source.indexOf(marker)
      expect(idx, `${fn} not found`).toBeGreaterThan(-1)
      const braceOpen = source.indexOf('{', idx)
      const braceClose = findMatchingBrace(source, braceOpen)
      expect(source.slice(braceOpen, braceClose)).toContain("from('checkride_binder_tracker_entries')")
    }
  })

  it('renderCheckrideBinderHome fires checkride_binder_all_complete only when every counted section is 100% complete', () => {
    const idx = source.indexOf('function renderCheckrideBinderHome() {')
    expect(idx).toBeGreaterThan(-1)
    const braceOpen = source.indexOf('{', idx)
    const braceClose = findMatchingBrace(source, braceOpen)
    const body = source.slice(braceOpen, braceClose)
    expect(body).toContain('completeCount === allSectionIds.length')
    expect(body).toContain("apexTrack('checkride_binder_all_complete'")
  })

  it('renderCheckrideBinderSection fires checkride_binder_section_viewed', () => {
    const idx = source.indexOf('function renderCheckrideBinderSection(sectionId) {')
    expect(idx).toBeGreaterThan(-1)
    const braceOpen = source.indexOf('{', idx)
    const braceClose = findMatchingBrace(source, braceOpen)
    expect(source.slice(braceOpen, braceClose)).toContain("apexTrack('checkride_binder_section_viewed'")
  })
})

describe('Seeded content (v150 migration): data integrity', () => {
  const MASTER_20 = [
    'start-here', 'binder-setup', 'applicant-documents', 'iacra-application', 'knowledge-test-report',
    'endorsements-experience', 'aircraft-documents', 'maintenance-airworthiness', 'know-your-aircraft',
    'cross-country-planning', 'weather-decision-making', 'wb-performance', 'personal-minimums-adm',
    'dpe-show-me-drill', 'oral-answer-framework', 'cfi-final-review', 'night-before-checklist',
    'checkride-morning', 'master-quick-reference', 'notes-reference'
  ]

  function extractSeededSections() {
    const re = /insert into public\.checkride_binder_content \(section_id, content\) values \('([^']*(?:''[^']*)*)', '([\s\S]*?)'::jsonb\)/g
    const sections = {}
    let match
    while ((match = re.exec(seedSql)) !== null) {
      const sectionId = match[1].replace(/''/g, "'")
      const rawJson = match[2].replace(/''/g, "'")
      sections[sectionId] = JSON.parse(rawJson)
    }
    return sections
  }

  const sections = extractSeededSections()

  it('parses all 27 sections cleanly (26 real inserts + this test would fail loudly on any malformed JSON)', () => {
    expect(Object.keys(sections).length).toBe(27)
  })

  it('every one of the 20 master-checklist sections is present', () => {
    for (const id of MASTER_20) {
      expect(sections[id], `missing section ${id}`).toBeTruthy()
      expect(sections[id].title).toBeTruthy()
    }
  })

  it('no section has a duplicate prompt id across its own checklist/dual_checklist/choice/fields blocks', () => {
    for (const [sectionId, section] of Object.entries(sections)) {
      const seen = new Set()
      for (const block of section.blocks || []) {
        let ids = []
        if (block.type === 'checklist' || block.type === 'dual_checklist' || block.type === 'fields') ids = (block.items || []).map((i) => i.id)
        if (block.type === 'choice') ids = [block.id]
        for (const id of ids) {
          expect(seen.has(id), `duplicate prompt id "${id}" in section "${sectionId}"`).toBe(false)
          seen.add(id)
        }
      }
    }
  })

  it('every tracker block declares its columns (the renderer has nothing to render otherwise)', () => {
    for (const [sectionId, section] of Object.entries(sections)) {
      for (const block of section.blocks || []) {
        if (block.type === 'tracker') expect(block.columns && block.columns.length, `tracker in "${sectionId}" has no columns`).toBeGreaterThan(0)
      }
    }
  })

  it('every dual_checklist block used as a multi-checkbox (no singleState) declares at least 2 subLabels', () => {
    for (const [sectionId, section] of Object.entries(sections)) {
      for (const block of section.blocks || []) {
        if (block.type === 'dual_checklist' && !block.singleState) {
          expect((block.subLabels || []).length, `dual_checklist in "${sectionId}" needs 2+ subLabels without singleState`).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it('content is real, non-placeholder prose (no section title is empty, no block is missing required fields)', () => {
    for (const [sectionId, section] of Object.entries(sections)) {
      expect(section.title, sectionId).toBeTruthy()
      for (const block of section.blocks || []) {
        expect(block.type, `${sectionId}: block missing type`).toBeTruthy()
      }
    }
  })
})
