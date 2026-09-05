#!/usr/bin/env bash
# Sprint 0 Phase 2A/2B security + Ground School hotfix regression suite.
#
# Rebuilds a disposable local database from scratch (BEFORE-state harness
# schema -> migrations v104-v109 -> fixtures -> BEFORE-FIX reproduction of
# the Ground School RPC ambiguity -> v110 hotfix -> fixtures round 2 -> the
# full regression set), then runs every assertion as an individual psql
# invocation under SET ROLE anon/authenticated/service_role, asserting
# expected success or expected denial for each.
#
# Named-parameter calls below (`p_x => value`) are the SQL-level mechanism
# PostgREST itself uses to resolve a `supabase.rpc('fn', {p_x: value})`
# call into a Postgres function call -- both go through Postgres's normal
# named-argument function resolution. This was confirmed to reproduce the
# exact production ambiguity error (Section "0. BEFORE-FIX REPRODUCTION"
# below), including against the live database itself (a safe, read-only,
# no-op diagnostic call during Phase 2A), so it is a faithful proxy for
# supabase-js's actual call shape without needing a full local PostgREST
# instance (unavailable in this sandbox -- no `postgrest` binary, no
# working Docker daemon).
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

expect_error_matching() {
  # $1=desc $2=role $3=uid $4=sql $5=regex the error text must match
  local desc="$1" role="$2" uid="$3" sql="$4" pattern="$5"
  local out; out=$(run_sql "$role" "$uid" "$sql"); local rc=$?
  if [ $rc -ne 0 ] && echo "$out" | grep -qiE "$pattern"; then
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

ADMIN=00000000-0000-0000-0000-000000000001
INSTRUCTOR=00000000-0000-0000-0000-000000000002
OFFICE=00000000-0000-0000-0000-000000000003
MEMBER_A=00000000-0000-0000-0000-000000000010
MEMBER_B=00000000-0000-0000-0000-000000000011
PACK_MEMBER=00000000-0000-0000-0000-000000000012
CLASS_ID=00000000-0000-0000-0000-0000000000c1
CLASS_FULL_ID=00000000-0000-0000-0000-0000000000c2
SESSION_ID=00000000-0000-0000-0000-00000000000a

echo "=== Rebuilding test database ==="
sudo -u postgres psql -X -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;"
sudo -u postgres psql -d "$DB" -X -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres;" >/dev/null
"${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f test/sql/00_harness_schema.sql >/tmp/apex_test_harness.log 2>&1 || { echo "HARNESS SCHEMA FAILED"; cat /tmp/apex_test_harness.log; exit 1; }

echo "=== Applying migrations v104-v109 (security hardening, Phase 2A) ==="
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

echo
echo "########## 0. BEFORE-FIX REPRODUCTION (Phase 2B required test #1) ##########"
echo "v104-v109 applied, v110 NOT yet applied -- both confirm_scheduled_ground_class_enrollment"
echo "overloads still exist. Reproducing the exact production failure mode: a named-parameter"
echo "RPC call (the same resolution mechanism PostgREST uses) supplying only the six parameters"
echo "shared by both overloads -- exactly what stripe-webhook sent before this fix."
BEFORE_OUT=$(run_sql service_role "" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_ID'::uuid, p_full_name => 'Repro', p_email => 'repro@test.local', p_profile_id => '$MEMBER_A'::uuid, p_stripe_session_id => 'repro-ambiguous-1', p_amount_cents => 2500);")
if echo "$BEFORE_OUT" | grep -qi "is not unique"; then
  echo "PASS: before-fix six-named-parameter RPC call reproduces the exact production ambiguity error"
  echo "  -> exact error: $(echo "$BEFORE_OUT" | grep -i 'is not unique' | head -1 | xargs)"
  PASS=$((PASS+1))
else
  echo "FAIL: before-fix reproduction did not reproduce the expected ambiguity error"
  echo "  -> output: $(echo "$BEFORE_OUT" | tr '\n' ' ')"
  FAIL=$((FAIL+1)); FAILURES+=("before-fix ambiguity reproduction")
fi

echo
echo "=== Applying v110 (Ground School RPC overload fix, Phase 2B) ==="
"${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f portal/supabase-portal-schema-v110-ground-school-rpc-overload-fix.sql >/tmp/apex_test_v110.log 2>&1 || { echo "V110 MIGRATION FAILED"; cat /tmp/apex_test_v110.log; exit 1; }

echo "=== Applying v111 (mission/streak client lockout) ==="
"${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f portal/supabase-portal-schema-v111-mission-streak-client-lockout.sql >/tmp/apex_test_v111.log 2>&1 || { echo "V111 MIGRATION FAILED"; cat /tmp/apex_test_v111.log; exit 1; }

echo "=== Applying v112-v116 (Phase C mobile backend primitives, source-controlled only) ==="
for f in portal/supabase-portal-schema-v112-acs-normalization.sql \
         portal/supabase-portal-schema-v113-task-evidence.sql \
         portal/supabase-portal-schema-v114-readiness-snapshots.sql \
         portal/supabase-portal-schema-v115-daily-drills.sql \
         portal/supabase-portal-schema-v116-mobile-device-notification-model.sql; do
  "${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f "$f" >/tmp/apex_test_migration.log 2>&1 || { echo "MIGRATION FAILED: $f"; cat /tmp/apex_test_migration.log; exit 1; }
done

echo
echo "########## 1. GROUND SCHOOL FORGERY (post-v110) ##########"
expect_rows "confirm_scheduled_ground_class_enrollment(6-arg) no longer exists after v110" postgres "" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_scheduled_ground_class_enrollment' and pg_get_function_identity_arguments(p.oid)='uuid, text, text, uuid, text, integer';" "0"
expect_rows "confirm_scheduled_ground_class_enrollment: exactly one signature remains after v110" postgres "" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_scheduled_ground_class_enrollment';" "1"
expect_rows "confirm_scheduled_ground_class_enrollment(7-arg): anon EXECUTE still revoked after v110" postgres "" \
  "select has_function_privilege('anon', 'public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)', 'EXECUTE');" "f"
expect_rows "confirm_scheduled_ground_class_enrollment(7-arg): authenticated EXECUTE still revoked after v110" postgres "" \
  "select has_function_privilege('authenticated', 'public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)', 'EXECUTE');" "f"
expect_rows "confirm_scheduled_ground_class_enrollment(7-arg): service_role EXECUTE preserved after v110" postgres "" \
  "select has_function_privilege('service_role', 'public.confirm_scheduled_ground_class_enrollment(uuid,text,text,uuid,text,integer,text)', 'EXECUTE');" "t"
expect_denied "anon direct RPC (named params, 7-arg) -> denied" anon "" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_ID'::uuid, p_full_name => 'Forger', p_email => 'forger@evil.test', p_profile_id => '$MEMBER_A'::uuid, p_stripe_session_id => 'forged-3', p_amount_cents => 0, p_payment_status => 'ground_school_pack');"
expect_denied "authenticated member direct RPC (named params, 7-arg) -> denied" authenticated "$MEMBER_A" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_ID'::uuid, p_full_name => 'Forger', p_email => 'forger@evil.test', p_profile_id => '$MEMBER_A'::uuid, p_stripe_session_id => 'forged-4', p_amount_cents => 0, p_payment_status => 'ground_school_pack');"

echo
echo "########## 2. PAID STRIPE PATH (Phase 2B required test #2) ##########"
echo "Named-parameter call matching the FIXED stripe-webhook code exactly (7 named args"
echo "including p_payment_status: 'paid')."
BEFORE_COUNT=$(run_sql postgres "" "select enrolled_count from public.scheduled_ground_classes where id='$CLASS_ID';" | tail -1 | xargs)
expect_success "exactly one RPC resolves for the fixed stripe-webhook call shape; paid enrollment inserted" service_role "" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_ID'::uuid, p_full_name => 'Real Student', p_email => 'realstripe@test.local', p_profile_id => '$MEMBER_B'::uuid, p_stripe_session_id => 'real-stripe-session-2', p_amount_cents => 2500, p_payment_status => 'paid');"
AFTER_COUNT=$(run_sql postgres "" "select enrolled_count from public.scheduled_ground_classes where id='$CLASS_ID';" | tail -1 | xargs)
if [ "$AFTER_COUNT" -eq "$((BEFORE_COUNT + 1))" ]; then
  echo "PASS: enrolled_count incremented exactly once"; PASS=$((PASS+1))
else
  echo "FAIL: enrolled_count expected $((BEFORE_COUNT + 1)), got $AFTER_COUNT"; FAIL=$((FAIL+1)); FAILURES+=("enrolled_count increment on paid path")
fi
expect_rows "payment_status is 'paid' on the inserted row" postgres "" \
  "select payment_status from public.scheduled_ground_class_enrollments where stripe_session_id='real-stripe-session-2';" "paid"
expect_success "retry with the SAME stripe_session_id is idempotent (returns existing row, no error)" service_role "" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_ID'::uuid, p_full_name => 'Real Student', p_email => 'realstripe@test.local', p_profile_id => '$MEMBER_B'::uuid, p_stripe_session_id => 'real-stripe-session-2', p_amount_cents => 2500, p_payment_status => 'paid');"
RETRY_COUNT=$(run_sql postgres "" "select enrolled_count from public.scheduled_ground_classes where id='$CLASS_ID';" | tail -1 | xargs)
if [ "$RETRY_COUNT" -eq "$AFTER_COUNT" ]; then
  echo "PASS: retried call did not double-increment enrolled_count"; PASS=$((PASS+1))
else
  echo "FAIL: enrolled_count changed on retry ($AFTER_COUNT -> $RETRY_COUNT)"; FAIL=$((FAIL+1)); FAILURES+=("idempotent retry did not double count")
fi

echo
echo "########## 3. PACK PATH (Phase 2B required test #3) ##########"
PACK_BEFORE=$(run_sql postgres "" "select enrolled_count from public.scheduled_ground_classes where id='$CLASS_ID';" | tail -1 | xargs)
expect_success "enroll_in_ground_school_via_pack still works for an entitled learner" authenticated "$PACK_MEMBER" \
  "select public.enroll_in_ground_school_via_pack('$CLASS_ID');"
expect_denied "enroll_in_ground_school_via_pack still rejects a non-entitled learner (entitlement check remains server-side)" authenticated "$MEMBER_A" \
  "select public.enroll_in_ground_school_via_pack('$CLASS_ID');"
expect_rows "pack enrollment payment_status is 'ground_school_pack'" postgres "" \
  "select payment_status from public.scheduled_ground_class_enrollments where scheduled_ground_class_id='$CLASS_ID' and lower(email)=lower((select email from public.profiles where id='$PACK_MEMBER'));" "ground_school_pack"
PACK_AFTER=$(run_sql postgres "" "select enrolled_count from public.scheduled_ground_classes where id='$CLASS_ID';" | tail -1 | xargs)
if [ "$PACK_AFTER" -eq "$((PACK_BEFORE + 1))" ]; then
  echo "PASS: pack enrollment incremented enrolled_count exactly once"; PASS=$((PASS+1))
else
  echo "FAIL: enrolled_count expected $((PACK_BEFORE + 1)), got $PACK_AFTER"; FAIL=$((FAIL+1)); FAILURES+=("enrolled_count increment on pack path")
fi
expect_success "pack path retry does not error (returns existing row via email+class+status match)" authenticated "$PACK_MEMBER" \
  "select public.enroll_in_ground_school_via_pack('$CLASS_ID');"
PACK_RETRY=$(run_sql postgres "" "select enrolled_count from public.scheduled_ground_classes where id='$CLASS_ID';" | tail -1 | xargs)
if [ "$PACK_RETRY" -eq "$PACK_AFTER" ]; then
  echo "PASS: pack path retry did not double-count enrolled_count"; PASS=$((PASS+1))
else
  echo "FAIL: enrolled_count changed on pack retry ($PACK_AFTER -> $PACK_RETRY)"; FAIL=$((FAIL+1)); FAILURES+=("pack retry did not double count")
fi

echo
echo "########## 4. SIX-PARAMETER POST-v110 STATE (Phase 2B required test #4) ##########"
echo "v110 removed the DEFAULT on p_payment_status, so a six-parameter call must now fail"
echo "clearly (function does not exist) rather than resolve ambiguously or silently."
expect_error_matching "six-named-parameter RPC call fails clearly (function does not exist) after v110" service_role "" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_ID'::uuid, p_full_name => 'X', p_email => 'x@test.local', p_profile_id => '$MEMBER_A'::uuid, p_stripe_session_id => 'six-param-post-v110', p_amount_cents => 2500);" \
  "does not exist"

echo
echo "########## 5. STRIPE WEBHOOK ERROR PATH (Phase 2B required test #5) ##########"
echo "DB-boundary test: asserts the RPC-level success/error signal stripe-webhook's own"
echo "refund-vs-complete branching switches on. No live Stripe charge is issued anywhere"
echo "in this suite -- Stripe itself is out of scope for a database test harness."
expect_error_matching "a real capacity failure still raises 'is full' (drives the webhook's existing refund path)" service_role "" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_FULL_ID'::uuid, p_full_name => 'Late Student', p_email => 'late@test.local', p_profile_id => '$MEMBER_A'::uuid, p_stripe_session_id => 'capacity-test-1', p_amount_cents => 2500, p_payment_status => 'paid');" \
  "is full"
expect_success "the fixed successful-enrollment call raises NO error (must not trigger refund)" service_role "" \
  "select public.confirm_scheduled_ground_class_enrollment(p_scheduled_ground_class_id => '$CLASS_ID'::uuid, p_full_name => 'Another Student', p_email => 'another@test.local', p_profile_id => '$MEMBER_A'::uuid, p_stripe_session_id => 'success-no-refund-1', p_amount_cents => 2500, p_payment_status => 'paid');"

echo
echo "########## 6. LEGACY GROUND REGISTRATION (unchanged by v110, re-verified) ##########"
expect_denied "anon direct confirm_legacy_ground_registration -> denied" anon "" \
  "select public.confirm_legacy_ground_registration('$SESSION_ID','Forger','forger@evil.test','$MEMBER_A','forged-legacy-1',0);"
expect_denied "authenticated member direct confirm_legacy_ground_registration -> denied" authenticated "$MEMBER_A" \
  "select public.confirm_legacy_ground_registration('$SESSION_ID','Forger','forger@evil.test','$MEMBER_A','forged-legacy-2',0);"
expect_success "service-role (stripe-webhook) confirm_legacy_ground_registration still works" service_role "" \
  "select public.confirm_legacy_ground_registration('$SESSION_ID','Real Student','real2@test.local','$MEMBER_B','real-legacy-session-1',2500);"

echo
echo "########## 7. XP ##########"
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
echo "########## 8. CLAIM FUNCTIONS ##########"
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
echo "########## 9. ADMIN RPCS ##########"
expect_denied "member -> rejected on get_retention_kpis" authenticated "$MEMBER_A" "select public.get_retention_kpis();"
expect_success "authorized admin -> succeeds on get_retention_kpis" authenticated "$ADMIN" "select public.get_retention_kpis();"
expect_denied "anon -> no EXECUTE on get_retention_kpis" anon "" "select public.get_retention_kpis();"
expect_denied "anon -> no EXECUTE on admin_award_xp" anon "" "select public.admin_award_xp('$MEMBER_A', 1, 'x');"

echo
echo "########## 10. PROFILE PRIVILEGE REGRESSION ##########"
run_sql authenticated "$MEMBER_A" "update public.profiles set role='admin', checkride_prep_unlocked=true where id='$MEMBER_A';" >/dev/null
expect_rows "self-escalation attempt on role/checkride_prep_unlocked has no effect" postgres "" \
  "select role || ',' || checkride_prep_unlocked::text from public.profiles where id='$MEMBER_A';" \
  "student,false"

echo
echo "########## 11. AI TABLES ##########"
expect_denied "authenticated client direct INSERT into ai_dpe_sessions -> denied" authenticated "$MEMBER_A" \
  "insert into public.ai_dpe_sessions (profile_id) values ('$MEMBER_A');"
expect_denied "authenticated client direct INSERT into ai_cfi_messages -> denied" authenticated "$MEMBER_A" \
  "insert into public.ai_cfi_messages (profile_id, content) values ('$MEMBER_A', 'hi');"
expect_success "owner can still read own ai_dpe_sessions row" authenticated "$MEMBER_A" \
  "select count(*) from public.ai_dpe_sessions where profile_id='$MEMBER_A';"

echo
echo "########## 12. ENTITLEMENTS ##########"
expect_denied "member cannot insert study_pack_entitlements for self" authenticated "$MEMBER_A" \
  "insert into public.study_pack_entitlements (profile_id, pack_id, source) values ('$MEMBER_A','free-pack','self-grant');"
expect_success "admin grant to study_pack_entitlements still works" authenticated "$ADMIN" \
  "insert into public.study_pack_entitlements (profile_id, pack_id, source) values ('$MEMBER_A','admin-granted-pack','admin_grant');"

echo
echo "########## 13. NOTIFICATIONS (migration 006) ##########"
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
echo "########## 14. CROSS-USER ISOLATION ##########"
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

MISSION_MEMBER=00000000-0000-0000-0000-000000000020
STREAK_MEMBER=00000000-0000-0000-0000-000000000021

echo
echo "########## 15. MISSION/STREAK CLIENT LOCKOUT (Phase B / v111) ##########"
expect_denied "anon direct RPC run_streak_maintenance -> denied" anon "" \
  "select public.run_streak_maintenance();"
expect_denied "anon direct RPC refresh_mission_progress -> denied" anon "" \
  "select public.refresh_mission_progress();"
expect_denied "authenticated member direct RPC run_streak_maintenance -> denied" authenticated "$MEMBER_A" \
  "select public.run_streak_maintenance();"
expect_denied "authenticated member direct RPC refresh_mission_progress -> denied" authenticated "$MEMBER_A" \
  "select public.refresh_mission_progress();"
expect_success "service-role run_streak_maintenance succeeds (lifecycle path)" service_role "" \
  "select public.run_streak_maintenance();"
expect_success "service-role refresh_mission_progress succeeds (lifecycle path)" service_role "" \
  "select public.refresh_mission_progress();"

echo
echo "--- MISSION BEHAVIOR: progress is still recomputed correctly ---"
expect_success "refresh_mission_progress runs clean against real mission/profile data" service_role "" \
  "select public.refresh_mission_progress();"
expect_rows "study_days mission marked complete for a member who studied today" postgres "" \
  "select (completed_at is not null) from public.member_mission_progress where profile_id='$MISSION_MEMBER' and mission_id='00000000-0000-0000-0000-0000000000e1';" "t"
expect_rows "mission completion awarded XP exactly once (not duplicated by the second run above)" postgres "" \
  "select count(*) from public.xp_ledger where profile_id='$MISSION_MEMBER' and event_type='mission_completed' and source_id='00000000-0000-0000-0000-0000000000e1';" "1"

echo
echo "--- STREAK BEHAVIOR: freeze/recovery-sortie maintenance still behaves correctly ---"
expect_success "run_streak_maintenance runs clean against real streak data" service_role "" \
  "select public.run_streak_maintenance();"
expect_rows "a missed day with zero freezes banked offers a Recovery Sortie" postgres "" \
  "select count(*) from public.recovery_sorties where profile_id='$STREAK_MEMBER' and missed_date = current_date - 1;" "1"
expect_success "run_streak_maintenance is safe to run twice in a row (no duplicate-key error)" service_role "" \
  "select public.run_streak_maintenance();"
expect_rows "a second run does not create a duplicate Recovery Sortie for the same missed day" postgres "" \
  "select count(*) from public.recovery_sorties where profile_id='$STREAK_MEMBER' and missed_date = current_date - 1;" "1"

MOBILE_MEMBER=00000000-0000-0000-0000-000000000030
NO_ENTITLEMENT_MEMBER=00000000-0000-0000-0000-000000000031

echo
echo "########## 16. ACS NORMALIZATION (Phase C1 / v112) ##########"
expect_success "anyone (anon) can read acs_versions (reference data)" anon "" \
  "select count(*) from public.acs_versions;"
expect_success "anyone (anon) can read acs_tasks (reference data)" anon "" \
  "select count(*) from public.acs_tasks;"
expect_success "anyone (anon) can read content_acs_mappings (reference data)" anon "" \
  "select count(*) from public.content_acs_mappings;"
expect_denied "authenticated cannot INSERT into acs_versions directly" authenticated "$MOBILE_MEMBER" \
  "insert into public.acs_versions (certificate_type, version_code) values ('commercial','forged');"
expect_denied "authenticated cannot INSERT into acs_tasks directly" authenticated "$MOBILE_MEMBER" \
  "insert into public.acs_tasks (acs_version_id, area_code, area_title, task_code, task_title) values ((select id from public.acs_versions limit 1),'Z','Forged','Z','Forged');"
expect_denied "authenticated cannot INSERT into content_acs_mappings directly" authenticated "$MOBILE_MEMBER" \
  "insert into public.content_acs_mappings (content_type, content_id, acs_task_id) values ('dpe_question','q1',(select id from public.acs_tasks limit 1));"
expect_rows "backfill created exactly 2 acs_tasks for private_pilot (Area I Task A, Area I Task B)" postgres "" \
  "select count(*) from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot';" "2"
expect_rows "q1 and q2 (same area/task/title) resolve to the SAME acs_task_id (title-consistency path)" postgres "" \
  "select (select acs_task_id from public.content_acs_mappings where content_id='q1') = (select acs_task_id from public.content_acs_mappings where content_id='q2');" "t"
expect_rows "q6 (a distinct task) resolves to a DIFFERENT acs_task_id than q1" postgres "" \
  "select (select acs_task_id from public.content_acs_mappings where content_id='q6') <> (select acs_task_id from public.content_acs_mappings where content_id='q1');" "t"
expect_rows "q3 (multi-task '/') is unmapped and reported with the correct reason" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q3';" "multi_task_reference_needs_human_disambiguation"
expect_rows "q4 (Special Emphasis Area) is unmapped and reported with the correct reason" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q4';" "special_emphasis_area_no_single_task"
expect_rows "q5 (no recognizable shape) is unmapped and reported with the correct reason" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q5';" "does_not_match_known_acs_reference_shape"
expect_rows "q1/q2/q6 (resolved rows) do NOT appear in acs_unresolved_mappings" postgres "" \
  "select count(*) from public.acs_unresolved_mappings where content_id in ('q1','q2','q6');" "0"
expect_denied "authenticated has no SELECT on acs_unresolved_mappings (service_role-only report)" authenticated "$MOBILE_MEMBER" \
  "select count(*) from public.acs_unresolved_mappings;"
expect_success "service_role can read acs_unresolved_mappings" service_role "" \
  "select count(*) from public.acs_unresolved_mappings;"

echo
echo "########## 17. TASK EVIDENCE (Phase C2 / v113) ##########"
TASK_IA="(select t.id from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and t.area_code='I' and t.task_code='A')"
expect_denied "anon direct RPC record_task_evidence -> denied" anon "" \
  "select public.record_task_evidence('$MOBILE_MEMBER'::uuid, $TASK_IA, true);"
expect_denied "authenticated direct RPC record_task_evidence -> denied (server-side-only write path)" authenticated "$MOBILE_MEMBER" \
  "select public.record_task_evidence('$MOBILE_MEMBER'::uuid, $TASK_IA, true);"
expect_success "service_role record_task_evidence succeeds (first correct attempt)" service_role "" \
  "select public.record_task_evidence('$MOBILE_MEMBER'::uuid, $TASK_IA, true);"
expect_rows "1 correct / 1 attempt -> evidence_score dampened by volume (0.2000, not 1.0)" postgres "" \
  "select evidence_score from public.task_evidence where profile_id='$MOBILE_MEMBER' and acs_task_id=$TASK_IA;" "0.2000"
run_sql service_role "" "select public.record_task_evidence('$MOBILE_MEMBER'::uuid, $TASK_IA, true);" >/dev/null
run_sql service_role "" "select public.record_task_evidence('$MOBILE_MEMBER'::uuid, $TASK_IA, true);" >/dev/null
run_sql service_role "" "select public.record_task_evidence('$MOBILE_MEMBER'::uuid, $TASK_IA, true);" >/dev/null
expect_success "service_role record_task_evidence succeeds (5th attempt, saturating the volume dampener)" service_role "" \
  "select public.record_task_evidence('$MOBILE_MEMBER'::uuid, $TASK_IA, true);"
expect_rows "5 correct / 5 attempts -> evidence_score = 1.0000 (dampener fully saturated at 5+ attempts)" postgres "" \
  "select evidence_score from public.task_evidence where profile_id='$MOBILE_MEMBER' and acs_task_id=$TASK_IA;" "1.0000"
expect_rows "anon sees zero task_evidence rows (table-level SELECT is grant-default, RLS filters every row)" anon "" \
  "select count(*) from public.task_evidence;" "0"
expect_rows "member A cannot read Mobile Member's task evidence (owner-only SELECT)" authenticated "$MEMBER_A" \
  "select count(*) from public.task_evidence where profile_id='$MOBILE_MEMBER';" "0"
expect_success "Mobile Member can read their own task evidence" authenticated "$MOBILE_MEMBER" \
  "select count(*) from public.task_evidence where profile_id='$MOBILE_MEMBER';"
expect_denied "authenticated cannot directly UPDATE task_evidence (no write policy at all)" authenticated "$MOBILE_MEMBER" \
  "update public.task_evidence set evidence_score=1.0 where profile_id='$MOBILE_MEMBER';"

echo
echo "########## 18. READINESS SNAPSHOTS (Phase C3 / v114) ##########"
expect_denied "anon direct RPC compute_readiness_snapshot -> denied (not authenticated at all)" anon "" \
  "select public.compute_readiness_snapshot();"
expect_success "authenticated Mobile Member can compute their own readiness snapshot" authenticated "$MOBILE_MEMBER" \
  "select public.compute_readiness_snapshot();"
expect_rows "evidence_level is 'low' with only 5 total attempts (< 10)" postgres "" \
  "select evidence_level from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "low"
expect_rows "reason_codes flags low_sample_size when evidence_level is low" postgres "" \
  "select (reason_codes @> '[\"low_sample_size\"]'::jsonb)::text from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "true"
expect_rows "reason_codes flags confidence_calibration_not_yet_available (no real confidence data captured yet)" postgres "" \
  "select (reason_codes @> '[\"confidence_calibration_not_yet_available\"]'::jsonb)::text from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "true"
expect_rows "confidence_score defaults to a neutral 50, never fabricated" postgres "" \
  "select confidence_score from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "50"
expect_rows "overall_score computed as the documented weighted average (0.35/0.30/0.20/0.15), pre-dampening" postgres "" \
  "select overall_score from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "75.00"
expect_rows "member A sees zero rows of Mobile Member's readiness snapshots" authenticated "$MEMBER_A" \
  "select count(*) from public.readiness_snapshots where profile_id='$MOBILE_MEMBER';" "0"
expect_denied "authenticated cannot directly INSERT into readiness_snapshots (only compute_readiness_snapshot() writes)" authenticated "$MOBILE_MEMBER" \
  "insert into public.readiness_snapshots (profile_id, overall_score, coverage_score, knowledge_score, risk_management_score, confidence_score, evidence_level) values ('$MOBILE_MEMBER', 100, 100, 100, 100, 100, 'high');"

echo "--- Single-session-swing guard ---"
run_sql postgres "" \
  "insert into public.readiness_snapshots (profile_id, algorithm_version, overall_score, coverage_score, knowledge_score, risk_management_score, confidence_score, evidence_level, weak_tasks, reason_codes, evidence_volume, created_at) values ('$MOBILE_MEMBER','v1',10.00,10,10,10,10,'low','[]','[]',100,now());" >/dev/null
expect_success "recompute after seeding a fabricated prior snapshot (overall=10, evidence_volume=100) still succeeds" authenticated "$MOBILE_MEMBER" \
  "select public.compute_readiness_snapshot();"
expect_rows "a >15-point swing NOT backed by proportional new evidence (5 attempts vs. prior volume 100) is clamped to a 15-point move" postgres "" \
  "select overall_score from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "25.00"
expect_rows "the clamp is recorded via reason_codes: score_change_dampened" postgres "" \
  "select (reason_codes @> '[\"score_change_dampened\"]'::jsonb)::text from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "true"

echo
echo "########## 19. DAILY DRILLS (Phase C4 / v115) ##########"
expect_denied "anon direct RPC get_or_create_daily_drill -> denied" anon "" \
  "select public.get_or_create_daily_drill();"
expect_error_matching "non-entitled learner is rejected server-side (entitlement is never caller-supplied)" authenticated "$NO_ENTITLEMENT_MEMBER" \
  "select public.get_or_create_daily_drill();" "not unlocked"
expect_success "entitled Mobile Member can generate today's daily drill" authenticated "$MOBILE_MEMBER" \
  "select public.get_or_create_daily_drill();"
DRILL_ID_1=$(run_sql authenticated "$MOBILE_MEMBER" "select (public.get_or_create_daily_drill()).id;" | tail -1 | xargs)
DRILL_ID_2=$(run_sql authenticated "$MOBILE_MEMBER" "select (public.get_or_create_daily_drill()).id;" | tail -1 | xargs)
if [ -n "$DRILL_ID_1" ] && [ "$DRILL_ID_1" = "$DRILL_ID_2" ]; then
  echo "PASS: repeated same-day calls are idempotent (return the same drill row, not a regenerated one)"; PASS=$((PASS+1))
else
  echo "FAIL: expected the same drill id on a same-day retry, got '$DRILL_ID_1' then '$DRILL_ID_2'"; FAIL=$((FAIL+1)); FAILURES+=("daily drill same-day idempotency")
fi
expect_rows "generated drill targets at least one ACS task" postgres "" \
  "select (jsonb_array_length(target_acs_tasks) > 0)::text from public.daily_drills where id='$DRILL_ID_1';" "true"
expect_rows "member A sees zero rows of Mobile Member's daily drill" authenticated "$MEMBER_A" \
  "select count(*) from public.daily_drills where id='$DRILL_ID_1';" "0"
expect_error_matching "member A cannot start Mobile Member's drill (ownership-scoped RPC, not just RLS)" authenticated "$MEMBER_A" \
  "select public.mark_daily_drill_started('$DRILL_ID_1');" "not found"
expect_success "Mobile Member can start their own drill" authenticated "$MOBILE_MEMBER" \
  "select public.mark_daily_drill_started('$DRILL_ID_1');"
expect_rows "drill status transitions to in_progress with started_at set" postgres "" \
  "select (status='in_progress' and started_at is not null)::text from public.daily_drills where id='$DRILL_ID_1';" "true"
expect_success "starting an already-started drill is a safe no-op, not an error" authenticated "$MOBILE_MEMBER" \
  "select public.mark_daily_drill_started('$DRILL_ID_1');"
expect_denied "authenticated cannot directly INSERT into daily_drills (generation is RPC-only)" authenticated "$MOBILE_MEMBER" \
  "insert into public.daily_drills (profile_id, drill_date) values ('$MOBILE_MEMBER', current_date + 1);"

echo
echo "########## 20. MOBILE DEVICES / NOTIFICATION PREFERENCES (Phase C5 / v116) ##########"
DEVICE_ID=$(run_sql authenticated "$MOBILE_MEMBER" \
  "insert into public.mobile_devices (profile_id, platform, expo_push_token) values ('$MOBILE_MEMBER','ios','ExponentPushToken[test-token-1]') returning id;" | tail -1 | xargs)
if [ -n "$DEVICE_ID" ]; then
  echo "PASS: a learner can register their own device directly (self-scoped RLS, low-risk owned data)"; PASS=$((PASS+1))
else
  echo "FAIL: expected a device id back from self-registration"; FAIL=$((FAIL+1)); FAILURES+=("mobile device self-registration")
fi
expect_denied "a learner cannot register a device row for a DIFFERENT profile_id (RLS with-check blocks forgery)" authenticated "$MOBILE_MEMBER" \
  "insert into public.mobile_devices (profile_id, platform, expo_push_token) values ('$MEMBER_A','ios','ExponentPushToken[forged]');"
expect_rows "member A cannot SELECT Mobile Member's devices" authenticated "$MEMBER_A" \
  "select count(*) from public.mobile_devices where profile_id='$MOBILE_MEMBER';" "0"
expect_error_matching "member A cannot revoke Mobile Member's device (ownership-scoped RPC)" authenticated "$MEMBER_A" \
  "select public.revoke_mobile_device('$DEVICE_ID');" "not found"
expect_success "Mobile Member can revoke their own device" authenticated "$MOBILE_MEMBER" \
  "select public.revoke_mobile_device('$DEVICE_ID');"
expect_rows "revoked device has revoked_at set" postgres "" \
  "select (revoked_at is not null)::text from public.mobile_devices where id='$DEVICE_ID';" "true"
expect_success "a learner can set their own notification preferences directly (self-scoped RLS)" authenticated "$MOBILE_MEMBER" \
  "insert into public.notification_preferences (profile_id, daily_drill_time) values ('$MOBILE_MEMBER','06:30') on conflict (profile_id) do update set daily_drill_time=excluded.daily_drill_time;"
expect_denied "a learner cannot set notification preferences for a DIFFERENT profile_id" authenticated "$MOBILE_MEMBER" \
  "insert into public.notification_preferences (profile_id) values ('$MEMBER_A');"
expect_rows "member A cannot SELECT Mobile Member's notification preferences" authenticated "$MEMBER_A" \
  "select count(*) from public.notification_preferences where profile_id='$MOBILE_MEMBER';" "0"

echo
echo "=================================================="
echo "RESULTS: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo "Failed tests:"
  printf '  - %s\n' "${FAILURES[@]}"
fi
echo "=================================================="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
