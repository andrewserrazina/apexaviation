// City-page SEO consolidation (flight-training-*.html + service-areas.html):
// covers the specific regressions this pass fixed -- a retired doorway page
// left live, present-tense "Apex Aviation offers/brings..." claims
// contradicting the planned-T74/March-2027 status, a fabricated LocalBusiness
// postalCode pointing at the wrong city, and broken internal links/sitemap
// entries after the Hutto/Taylor consolidation. Static source-text sweep,
// same convention as the rest of this suite -- these are plain HTML files,
// not modules to import.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SITE_DIR = path.join(REPO_ROOT, 'site')

const cityPageFiles = readdirSync(SITE_DIR)
  .filter((f) => /^flight-training-.*\.html$/.test(f))
  .sort()

function read(relPath) {
  return readFileSync(path.join(SITE_DIR, relPath), 'utf8')
}

function extractJsonLd(html) {
  const blocks = []
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
  let m
  while ((m = re.exec(html))) {
    blocks.push(JSON.parse(m[1]))
  }
  return blocks
}

describe('city pages: retired flight-training-hutto-taylor.html', () => {
  it('no longer exists as a file', () => {
    expect(existsSync(path.join(SITE_DIR, 'flight-training-hutto-taylor.html'))).toBe(false)
  })

  it('301-redirects to the consolidated Taylor page, not a redirect chain', () => {
    const redirects = read('_redirects')
    const match = redirects.match(/^\/flight-training-hutto-taylor\.html\s+(\S+)\s+301/m)
    expect(match).toBeTruthy()
    // Phase 3 live validation found the .html target itself then
    // 308-redirected to the extensionless form (a 301 -> 308 -> 200 chain).
    // Repointed directly at the extensionless destination so this is a
    // single-hop 301, per the rule name ("not a redirect chain").
    expect(match[1]).toBe('/flight-training-taylor')
  })

  it('is removed from sitemap.xml', () => {
    const sitemap = read('sitemap.xml')
    expect(sitemap).not.toContain('flight-training-hutto-taylor.html')
  })

  it('has no remaining internal links anywhere on the site', () => {
    const offenders = []
    for (const f of readdirSync(SITE_DIR)) {
      if (!f.endsWith('.html') && f !== '_redirects') continue
      if (f === '_redirects') continue
      const html = read(f)
      if (html.includes('flight-training-hutto-taylor.html')) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})

describe('city pages: no unsupported present-tense "already operating" claims', () => {
  // The business is virtual-only today; in-person training at T74 is planned,
  // not live. These verbs previously appeared in body copy asserting Apex
  // "already" brings/offers/closes/fills/changes/gives real-aircraft training,
  // directly contradicting the same page's own conditional hero copy.
  const bannedPattern = /Apex Aviation (offers|brings|closes|fills|changes|gives) /

  for (const file of cityPageFiles) {
    it(`${file} does not assert present-tense in-person training availability`, () => {
      const html = read(file)
      expect(html).not.toMatch(bannedPattern)
    })
  }
})

describe('city pages: JSON-LD structured data', () => {
  for (const file of cityPageFiles) {
    it(`${file} has valid, parseable JSON-LD`, () => {
      expect(() => extractJsonLd(read(file))).not.toThrow()
    })

    it(`${file} does not fabricate the San Marcos ZIP (78666) as an Austin address`, () => {
      const html = read(file)
      expect(html).not.toContain('"postalCode": "78666"')
    })

    it(`${file} does not claim a confirmed opening date or aggregate rating`, () => {
      const blocks = extractJsonLd(read(file))
      for (const block of blocks) {
        expect(block).not.toHaveProperty('aggregateRating')
        expect(block).not.toHaveProperty('openingHoursSpecification')
      }
    })
  }
})

describe('city pages: title/canonical consistency', () => {
  for (const file of cityPageFiles) {
    it(`${file} has exactly one <title> and one canonical link matching its own extensionless URL`, () => {
      const html = read(file)
      const titles = html.match(/<title>/g) || []
      expect(titles.length).toBe(1)

      const canonicalMatch = html.match(/<link rel="canonical" href="([^"]+)"/)
      expect(canonicalMatch).toBeTruthy()
      // Phase 4: extensionless URLs are the permanent canonical standard --
      // .html still resolves (via the platform's own redirect), but is no
      // longer what pages declare as canonical.
      expect(canonicalMatch[1]).toBe(`https://apexaviationtx.com/${file.replace(/\.html$/, '')}`)
    })

    it(`${file} has exactly one <h1>`, () => {
      const html = read(file)
      const h1s = html.match(/<h1[ >]/g) || []
      expect(h1s.length).toBe(1)
    })
  }
})

describe('city pages: Hutto page does not imply an Apex location in Hutto', () => {
  const html = read('flight-training-hutto.html')

  it('title reflects "near Hutto", not "in/for Hutto" as an operating location', () => {
    expect(html).toMatch(/<title>Flight Training Near Hutto, TX/)
  })

  it('explicitly states Apex has no training location in Hutto', () => {
    expect(html).toMatch(/doesn't have a training location in Hutto|no training location in Hutto/)
  })
})

describe('city pages: Georgetown page distinguishes KGTU from the proposed T74 site', () => {
  const html = read('flight-training-georgetown.html')

  it('names Taylor Municipal Airport (T74) as the actual proposed site', () => {
    expect(html).toContain('Taylor Municipal Airport (T74)')
  })

  it('explicitly disclaims any Apex connection to KGTU', () => {
    expect(html).toMatch(/not based at KGTU|no connection to that airport|Apex has no connection to that airport/)
  })
})

describe('city pages: Taylor is the primary resource and carries the rich lead form', () => {
  const html = read('flight-training-taylor.html')

  it('has the interest-list form wired to the shared Formspree + CRM capture helpers', () => {
    expect(html).toContain('id="taylorForm"')
    expect(html).toContain('submitToFormspree(taylorForm')
    expect(html).toContain('captureWaitlistLead(taylorForm)')
  })

  it('does not stand up a second, parallel lead-capture system', () => {
    // Same Formspree-backed contact__form + captureWaitlistLead pattern used
    // sitewide -- not a bespoke endpoint for this one page.
    expect(html).toContain('class="contact__form"')
  })

  it('mentions the planned Part 61 / Sporty\'s ground-school model', () => {
    expect(html).toContain('Part 61')
    expect(html).toContain("Sporty's")
  })
})

describe('sitemap.xml: entries for touched city pages resolve to real files', () => {
  // Phase 4: sitemap entries are extensionless (the canonical standard);
  // the underlying files on disk are still named flight-training-*.html.
  const sitemap = read('sitemap.xml')
  const locSlugs = [...sitemap.matchAll(/<loc>https:\/\/apexaviationtx\.com\/(flight-training-[^<]+)<\/loc>/g)]
    .map((m) => m[1])

  it('lists at least the known city pages', () => {
    expect(locSlugs.length).toBeGreaterThanOrEqual(cityPageFiles.length)
  })

  for (const file of cityPageFiles) {
    const slug = file.replace(/\.html$/, '')
    it(`sitemap.xml includes ${slug} (extensionless) exactly once`, () => {
      expect(locSlugs.filter((l) => l === slug).length).toBe(1)
    })
  }

  it('every <loc> flight-training-* entry corresponds to an existing file', () => {
    const missing = locSlugs.filter((slug) => !existsSync(path.join(SITE_DIR, `${slug}.html`)))
    expect(missing).toEqual([])
  })
})

describe('service-areas.html: links and structured data point at real, correct pages', () => {
  const html = read('service-areas.html')

  it('Hutto and Taylor pills/breadcrumbs point at their own distinct pages, not a shared URL', () => {
    const huttoLinks = [...html.matchAll(/"name":\s*"Hutto, TX",\s*"url":\s*"([^"]+)"/g)].map((m) => m[1])
    const taylorLinks = [...html.matchAll(/"name":\s*"Taylor, TX",\s*"url":\s*"([^"]+)"/g)].map((m) => m[1])
    // Phase 4: extensionless is the canonical standard.
    expect(huttoLinks).toEqual(['https://apexaviationtx.com/flight-training-hutto'])
    expect(taylorLinks).toEqual(['https://apexaviationtx.com/flight-training-taylor'])
  })

  it('references no page that no longer exists', () => {
    const hrefs = [...html.matchAll(/href="(flight-training-[^"]+)"/g)].map((m) => m[1])
    const missing = hrefs.filter((slug) => !existsSync(path.join(SITE_DIR, `${slug}.html`)))
    expect(missing).toEqual([])
  })
})
