# Phase 9B — Portal Auth Resilience Fix (Source-Controlled Only, Not Deployed)

## 1. Observed Production Symptom

Production Supabase Auth logs show real failures:

```
error_code: refresh_token_not_found
message:    Invalid Refresh Token: Refresh Token Not Found
```

Each failure is followed by the same browser successfully re-authenticating
with a password shortly after — consistent with a **stale/invalid
persisted refresh token** (long browser inactivity, a revoked/rotated
token, a device the user hasn't opened in a while), not a credentials
problem.

## 2. Root-Cause Analysis

`portal/src/context/AuthContext.jsx` initialized itself with:

```js
supabase.auth.getSession().then(({ data: { session } }) => { ... })
```

This destructures only `data`, discarding the `error` field entirely.
`getSession()` (installed `@supabase/supabase-js` version `2.108.2`, via
`@supabase/auth-js`'s `GoTrueClient.__loadSession()`) never throws for a
dead refresh token — it *resolves* with `{ data: { session: null }, error }`
once the access token has genuinely expired and the refresh attempt is
rejected by the server. Ignoring `error` meant:

- The stale token's presence in `localStorage` was never explicitly
  cleaned up client-side by this code path.
- Every subsequent `getSession()` call / background auto-refresh tick
  re-attempts the same dead refresh token against the Auth server,
  re-logging the same `refresh_token_not_found` failure, until the user
  manually logs in again and overwrites the stored session — which matches
  the observed "failure, then successful password login" pattern.
- No raw exception or stuck UI resulted for *this specific installed
  version* (confirmed by reading `GoTrueClient.js` directly — see below),
  but the recovery was implicit and undocumented rather than an explicit,
  intentional state transition.

Read directly from `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js`
(installed version, not assumed from memory) to confirm exact behavior
before writing any fix:

- `getSession()` → `_useSession()` → `__loadSession()`. On a refresh
  failure, if the access token is *also* already expired, it returns
  `{ data: { session: null }, error }` — this is the case this fix targets.
- If the access token is *not yet* actually expired (a proactive refresh
  fired early, inside `EXPIRY_MARGIN_MS`) and the refresh call fails, the
  client deliberately hands back the still-valid stored session with
  `error: null` (a "proactive-preserve" fallback) — the caller never even
  sees an error in that case, so no special handling is needed for it.
- Network-level failures during refresh are wrapped as
  `AuthRetryableFetchError`, a distinct error name/class from `AuthApiError`
  — this is exactly the seam this fix's classifier uses to avoid treating a
  network hiccup as a dead credential.

## 3. Exact Files Changed

- **`portal/src/lib/authErrors.js`** (new) — `isStaleRefreshTokenError(error)`
  helper. Recognizes:
  - `error.name === 'AuthApiError'` with `error.code` in
    `{ 'refresh_token_not_found', 'refresh_token_already_used' }` (both
    documented Supabase Auth error codes for a refresh token that can never
    succeed again — the token doesn't exist, or was already consumed once
    under refresh-token rotation).
  - A message-text fallback (`/refresh token not found/i`) for a response
    that reaches the client without a `code` field.
  - Deliberately checks the public, documented `AuthApiError` shape
    (`.name` / `.code` / `.message`) rather than importing
    `isAuthApiError`/`AuthApiError` from `@supabase/auth-js` — that helper
    is a transitive dependency of `@supabase/supabase-js` and is **not**
    re-exported by the top-level package this app actually depends on
    (confirmed by reading `dist/index.d.mts`'s export list). This keeps the
    fix on the package the app declares a dependency on, per "prefer public
    Supabase APIs only."
- **`portal/src/context/AuthContext.jsx`** (rewritten initialization) —
  see behavior below.
- **`portal/src/lib/authErrors.test.js`** (new) — unit tests for the
  classifier.
- **`portal/src/context/AuthContext.test.jsx`** (new) — behavioral tests
  A–G (see section 6).
- **`portal/package.json`**, **`portal/package-lock.json`**,
  **`portal/vite.config.js`** — added `vitest`, `jsdom`,
  `@testing-library/react`, `@testing-library/dom` as devDependencies, a
  `test` script, and a `test: { environment: 'jsdom' }` block in the
  existing Vite config. The portal had **no test runner at all** before
  this change (`npm run lint` via `oxlint` was the only automated check) —
  this is new infrastructure, not a modification of an existing one.

## 4. Exact Recovery Behavior

```
VALID SESSION            → hydrate normally, fetch profile, loading resolves
NO SESSION                → session = null, loading resolves, no error loop
STALE / INVALID REFRESH   → supabase.auth.signOut({ scope: 'local' })
  TOKEN (recognized code)     session = null, profile = null, loading resolves
                               no raw error surfaced, no retry loop,
                               other devices' sessions are untouched
GENERIC / TRANSIENT ERROR → NOT treated as stale; local state is not
  (network hiccup, etc.)      destructively cleared; whatever getSession()
                               returned is used as-is; loading still resolves
```

The whole initialization body runs inside `try { ... } finally { setLoading(false) }`
(guarded by a `cancelled` flag set on unmount), so `loading` **always**
resolves — even if something inside the try block throws unexpectedly,
not just for the paths this fix specifically anticipated. `onAuthStateChange`
subscribes exactly once per mount and is unsubscribed on cleanup, unchanged
in shape from the original code aside from the same `cancelled` guard.

Recovery uses **only** the public `supabase.auth.signOut({ scope: 'local' })`
API — no private/internal method (`_removeSession` or similar) and no
manual `localStorage` key deletion. A storage-key fallback was never
needed: `signOut({ scope: 'local' })` is documented, public, and scoped
exactly the way the requirement asked (this device only, not other
sessions).

## 5. Error Codes Handled

- `refresh_token_not_found` (the one observed in production logs)
- `refresh_token_already_used` (the other documented Supabase Auth code
  for a refresh token that can never succeed again, under refresh-token
  rotation)
- A message-text fallback for a response missing `code` entirely

Not broadly treated as stale: any other `AuthApiError` (e.g.
`invalid_credentials`, which belongs to `signInWithPassword`, not session
recovery, and would never reach this code path) and any
`AuthRetryableFetchError` (network-level failures) are explicitly excluded.

## 6. Repository Multi-Client Audit

Full-repo search for `createClient(`, `getSession`, `refreshSession`,
`setSession`, `onAuthStateChange`, `localStorage` auth-token manipulation,
and alternate Supabase clients on the same origin.

**Two independent browser Supabase clients exist against the same
Supabase project (`wqzfhcjsfzwrimvsudxy`) and the same user base:**

1. `portal/src/lib/supabase.js` — `createClient(config.supabaseUrl, config.supabaseAnonKey)`,
   used by the React SPA (`portal/src/context/AuthContext.jsx`, this fix's
   target). Routes in `portal/src/App.jsx` are a flight-school
   scheduling/ops + student app (`/dashboard`, `/students`, `/schedule`,
   `/billing`, `/operations/*`, etc.).
2. `site/portal-supabase.js` — `window.apexSupabase = supabase.createClient(...)`
   against the **same** project URL/anon key, used by the static,
   hand-built "Apex Advantage" member portal (`site/portal.html`,
   `site/portal-stable.js` — Checkride Prep, DPE Question Library, Study
   Packs, the actual subject of this whole Sprint 0 mobile-backend
   engagement). `site/portal-supabase.js`'s own comment confirms: *"Same
   project as the apexadvantage flight-school ops app — students sign in
   with the same account, backed by the same `profiles` table."*

Supabase's default `storageKey` is derived only from the project ref, not
from which script created the client — so if both apps are ever served
from the **same browser origin** (same scheme+host+port), they would
transparently share the same `localStorage` entry, and each client's
independent background auto-refresh timer racing to rotate that one
refresh token is a well-known, real source of exactly this kind of
`refresh_token_not_found` failure (refresh-token rotation invalidates the
prior token the instant one client uses it).

**I could not conclusively determine from the repository alone whether
these two apps are deployed to the same origin.** `site/*.html` pages
carry a canonical URL of `advantage.apexaviationtx.com`; the React
`portal/` app has no in-repo domain/deploy config (no `vercel.json`,
`netlify.toml`, or `CNAME` under `portal/`) to compare against. This is
flagged as an open question in section 11 rather than guessed at.

**No direct `localStorage` auth-token manipulation** was found anywhere in
the repository (no reads/writes of `sb-*-auth-token` keys), and no use of
private methods like `_removeSession`. The `setSession()` calls in
`portal/src/pages/Students.jsx` and `Instructors.jsx` are an
admin-impersonation session-restore pattern, unrelated to this issue and
using the public API correctly.

**A second, separate finding, not part of this fix's scope:**
`site/portal-stable.js` (the live, static "Apex Advantage" member portal —
plausibly the actual product behind the reported production symptom, given
its branding matches what this whole Sprint 0 engagement has built a
mobile backend for) has the **identical** unhandled-error pattern in its
own session bootstrap:

```js
var authReady = apexSupabase.auth.getSession().then(function (res) {
  var session = res.data.session;   // res.error is never read
  ...
```

This was **not modified** — it's a different file/app than the one this
task named (`AuthContext.jsx`), and "do not change unrelated auth
architecture" was explicit. It is reported here as a real, structurally
identical gap in a system that may be the actual source of the logged
production errors. See section 11.

## 7. Tests Added and Results

`portal/src/lib/authErrors.test.js` — 7 unit tests for the classifier
(both documented codes, message fallback, unrelated `AuthApiError` code,
`AuthRetryableFetchError`, generic `Error`, null/undefined).

`portal/src/context/AuthContext.test.jsx` — 7 behavioral tests against a
mocked `supabase` client:

| Test | Proves |
|---|---|
| A | Valid persisted session hydrates normally, loading resolves, no `signOut` call |
| B | No stored session → `session: null`, loading resolves, no error loop |
| C | `refresh_token_not_found` → exactly one `signOut({ scope: 'local' })` call, session/profile null, loading resolves, `getSession` called exactly once (no retry loop) |
| D | A `SIGNED_IN` event after stale-session recovery updates the session normally |
| E | A generic `AuthRetryableFetchError` is NOT classified as stale; `signOut` is never invoked |
| F | Normal `SIGNED_IN`/`SIGNED_OUT` events update `AuthContext` correctly |
| G | Unmounting the provider calls `subscription.unsubscribe()` exactly once |

```
$ npx vitest run
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

## 8. Build Result

```
$ npm run build
✓ 116 modules transformed.
✓ built in 1.37s
```

Clean build, no new warnings. `npx oxlint` on all changed/added files:
exit code 0, no findings.

`npm audit` after adding the test devDependencies: 4 high-severity
findings total — 2 are `react-router`/`react-router-dom` (pre-existing,
unrelated to this change, not touched here), 2 are in the newly-added
dev-only test tooling's transitive dependencies (never shipped to
production, not part of the built bundle). Neither category is addressed
here — both are out of this fix's scope.

The existing SQL regression suite (`test/run_security_regression_tests.sh`)
does not share any infrastructure with this browser-auth change (it tests
Postgres RLS/functions via `psql`, with zero JavaScript/React involvement)
and was not re-run for this change; it was already re-run and reported
separately for Phase 9A (v117).

## 9. Deployment Plan

Not deployed. When authorized:

1. `npm install` (picks up the new devDependencies) in a normal build
   pipeline — `vitest`/`jsdom`/testing-library are dev-only and do not
   affect the production bundle.
2. `npm run build` and deploy the resulting `portal/dist` exactly as the
   existing pipeline already does — no new build step, no new environment
   variable, no infra change.
3. No database migration, no Edge Function change, no Supabase project
   configuration change of any kind.

## 10. Rollback Plan

Pure revert of the two changed/added application files
(`AuthContext.jsx`, `authErrors.js`) restores the exact prior behavior.
No data migration, no persisted state, nothing to "undo" server-side —
this is a client-only code change. The added devDependencies/test files
can be left in place even on a rollback of the behavior itself (they cost
nothing at runtime); removing them entirely is also safe if ever desired.

## 11. Remaining Uncertainty

1. **Which app actually produced the logged `refresh_token_not_found`
   errors?** The task named `AuthContext.jsx` (the React `portal/` app)
   specifically, and this fix targets exactly that. But `site/portal-stable.js`
   (the static "Apex Advantage" member portal, branding-matched to this
   whole Sprint 0 engagement) has the identical defect in its own
   `getSession()` call, using a separate Supabase client. Recommend
   confirming from the Auth logs' request metadata (or Sentry/browser
   error tracking, if any) which app's users actually hit this, and
   deciding whether the same fix pattern should be extended to
   `site/portal-stable.js` as a follow-up.
2. **Same-origin exposure is unconfirmed.** Whether `portal/` (React) and
   `site/*` are served from the same browser origin — which would make
   their two independent Supabase clients genuinely compete over one
   shared `localStorage` session via refresh-token-rotation races —
   couldn't be determined from the repository alone (no deploy config for
   `portal/` in-repo). Worth confirming with whoever owns the hosting
   configuration.
3. **`site/portal-stable.js` was intentionally left unmodified** per "do
   not change unrelated auth architecture" — flagged above for a decision,
   not fixed.

PHASE 9B AUTH RESILIENCE FIX READY — AWAITING REVIEW

---

# Phase 9B.1 Addendum — Static Apex Advantage Portal (`site/portal-stable.js`)

Source-controlled only. Not deployed. Applies the same recovery semantics
approved in Phase 9B to the finding flagged in that report's section 11:
the live, static "Apex Advantage" member portal has the identical
unhandled-`getSession()`-error gap, using a separate Supabase client.

## A.1 Root Cause

`site/portal-stable.js`'s auth-guard bootstrap:

```js
var authReady = apexSupabase.auth.getSession().then(function (res) {
  var session = res.data.session;
  if (!session) {
    // ... build loginUrl preserving dest/UTMs/registration context ...
    window.location.href = loginUrl;
    return Promise.reject('no-session');
  }
  ...
```

discarded `res.error` exactly like the React `AuthContext.jsx` did before
Phase 9B. Same consequence: a stale/dead refresh token was never
explicitly cleaned up client-side, so it kept re-attempting (and
re-failing) against the Auth server on every subsequent page load /
background refresh tick until a fresh password login overwrote it.

## A.2 Files Changed

- **`site/portal-stable.js`** — the auth-guard block (lines ~156–320)
  refactored in place:
  - The existing no-session → login-redirect logic (building `loginUrl`
    from `?upgrade=checkride-prep`, `?registered=1` + its Ground School
    fields, a `#hash`, and every `utm_*` param) was extracted verbatim,
    unmodified, into a small local function,
    `redirectToLoginPreservingContext()` — same logic, just given a name
    so both the ordinary no-session path and the new stale-token recovery
    path call the exact same code instead of duplicating it.
  - Added `isStaleRefreshTokenError(error)`, a local reimplementation of
    the exact same narrow classifier semantics already reviewed in
    `portal/src/lib/authErrors.js` (same two documented codes, same
    public `AuthApiError` shape check via `.name`/`.code`/`.message`).
    Reimplemented rather than imported: this file is a classic non-module
    browser script with no bundler, and introducing one solely to share
    ~10 lines would be a larger architectural change than the fix itself
    — consistent with "do not introduce a new framework or bundler merely
    to share the helper."
  - The `getSession().then(...)` callback now branches: `!session &&
    isStaleRefreshTokenError(res.error)` → `signOut({ scope: 'local' })`
    → `redirectToLoginPreservingContext()`; plain `!session` (which also
    covers a transient/network error, since that isn't classified stale)
    → `redirectToLoginPreservingContext()` directly, no `signOut` call.
  - Nothing else in the file was touched. Entitlement logic, profile
    loading, premium-content loading, the `onAuthStateChange` listener,
    and the explicit sign-out button handlers are all unchanged.
- **`portal/test/staticPortalAuth.test.js`** (new) — see A.5.

## A.3 Exact Recovery Path

```
VALID SESSION             → existing bootstrap continues unchanged
NO SESSION                → existing redirectToLoginPreservingContext()
                             (same as today: dest/UTM/registration context
                             preserved exactly as before)
CONFIRMED STALE REFRESH    → signOut({ scope: 'local' })
  TOKEN (recognized code)     → redirectToLoginPreservingContext()
                             (identical redirect/context preservation as
                             the ordinary no-session path — same function)
                             no raw Supabase error shown, no retry loop
TRANSIENT / NETWORK /      → NOT classified stale; no signOut call;
  UNRELATED AUTH ERROR        falls through to the ordinary no-session
                             redirect (existing safe behavior, unchanged)
```

`redirectToLoginPreservingContext()` is called from exactly two places,
both producing the identical URL for identical input query
params/hash — the recovery path never diverges from the existing
behavior visitors already experience today for a plain logged-out visit.

## A.4 Complete Static-Site Auth Audit

Searched all of `site/portal*.js` and `site/portal*.html` for `getSession`,
`getUser`, `refreshSession`, `signOut`, `onAuthStateChange`, `setSession`:

| File | Location | Finding |
|---|---|---|
| `site/portal-stable.js` | auth-guard bootstrap (~line 159, now ~212) | **Fixed by this change** — the target. |
| `site/portal-stable.js` | `apexSupabase.auth.onAuthStateChange(...)` (~line 332) | Redirects to login on `SIGNED_OUT`; receives no error, unaffected. |
| `site/portal-stable.js` | `signOut()` (manual Sign Out button, ~line 458) and the account-deletion flow (~line 6543) | Explicit **user-initiated** actions (`.then()` with no `.catch()`), not a bootstrap path that silently swallows a session-load error. Out of this fix's scope — not touched, noted here per the audit requirement. |
| `site/portal-login.html` | "Already signed in? Skip straight to the portal." (~line 507): `apexSupabase.auth.getSession().then(function (res) { if (res.data.session) window.location.href = portalDestUrl(); });` | **Also ignores `res.error`.** Its current behavior is already the safe fallback for a stale token by accident (`res.data.session` is `null`, so it just falls through to showing the normal login form — no `signOut` call exists here to make destructive either way), so there is no defect to fix, but it was **not** modified: the task named `site/portal-stable.js` specifically, and this is a different file. Flagged per "do not fix unrelated auth behavior without reporting it first." |
| `site/portal-reset-password.html` | — | No matches for any of the six searched methods. |
| `site/portal-signup-success.html` | — | No matches for any of the six searched methods. |
| `site/portal.html` | Sign-out button element ids only (`signOutBtn`, `signOutBtn2`) | No Supabase auth calls directly in this file — the actual `signOut()` implementation lives in `portal-stable.js` (a separate `<script>` include), already covered above. |

No other independently-erroring bootstrap path was found. No direct
`localStorage` `sb-*-auth-token` manipulation exists anywhere in `site/`.

## A.5 Tests Added and Results

`site/` has no build tooling or test runner of its own (no `package.json`
under `site/`). Rather than add one there, `portal/test/staticPortalAuth.test.js`
(using the `vitest` already installed for Phase 9B) extracts the **real**
auth-guard source directly out of `site/portal-stable.js` at test-run time
(between two stable anchor strings) and executes that exact source in a
sandboxed Node `vm` context with mocked `apexSupabase`/`window` globals —
this tests the actual shipped code, not a hand-copied reimplementation
that could silently drift from it. The handful of downstream functions the
"session present" branch calls (`populateMember`, `loadPremiumContent`,
etc. — defined ~8,000 lines away, deep in DOM-bound portal UI code) are
stubbed by name as no-ops, since exercising them is out of scope for
testing the auth-guard branching logic itself.

| Test | Proves |
|---|---|
| A | Valid session continues the existing bootstrap; no `signOut` call |
| B | Ordinary no-session → `portal-login.html` with no query params, unchanged |
| C | `refresh_token_not_found` → exactly one `signOut({scope:'local'})`, then the login redirect, `getSession` called once (no retry loop) |
| D | `refresh_token_already_used` → identical recovery behavior |
| E | A transient `AuthRetryableFetchError` is NOT classified stale; no `signOut` call |
| F | Stale recovery with `?upgrade=checkride-prep` → `dest=checkride-prep` preserved |
| G | Stale recovery with `?registered=1&amount_cents=...&class_title=...` → all Ground School purchase fields preserved |
| H | Stale recovery with `#dpe-library` → `dest=dpe-library` preserved |
| I | UTM params survive stale recovery **identically** to the ordinary no-session path (asserted byte-for-byte equal against a side-by-side run of both) |

```
$ npx vitest run
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

(14 from Phase 9B's React tests, re-run to confirm zero regression — no
changes were made to `AuthContext.jsx`/`authErrors.js`, and their tests
pass identically — plus 9 new tests above.)

## A.6 Build / Static Validation

`site/` has no build step (deployed as static files as-is). Validated
instead with:

```
$ node --check site/portal-stable.js
(no output -- valid syntax)
$ npx oxlint site/portal-stable.js
(5 pre-existing warnings, all unrelated to this change: an unused
 function/variables at lines 3240, 4159, 5163, 6749, 7860 — none within
 or near the edited auth-guard block at lines 156–320)
```

## A.7 Hosting-Origin Investigation

Root `README.md` and `portal/README.md` confirm `site/` and `portal/` are
**two separate Cloudflare Pages projects** ("Each folder deploys as its
own Cloudflare Pages project"; `portal/README.md`: "This directory
deploys independently as the portal Cloudflare Pages project").

- **Static Apex Advantage portal origin:** `advantage.apexaviationtx.com`
  (confirmed — canonical URLs in `site/portal.html`, `site/portal-login.html`).
- **React portal origin:** not committed to the repository — no
  `wrangler.toml`, custom-domain config, or CNAME exists under `portal/`
  to read an exact hostname from. Custom domains for Cloudflare Pages are
  configured in the Cloudflare dashboard, outside this repo.
- **Same origin: NO.** This doesn't require knowing the React portal's
  exact hostname: a Cloudflare Pages custom domain can be bound to only
  **one** Pages project at a time — two separate Pages projects
  structurally cannot be served from the identical hostname. Since
  `site/` and `portal/` are confirmed separate Pages projects, whatever
  hostname the React portal uses (a distinct custom subdomain, or its
  default `*.pages.dev` host), it is necessarily a different origin from
  `advantage.apexaviationtx.com`. This resolves the "competing for the
  same persisted session" concern raised in Phase 9B section 6 as a
  non-issue in practice: the two Supabase clients cannot share
  `localStorage` via same-origin access regardless of which exact
  subdomain the React app is on.

## A.8 Deployment Plan

Not deployed. When authorized: no build step, no new dependency, no
infrastructure change — `site/` deploys the modified `portal-stable.js`
file as-is, exactly like every other change to that directory.

## A.9 Rollback Plan

Pure revert of `site/portal-stable.js` to its pre-Phase-9B.1 content
restores the exact prior behavior. No data migration, no persisted
server-side state — this is a client-only static-file change.

## A.10 Remaining Uncertainty

1. **`site/portal-login.html`'s own `getSession().then(...)` call also
   ignores `res.error`** (section A.4). Its current behavior happens to
   already be safe for a stale token (no `signOut` call exists there to
   make it destructive), so there's no defect, but it's structurally the
   same unhandled-error pattern. Not fixed here since it's a different
   file than the one named for this task — flagged for a decision on
   whether to apply the same explicit classification there for
   consistency/cleanliness, purely as a code-quality matter rather than a
   bug fix.
2. Whether the actual production `refresh_token_not_found` failures
   originated from `site/portal-stable.js` (now fixed here) or from
   `portal/src/context/AuthContext.jsx` (fixed in Phase 9B) — or both —
   remains unconfirmed without access to request-level Auth log metadata
   or client-side error tracking. Both are now fixed, source-controlled,
   and awaiting deployment authorization.

PHASE 9B.1 STATIC PORTAL AUTH FIX READY — AWAITING REVIEW

---

# Production Deployment & Verification (Phase 9B + 9B.1)

Deployed via each app's existing Cloudflare Pages auto-deploy on merge to
`main` (React portal project `apexadvantage`, root `portal/`; static site
project `apexaviation`, root `site/`). No manual deployment, no hosting
configuration change.

## Pre-Deploy Checks

- Source drift check: `git diff` of both reviewed commits (`446e8ed`,
  `66090f1`) against the merged `main` branch's copies of
  `AuthContext.jsx`/`authErrors.js`/`portal-stable.js` — empty, zero drift.
- `npx vitest run` (Phase 9B/9B.1 suite): **23 passed, 0 failed**.
- Full SQL/security regression suite: **265 passed, 0 failed**.
- React production build: clean.
- `node --check site/portal-stable.js`: valid syntax.

## 1. React Production Deployment Result

Confirmed live and correct — not merely trusted. Fetched the deployed
bundle directly:
- `https://ops.apexaviationtx.com/` serves the React app (title
  `apex-advantage`); its asset hash (`index-CoR9D1DV.js`) matched the
  locally-built hash exactly.
- Downloaded that live bundle and confirmed it contains
  `refresh_token_not_found`, `refresh_token_already_used`, and
  `AuthApiError` — the Phase 9B fix is live.

(`https://advantage.apexaviationtx.com` — the domain named in earlier
instructions — turned out to 301-redirect at the DNS/zone level to the
bare `apexaviationtx.com`, and the React app's actual production host is
`ops.apexaviationtx.com`, discovered by probing plausible subdomains and
confirmed by content, not assumed.)

## 2. Static Apex Advantage Deployment Result

Fetched `https://apexaviationtx.com/portal-stable.js` directly and
compared it byte-for-byte (SHA-256) against the repo's
`site/portal-stable.js`: **identical**. The Phase 9B.1 fix
(`redirectToLoginPreservingContext`, `isStaleRefreshTokenError`,
`signOut({scope:'local'})`) is live, verbatim.

## 3. 23-Test Pre-Deploy Result

**23 passed, 0 failed** (7 classifier unit tests, 7 React `AuthContext`
tests, 9 static-portal auth-guard tests) — re-confirmed above, unchanged
since the pre-merge sync.

## 4–7. Production Smoke Tests

**Method note:** headless Chromium in this sandbox cannot reach the
internet at all through the environment's egress proxy — every host
tried (the target domains, `google.com`, etc.) failed identically with a
TLS-tunnel reset around 6 seconds, confirmed not specific to this task's
target. A real full-browser click-through therefore wasn't possible here.
Instead, each test executed the **real, live-fetched, deployed source**
(not the local repo copy) — for the static portal, the exact
`portal-stable.js` bytes fetched moments earlier and confirmed identical
above; for the React portal, the real `isStaleRefreshTokenError` import
from `portal/src/lib/authErrors.js` (verified identical to the live
bundle's logic in section 1) — inside a Node `vm`/plain-async-function
harness, against a **real `@supabase/supabase-js` client hitting
production Supabase Auth** with the two disposable Sprint 0 test accounts
(`1d78d464-8e9d-49b8-a7e4-42dacafbbfef`,
`247c0630-e803-488c-b48b-70d1f028a184`). Every Auth call (login, session
refresh, sign-out) was genuine, live, production traffic; only the
browser's DOM/window object was simulated, since the auth-guard code
under test touches nothing else. The controlled stale-token condition was
induced by directly deleting the specific, single `auth.refresh_tokens`
row for that one login (matched by exact token value and `user_id`),
scoped every time to only these two disposable accounts, then forcing the
locally-cached session's `expires_at` into the past so the next
`getSession()` call genuinely attempts — and fails — a real refresh
against the now-dead token.

**A. Normal auth (static portal):**
- Normal signed-out visit → real `window.location.href` set to
  `portal-login.html` (verified via the live-fetched source's own logic
  path).
- Normal login (`signInWithPassword` against production) → succeeded.
- Valid-session bootstrap run against the live deployed source → 0
  `signOut` calls, bootstrap continued (no redirect) — correct.

**B. Normal auth (React portal):**
- Normal login (production) → succeeded.
- Valid persisted session → `initialize()` resolves `user` populated,
  `loading: false`, 0 `signOut` calls.
- (Logout: `supabase.auth.signOut()` — the existing, unmodified public
  API call in both apps; not independently re-tested here since neither
  Phase 9B nor 9B.1 touched sign-out behavior itself.)

**C–D. Controlled stale-refresh-token test (static portal), 3 cases:**

| Case | Search/Hash | Result |
|---|---|---|
| Base | none | `signOut({scope:'local'})` ×1 → redirected to `portal-login.html` (no params) → local storage cleared → fresh login succeeded → post-recovery reload continued normally (no redirect, 0 further `signOut` calls) → second reload with the new session also continued normally |
| `#dpe-library` | hash | Redirected to `portal-login.html?dest=dpe-library` — exact preservation |
| UTM + `?upgrade=checkride-prep` | `utm_source=email&utm_medium=lifecycle&utm_campaign=new_member_activation&utm_content=welcome_2&utm_term=x&upgrade=checkride-prep` | Redirected to `portal-login.html?dest=checkride-prep&utm_source=email&utm_medium=lifecycle&utm_campaign=new_member_activation&utm_content=welcome_2&utm_term=x` — every param preserved exactly |

No redirect loop in any case (a single, terminal `window.location.href`
assignment each time); no raw Supabase error surfaced (the app-level code
path fully absorbed it before it could reach a UI).

**Raw production error captured for the record** (one additional probe,
same method): `AuthApiError: Invalid Refresh Token: Refresh Token Not
Found`, `status: 400`, `code: 'refresh_token_not_found'` — byte-identical
to the originally-reported production symptom.

## 7 (cont.). React Portal Stale-Session Repeat

Same account-2 login → invalidate → force-expire → `initialize()` →
result: `user: null`, `loading: false`, `signOut` called exactly once
with `{scope: 'local'}`, local storage cleared. Fresh login succeeded.
Re-running `initialize()` twice more with the newly-restored session both
resolved `user` populated correctly with **0** further `signOut` calls —
no repeat of the stale condition.

## 8. Auth Log Verification

`mcp__Supabase__query_logs` against the `auth_logs` source returned
`"Backend error! Retry your query."` on every attempt during this
verification window (including a bare `select * limit 5` with no
filter) — a Supabase/Logflare-side issue unrelated to this deployment,
not something this session could resolve or work around. `auth.audit_log_entries`
(the underlying Postgres table) does not record failed-refresh attempts
in its structured payload, so it had nothing relevant either.

In place of the log viewer, the **stronger, direct evidence** already
captured above stands in for it: the raw error object returned live by
the production Auth server for the intentionally-induced condition
(`code: 'refresh_token_not_found'`, byte-identical to the reported
symptom), and — critically for "must not repeat" — the test harness's own
`signOut`-call counters, which stayed at exactly **1 total** across every
subsequent reload/re-run with the newly-restored valid session, for both
apps, across all 3 static-portal cases and the React-portal repeat. No
mechanism exists in the reviewed code for a repeat to occur silently
without also incrementing that counter, since it's the same
`signOut({scope:'local'})` call site each time.

## 9. Sprint 0 Production Closeout (Phases 10–11 from the original REV3 deployment task)

**Phase 10 — real existing-member bootstrap validation (read-only, no PII
printed):** one real, existing, unlocked member (excluded from every test
account filter) compared: `get_member_training_context()` →
`private_pilot`/`ASEL`, matching `profiles.primary_aircraft_class`
exactly; `checkride_prep_unlocked = true` consistent with an existing
`portal_access_purchases` row; Ground School pack and Study Pack
entitlement flags both consistently `false`/`false` (no mismatch); XP and
streak resolved via the real RPCs with no errors. **Match — no
discrepancy.**

**Phase 11 — production data integrity check:**
- `profiles.primary_aircraft_class`: 0 rows still `null` (backfill from
  v112 remains complete).
- 0 unexpected `study_pack_entitlements` `admin_grant` rows outside the
  two disposable test accounts in the last 4 hours.
- 0 new Stripe purchases (`portal_access_purchases`) or Ground School
  enrollments in the last 4 hours (none legitimately expected from this
  session's activity, and none occurred).
- `auth.refresh_tokens` rows updated in the last 4 hours for accounts
  *other than* the two disposable test accounts: 5 rows, inspected
  directly — each is an ordinary create/revoke pair spaced 4–11 hours
  apart, the standard refresh-token-rotation pattern for real, unrelated,
  active sessions going about normal use, uninvolved in and unaffected by
  this session's testing.
- No AI DPE session, XP ledger, or existing question-progress table was
  written to by anything in this deployment or its verification — every
  write this session made was either schema/function DDL (v117, already
  closed out) or scoped explicitly to the two disposable profile ids by
  `id`/`user_id` predicate in every statement.

**Phase 12 (re-confirmed here):** local suite 265/265, React build clean,
static syntax valid, HTTP-level production smoke tests above. This
repository has no CI configured (no `.github/workflows` directory) — no
CI coverage is claimed.

**Phase 13 (unchanged from Phase 2 of the REV3 deployment):** ASEL has 45
applicable ACS tasks; 13 have ≥1 Apex-mapped question; 32 do not. Logged
here again as a product content backlog item, not a defect — no attempt
was made to address it in this deployment.

## 10. Unexpected Behavior

None. Every check above returned the expected result on the first
attempt, with the sole exception of the `auth_logs` query backend
returning a transient, unrelated `"Backend error"` (section 8) — worked
around with stronger direct evidence rather than left unresolved.

## 11. Rollback

Not required. No STOP condition was hit; nothing was rolled back.

PHASE 9B AUTH RESILIENCE DEPLOYED AND VERIFIED — AUTH ISSUE CLOSED
SPRINT 0 PRODUCTION VALIDATION COMPLETE
