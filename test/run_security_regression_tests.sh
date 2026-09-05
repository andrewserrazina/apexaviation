#!/usr/bin/env bash
# Sprint 0 Phase 2A security regression suite.
#
# Rebuilds a disposable local database from scratch (BEFORE-state harness
# schema -> migrations v104-v109 -> fixtures), then runs the 10 required
# regression categories from the Phase 2A approval as individual psql
# invocations under SET ROLE anon/authenticated/service_role, asserting
# expected success or expected denial for each.
#
# Usage: bash test/run_security_regression_tests.sh
# Requires: local postgres superuser access via `sudo -u postgres psql`
# (matches this sandbox's setup -- adjust PSQL_BASE below for a different
# local Postgres setup, e.g. a Supabase CLI local stack).

set -uo pipefail
cd "$(dirname "$0")/.."

DB=apex_test
PSQL_BASE=(sudo -u postgres psql -d "$DB" -X -q -t -A)

PASS=0
FAIL=0
FAILURES=()

echo "=== Rebuilding test database ==="
sudo -u postgres psql -X -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"
sudo -u postgres psql -d "$DB" -X -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres;" >/dev/null
"${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f test/sql/00_harness_schema.sql >/tmp/apex_test_harness.log 2>&1 || { echo "HARNESS SCHEMA FAILED"; cat /tmp/apex_test_harness.log; exit 1; }

echo "=== Applying migrations v104-v109 ==="
for f in portal/supabase-portal-schema-v104-rpc-privilege-hardening.sql \
         portal/supabase-portal-schema-v105-function-search-path-hardening.sql \
         portal/supabase-portal-schema-v106-claim-function-service-role-only.sql \
         portal/supabase-portal-schema-v107-admin-grant-tightening.sql \
         portal/supabase-portal-schema-v108-funnel-report-gating.sql \
         portal/supabase-portal-schema-v109-notifications-insert-policy-hardening.sql; do
  "${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f "$f" >/tmp/apex_test_migration.log 2>&1 || { echo "MIGRATION FAILED: $f"; cat /tmp/apex_test_migration.log; exit 1; }
done

echo "=== Loading fixtures ==="
"${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f test/sql/01_fixtures.sql >/tmp/apex_test_fixtures.log 2>&1 || { echo "FIXTURES FAILED"; cat /tmp/apex_test_fixtures.log; exit 1; }

ADMIN=00000000-0000-0000-0000-000000000001
INSTRUCTOR=00000000-0000-0000-0000-000000000002
OFFICE=00000000-0000-0000-0000-000000000003
MEMBER_A=00000000-0000-0000-0000-000000000010
MEMBER_B=00000000-0000-0000-0000-000000000011
PACK_MEMBER=00000000-0000-0000-0000-000000000012
CLASS_ID=00000000-0000-0000-0000-0000000000c1
SESSION_ID=00000000-0000-0000-0000-00000000000a

run_sql() {
  # $1=role $2=uid(or empty) $3=sql
  local role="$1" uid="$2" sql="$3"
  {
    echo "set role $role;"
    if [ -n "$uid" ]; then echo "set myapp.uid = '$uid';"; fi
    echo "set myapp.role = '$role';"
    echo "$sql"
  } | "${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 2>&1
}

expect_denied() {
  local desc="$1" role="$2" uid="$3" sql="$4"
  local out; out=$(run_sql "$role" "$uid" "$sql"); local rc=$?
  if [ $rc -ne 0 ] && echo "$out" | grep -qiE "permission denied|not authorized|admin access required|instructor access required|authentication required|not signed in|row-level security|has not unlocked"; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc"; echo "  -> rc=$rc output: $(echo "$out" | tr '\n' ' ')"; FAIL=$((FAIL+1)); FAILURES+=("$desc")
  fi
}

expect_success() {
  local desc="$1" role="$2" uid="$3" sql="$4"
  local out; out=$(run_sql "$role" "$uid" "$sql"); local rc=$?
  if [ $rc -eq 0 ]; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc"; echo "  -> rc=$rc output: $(echo "$out" | tr '\n' ' ')"; FAIL=$((FAIL+1)); FAILURES+=("$desc")
  fi
}

expect_rows() {
  # $1=desc $2=role $3=uid $4=sql (must return exactly one row, one col) $5=expected value
  local desc="$1" role="$2" uid="$3" sql="$4" expected="$5"
  local out; out=$(run_sql "$role" "$uid" "$sql")
  out=$(echo "$out" | tail -1 | xargs)
  if [ "$out" = "$expected" ]; then
    echo "PASS: $desc"; PASS=$((PASS+1))
  else
    echo "FAIL: $desc (expected '$expected', got '$out')"; FAIL=$((FAIL+1)); FAILURES+=("$desc")
  fi
}

echo
echo "########## 1. GROUND SCHOOL FORGERY ##########"
# NOTE: the 6-arg and 7-arg confirm_scheduled_ground_class_enrollment
# overloads share the same first 6 parameter names/types, and the 7-arg
# overload's extra p_payment_status has a DEFAULT -- Postgres treats a
# call supplying exactly those 6 (named OR positional, even with exact
# type casts) as genuinely ambiguous between the two candidates and
# refuses to pick one ("function ... is not unique"), REGARDLESS OF ROLE
# OR GRANTS. Confirmed empirically against both this harness and the live
# production database (read-only diagnostic call, no rows touched) during
# Phase 2A test-writing -- this is a pre-existing production bug,
# unrelated to and unaffected by this migration, not introduced or fixed
# by it. See SPRINT_0_PHASE_2A_REPORT.md "Remaining Risks" for the full
# writeup and recommended emergency follow-up (out of scope for this
# security-hardening-only sprint). Grant correctness for the 6-arg
# overload is therefore verified via has_function_privilege() metadata
# instead of a live call, since no live call can ever reach it.
expect_rows "confirm_scheduled_ground_class_enrollment(6-arg): anon EXECUTE revoked" postgres "" \
  "select has_function_privilege('anon', 'public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer)', 'EXECUTE');" "f"
expect_rows "confirm_scheduled_ground_class_enrollment(6-arg): authenticated EXECUTE revoked" postgres "" \
  "select has_function_privilege('authenticated', 'public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer)', 'EXECUTE');" "f"
expect_rows "confirm_scheduled_ground_class_enrollment(6-arg): service_role EXECUTE preserved" postgres "" \
  "select has_function_privilege('service_role', 'public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer)', 'EXECUTE');" "t"
expect_denied "anon direct RPC confirm_scheduled_ground_class_enrollment(7-arg) -> denied" anon "" \
  "select public.confirm_scheduled_ground_class_enrollment('$CLASS_ID','Forger','forger@evil.test','$MEMBER_A','forged-3',0,'ground_school_pack');"
expect_denied "authenticated member direct RPC confirm_scheduled_ground_class_enrollment(7-arg) -> denied" authenticated "$MEMBER_A" \
  "select public.confirm_scheduled_ground_class_enrollment('$CLASS_ID','Forger','forger@evil.test','$MEMBER_A','forged-4',0,'ground_school_pack');"
expect_success "service-role confirm_scheduled_ground_class_enrollment(7-arg) still works" service_role "" \
  "select public.confirm_scheduled_ground_class_enrollment('$CLASS_ID','Real Student','real@test.local','$MEMBER_B','real-stripe-session-1',2500,'paid');"
expect_success "enroll_in_ground_school_via_pack still works for an entitled learner" authenticated "$PACK_MEMBER" \
  "select public.enroll_in_ground_school_via_pack('$CLASS_ID');"
expect_denied "enroll_in_ground_school_via_pack still rejects a non-entitled learner" authenticated "$MEMBER_A" \
  "select public.enroll_in_ground_school_via_pack('$CLASS_ID');"

echo
echo "########## 2. LEGACY GROUND REGISTRATION ##########"
expect_denied "anon direct confirm_legacy_ground_registration -> denied" anon "" \
  "select public.confirm_legacy_ground_registration('$SESSION_ID','Forger','forger@evil.test','$MEMBER_A','forged-legacy-1',0);"
expect_denied "authenticated member direct confirm_legacy_ground_registration -> denied" authenticated "$MEMBER_A" \
  "select public.confirm_legacy_ground_registration('$SESSION_ID','Forger','forger@evil.test','$MEMBER_A','forged-legacy-2',0);"
expect_success "service-role (stripe-webhook) confirm_legacy_ground_registration still works" service_role "" \
  "select public.confirm_legacy_ground_registration('$SESSION_ID','Real Student','real2@test.local','$MEMBER_B','real-legacy-session-1',2500);"

echo
echo "########## 3. XP ##########"
expect_denied "anon direct award_xp -> denied" anon "" \
  "select public.award_xp('$MEMBER_A','forged_xp',99999,'x','forged-xp-1');"
expect_denied "authenticated member direct award_xp -> denied" authenticated "$MEMBER_A" \
  "select public.award_xp('$MEMBER_A','forged_xp',99999,'x','forged-xp-2');"
expect_success "practice-attempt trigger XP path still works" service_role "" \
  "insert into public.stub_practice_attempts (profile_id, completed_at) values ('$MEMBER_A', now());"
expect_success "admin_award_xp still works for a real admin" authenticated "$ADMIN" \
  "select public.admin_award_xp('$MEMBER_A', 10, 'test bonus');"
expect_denied "admin_award_xp still rejects a non-admin" authenticated "$MEMBER_A" \
  "select public.admin_award_xp('$MEMBER_B', 10, 'test bonus');"
expect_rows "no duplicate XP from a retried admin_award_xp with the same idempotency key" service_role "" \
  "select public.award_xp('$MEMBER_A','retry_test',5,'src','same-key-1')::text || ',' || public.award_xp('$MEMBER_A','retry_test',5,'src','same-key-1')::text;" \
  "true,false"

echo
echo "########## 4. CLAIM FUNCTIONS ##########"
expect_denied "anon direct claim_ground_school_enrollments_by_email -> denied" anon "" \
  "select public.claim_ground_school_enrollments_by_email('$MEMBER_A','real2@test.local');"
expect_denied "authenticated direct claim_ground_school_enrollments_by_email -> denied" authenticated "$MEMBER_A" \
  "select public.claim_ground_school_enrollments_by_email('$MEMBER_A','real2@test.local');"
expect_success "service-role (create-free-account) claim_ground_school_enrollments_by_email still works" service_role "" \
  "select public.claim_ground_school_enrollments_by_email('$MEMBER_B','real2@test.local');"
expect_denied "anon direct claim_readiness_assessment_by_email -> denied" anon "" \
  "select public.claim_readiness_assessment_by_email('$MEMBER_A','membera@test.local');"
expect_success "service-role (create-free-account) claim_readiness_assessment_by_email still works" service_role "" \
  "select public.claim_readiness_assessment_by_email('$MEMBER_A','membera@test.local');"
expect_denied "authenticated direct record_referral_signup -> denied" authenticated "$MEMBER_A" \
  "select public.record_referral_signup('$MEMBER_A','membera@test.local',null);"
expect_success "service-role (create-free-account) record_referral_signup still works" service_role "" \
  "select public.record_referral_signup('$MEMBER_A','membera@test.local',null);"

echo
echo "########## 5. ADMIN RPCS ##########"
expect_denied "member -> rejected on get_retention_kpis" authenticated "$MEMBER_A" "select public.get_retention_kpis();"
expect_success "authorized admin -> succeeds on get_retention_kpis" authenticated "$ADMIN" "select public.get_retention_kpis();"
expect_denied "anon -> no EXECUTE on get_retention_kpis" anon "" "select public.get_retention_kpis();"
expect_denied "anon -> no EXECUTE on admin_award_xp" anon "" "select public.admin_award_xp('$MEMBER_A', 1, 'x');"

echo
echo "########## 6. PROFILE PRIVILEGE REGRESSION ##########"
run_sql authenticated "$MEMBER_A" "update public.profiles set role='admin', checkride_prep_unlocked=true where id='$MEMBER_A';" >/dev/null
expect_rows "self-escalation attempt on role/checkride_prep_unlocked has no effect" postgres "" \
  "select role || ',' || checkride_prep_unlocked::text from public.profiles where id='$MEMBER_A';" \
  "student,false"

echo
echo "########## 7. AI TABLES ##########"
expect_denied "authenticated client direct INSERT into ai_dpe_sessions -> denied" authenticated "$MEMBER_A" \
  "insert into public.ai_dpe_sessions (profile_id) values ('$MEMBER_A');"
expect_denied "authenticated client direct INSERT into ai_cfi_messages -> denied" authenticated "$MEMBER_A" \
  "insert into public.ai_cfi_messages (profile_id, content) values ('$MEMBER_A', 'hi');"
expect_success "owner can still read own ai_dpe_sessions row" authenticated "$MEMBER_A" \
  "select count(*) from public.ai_dpe_sessions where profile_id='$MEMBER_A';"

echo
echo "########## 8. ENTITLEMENTS ##########"
expect_denied "member cannot insert study_pack_entitlements for self" authenticated "$MEMBER_A" \
  "insert into public.study_pack_entitlements (profile_id, pack_id, source) values ('$MEMBER_A','free-pack','self-grant');"
expect_success "admin grant to study_pack_entitlements still works" authenticated "$ADMIN" \
  "insert into public.study_pack_entitlements (profile_id, pack_id, source) values ('$MEMBER_A','admin-granted-pack','admin_grant');"

echo
echo "########## 9. NOTIFICATIONS (migration 006) ##########"
expect_denied "anon cannot insert notification" anon "" \
  "insert into public.notifications (user_id, title, body, type) values ('$MEMBER_B','x','x','info');"
expect_denied "normal member cannot insert notification targeting another user" authenticated "$MEMBER_A" \
  "insert into public.notifications (user_id, title, body, type) values ('$MEMBER_B','phish','phish','info');"
expect_success "instructor (authorized producer) can insert a notification" authenticated "$INSTRUCTOR" \
  "insert into public.notifications (user_id, title, body, type) values ('$MEMBER_A','Lesson Approved','Your lesson was approved','success');"
expect_success "admin (authorized producer) can insert a notification" authenticated "$ADMIN" \
  "insert into public.notifications (user_id, title, body, type) values ('$MEMBER_A','Admin note','hi','info');"
expect_success "normal user can still SELECT own notifications" authenticated "$MEMBER_A" \
  "select count(*) from public.notifications where user_id='$MEMBER_A';"
expect_success "normal user can still mark own notification read" authenticated "$MEMBER_A" \
  "update public.notifications set read=true where user_id='$MEMBER_A';"
expect_rows "normal user cannot read another user's notifications" authenticated "$MEMBER_B" \
  "select count(*) from public.notifications where user_id='$MEMBER_A';" "0"

echo
echo "########## 10. CROSS-USER ISOLATION ##########"
expect_rows "member A cannot read member B's profile row" authenticated "$MEMBER_A" \
  "select count(*) from public.profiles where id='$MEMBER_B';" "0"
expect_rows "member A cannot read member B's XP ledger" authenticated "$MEMBER_A" \
  "select count(*) from public.xp_ledger where profile_id='$MEMBER_B';" "0"
expect_rows "member A cannot read member B's AI DPE sessions" authenticated "$MEMBER_A" \
  "select count(*) from public.ai_dpe_sessions where profile_id='$MEMBER_B';" "0"
expect_rows "member A cannot read member B's study pack entitlements" authenticated "$MEMBER_A" \
  "select count(*) from public.study_pack_entitlements where profile_id='$MEMBER_B';" "0"
run_sql authenticated "$MEMBER_A" "update public.profiles set full_name='hacked' where id='$MEMBER_B';" >/dev/null
expect_rows "member A's update attempt on member B's profile has no effect (RLS filters the row, 0 rows touched)" postgres "" \
  "select full_name from public.profiles where id='$MEMBER_B';" "Member B"

echo
echo "=================================================="
echo "RESULTS: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo "Failed tests:"
  printf '  - %s\n' "${FAILURES[@]}"
fi
echo "=================================================="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
