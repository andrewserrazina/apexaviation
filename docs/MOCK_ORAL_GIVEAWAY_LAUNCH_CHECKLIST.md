# Private Pilot Mock Oral Giveaway — launch gate (DRAFT)

## Campaign proposed dates
- Opens: October 22, 2026, noon America/New_York (16:00 UTC)
- Closes: November 1, 2026, 11:59 PM America/New_York (November 2, 04:59 UTC)
- One $129-value online Private Pilot Mock Oral (up to two hours)
- One equal-chance entry per person; assessment and direct routes, no purchase necessary.

## Implemented on this branch (NOT deployed)
- Branded readiness-assessment hero announcement, hidden by default
- Separate accessible entry-page draft, disabled by default
- Server-side Edge Function draft validating inputs, verifying Turnstile, and writing database rows
- Additive RLS-protected database migration enforcing one email per campaign
- Error handling for duplicate entries

## Blocking work before turning on promotion
1. Have counsel/qualified reviewer approve official rules: sponsor address, eligible states and age, prize details, odds, drawing method, winner contact/response deadlines, publicity/privacy terms, disputes and exclusions. Publish final Official Rules at /mock-oral-giveaway-rules.html; verify /privacy.html exists.
2. Implement real verification of assessment completion if desired. Current entry_method=assessment is a self-reported URL hint, and assessment_completed is deliberately false; never claim verified completion.
3. Decide policy for participants who completed assessment before campaign opening and for already registered members.
4. Configure Turnstile site key/secret and Edge Function production secrets, then deploy using approved Supabase pipeline with JWT mode appropriate for public entry.
5. Confirm server-side rate limiting against spam beyond Turnstile. Consider email verification before random drawing to prevent fake/multiple identities (email dedupe alone is insufficient).
6. Test full browser->Edge Function->DB round-trip, timezone boundary and DST handling, duplicate entries, captcha failures, malformed requests, optional marketing consent, and anti-automation.
7. Provide accessible launch route from results screen AFTER verified assessment completion, while maintaining equally prominent free direct entry route.
8. Create admin-only auditable random selection from eligible entries, do not include withdrawn/invalid entries. Handle winner notification, claim deadline and prize booking.
9. Enable banner and form only in a separate reviewed launch commit; remove noindex only when ready. Test actual production URLs and form with a non-production campaign or isolated staging.
10. Do not send entry confirmation/marketing emails unless appropriate consent and sending configuration are verified. Retention/deletion policy for entrants needs review.

**The code in this PR is a staged foundation, not an operational giveaway. Do not merge/deploy as a giveaway launch.**
