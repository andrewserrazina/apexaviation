// Email-system audit -- tests for the shared branded shell
// (_shared/emailTemplate.ts) and its two forced-inline duplicates.
//
// _shared/emailTemplate.ts is plain TypeScript with no Deno-only syntax
// (no top-level `Deno.env.get`, no remote URL imports), so it's imported
// directly here and exercised through Vite's normal TS transform -- no
// vm sandbox needed, unlike the Deno Edge Functions tested in
// emailLifecycle.test.js.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  EMAIL_COLORS,
  emailTemplate,
  emailHeadline,
  emailParagraph,
  emailButton,
  emailSecondaryLink,
  emailDivider,
  emailSignoff,
} from '../supabase/functions/_shared/emailTemplate.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('emailTemplate() shell', () => {
  const rendered = emailTemplate('<p>hello</p>')

  it('uses the approved navy header, not the old near-black background', () => {
    expect(rendered).toContain(EMAIL_COLORS.navy)
    expect(rendered).not.toContain('#06080f')
  })

  it('reads the body on a white background, not dark theme text colors', () => {
    expect(rendered).toContain(`background:${EMAIL_COLORS.white}`)
    expect(rendered).not.toMatch(/rgba\(255,\s*255,\s*255/)
  })

  it('carries the content through unescaped', () => {
    expect(rendered).toContain('<p>hello</p>')
  })

  it('links to a real email-preferences unsubscribe/manage page in the footer', () => {
    expect(rendered).toContain('https://apexaviationtx.com/email-preferences.html')
    expect(rendered).toContain('Manage email preferences')
  })

  it('uses Arial/Helvetica only -- no external web font', () => {
    expect(rendered).toContain('Arial,Helvetica,sans-serif')
    expect(rendered).not.toContain('fonts.googleapis.com')
  })

  it('renders the logo at or above the 150px brand minimum', () => {
    const widthMatch = rendered.match(/apexwhite\.png"[^>]*width="(\d+)"/)
    expect(widthMatch).not.toBeNull()
    expect(Number(widthMatch[1])).toBeGreaterThanOrEqual(150)
  })
})

describe('reusable email components', () => {
  it('emailButton() never rounds its corners and uses the gold/navy brand pairing', () => {
    const html = emailButton('Start Studying', 'https://example.com')
    expect(html).not.toMatch(/border-radius:\s*[1-9]/)
    expect(html).toContain(EMAIL_COLORS.gold)
    expect(html).toContain(EMAIL_COLORS.navy)
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('Start Studying')
  })

  it('emailHeadline() renders navy text, not gold', () => {
    const html = emailHeadline('Title')
    expect(html).toContain(EMAIL_COLORS.navy)
    expect(html).not.toContain(EMAIL_COLORS.gold)
  })

  it('emailParagraph() uses solid high-contrast text by default, muted variant on request', () => {
    expect(emailParagraph('body copy')).toContain(EMAIL_COLORS.bodyText)
    expect(emailParagraph('fine print', { muted: true })).toContain(EMAIL_COLORS.mutedText)
  })

  it('emailSecondaryLink() and emailDivider() and emailSignoff() render without throwing', () => {
    expect(emailSecondaryLink('See more', 'https://example.com')).toContain('https://example.com')
    expect(emailDivider()).toContain('<hr')
    expect(emailSignoff()).toContain('Blue skies,')
    expect(emailSignoff('Fly safe,')).toContain('Fly safe,')
  })

  it('no component ever uses rounded corners', () => {
    for (const html of [emailButton('x', '#'), emailHeadline('x'), emailParagraph('x'), emailDivider()]) {
      expect(html).not.toMatch(/border-radius:\s*[1-9]/)
    }
  })
})

// _shared/emailTemplate.ts's own header comment documents that
// stripe-webhook/index.ts and create-checkout-session/index.ts each
// carry a forced-inline, "must stay byte-identical" duplicate of
// emailTemplate() because their Supabase deploy path can't resolve a
// relative import reaching outside the function's own directory. That's
// exactly the kind of hand-maintained invariant that silently drifts --
// this locks it down so a future edit to one copy without the others
// fails CI instead of shipping a visually inconsistent email.
describe('forced-inline shell duplicates stay byte-identical to the shared source', () => {
  function extractFunctionBody(source, functionNameMarker) {
    const startIdx = source.indexOf(functionNameMarker)
    if (startIdx === -1) throw new Error(`Marker not found: ${functionNameMarker}`)
    const parenClose = source.indexOf(')', startIdx)
    const braceOpen = source.indexOf('{', parenClose)
    let depth = 0
    let i = braceOpen
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') { depth--; if (depth === 0) break }
    }
    return source.slice(braceOpen + 1, i) // body only, braces stripped
  }

  function loadInlineTemplateFn(relativePath, functionNameMarker) {
    const source = readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
    const body = extractFunctionBody(source, functionNameMarker)
    // eslint-disable-next-line no-new-func
    return new Function('content', body)
  }

  it('stripe-webhook/index.ts template() renders identically to the shared shell', () => {
    const inlineTemplate = loadInlineTemplateFn('portal/supabase/functions/stripe-webhook/index.ts', 'function template(')
    expect(inlineTemplate('<p>x</p>')).toBe(emailTemplate('<p>x</p>'))
  })

  it('create-checkout-session/index.ts emailTemplate() renders identically to the shared shell', () => {
    const inlineTemplate = loadInlineTemplateFn('portal/supabase/functions/create-checkout-session/index.ts', 'function emailTemplate(')
    expect(inlineTemplate('<p>x</p>')).toBe(emailTemplate('<p>x</p>'))
  })
})
