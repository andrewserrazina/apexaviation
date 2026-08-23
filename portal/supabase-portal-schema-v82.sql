-- Apex Advantage — record per-recipient delivery outcome on broadcasts (v82)
--
-- admin_broadcast_recipients (v33.sql) has always logged every intended
-- recipient of a broadcast, but never whether that specific person's send
-- actually succeeded -- only the in-memory sent/failed counts
-- (sendAdminEmail's return value) ever existed, and those vanish the
-- moment the browser tab moves on. When a real 113-recipient broadcast
-- came back "sent: 57, failed: 56" (Resend's 2 req/sec rate limit, hit by
-- firing 5 requests concurrently with no pacing -- see the matching fix in
-- portal/src/lib/email.js), there was no way to say WHICH 56 people never
-- got it without exporting Resend's own send log and diffing it by hand
-- against this table's recipient list.
--
-- delivered is nullable rather than defaulting to true/false: existing
-- rows genuinely don't know their outcome (that information was never
-- captured), and a nullable column keeps that honest instead of
-- fabricating a value for history it can't know. Every new broadcast from
-- here on records a real true/false per recipient.
--
-- Run this in the Supabase SQL editor, after supabase-portal-schema-v81.

alter table public.admin_broadcast_recipients
  add column if not exists delivered boolean;

comment on column public.admin_broadcast_recipients.delivered is
  'Whether this recipient''s send actually succeeded. Null for broadcasts sent before this column existed -- that outcome was never recorded, not false.';
