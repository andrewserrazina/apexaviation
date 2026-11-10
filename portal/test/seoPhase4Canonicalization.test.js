// Phase 4: extensionless canonical URLs are now the permanent standard
// (apexaviationtx.com/flight-training-taylor, not .../flight-training-taylor.html).
// Legacy .html URLs keep resolving -- Cloudflare Pages' own clean-URL
// behavior 308-redirects them to the extensionless form -- but every
// indexable page now DECLARES the extensionless form as canonical, and
// every internal reference (links, sitemap, structured data) was updated
// to match, so nothing points at a URL that itself has to redirect.
//
// Scope deliberately excludes the 15 noindex/app pages (portal*, auth,
// giveaway-funnel download pages, 404, etc.): they are not part of the
// indexable SEO surface, their query-string app routing is untouched by
// design, and their own canonical/og tags (where present) were left alone.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SITE_DIR = path.join(REPO_ROOT, 'site')

function read(relPath) {
  return readFileSync(path.join(SITE_DIR, relPath), 'utf8')
}

const NOINDEX_FILES = new Set([
  '404.html', 'apex-advantage-private-pilot.html', 'blog-post.html',
  'checkride-guide-download.html', 'checkride-guide-web.html',
  'checkride-prep-download.html', 'coming-soon.html', 'email-preferences.html',
  'free-checkride-guide.html', 'landing.html', 'mobile-auth-redirect.html',
  'portal-login.html', 'portal-reset-password.html', 'portal-signup-success.html',
  'portal.html',
])

const allHtmlFiles = readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'))
const publicFiles = allHtmlFiles.filter((f) => !NOINDEX_FILES.has(f)).sort()
const publicSlugs = new Set(publicFiles.map((f) => f.replace(/\.html$/, '')))

function slugOf(file) {
  return file.replace(/\.html$/, '')
}

describe('Phase 4: every indexable page declares an extensionless canonical', () => {
  for (const file of publicFiles) {
    const slug = slugOf(file)
    const expected = slug === 'index' ? 'https://apexaviationtx.com/' : `https://apexaviationtx.com/${slug}`

    it(`${file} has exactly one canonical link, matching https://apexaviationtx.com/${slug === 'index' ? '' : slug}`, () => {
      const html = read(file)
      const matches = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)]
      expect(matches.length).toBe(1)
      expect(matches[0][1]).toBe(expected)
      expect(matches[0][1]).not.toMatch(/\.html$/)
    })
  }
})

describe('Phase 4: every indexable page declares a matching og:url', () => {
  for (const file of publicFiles) {
    const slug = slugOf(file)
    const expected = slug === 'index' ? 'https://apexaviationtx.com/' : `https://apexaviationtx.com/${slug}`

    it(`${file} has exactly one og:url, matching its canonical`, () => {
      const html = read(file)
      const matches = [...html.matchAll(/property="og:url" content="([^"]+)"/g)]
      expect(matches.length).toBe(1)
      expect(matches[0][1]).toBe(expected)
    })
  }
})

describe('Phase 4: no canonical or og:url points at a redirect source', () => {
  // Nothing an indexable page declares as canonical should itself appear as
  // a redirect *source* in _redirects -- that would mean the canonical URL
  // 30x's somewhere else instead of serving 200 directly.
  const redirects = read('_redirects')
  const redirectSources = [...redirects.matchAll(/^\/(\S+)\s+\S+\s+30[128]/gm)].map((m) => m[1])

  for (const file of publicFiles) {
    const slug = slugOf(file)
    if (slug === 'index') continue // index.html -> / is an intentional, pre-existing redirect; canonical is "/", not "/index"
    it(`${file}'s canonical slug is not a redirect source`, () => {
      expect(redirectSources).not.toContain(slug)
      expect(redirectSources).not.toContain(`${slug}.html`)
    })
  }
})

describe('Phase 4: JSON-LD url/@id fields never reference a public page with .html', () => {
  for (const file of allHtmlFiles) {
    it(`${file} has no JSON-LD "url" or "@id" field pointing at a public page's .html URL`, () => {
      const html = read(file)
      const offenders = [...html.matchAll(/"(?:url|@id)":\s*"https:\/\/apexaviationtx\.com\/([a-zA-Z0-9-]+)\.html(#[^"]*)?"/g)]
        .map((m) => m[1])
        .filter((slug) => publicSlugs.has(slug))
      expect(offenders).toEqual([])
    })
  }
})

describe('Phase 4: the shared person/organization identifiers stay internally consistent', () => {
  it('every "about#andrew-serrazina" @id reference is extensionless and identical', () => {
    const ids = new Set()
    for (const file of allHtmlFiles) {
      const html = read(file)
      for (const m of html.matchAll(/"@id":\s*"(https:\/\/apexaviationtx\.com\/about[^"]*andrew-serrazina)"/g)) {
        ids.add(m[1])
      }
    }
    expect([...ids]).toEqual(['https://apexaviationtx.com/about#andrew-serrazina'])
  })

  it('the shared #organization @id is untouched (fragment-only, no .html)', () => {
    for (const file of allHtmlFiles) {
      const html = read(file)
      if (html.includes('#organization')) {
        expect(html).toContain('"@id": "https://apexaviationtx.com/#organization"')
      }
    }
  })
})

describe('Phase 4: internal links to public pages never use .html', () => {
  for (const file of allHtmlFiles) {
    it(`${file} has no href="<public-slug>.html" (relative, absolute, or root-relative)`, () => {
      const html = read(file)
      const offenders = []
      for (const m of html.matchAll(/href="(?:https:\/\/apexaviationtx\.com\/|\/)?([a-zA-Z0-9-]+)\.html(?:[?#][^"]*)?"/g)) {
        if (publicSlugs.has(m[1])) offenders.push(m[0])
      }
      expect(offenders).toEqual([])
    })
  }
})

describe('Phase 4: internal links to public pages resolve to a real file', () => {
  for (const file of allHtmlFiles) {
    it(`${file}'s extensionless internal links all resolve`, () => {
      const html = read(file)
      const missing = []
      for (const m of html.matchAll(/href="(?:https:\/\/apexaviationtx\.com\/)?([a-zA-Z0-9-]+)(?:[?#][^"]*)?"/g)) {
        const slug = m[1]
        if (!publicSlugs.has(slug)) continue // not a page we rewrote -- not in scope here
        if (!existsSync(path.join(SITE_DIR, `${slug}.html`))) missing.push(slug)
      }
      expect(missing).toEqual([])
    })
  }
})

describe('Phase 4: noindex/app pages are untouched by the canonicalization', () => {
  it('portal-login.html query-string routing links are still .html (app routing, out of scope)', () => {
    const html = read('readiness-assessment.html')
    expect(html).toMatch(/portal-login\.html\?/)
  })

  it('no noindex file was given a self-referencing extensionless canonical by this phase', () => {
    // Noindex pages are out of scope for the canonicalization rewrite. Some
    // (e.g. apex-advantage-private-pilot.html) pre-existingly canonicalize to
    // a different, surviving page -- untouched and out of scope here. What we
    // guard against is Phase 4 having "fixed" a noindex page's OWN .html
    // self-reference the way it did for the 65 public pages.
    for (const file of NOINDEX_FILES) {
      const filePath = path.join(SITE_DIR, file)
      if (!existsSync(filePath)) continue
      const html = readFileSync(filePath, 'utf8')
      const match = html.match(/<link rel="canonical" href="([^"]+)"/)
      if (!match) continue
      const selfExtensionless = `https://apexaviationtx.com/${slugOf(file)}`
      const selfHtml = `https://apexaviationtx.com/${file}`
      if (match[1] === selfHtml) continue // untouched self-reference, as expected
      expect(match[1]).not.toBe(selfExtensionless)
    }
  })
})

describe('Phase 4: sitemap.xml is extensionless, deduplicated, and free of noindex/retired entries', () => {
  const sitemap = read('sitemap.xml')
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

  it('has no duplicate entries', () => {
    const seen = new Set()
    const dupes = []
    for (const loc of locs) {
      if (seen.has(loc)) dupes.push(loc)
      seen.add(loc)
    }
    expect(dupes).toEqual([])
  })

  it('has no .html entries (except none -- all extensionless)', () => {
    const htmlLocs = locs.filter((l) => l.endsWith('.html'))
    expect(htmlLocs).toEqual([])
  })

  it('has no entry for any noindex page', () => {
    const offenders = locs.filter((l) => {
      const rel = l.replace('https://apexaviationtx.com/', '')
      return NOINDEX_FILES.has(`${rel}.html`) || NOINDEX_FILES.has(rel)
    })
    expect(offenders).toEqual([])
  })

  it('every entry resolves directly to an existing file (200, not via a redirect)', () => {
    const redirects = read('_redirects')
    const redirectSources = new Set([...redirects.matchAll(/^\/(\S+)\s+\S+\s+30[128]/gm)].map((m) => m[1]))
    const missing = []
    const viaRedirect = []
    for (const loc of locs) {
      if (loc === 'https://apexaviationtx.com/') continue
      const rel = loc.replace('https://apexaviationtx.com/', '')
      if (!existsSync(path.join(SITE_DIR, `${rel}.html`))) missing.push(loc)
      if (redirectSources.has(rel) || redirectSources.has(`${rel}.html`)) viaRedirect.push(loc)
    }
    expect(missing).toEqual([])
    expect(viaRedirect).toEqual([])
  })

  it('includes every public page exactly once', () => {
    for (const file of publicFiles) {
      const slug = slugOf(file)
      const expected = slug === 'index' ? 'https://apexaviationtx.com/' : `https://apexaviationtx.com/${slug}`
      expect(locs.filter((l) => l === expected).length).toBe(1)
    }
  })
})

describe('Phase 4: no regression to analytics, lead capture, or noindex directives', () => {
  it('GA4 tag is still present on the homepage and a representative inner page', () => {
    expect(read('index.html')).toMatch(/googletagmanager\.com\/gtag\/js\?id=G-/)
    expect(read('contact.html')).toMatch(/googletagmanager\.com\/gtag\/js\?id=G-/)
  })

  it('the Taylor lead form is still wired to Formspree + CRM capture (untouched by the href rewrite)', () => {
    const html = read('flight-training-taylor.html')
    expect(html).toContain('id="taylorForm"')
    expect(html).toContain('submitToFormspree(taylorForm')
    expect(html).toContain('captureWaitlistLead(taylorForm)')
  })

  it('the noindex set is exactly unchanged from Phase 3', () => {
    const actual = allHtmlFiles
      .filter((f) => /name="robots"\s+content="noindex/.test(read(f)))
      .sort()
    expect(actual).toEqual([...NOINDEX_FILES].sort())
  })
})
