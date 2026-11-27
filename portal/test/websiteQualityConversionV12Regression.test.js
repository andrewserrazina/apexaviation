// Website Quality & Conversion v1.2 sprint — regression guards for the
// high-confidence fixes implemented this pass. Deliberately avoids asserting
// on brittle marketing copy strings; checks target structure/behavior that
// would silently regress on a future content edit (landmarks, pixel init,
// FAQ ARIA wiring, CTA destinations, terminology, image dimensions).
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SITE_DIR = path.join(REPO_ROOT, 'site')

function read(relPath) {
  return readFileSync(path.join(SITE_DIR, relPath), 'utf8')
}

// Pages that are deliberately not part of the indexable SEO/landmark surface:
// retired/deprecated stubs kept only for historical redirects, plus the
// client-rendered portal.html app shell (its landmark structure is owned by
// the React app, not static markup) and giveaway rules page covered below.
const RETIRED_STUBS = new Set([
  'apex-advantage-private-pilot.html', 'blog-post.html', 'checkride-guide-web.html',
  'checkride-prep-download.html', 'coming-soon.html', 'free-checkride-guide.html',
  'landing.html',
])
const NOT_LANDMARK_CHECKED = new Set([...RETIRED_STUBS, 'portal.html'])

const allHtmlFiles = readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'))
const landmarkCheckedFiles = allHtmlFiles.filter((f) => !NOT_LANDMARK_CHECKED.has(f)).sort()

describe('v1.2: every real page has exactly one <main id="main-content">...</main>', () => {
  for (const file of landmarkCheckedFiles) {
    it(`${file} has a unique main landmark`, () => {
      const html = read(file)
      const idMatches = html.match(/id="main-content"/g) || []
      const openMatches = html.match(/<main[\s>]/g) || []
      const closeMatches = html.match(/<\/main>/g) || []
      expect(idMatches.length).toBe(1)
      expect(openMatches.length).toBe(1)
      expect(closeMatches.length).toBe(1)
    })
  }
})

// Pages with a real header/nav to skip past need a visible-on-focus skip
// link targeting #main-content; bare auth/redirect/rules pages with no nav
// (no header before <main>) are intentionally exempt.
describe('v1.2: pages with a header have a working skip link', () => {
  for (const file of landmarkCheckedFiles) {
    const html = read(file)
    const hasHeaderBeforeMain = /<header[\s\S]*?<main/.test(html)
    if (!hasHeaderBeforeMain) continue
    it(`${file} has a skip link pointing at #main-content`, () => {
      expect(html).toMatch(/<a href="#main-content" class="skip-link">/)
    })
  }
})

describe('v1.2: Meta Pixel parity across the three live paid-product pages', () => {
  const pages = [
    'apex-advantage-mock-oral.html',
    'apex-advantage-private-instruction.html',
    'checkride-prep.html',
  ]
  for (const file of pages) {
    it(`${file} initializes the Meta Pixel exactly once`, () => {
      const html = read(file)
      const initMatches = html.match(/fbq\(\s*'init'\s*,\s*'1049117198055794'\s*\)/g) || []
      expect(initMatches.length).toBe(1)
      expect(html).toMatch(/fbq\(\s*'track'\s*,\s*'PageView'\s*\)/)
    })
  }
})

describe('v1.2: checkride-prep FAQ accordion exposes aria-expanded state', () => {
  const html = read('checkride-prep.html')
  const questionButtons = [...html.matchAll(/<button class="faq-item__question"[^>]*>/g)]

  it('found the 12 FAQ question buttons', () => {
    expect(questionButtons.length).toBe(12)
  })

  it('every FAQ button declares aria-expanded and aria-controls, each pointing at a real answer panel', () => {
    for (const [tag] of questionButtons) {
      expect(tag).toMatch(/aria-expanded="false"/)
      const controls = tag.match(/aria-controls="([^"]+)"/)
      expect(controls).not.toBeNull()
      const panelId = controls[1]
      expect(html).toContain(`<div class="faq-item__answer" id="${panelId}"`)
    }
  })

  it('the accordion script toggles aria-expanded alongside the open class', () => {
    const scriptSection = html.slice(html.indexOf('faq-item__question'))
    expect(scriptSection).toMatch(/setAttribute\(\s*['"]aria-expanded['"]/)
  })
})

describe('v1.2: pricing page CTAs resolve to real internal pages, not mailto', () => {
  const html = read('pricing.html')
  it('the "Book a Virtual Session" CTA links to the private instruction page', () => {
    expect(html).toMatch(/<a href="apex-advantage-private-instruction" class="btn btn--primary">Book a Virtual Session<\/a>/)
  })
  it('no primary/outline CTA on the page uses a mailto: link', () => {
    const ctaMailtos = [...html.matchAll(/<a href="mailto:[^"]*" class="btn[^"]*"/g)]
    expect(ctaMailtos.length).toBe(0)
  })
})

describe('v1.2: "waitlist" terminology is standardized sitewide', () => {
  for (const file of allHtmlFiles) {
    it(`${file} does not say "interest list"`, () => {
      const html = read(file)
      expect(html.toLowerCase()).not.toMatch(/interest list/)
    })
  }
})

describe('v1.2: homepage Services section no longer duplicates the Flight Training Paths grid', () => {
  const html = read('index.html')
  it('the Flight Training Paths grid still offers all three certificates', () => {
    const grid = html.slice(html.indexOf('id="training"'), html.indexOf('id="services"'))
    expect(grid).toContain('Private Pilot')
    expect(grid).toContain('Instrument Rating')
    expect(grid).toContain('Commercial Pilot')
  })
  it('the Services section does not re-list a redundant "Flight Training" certificate card', () => {
    const services = html.slice(html.indexOf('id="services"'), html.indexOf('id="approach"'))
    expect(services).not.toMatch(/<h3>Flight Training<\/h3>/)
  })
  it('the Services section still keeps exactly one primary and one secondary CTA', () => {
    const services = html.slice(html.indexOf('id="services"'), html.indexOf('id="approach"'))
    expect((services.match(/btn--primary/g) || []).length).toBe(1)
    expect((services.match(/btn--ghost|btn--outline/g) || []).length).toBeGreaterThanOrEqual(1)
  })
})

describe('v1.2: resized shared images keep their aspect ratio contract with existing markup', () => {
  // andrew-hero.jpg / andrew-instructor.jpg were resized but every referencing
  // page's declared width/height attributes were deliberately left unchanged
  // (480x600 and 440x440 source files match the 360x450 / 220x220 markup
  // aspect ratio exactly), so this guards against a future asset swap that
  // breaks that assumption and introduces layout shift.
  function dims(relAssetPath) {
    const buf = readFileSync(path.join(SITE_DIR, relAssetPath))
    // JPEG SOF0 marker scan for width/height
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buf.readUInt16BE(i + 5)
        const width = buf.readUInt16BE(i + 7)
        return { width, height }
      }
      const len = buf.readUInt16BE(i + 2)
      i += 2 + len
    }
    throw new Error(`no SOF marker found in ${relAssetPath}`)
  }

  it('andrew-hero.jpg aspect ratio matches the 360x450 markup used sitewide', () => {
    const { width, height } = dims('assets/images/mock-oral/andrew-hero.jpg')
    expect(Math.abs(width / height - 360 / 450)).toBeLessThan(0.01)
  })

  it('andrew-instructor.jpg aspect ratio matches the 220x220 markup used sitewide', () => {
    const { width, height } = dims('assets/images/mock-oral/andrew-instructor.jpg')
    expect(Math.abs(width / height - 220 / 220)).toBeLessThan(0.01)
  })
})
