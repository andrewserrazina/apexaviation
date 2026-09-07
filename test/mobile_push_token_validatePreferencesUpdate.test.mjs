// Sprint 1C Rev2 (independent review) -- narrow, plain-Node unit
// coverage for mobile-push-token's update_preferences validation logic.
// This is NOT a substitute for a real Edge Function integration test
// (there is no deno/supabase-cli runtime in this sandbox -- see this
// repo's other *_validateAcsTaskId.test.mjs for the same documented
// limitation); it exercises the actual exported
// validatePreferencesUpdate() function from validatePreferencesUpdate.ts
// (compiled to plain JS by test/run_security_regression_tests.sh
// immediately before this runs), not a hand-written duplicate, so it
// cannot silently drift from what index.ts really calls.
//
// Deliberately a single small script, not a test framework -- run
// directly with `node`, asserting and exiting nonzero on first failure.
import { validatePreferencesUpdate } from './__mobile_push_token_compiled/validatePreferencesUpdate.js'

let failures = 0

function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`)
  if (!pass) {
    console.log(`  -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failures++
  }
}

// Booleans accepted when supplied and actually boolean.
check(
  'accepts a single valid boolean field',
  validatePreferencesUpdate({ daily_drill_enabled: false }),
  { ok: true, update: { daily_drill_enabled: false } }
)
check(
  'accepts all four boolean fields plus a valid time together',
  validatePreferencesUpdate({
    daily_drill_enabled: true,
    checkride_countdown_enabled: false,
    weak_area_enabled: true,
    streak_enabled: false,
    daily_drill_time: '06:30',
  }),
  { ok: true, update: { daily_drill_enabled: true, checkride_countdown_enabled: false, weak_area_enabled: true, streak_enabled: false, daily_drill_time: '06:30' } }
)

// Omitted fields are simply not included -- never defaulted here.
check('omitted fields are left out of the update entirely', validatePreferencesUpdate({ streak_enabled: true }), { ok: true, update: { streak_enabled: true } })

// Non-boolean values for boolean fields are rejected, not coerced.
check('rejects a string "true" for a boolean field', validatePreferencesUpdate({ daily_drill_enabled: 'true' }), { ok: false, error: 'daily_drill_enabled must be a boolean' })
check('rejects a number for a boolean field', validatePreferencesUpdate({ weak_area_enabled: 1 }), { ok: false, error: 'weak_area_enabled must be a boolean' })

// Explicit null is invalid, never silently dropped.
check('rejects explicit null for a boolean field', validatePreferencesUpdate({ checkride_countdown_enabled: null }), { ok: false, error: 'checkride_countdown_enabled must be a boolean' })
check('rejects explicit null for daily_drill_time', validatePreferencesUpdate({ daily_drill_time: null }), {
  ok: false,
  error: 'daily_drill_time must be a valid 24-hour time (HH:MM or HH:MM:SS)',
})

// daily_drill_time format validation.
check('accepts HH:MM', validatePreferencesUpdate({ daily_drill_time: '07:00' }), { ok: true, update: { daily_drill_time: '07:00' } })
check('accepts HH:MM:SS', validatePreferencesUpdate({ daily_drill_time: '07:00:00' }), { ok: true, update: { daily_drill_time: '07:00:00' } })
check('rejects a single-digit hour', validatePreferencesUpdate({ daily_drill_time: '7:00' }), {
  ok: false,
  error: 'daily_drill_time must be a valid 24-hour time (HH:MM or HH:MM:SS)',
})
check('rejects an out-of-range hour', validatePreferencesUpdate({ daily_drill_time: '25:00' }), {
  ok: false,
  error: 'daily_drill_time must be a valid 24-hour time (HH:MM or HH:MM:SS)',
})
check('rejects an out-of-range minute', validatePreferencesUpdate({ daily_drill_time: '07:60' }), {
  ok: false,
  error: 'daily_drill_time must be a valid 24-hour time (HH:MM or HH:MM:SS)',
})
check('rejects a non-time string', validatePreferencesUpdate({ daily_drill_time: 'seven am' }), {
  ok: false,
  error: 'daily_drill_time must be a valid 24-hour time (HH:MM or HH:MM:SS)',
})

// No recognized fields at all -> clean 400-shaped rejection.
check('rejects an empty body', validatePreferencesUpdate({}), { ok: false, error: 'No preference fields provided' })
check('rejects a non-object body', validatePreferencesUpdate('daily_drill_enabled'), { ok: false, error: 'Invalid request body' })
check('rejects null', validatePreferencesUpdate(null), { ok: false, error: 'Invalid request body' })
check('rejects undefined', validatePreferencesUpdate(undefined), { ok: false, error: 'Invalid request body' })

// Unknown fields are never persisted -- a body with only unknown keys
// behaves exactly like an empty body, and a body mixing a known field
// with unknown ones only carries the known field through.
check('a body with only unknown fields is rejected as having no recognized fields', validatePreferencesUpdate({ profile_id: 'attacker-controlled', is_admin: true }), {
  ok: false,
  error: 'No preference fields provided',
})
check(
  'unknown fields alongside a valid field are silently ignored, never persisted',
  validatePreferencesUpdate({ streak_enabled: true, profile_id: 'attacker-controlled' }),
  { ok: true, update: { streak_enabled: true } }
)

console.log()
console.log(failures === 0 ? 'All validatePreferencesUpdate() assertions passed' : `${failures} validatePreferencesUpdate() assertion(s) failed`)
process.exit(failures === 0 ? 0 : 1)
