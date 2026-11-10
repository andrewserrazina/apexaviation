// Phase 2 local-SEO content pass: the five priority pages (Taylor, Hutto,
// Georgetown, Round Rock, Pflugerville) were deepened with real airport
// research, location-specific FAQs, and distinct CFI-perspective
// educational angles -- specifically to avoid Round Rock/Pflugerville
// becoming "the Hutto page with a different city name." These checks
// guard the regressions that would be easiest to reintroduce by accident:
// duplicated content across pages, a reverted factual correction, or a
// present-tense claim creeping back into new copy. Static source-text
// sweep, same convention as the rest of this suite.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SITE_DIR = path.join(REPO_ROOT, 'site')

const PRIORITY_PAGES = [
  'flight-training-taylor.html',
  'flight-training-hutto.html',
  'flight-training-georgetown.html',
  'flight-training-round-rock.html',
  'flight-training-pflugerville.html',
]

function read(relPath) {
  return readFileSync(path.join(SITE_DIR, relPath), 'utf8')
}

describe('Phase 2: the five priority pages are not clones of one another', () => {
  it('each has a distinct meta description', () => {
    const descriptions = PRIORITY_PAGES.map((f) => {
      const html = read(f)
      return html.match(/<meta name="description" content="([^"]+)"/)[1]
    })
    expect(new Set(descriptions).size).toBe(PRIORITY_PAGES.length)
  })

  it('each has at least one FAQ item, and the FAQ questions are not identical across pages', () => {
    const allQuestionSets = PRIORITY_PAGES.map((f) => {
      const html = read(f)
      const questions = [...html.matchAll(/<button class="faq-item__question">\s*([^<\n][^\n]*)/g)]
        .map((m) => m[1].trim())
      expect(questions.length).toBeGreaterThan(0)
      return questions.join('|')
    })
    expect(new Set(allQuestionSets).size).toBe(PRIORITY_PAGES.length)
  })

  it('Round Rock and Pflugerville do not reuse Hutto\'s "no training location" framing verbatim', () => {
    const hutto = read('flight-training-hutto.html')
    const roundRock = read('flight-training-round-rock.html')
    const pflugerville = read('flight-training-pflugerville.html')
    const huttoFramingLine = "Apex Aviation doesn't have a training location in Hutto"
    expect(hutto).toContain(huttoFramingLine)
    expect(roundRock).not.toContain(huttoFramingLine)
    expect(pflugerville).not.toContain(huttoFramingLine)
  })
})

describe('Phase 2: no present-tense "already operating" claims in the new content', () => {
  const bannedPattern = /Apex Aviation (offers|brings|closes|fills|changes|gives) /
  for (const file of PRIORITY_PAGES) {
    it(`${file} still does not assert present-tense in-person training availability`, () => {
      expect(read(file)).not.toMatch(bannedPattern)
    })
  }
})

describe('Phase 2: Georgetown Municipal Airport (KGTU) runway-count correction', () => {
  const html = read('flight-training-georgetown.html')

  it('no longer describes KGTU as a single-runway field (it has two: 18/36 and 11/29)', () => {
    expect(html).not.toMatch(/busy single-runway field/i)
  })

  it('still explicitly disclaims any Apex connection to KGTU', () => {
    expect(html).toMatch(/not based at KGTU|no connection to that airport|no base, lease, or operating connection to KGTU/)
  })
})

describe('Phase 2: Pflugerville explicitly disclaims any Apex connection to KEDC', () => {
  const html = read('flight-training-pflugerville.html')

  it('names Austin Executive Airport (KEDC) as a real nearby airport', () => {
    expect(html).toContain('Austin Executive Airport (KEDC)')
  })

  it('explicitly states Apex has no base/lease/connection to KEDC', () => {
    expect(html).toMatch(/no base, lease, or operating connection to KEDC|no base, lease, hangar, or any operating connection to KEDC/)
  })

  it('links to the existing Class C airspace guide instead of duplicating it', () => {
    expect(html).toContain('blog-flying-austin-class-c-airspace-guide.html')
  })
})

describe('Phase 2: Round Rock is framed around its commuter/no-local-airport reality', () => {
  const html = read('flight-training-round-rock.html')

  it('states Round Rock has no public-use general aviation airport of its own (narrowly, not an unverifiable absolute)', () => {
    expect(html).toMatch(/no public-use (general aviation )?airport of its own/)
  })

  it('acknowledges the nearby private hospital heliport rather than ignoring it', () => {
    expect(html).toMatch(/heliport/i)
  })

  it('does not fabricate a specific drive-time in minutes to a named airport', () => {
    expect(html).not.toMatch(/\d+\s*minutes? from (Austin Executive|Georgetown Municipal|KEDC|KGTU|KAUS)/i)
  })
})

describe('Phase 2: Taylor page states what remains unconfirmed', () => {
  const html = read('flight-training-taylor.html')

  it('has an explicit "what remains unconfirmed" section', () => {
    expect(html).toMatch(/What Remains Unconfirmed/)
  })

  it('cites verifiable T74 airport facts (runway, CTAF, AWOS) rather than vague geography', () => {
    expect(html).toContain('122.8')
    expect(html).toMatch(/17\/35/)
  })
})

describe('Phase 2: Related Resources sections link to real, existing pages', () => {
  for (const file of PRIORITY_PAGES) {
    it(`${file}'s internal links all resolve to existing files`, () => {
      const html = read(file)
      const hrefs = [...html.matchAll(/href="([a-zA-Z0-9_-]+\.html)[^"]*"/g)].map((m) => m[1])
      const missing = hrefs.filter((f) => !existsSync(path.join(SITE_DIR, f)))
      expect(missing).toEqual([])
    })
  }
})

describe('Phase 2: editorial standard document exists and covers the required topics', () => {
  const docPath = path.join(REPO_ROOT, 'docs/CITY_PAGE_EDITORIAL_STANDARD.md')

  it('is committed to the repo', () => {
    expect(existsSync(docPath)).toBe(true)
  })

  it('covers every required topic area', () => {
    const doc = readFileSync(docPath, 'utf8')
    const requiredTopics = [
      'Purpose', 'Geographic accuracy', 'research', 'originality',
      'Service availability', 'SEO structure', 'Internal linking',
      'Conversion CTAs', 'Trust signals', 'doorway',
    ]
    for (const topic of requiredTopics) {
      expect(doc.toLowerCase()).toContain(topic.toLowerCase())
    }
  })
})
