// SEO Phase 3 technical audit: guards the specific defects this phase found
// and fixed (or deliberately deferred). These are static source-text checks,
// same convention as the rest of this suite -- they verify repository state,
// not live production HTTP behavior, which can't be reproduced in this test
// environment. See docs/SEO_PHASE3_TECHNICAL_AUDIT.md for the live curl
// commands that verify the actual production behavior these tests can't.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SITE_DIR = path.join(REPO_ROOT, 'site')

function read(relPath) {
  return readFileSync(path.join(SITE_DIR, relPath), 'utf8')
}

const allHtmlFiles = readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'))

describe('Phase 3: the 143 retired ground-school pages stay retired', () => {
  it('no ground-school-*.html files exist in site/', () => {
    const matches = allHtmlFiles.filter((f) => /^ground-school-.*\.html$/.test(f))
    expect(matches).toEqual([])
  })

  it('sitemap.xml has no ground-school entries', () => {
    const sitemap = read('sitemap.xml')
    expect(sitemap).not.toContain('ground-school')
  })

  it('no page links to a ground-school-*.html URL', () => {
    const offenders = []
    for (const f of allHtmlFiles) {
      if (/href="ground-school-[a-z0-9-]+\.html"/.test(read(f))) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})

describe('Phase 3: ground-school redirect rule, collapsed to one wildcard', () => {
  const redirects = read('_redirects')

  it('has exactly one /ground-school-* redirect rule, not 143 individual ones', () => {
    const matches = redirects.match(/^\/ground-school-\S*\s+\S+\s+301/gm) || []
    expect(matches.length).toBe(1)
    expect(matches[0]).toMatch(/^\/ground-school-\*/)
  })

  it('the wildcard rule targets the real consolidated page', () => {
    const match = redirects.match(/^\/ground-school-\*\s+(\S+)\s+301/m)
    expect(match).toBeTruthy()
    expect(match[1]).toBe('/apex-advantage-private-instruction.html')
  })

  it('the retired Hutto/Taylor redirect from Phase 1 is still present and unchanged', () => {
    expect(redirects).toMatch(/^\/flight-training-hutto-taylor\.html\s+\/flight-training-taylor\.html\s+301/m)
  })

  it('still ends with the 404 catch-all as the last rule', () => {
    const lines = redirects.trim().split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
    expect(lines[lines.length - 1]).toMatch(/^\/\*\s+\/404\.html\s+404/)
  })
})

describe('Phase 3: no page declares more than one canonical tag', () => {
  for (const f of allHtmlFiles) {
    it(`${f} has at most one <link rel="canonical">`, () => {
      const count = (read(f).match(/rel="canonical"/g) || []).length
      expect(count).toBeLessThanOrEqual(1)
    })
  }
})

describe('Phase 3: noindex is applied only to the known, legitimate set of pages', () => {
  // This exact set matches GSC's reported "Excluded by noindex tag: 15"
  // (see docs/SEO_PHASE3_TECHNICAL_AUDIT.md Section 4). If this test starts
  // failing because a new file was added to or removed from the set, that's
  // expected -- update the list deliberately, don't just loosen the check.
  const expectedNoindexFiles = [
    '404.html', 'apex-advantage-private-pilot.html', 'blog-post.html',
    'checkride-guide-download.html', 'checkride-guide-web.html',
    'checkride-prep-download.html', 'coming-soon.html', 'email-preferences.html',
    'free-checkride-guide.html', 'landing.html', 'mobile-auth-redirect.html',
    'portal-login.html', 'portal-reset-password.html', 'portal-signup-success.html',
    'portal.html',
  ].sort()

  it('exactly this set of files carries a noindex directive', () => {
    const actual = allHtmlFiles
      .filter((f) => /name="robots"\s+content="noindex/.test(read(f)))
      .sort()
    expect(actual).toEqual(expectedNoindexFiles)
  })

  it('no flight-training-*.html city page is noindexed', () => {
    const cityPages = allHtmlFiles.filter((f) => /^flight-training-.*\.html$/.test(f))
    const noindexed = cityPages.filter((f) => /name="robots"\s+content="noindex/.test(read(f)))
    expect(noindexed).toEqual([])
  })

  it('the nationwide consolidation page is not noindexed', () => {
    expect(read('apex-advantage-private-instruction.html')).not.toMatch(/name="robots"\s+content="noindex/)
  })
})

describe('Phase 3: nationwide consolidation page accurately states virtual-only availability', () => {
  const html = read('apex-advantage-private-instruction.html')

  it('explicitly states the service is available nationwide and held online', () => {
    expect(html).toMatch(/held entirely online|available to students anywhere/i)
  })

  it('does not claim a local instructor or physical classroom presence', () => {
    expect(html).not.toMatch(/located in|based at|stationed|our (physical )?location|local classroom/i)
  })
})

describe('Phase 3: sitemap.xml remains well-formed and free of retired URLs', () => {
  const sitemap = read('sitemap.xml')

  it('contains no ground-school or hutto-taylor entries', () => {
    expect(sitemap).not.toContain('ground-school')
    expect(sitemap).not.toContain('flight-training-hutto-taylor')
  })

  it('every <loc> entry maps to an existing file (except the bare domain root)', () => {
    const locs = [...sitemap.matchAll(/<loc>(https:\/\/apexaviationtx\.com\/[^<]*)<\/loc>/g)].map((m) => m[1])
    const missing = locs.filter((loc) => {
      if (loc === 'https://apexaviationtx.com/' || loc === 'https://apexaviationtx.com') return false
      const relPath = loc.replace('https://apexaviationtx.com/', '')
      return !existsSync(path.join(SITE_DIR, relPath))
    })
    expect(missing).toEqual([])
  })
})

describe('Phase 3: prior-phase corrections remain intact (spot check)', () => {
  it('no city page carries the fabricated San Marcos ZIP (78666) mislabeled as Austin', () => {
    const offenders = allHtmlFiles.filter((f) => /^flight-training-.*\.html$/.test(f) && read(f).includes('"postalCode": "78666"'))
    expect(offenders).toEqual([])
  })

  it('no city page asserts present-tense "already operating" in-person training', () => {
    const bannedPattern = /Apex Aviation (offers|brings|closes|fills|changes|gives) /
    const offenders = allHtmlFiles.filter((f) => /^flight-training-.*\.html$/.test(f) && bannedPattern.test(read(f)))
    expect(offenders).toEqual([])
  })
})
