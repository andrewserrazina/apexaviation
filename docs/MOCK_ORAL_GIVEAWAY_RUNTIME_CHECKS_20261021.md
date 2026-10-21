# Giveaway runtime checks — 2026-10-21

## Production project (existing ApexAdvantage, no additional environment)

**Controlled database tests performed inside BEGIN/ROLLBACK**
- Six sequential calls to mock_oral_giveaway_take_rate_limit with the same test digest: allowed 1–5 and rejected attempt 6; assertion block completed without error.
- Invalid campaign rejected by the rate limiter.
- Transaction rolled back; persisted test rate-limit rows = 0.

**Read-only access checks**
- Anonymous role cannot INSERT or SELECT giveaway entries.
- Anonymous role cannot execute throttle RPC.
- Service role can execute throttle RPC.
- Giveaway entries = 0; rate limit records = 0 at completion.

**Function status**
- Function submit-mock-oral-giveaway version 3 deployed.
- Server launch switch still defaults disabled.
- Turnstile action must equal `mock_oral_giveaway`; hostname must match apexaviationtx.com.
- No live browser-to-function POST test achieved: public endpoint outbound access unavailable from this runtime, and production Turnstile configuration and secrets are unverified.

## Launch blockers remaining
1. Configure Cloudflare Turnstile site key in frontend and matching secret in Supabase.
2. Provision server secret GIVEAWAY_RATE_LIMIT_PEPPER (>=32 characters). Do not commit secrets.
3. Decide on approved eligibility + official legal rules; publish reviewed `mock-oral-giveaway-rules.html`.
4. Set up safe gateway/network IP rate controls to supplement email-based throttling.
5. Validate public form submission to Edge Function and DB; duplicate/closed/invalid tests with controlled identity.
6. Perform actual UI/account/payment regression tests.
7. Do not set MOCK_ORAL_GIVEAWAY_ENABLED=true or frontend GIVEAWAY_LIVE=true until all conditions pass.
