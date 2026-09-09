// Parses a Postgres `date`-only string (e.g. "2026-03-01", no time or
// timezone) as LOCAL midnight instead of UTC midnight.
//
// `new Date("2026-03-01")` alone parses as UTC midnight; every later
// .getFullYear()/.getMonth()/.getDate()/.toLocaleDateString() call then
// reads it back in the browser's LOCAL timezone, which shifts any
// date-only value into the previous day for every US-based
// (UTC-negative) browser -- e.g. 2026-03-01 becomes Feb 28 in Chicago.
// Appending 'T00:00:00' (no trailing Z/offset) makes the Date
// constructor parse the string as local midnight instead, so it reads
// back correctly everywhere.
//
// This exact fix already existed, working, in PilotJourney.jsx's local
// fmtDate() before a repo-wide bug sweep found the same unfixed bug in
// Analytics.jsx, Logbook.jsx, Dashboard.jsx, Endorsements.jsx,
// Reports.jsx, and Layout.jsx -- extracted here so every date-only
// column in this app goes through the one corrected implementation
// instead of five more independent (and easy to get wrong) copies.
//
// Only for genuine `date` (no time zone) Postgres columns -- a real
// `timestamptz` value already carries its own correct instant and
// should be parsed with `new Date(value)` unmodified; running it through
// this function would incorrectly re-anchor it to local midnight.
export function parseDateOnly(dateStr) {
  return dateStr ? new Date(dateStr + 'T00:00:00') : null
}

// Same local-midnight parsing, pre-formatted for direct display --
// covers the common case (every callsite fixed by this sweep just wants
// a display string) without each file re-deriving toLocaleDateString().
export function formatDateOnly(dateStr, fallback = '—') {
  const d = parseDateOnly(dateStr)
  return d ? d.toLocaleDateString() : fallback
}
