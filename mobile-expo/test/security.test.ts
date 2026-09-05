// Static source-scan tests -- these read the app's own source files
// rather than mocking anything, so they catch a real leaked secret or a
// reintroduced client-side business rule regardless of which file it
// ends up in.
import fs from 'fs'
import path from 'path'

const SOURCE_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'constants']
const ROOT = path.resolve(__dirname, '..')

function listSourceFiles(): string[] {
  const files: string[] = []
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(ROOT, dir)
    if (!fs.existsSync(abs)) continue
    walk(abs, files)
  }
  return files
}

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
}

const sourceFiles = listSourceFiles()

function readAll(): { file: string; content: string }[] {
  return sourceFiles.map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))
}

describe('Sprint 1A security/config guarantees (static source scan)', () => {
  const files = readAll()

  // AF: no service-role credential anywhere in the app's TypeScript
  // source (app/, components/, contexts/, hooks/, lib/, constants/).
  // .env.example is deliberately NOT scanned here -- it explains in prose
  // why the service-role key must never appear, without ever containing
  // a real value.
  it('never references a Supabase service-role key', () => {
    const offenders = files.filter((f) => /SUPABASE_SERVICE_ROLE_KEY/i.test(f.content) || /service[-_]role/i.test(f.content))
    expect(offenders.map((f) => f.file)).toEqual([])
  })

  // AG: no Stripe secret key pattern or lifecycle/admin secret reference.
  it('never references a Stripe secret key, lifecycle cron secret, or admin token', () => {
    const bannedPatterns = [/sk_live_/i, /sk_test_/i, /STRIPE_SECRET/i, /LIFECYCLE_CRON_SECRET/i, /ADMIN_TOKEN/i, /DATABASE_URL/i, /DB_PASSWORD/i]
    for (const pattern of bannedPatterns) {
      const offenders = files.filter((f) => pattern.test(f.content))
      expect(offenders.map((f) => f.file)).toEqual([])
    }
  })

  // AH: no hard-coded business rule for entitlement, readiness, or XP --
  // the client only ever renders server-provided values, never computes
  // or thresholds them itself. This looks for the specific shapes a
  // reintroduced rule would take: a literal XP award amount being summed
  // locally, or an entitlement/readiness boolean derived from a formula
  // rather than an API field.
  it('never awards XP locally (no local XP arithmetic)', () => {
    const offenders = files.filter((f) => /xp\s*\+=|xp\s*=\s*xp\s*\+|totalXp\s*\+=|awardXp|localXp/i.test(f.content))
    expect(offenders.map((f) => f.file)).toEqual([])
  })

  it('never computes checkride_prep_unlocked or readiness from a local formula', () => {
    // Legitimate uses read access.checkride_prep (a server-provided
    // boolean) or pass overall_score/evidence_level through untouched --
    // this bans a client-side recomputation of either.
    const offenders = files.filter(
      (f) => /checkride_prep_unlocked\s*=\s*(?!.*access\.)/i.test(f.content) || /overall_score\s*=\s*[\d(]/i.test(f.content)
    )
    expect(offenders.map((f) => f.file)).toEqual([])
  })

  // L: insufficient_content_coverage (and readiness generally) must never
  // produce pass-probability language anywhere in the shipped copy.
  it('never uses pass-probability language anywhere in the app copy', () => {
    const bannedPhrases = [/chance of passing/i, /probability of passing/i, /likelihood of passing/i, /you will pass/i, /you'll pass/i]
    for (const phrase of bannedPhrases) {
      const offenders = files.filter((f) => phrase.test(f.content))
      expect(offenders.map((f) => f.file)).toEqual([])
    }
  })
})
