// Rev2 (independent review, Blocker 3) -- narrow, plain-Node unit
// coverage for mobile-practice's acs_task_id decision logic. This is NOT
// a substitute for real Edge Function integration tests (there is no
// deno/supabase-cli runtime in this sandbox -- see
// SPRINT_1B_V119_PRACTICE_CONTRACT_REPORT.md's Rev2 section for the
// documented limitation); it exercises the actual exported
// validateAcsTaskId() function from validateAcsTaskId.ts (compiled to
// plain JS by test/run_security_regression_tests.sh immediately before
// this runs), not a hand-written duplicate of its logic, so it cannot
// silently drift from what index.ts really calls.
//
// Deliberately a single small script, not a test framework -- run
// directly with `node`, asserting and exiting nonzero on first failure.
import { validateAcsTaskId } from './__v119_compiled/validateAcsTaskId.js'

let failures = 0

function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`)
  if (!pass) {
    console.log(`  -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    failures++
  }
}

// REV2.8: field omitted entirely -> general practice (acsTaskId: null), not rejected.
check('REV2.8: acs_task_id omitted -> valid, general practice (null)', validateAcsTaskId(undefined), { ok: true, acsTaskId: null })

// REV2.9: explicitly supplied empty string -> rejected, never treated as general.
check('REV2.9: acs_task_id="" (empty string) -> rejected', validateAcsTaskId(''), { ok: false })

// REV2.10: explicitly supplied whitespace-only string -> rejected.
check('REV2.10: acs_task_id="   " (whitespace only) -> rejected', validateAcsTaskId('   '), { ok: false })

// REV2.11: explicitly supplied non-string / null values -> rejected.
check('REV2.11a: acs_task_id=null (explicitly supplied) -> rejected', validateAcsTaskId(null), { ok: false })
check('REV2.11b: acs_task_id=123 (non-string) -> rejected', validateAcsTaskId(123), { ok: false })
check('REV2.11c: acs_task_id=true (non-string) -> rejected', validateAcsTaskId(true), { ok: false })
check('REV2.11d: acs_task_id={} (non-string) -> rejected', validateAcsTaskId({}), { ok: false })
check('REV2.11e: acs_task_id="not-a-uuid" (malformed shape) -> rejected', validateAcsTaskId('not-a-uuid'), { ok: false })

// REV2.12: a genuinely valid ACS task id (UUID shape) is accepted and passed through untouched.
check(
  'REV2.12: a valid UUID acs_task_id is accepted and passed through',
  validateAcsTaskId('3fa85f64-5717-4562-b3fc-2c963f66afa6'),
  { ok: true, acsTaskId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
)
// A surrounding-whitespace valid UUID is trimmed, not rejected.
check(
  'REV2.12b: a valid UUID with surrounding whitespace is trimmed and accepted',
  validateAcsTaskId('  3fa85f64-5717-4562-b3fc-2c963f66afa6  '),
  { ok: true, acsTaskId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
)

if (failures > 0) {
  console.log(`\n${failures} validateAcsTaskId() assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll validateAcsTaskId() assertions passed')
