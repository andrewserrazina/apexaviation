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
