# Giveaway Eligibility Review SOP (draft)

**No live changes.** This is a required operator checklist before running the draw.

1. Obtain reviewed Official Rules and confirmed eligibility criteria, including age, geographic scope, prohibited jurisdictions, employees/household exclusions, deadline, sponsor identity, and treatment of invalid or duplicate submissions.
2. Export entries through a private admin-only route (never expose service-role keys in browsers or commit them). Keep personal information access limited and log review actions.
3. Review each entry against the approved rules. A correct email alone does not establish eligibility or unique identity. Resolve suspected multiple-email entries consistently and document evidence; permit an appeal/contact where appropriate.
4. Update each entry's `eligibility_status` to `eligible` or `ineligible` only following review. Record `eligibility_reviewed_at`, `eligibility_reviewed_by`, and a short privacy-conscious `eligibility_review_note`. Leave uncertainty as `pending` and don't draw until all relevant entries are resolved.
5. Export a count by status and review it independently. Verify there are no pending or unreviewed entries that should be in the drawing pool.
6. Set `GIVEAWAY_ELIGIBILITY_REVIEW_COMPLETE=yes` ONLY when evidence of review is secured and the eligible entries are ready. Keep service credentials private.
7. On or after November 2, 2026 at midnight Eastern, run the drawing script once, preserve its private JSON output, and record the winner and any alternate drawing transparently.
8. Verify the selected entrant before awarding the session. Follow the approved winner notification/claim/redraw schedule. Do not advertise a confirmed winner prematurely.

### Safety notes
- Scripts assume the giveaway table has been migrated and the submission API tested in a staging environment.
- Current draw script filters status=eligible, but the audit has not validated the implementation against live entries.
- Avoid transmitting personal email addresses or entrant exports in public PR comments.
