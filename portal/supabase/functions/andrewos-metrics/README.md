# andrewos-metrics

Supabase Edge Function that collects operational KPIs from the Apex
Advantage / flight-training Supabase project and writes one snapshot page
per KPI into a Notion "Metric Snapshots" data source, so AndrewOS can
track business health over time without querying Supabase directly.

## Purpose

Runs on a daily schedule (see `schedule.sql` in this folder) and, on each
invocation:

1. Collects four aggregate KPIs from Supabase.
2. For each KPI, checks whether a snapshot for that metric + business +
   UTC calendar day already exists in the Notion data source.
3. If not, creates a new snapshot page. If one already exists, skips it
   (no duplicate rows, no overwriting history).
4. Returns a JSON summary of what happened.

No personally identifiable information is ever read or sent. Every
Supabase query is either a `head: true` row count (no rows returned) or a
select of a single numeric column (`logbook_entries.duration_hours`) --
never names, emails, or other identifying fields.

## Metrics collected

| Metric | Period | Definition |
|---|---|---|
| Active Flight Students | Current | Count of `profiles` where `role = 'student'`. Mirrors the admin dashboard's existing "Active Students" count exactly (`portal/src/pages/Dashboard.jsx`, `portal/src/pages/Students.jsx`). The schema has no explicit active/inactive status column on `profiles`, so this is not narrowed further. **Note:** `profiles.student_type` (`'apex_advantage'` \| `'flight_student'`) exists but the dashboard itself doesn't filter on it either, so this count currently includes both real flight students and Apex Advantage portal-only members marked `role='student'`. If you want a narrower "flight students only" number, add `.eq('student_type', 'flight_student')` in `index.ts` -- flagged here rather than assumed, since that would diverge from the existing dashboard number. |
| Instructional Hours MTD | Month to Date | Sum of `logbook_entries.duration_hours` where `date >= <first day of current UTC month>`. |
| Upcoming Lessons | Current | Count of `lessons` where `starts_at >= now()`. |
| Ground School Registrations | Month to Date | Count of `ground_registrations` where `registered_at >= <first day of current UTC month>`. **Fallback:** this table has no `created_at` column in this schema (see `GROUND_SCHOOL_RLS_AUDIT.md`); `registered_at` (set by default to `now()` when a registration is submitted) is used instead. |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key, used server-side only, never exposed to a client. |
| `NOTION_TOKEN` | yes | Notion internal integration token, shared with (or given access to) the Metric Snapshots data source. |
| `NOTION_METRIC_SNAPSHOTS_DATA_SOURCE_ID` | yes | The **data source ID** (not a legacy database ID) of the Metric Snapshots data source. See "Notion property names to verify" below for how to find this. |
| `ANDREWOS_CRON_SECRET` | yes | Shared secret the caller must present, either as `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`. |

Set these with:

```bash
supabase secrets set \
  SUPABASE_URL=https://<project-ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  NOTION_TOKEN=<notion-integration-token> \
  NOTION_METRIC_SNAPSHOTS_DATA_SOURCE_ID=<data-source-id> \
  ANDREWOS_CRON_SECRET=<a-long-random-string>
```

## Local serving instructions

```bash
cd portal
supabase link --project-ref <your-project-ref>   # once
supabase functions serve andrewos-metrics --env-file ./supabase/.env.local --no-verify-jwt
```

(`--no-verify-jwt` matches the deployed config in `supabase/config.toml`,
where `verify_jwt = false` for this function -- auth is enforced in code,
not by the platform.)

## Manual invocation example

```bash
curl -i -X POST \
  "http://localhost:54321/functions/v1/andrewos-metrics" \
  -H "x-cron-secret: <ANDREWOS_CRON_SECRET value>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Against the deployed function, replace the URL with
`https://<project-ref>.supabase.co/functions/v1/andrewos-metrics`.

## Deployment command

```bash
cd portal
supabase functions deploy andrewos-metrics
```

## Example successful response

```json
{
  "collected": 4,
  "created": 3,
  "skipped": 1,
  "failed": 0,
  "executedAt": "2026-07-19T13:00:04.128Z",
  "details": [
    { "metric": "Active Flight Students", "status": "created", "value": 42, "notionPageId": "1a2b3c4d-...-..." },
    { "metric": "Instructional Hours MTD", "status": "created", "value": 118.5, "notionPageId": "2b3c4d5e-...-..." },
    { "metric": "Upcoming Lessons", "status": "skipped", "value": 17 },
    { "metric": "Ground School Registrations", "status": "created", "value": 6, "notionPageId": "3c4d5e6f-...-..." }
  ]
}
```

A `skipped` entry means a snapshot for that metric already exists for
today (UTC) -- expected if the function is invoked more than once in the
same day. A `failed` entry means either the Supabase query or the Notion
write for that one metric didn't succeed; other metrics still complete
independently (see "Duplicate-prevention behavior" below for what gets
written to Notion in that case).

## Security notes

- The service-role key is used only inside this server-side Edge
  Function, never returned to a client.
- Only aggregate numbers are ever sent to Notion -- no names, emails, or
  other row-level data. See "Metrics collected" above for exactly which
  columns are queried.
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `NOTION_TOKEN`,
  `ANDREWOS_CRON_SECRET`) are never logged or included in HTTP responses.
  Error messages returned to the caller are generic
  (`"Server misconfiguration: ..."`); only `console.error` gets the
  specific missing-variable name or Supabase/Notion error text, and even
  those never include a secret's value, only which variable was missing
  or which query/request failed.
- The function only accepts `POST` and only proceeds past auth if the
  caller presents `ANDREWOS_CRON_SECRET` exactly, via either supported
  header.

## Duplicate-prevention behavior

Before creating a Notion page for a metric, the function queries the
data source for an existing page where:

- `Metric` (title) equals the metric name, **and**
- `Business` equals `Apex Aviation`, **and**
- `Snapshot Date` falls within the current UTC calendar day.

If a match is found, that metric is reported as `skipped` and no new
page is written. This means running the function multiple times in one
day (e.g. a manual test right after the scheduled run) is safe and will
not create duplicate rows. Existing/historical snapshots are never
updated or deleted by this function.

If a metric's *Supabase collection* fails, the function still attempts
to write a visible `Status: Error` snapshot for that metric (deduped the
same way), so a broken metric doesn't just silently vanish from the
tracker for the day. If that Notion write also fails, the metric is
reported as `failed` with no Notion page created at all.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `401 Unauthorized` | `ANDREWOS_CRON_SECRET` missing/mismatched, or the request didn't include `Authorization: Bearer <secret>` or `x-cron-secret: <secret>`. |
| `405 Method ... not allowed` | Called with something other than `POST` (e.g. a browser `GET` to the function URL). |
| `500 Server misconfiguration` | One of the five required env vars isn't set for this function's deployment. Check with `supabase secrets list`. |
| A metric always comes back `failed` with a Supabase error message | The referenced table/column may not match this project's actual schema (e.g. if `ground_registrations` gains a real `created_at` later, or a column is renamed). Check the error text in the `details[].error` field. |
| A metric always comes back `failed` with a Notion error message | Usually a property name/type mismatch -- see "Notion property names to verify" below -- or the integration hasn't been shared with (given access to) the data source. |
| Every run creates duplicates instead of skipping | Confirm the assumed property names (`Metric`, `Business`, `Snapshot Date`) actually exist with those exact names/types in the real data source -- the duplicate-check filter silently returns zero matches (not an error) if a property name is wrong. |

## Notion property names to verify

This repo had no existing Notion integration or documented schema for
"Metric Snapshots" to match against, so the following are **assumptions**
made from the task spec, configured at the top of `index.ts`
(`NOTION_PROPERTIES` and `NOTION_PROPERTY_TYPES`) rather than hardcoded
throughout the logic:

- `Metric` -- assumed **title** property.
- `Value` -- assumed **number** property.
- `Snapshot Date` -- assumed **date** property.
- `Business`, `Source`, `Period`, `Status` -- assumed **select**
  properties (single-select). If any of these are actually plain text in
  the real data source, change that property's entry in
  `NOTION_PROPERTY_TYPES` from `'select'` to `'rich_text'` -- no other
  code changes are needed.
- `Notes` -- assumed **rich_text** property.

To find the data source ID: open the Metric Snapshots database in
Notion, use "Copy link", and extract the ID from the URL. Since Notion's
2025-09 API introduced multi-source databases, a database's *data
source* ID (used by this function) is distinct from the database's own
ID -- if unsure, use the Notion API's `GET /v1/databases/{database_id}`
endpoint (`Notion-Version: 2025-09-03`) and read the `data_sources[]`
array in the response to get the correct ID.
