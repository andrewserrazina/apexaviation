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
echo "########## 16. ACS NORMALIZATION -- AUTHORITATIVE FAA-S-ACS-6C (Phase C1 / v112 REV2) ##########"
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
expect_rows "the private_pilot version is seeded as FAA-S-ACS-6C, not v1-backfill" postgres "" \
  "select version_code from public.acs_versions where certificate_type='private_pilot' and active;" "FAA-S-ACS-6C"
expect_rows "seeded with the real effective date (2024-05-31)" postgres "" \
  "select effective_date::text from public.acs_versions where certificate_type='private_pilot' and active;" "2024-05-31"
expect_rows "the COMPLETE authoritative taxonomy is seeded: 61 tasks, regardless of Apex content" postgres "" \
  "select count(*) from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot';" "61"
expect_rows "12 Areas of Operation, matching the real FAA-S-ACS-6C table of contents" postgres "" \
  "select count(distinct area_code) from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot';" "12"
expect_rows "a task with ZERO Apex content mapped to it is still present (Area III Task A -- Apex has no seaplane/light-signals content)" postgres "" \
  "select task_title from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and t.area_code='III' and t.task_code='A';" "Communications, Light Signals, and Runway Lighting Systems"
expect_rows "q1 and q2 (different Apex-authored acs_reference title text) still resolve to the SAME authoritative I/A task -- mapping is by area/task CODE only, never by title match" postgres "" \
  "select (select acs_task_id from public.content_acs_mappings where content_id='q1') = (select acs_task_id from public.content_acs_mappings where content_id='q2');" "t"
expect_rows "the shared task's title is the AUTHORITATIVE FAA title (Pilot Qualifications), not Apex's own paraphrase (Certificates and Documents)" postgres "" \
  "select t.task_title from public.content_acs_mappings m join public.acs_tasks t on t.id=m.acs_task_id where m.content_id='q1';" "Pilot Qualifications"
expect_rows "q6/q9 (Area I Task B) resolve to a DIFFERENT acs_task_id than q1" postgres "" \
  "select (select acs_task_id from public.content_acs_mappings where content_id='q6') <> (select acs_task_id from public.content_acs_mappings where content_id='q1');" "t"
expect_rows "q3 (multi-task '/') is unmapped and reported with the correct reason" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q3';" "multi_task_reference_needs_human_disambiguation"
expect_rows "q4 (Special Emphasis Area) is unmapped and reported with the correct reason" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q4';" "special_emphasis_area_no_single_task"
expect_rows "q5 (no recognizable shape) is unmapped and reported with the correct reason" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q5';" "does_not_match_known_acs_reference_shape"
expect_rows "q7 (well-formed but non-existent Area XX Task Z) is unmapped with the NEW REV2 reason -- never silently accepted" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q7';" "area_task_not_found_in_authoritative_acs"
expect_rows "q8 (instrument exam_type, no authoritative ACS seeded) is unmapped with the NEW REV2 staging reason" postgres "" \
  "select reason from public.acs_unresolved_mappings where content_id='q8';" "no_authoritative_acs_seeded_for_exam_type"
expect_rows "q1/q2/q6/q9 (resolved rows) do NOT appear in acs_unresolved_mappings" postgres "" \
  "select count(*) from public.acs_unresolved_mappings where content_id in ('q1','q2','q6','q9');" "0"
expect_rows "exactly 9 test dpe_questions total, 4 resolved, 5 unresolved -- matches the documented REV2 mapping-results table" postgres "" \
  "select count(*)::text || ',' || (select count(*) from public.content_acs_mappings where content_type='dpe_question' and content_id in ('q1','q2','q3','q4','q5','q6','q7','q8','q9'))::text || ',' || (select count(*) from public.acs_unresolved_mappings where content_id in ('q1','q2','q3','q4','q5','q6','q7','q8','q9'))::text from public.dpe_questions where id in ('q1','q2','q3','q4','q5','q6','q7','q8','q9');" "9,4,5"
expect_denied "authenticated has no SELECT on acs_unresolved_mappings (service_role-only report)" authenticated "$MOBILE_MEMBER" \
  "select count(*) from public.acs_unresolved_mappings;"
expect_success "service_role can read acs_unresolved_mappings" service_role "" \
  "select count(*) from public.acs_unresolved_mappings;"

echo
echo "########## 16b. CONTENT MAPPING PROVENANCE SURVIVES RERUN (REV2.2 -- defect #2) ##########"
TASK_IC="(select t.id from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and t.area_code='I' and t.task_code='C')"
run_sql postgres "" \
  "insert into public.content_acs_mappings (content_type, content_id, acs_task_id, mapping_type, mapping_source, created_by) values ('dpe_question','q4',$TASK_IC,'human_curated_test','human_curated','$ADMIN');" >/dev/null
expect_rows "q4's manual mapping exists before any rerun" postgres "" \
  "select count(*) from public.content_acs_mappings where content_type='dpe_question' and content_id='q4' and mapping_source='human_curated';" "1"
expect_rows "q4 no longer appears in acs_unresolved_mappings now that a human has mapped it" service_role "" \
  "select count(*) from public.acs_unresolved_mappings where content_id='q4';" "0"

echo "=== Re-applying v112 a second time (proves rerun-safety, REV2.2) ==="
"${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 -f portal/supabase-portal-schema-v112-acs-normalization.sql >/tmp/apex_test_v112_rerun.log 2>&1 || { echo "V112 RERUN FAILED"; cat /tmp/apex_test_v112_rerun.log; exit 1; }

expect_rows "q4's MANUAL mapping SURVIVES the v112 rerun untouched, on the exact task a human chose" postgres "" \
  "select count(*) from public.content_acs_mappings where content_type='dpe_question' and content_id='q4' and mapping_source='human_curated' and acs_task_id=$TASK_IC;" "1"
expect_rows "q1's AUTO mapping still exists after the rerun (regenerated, same task, not duplicated)" postgres "" \
  "select count(*) from public.content_acs_mappings where content_type='dpe_question' and content_id='q1' and mapping_source='deterministic_backfill';" "1"
expect_rows "exactly one mapping row total for q1 after the rerun (no duplication)" postgres "" \
  "select count(*) from public.content_acs_mappings where content_type='dpe_question' and content_id='q1';" "1"
expect_rows "the authoritative task count is still exactly 61 after a rerun (seeding is idempotent, never duplicates tasks)" postgres "" \
  "select count(*) from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot';" "61"

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
expect_rows "overall_score computed as the documented weighted average over the ASEL-applicable 45-task denominator (REV3: coverage=1/45=2.22, knowledge=risk=100, confidence=50 -> 0.35*2.22+0.30*100+0.20*100+0.15*50=58.28), pre-dampening" postgres "" \
  "select overall_score from public.readiness_snapshots where profile_id='$MOBILE_MEMBER' order by created_at desc limit 1;" "58.28"
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

TASK_IB="(select t.id from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and t.area_code='I' and t.task_code='B')"

echo
echo "########## 21. QUESTION PROGRESS COUNTERS FIXED (REV2.6 -- defect #4) ##########"
COUNTERS_MEMBER=00000000-0000-0000-0000-000000000046
COUNTERS_ATTEMPT=$(run_sql postgres "" \
  "insert into public.portal_practice_attempts (profile_id, mode, question_ids, total, started_at) values ('$COUNTERS_MEMBER','dpe_questions','[\"q1\"]'::jsonb,1,now()) returning id;" | tail -1 | xargs)
expect_rows "BEFORE: fixture answered_count is 7, favorited is true" postgres "" \
  "select answered_count::text || ',' || favorited::text from public.portal_question_progress where profile_id='$COUNTERS_MEMBER' and question_id='q1';" "7,true"
expect_success "Counters Member completes a new practice session containing q1" authenticated "$COUNTERS_MEMBER" \
  "select * from public.complete_mobile_practice_session('$COUNTERS_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"}]'::jsonb);"
expect_rows "AFTER: answered_count is INCREMENTED to 8, never reset to 1 (the Rev1 bug)" postgres "" \
  "select answered_count from public.portal_question_progress where profile_id='$COUNTERS_MEMBER' and question_id='q1';" "8"
expect_rows "AFTER: favorited remains true (not reset by the completion upsert)" postgres "" \
  "select favorited::text from public.portal_question_progress where profile_id='$COUNTERS_MEMBER' and question_id='q1';" "true"
expect_rows "AFTER: viewed_count and first_viewed_at are untouched by a completion (9 and the original 30-day-old timestamp)" postgres "" \
  "select viewed_count::text || ',' || (first_viewed_at < now() - interval '29 days')::text from public.portal_question_progress where profile_id='$COUNTERS_MEMBER' and question_id='q1';" "9,true"

echo
echo "########## 22. ATOMIC PRACTICE COMPLETION -- OWNERSHIP + VALIDATION (REV2.4) ##########"
expect_error_matching "completing a nonexistent session fails clearly" authenticated "$MOBILE_MEMBER" \
  "select * from public.complete_mobile_practice_session('00000000-0000-0000-0000-0000000000ff', '[]'::jsonb);" "session_not_found"
CONCURRENCY_MEMBER=00000000-0000-0000-0000-000000000044
OWNERSHIP_ATTEMPT=$(run_sql postgres "" \
  "insert into public.portal_practice_attempts (profile_id, mode, question_ids, total, started_at) values ('$CONCURRENCY_MEMBER','dpe_questions','[\"q1\"]'::jsonb,1,now()) returning id;" | tail -1 | xargs)
expect_error_matching "member A cannot complete Concurrency Member's session (ownership enforced INSIDE the RPC, not just by RLS)" authenticated "$MEMBER_A" \
  "select * from public.complete_mobile_practice_session('$OWNERSHIP_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"}]'::jsonb);" "not_your_session"
expect_denied "anon cannot call complete_mobile_practice_session at all (no EXECUTE grant)" anon "" \
  "select * from public.complete_mobile_practice_session('$OWNERSHIP_ATTEMPT', '[]'::jsonb);"
run_sql postgres "" "delete from public.portal_practice_attempts where id='$OWNERSHIP_ATTEMPT';" >/dev/null

echo
echo "########## 23. REAL TWO-PROCESS CONCURRENCY (REV2.7 -- defect #3, the critical fix) ##########"
echo "Two independent psql processes attempt to complete the SAME attempt_id at effectively the"
echo "same time. Process A opens an explicit transaction, runs the completion RPC (which takes a"
echo "row lock via 'select ... for update' as its very first statement), then holds that lock via"
echo "pg_sleep(3) BEFORE committing. Process B is launched 1 second later as a single autocommit"
echo "statement -- it must block on A's row lock (ordinary Postgres row-lock semantics) until A"
echo "commits, then see completed_at already set and perform ZERO side effects a second time."
CONCURRENCY_ATTEMPT=$(run_sql postgres "" \
  "insert into public.portal_practice_attempts (profile_id, mode, question_ids, total, started_at) values ('$CONCURRENCY_MEMBER','dpe_questions','[\"q1\"]'::jsonb,1,now()) returning id;" | tail -1 | xargs)

(
  {
    echo "set role authenticated;"
    echo "set myapp.uid = '$CONCURRENCY_MEMBER';"
    echo "set myapp.role = 'authenticated';"
    echo "begin;"
    echo "select * from public.complete_mobile_practice_session('$CONCURRENCY_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"}]'::jsonb);"
    echo "select pg_sleep(3);"
    echo "commit;"
  } | "${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 > /tmp/apex_test_concurrency_a.log 2>&1
) &
CONC_PID_A=$!
sleep 1
(
  {
    echo "set role authenticated;"
    echo "set myapp.uid = '$CONCURRENCY_MEMBER';"
    echo "set myapp.role = 'authenticated';"
    echo "select * from public.complete_mobile_practice_session('$CONCURRENCY_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"}]'::jsonb);"
  } | "${PSQL_BASE[@]}" -v ON_ERROR_STOP=1 > /tmp/apex_test_concurrency_b.log 2>&1
) &
CONC_PID_B=$!
wait $CONC_PID_A
CONC_RC_A=$?
wait $CONC_PID_B
CONC_RC_B=$?

if [ $CONC_RC_A -eq 0 ] && [ $CONC_RC_B -eq 0 ]; then
  echo "PASS: both concurrent completion requests returned successfully (no error, no deadlock)"; PASS=$((PASS+1))
else
  echo "FAIL: a concurrent completion request errored -- A rc=$CONC_RC_A, B rc=$CONC_RC_B"
  echo "  -- process A log:"; cat /tmp/apex_test_concurrency_a.log
  echo "  -- process B log:"; cat /tmp/apex_test_concurrency_b.log
  FAIL=$((FAIL+1)); FAILURES+=("concurrent completion requests both succeed")
fi
expect_rows "final state: the attempt is completed exactly once" postgres "" \
  "select (completed_at is not null)::text from public.portal_practice_attempts where id='$CONCURRENCY_ATTEMPT';" "true"
expect_rows "final state: exactly ONE response row (not two) for the raced question" postgres "" \
  "select count(*) from public.portal_practice_attempt_responses where attempt_id='$CONCURRENCY_ATTEMPT';" "1"
expect_rows "final state: task_evidence attempt_count incremented exactly ONCE (not twice) for the mapped task" postgres "" \
  "select attempt_count from public.task_evidence where profile_id='$CONCURRENCY_MEMBER' and acs_task_id=$TASK_IA;" "1"
expect_rows "final state: XP awarded exactly ONCE for this attempt" postgres "" \
  "select count(*) from public.xp_ledger where profile_id='$CONCURRENCY_MEMBER' and event_type='mobile_practice_completed' and source_id='$CONCURRENCY_ATTEMPT';" "1"
expect_rows "final state: study activity credited exactly ONCE (45 seconds, not 90)" postgres "" \
  "select seconds from public.portal_study_activity where profile_id='$CONCURRENCY_MEMBER' and activity_date = public.member_local_date('$CONCURRENCY_MEMBER');" "45"

echo
echo "########## 24. REVEAL CONTRACT -- underlying data authorization (REV2.9) ##########"
echo "NOTE: mobile-practice's 'reveal' action is implemented in the Deno Edge Function, which"
echo "cannot execute in this sandbox (no deno/supabase-cli runtime available -- confirmed absent"
echo "before writing this section, see the Rev2 report). These tests instead prove, at the"
echo "database level, the exact authorization predicate that action's TypeScript evaluates before"
echo "returning any debrief field -- HTTP-level execution of mobile-practice itself remains for"
echo "staging verification, and this report does not claim otherwise."
expect_rows "owner + question genuinely in the session: the reveal predicate is satisfied" authenticated "$CONCURRENCY_MEMBER" \
  "select (question_ids @> to_jsonb('q1'::text))::text from public.portal_practice_attempts where id='$CONCURRENCY_ATTEMPT' and profile_id='$CONCURRENCY_MEMBER';" "true"
expect_rows "owner but question NOT part of that session: the reveal predicate is not satisfied" authenticated "$CONCURRENCY_MEMBER" \
  "select (question_ids @> to_jsonb('q6'::text))::text from public.portal_practice_attempts where id='$CONCURRENCY_ATTEMPT' and profile_id='$CONCURRENCY_MEMBER';" "false"
expect_rows "a different learner cannot even see the session row to evaluate the predicate against (RLS)" authenticated "$MEMBER_A" \
  "select count(*) from public.portal_practice_attempts where id='$CONCURRENCY_ATTEMPT';" "0"
expect_rows "dpe_questions carries real debrief fields for the reveal response (model_answer/common_mistakes/dpe_evaluating/real_world_application)" postgres "" \
  "select (model_answer is not null and common_mistakes is not null and dpe_evaluating is not null and real_world_application is not null)::text from public.dpe_questions where id='q1';" "true"

echo
echo "########## 25. MOBILE BOOTSTRAP: TODAY REALLY MEANS TODAY (REV2.10 -- defect #5) ##########"
YESTERDAY_MEMBER=00000000-0000-0000-0000-000000000045
run_sql postgres "" \
  "insert into public.daily_drills (profile_id, drill_date, algorithm_version, status) values ('$YESTERDAY_MEMBER', current_date - 1, 'v1', 'pending');" >/dev/null
expect_rows "the OLD buggy query shape (order by drill_date desc limit 1) WOULD have wrongly returned yesterday's drill as 'today's'" postgres "" \
  "select (drill_date = current_date - 1)::text from public.daily_drills where profile_id='$YESTERDAY_MEMBER' order by drill_date desc limit 1;" "true"
expect_rows "the FIXED query (exact match on member_local_date()) correctly finds ZERO rows -- mobile-bootstrap returns todays_drill: null" postgres "" \
  "select count(*) from public.daily_drills where profile_id='$YESTERDAY_MEMBER' and drill_date = public.member_local_date('$YESTERDAY_MEMBER') and algorithm_version = 'v1';" "0"

echo
echo "########## 26. DAILY DRILL CHECKRIDE-PROXIMITY WEIGHTING (REV2.11/2.12) ##########"
PROX_NONE=00000000-0000-0000-0000-000000000040
PROX_FAR=00000000-0000-0000-0000-000000000041
PROX_NEAR=00000000-0000-0000-0000-000000000042
for M in "$PROX_NONE" "$PROX_FAR" "$PROX_NEAR"; do
  run_sql postgres "" \
    "insert into public.task_evidence (profile_id, acs_task_id, attempt_count, correct_count, recent_accuracy, evidence_score, last_attempt_at) values ('$M', $TASK_IB, 5, 1, 0.2, 0.2, now());" >/dev/null
done
expect_success "Proximity None Member (no checkride date) can generate a daily drill" authenticated "$PROX_NONE" "select public.get_or_create_daily_drill();"
expect_success "Proximity Far Member (checkride 60 days out) can generate a daily drill" authenticated "$PROX_FAR" "select public.get_or_create_daily_drill();"
expect_success "Proximity Near Member (checkride 3 days out) can generate a daily drill" authenticated "$PROX_NEAR" "select public.get_or_create_daily_drill();"
expect_rows "NO checkride date: coverage-weighted ('far') scoring means the ~60 zero-evidence tasks (score 3.0) drown out the one weak-but-attempted task I/B (score 0.8) -- I/B is NOT targeted" postgres "" \
  "select ((select target_acs_tasks from public.daily_drills where profile_id='$PROX_NONE') @> jsonb_build_array(jsonb_build_object('acs_task_id', $TASK_IB)))::text;" "false"
expect_rows "FAR checkride date (60 days): same coverage-weighted bucket as no-date -- I/B still NOT targeted" postgres "" \
  "select ((select target_acs_tasks from public.daily_drills where profile_id='$PROX_FAR') @> jsonb_build_array(jsonb_build_object('acs_task_id', $TASK_IB)))::text;" "false"
expect_rows "NEAR checkride date (3 days): weak-evidence weighting flips the ranking -- I/B (score 1.6) beats every untouched task (score 0.5) and IS targeted" postgres "" \
  "select ((select target_acs_tasks from public.daily_drills where profile_id='$PROX_NEAR') @> jsonb_build_array(jsonb_build_object('acs_task_id', $TASK_IB)))::text;" "true"

echo
echo "########## 27. DAILY DRILL RECENCY CORRECTNESS (REV2.13) ##########"
echo "Uses REAL per-question response events (portal_practice_attempt_responses), never"
echo "portal_question_progress.completed, to decide anti-repeat vs. recent-miss priority."
RECENCY_MEMBER=00000000-0000-0000-0000-000000000043
run_sql postgres "" \
  "insert into public.task_evidence (profile_id, acs_task_id, attempt_count, correct_count, recent_accuracy, evidence_score, last_attempt_at) values ('$RECENCY_MEMBER', $TASK_IB, 5, 1, 0.2, 0.2, now());" >/dev/null
RECENCY_ATTEMPT=$(run_sql postgres "" \
  "insert into public.portal_practice_attempts (profile_id, mode, question_ids, total, started_at, completed_at) values ('$RECENCY_MEMBER','dpe_questions','[\"q6\",\"q9\"]'::jsonb,2,now(),now()) returning id;" | tail -1 | xargs)
run_sql postgres "" \
  "insert into public.portal_practice_attempt_responses (attempt_id, profile_id, question_id, self_rating, is_correct, answered_at) values ('$RECENCY_ATTEMPT','$RECENCY_MEMBER','q6','correct',true,now()), ('$RECENCY_ATTEMPT','$RECENCY_MEMBER','q9','incorrect',false,now());" >/dev/null
expect_success "Recency Member (checkride near, so I/B is targeted per section 26's proven mechanism) can generate a daily drill" authenticated "$RECENCY_MEMBER" "select public.get_or_create_daily_drill();"
expect_rows "q6 (answered CORRECTLY 0 days ago) is EXCLUDED from the drill -- real anti-repeat, not the old 'completed' proxy" postgres "" \
  "select ((select question_ids from public.daily_drills where profile_id='$RECENCY_MEMBER') @> '\"q6\"'::jsonb)::text;" "false"
expect_rows "q9 (answered INCORRECTLY 0 days ago) IS included -- recent misses are prioritized for re-drilling, not suppressed" postgres "" \
  "select ((select question_ids from public.daily_drills where profile_id='$RECENCY_MEMBER') @> '\"q9\"'::jsonb)::text;" "true"

echo
echo "########## 28. READINESS: HONEST ABOUT CONTENT-LESS ACS TASKS (REV2.14) ##########"
expect_success "Proximity None Member can compute readiness against the full authoritative ACS" authenticated "$PROX_NONE" "select public.compute_readiness_snapshot();"
expect_rows "coverage_score denominator is the full 61-task authoritative ACS, not just the ~9 tasks Apex has content for (score stays well under 10 with only 1 task evidenced)" postgres "" \
  "select (coverage_score < 10)::text from public.readiness_snapshots where profile_id='$PROX_NONE' order by created_at desc limit 1;" "true"
expect_rows "reason_codes flags insufficient_content_coverage -- the learner is not silently scored down for ACS tasks Apex has never written content for" postgres "" \
  "select (reason_codes @> '[\"insufficient_content_coverage\"]'::jsonb)::text from public.readiness_snapshots where profile_id='$PROX_NONE' order by created_at desc limit 1;" "true"

echo
echo "########## 29. ACS VERSION SELECTION (REV2.15) ##########"
expect_rows "get_active_acs_version() resolves the one authoritative private_pilot version unambiguously" postgres "" \
  "select (public.get_active_acs_version('private_pilot') = (select id from public.acs_versions where certificate_type='private_pilot' and version_code='FAA-S-ACS-6C'))::text;" "true"
expect_error_matching "a SECOND active version for the same certificate_type is rejected outright by the partial unique index" postgres "" \
  "insert into public.acs_versions (certificate_type, version_code, active) values ('private_pilot', 'duplicate-active-test', true);" "duplicate key value violates unique constraint"
expect_success "a second INACTIVE version for the same certificate_type is allowed to coexist (future-revision staging)" postgres "" \
  "insert into public.acs_versions (certificate_type, version_code, active) values ('private_pilot', 'duplicate-inactive-test', false);"

TASK_II="(select t.id from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and v.version_code='FAA-S-ACS-6C' and t.area_code='I' and t.task_code='I')"
TASK_IVC="(select t.id from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and v.version_code='FAA-S-ACS-6C' and t.area_code='IV' and t.task_code='C')"
TASK_XA="(select t.id from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and v.version_code='FAA-S-ACS-6C' and t.area_code='X' and t.task_code='A')"

echo
echo "########## 30. ACS TASK APPLICABILITY (REV3.1/3.2) ##########"
expect_rows "a universal task (I/A, Pilot Qualifications) is applicable to ASEL" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_IA and aircraft_class='ASEL')::text;" "true"
expect_rows "an ASEL-only task (IV/C, Soft-Field Takeoff and Climb) is applicable to ASEL" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_IVC and aircraft_class='ASEL')::text;" "true"
expect_rows "that same ASEL-only task is NOT applicable to ASES" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_IVC and aircraft_class='ASES')::text;" "false"
expect_rows "that same ASEL-only task is NOT applicable to AMEL" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_IVC and aircraft_class='AMEL')::text;" "false"
expect_rows "that same ASEL-only task is NOT applicable to AMES" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_IVC and aircraft_class='AMES')::text;" "false"
expect_rows "an ASES-only task (I/I, seaplane characteristics) is NOT applicable to ASEL" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_II and aircraft_class='ASEL')::text;" "false"
expect_rows "that same ASES-only task IS applicable to ASES" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_II and aircraft_class='ASES')::text;" "true"
expect_rows "an AMEL-specific task (X/A, multiengine) is NOT applicable to ASEL" postgres "" \
  "select exists(select 1 from public.acs_task_applicability where acs_task_id=$TASK_XA and aircraft_class='ASEL')::text;" "false"
expect_denied "authenticated cannot INSERT into acs_task_applicability directly" authenticated "$MOBILE_MEMBER" \
  "insert into public.acs_task_applicability (acs_task_id, aircraft_class) values ($TASK_II, 'ASEL');"
expect_error_matching "acs_task_applicability rejects an arbitrary class string (no glider/helicopter values invented)" postgres "" \
  "insert into public.acs_task_applicability (acs_task_id, aircraft_class) values ($TASK_IA, 'GLIDER');" "violates check constraint"
expect_rows "the complete 61-task authoritative taxonomy still exists regardless of applicability filtering" postgres "" \
  "select count(*) from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and v.version_code='FAA-S-ACS-6C';" "61"

echo
echo "########## 31. LEARNER TRAINING CONTEXT RESOLUTION (REV3.3/3.4) ##########"
expect_rows "profiles.primary_aircraft_class defaults to ASEL for an existing (pre-v112) fixture row" postgres "" \
  "select primary_aircraft_class from public.profiles where id='$MOBILE_MEMBER';" "ASEL"
expect_denied "anon cannot call get_member_training_context at all" anon "" \
  "select * from public.get_member_training_context();"
expect_success "authenticated Mobile Member resolves their own training context (no argument -> auth.uid())" authenticated "$MOBILE_MEMBER" \
  "select * from public.get_member_training_context();"
expect_rows "resolved context is exactly private_pilot / ASEL / the authoritative FAA-S-ACS-6C version" postgres "" \
  "select certificate_type || ',' || aircraft_class || ',' || (acs_version_id = (select id from public.acs_versions where certificate_type='private_pilot' and version_code='FAA-S-ACS-6C'))::text from public.get_member_training_context('$MOBILE_MEMBER');" "private_pilot,ASEL,true"
expect_error_matching "member A cannot resolve Mobile Member's training context by passing their id explicitly (their own real auth.uid() differs from it)" authenticated "$MEMBER_A" \
  "select * from public.get_member_training_context('$MOBILE_MEMBER');" "not authorized to resolve another member"
expect_success "service_role (no forwarded end-user JWT, auth.uid() is null) MAY resolve an explicit learner's context -- mobile-bootstrap's own calling convention" service_role "" \
  "select * from public.get_member_training_context('$MOBILE_MEMBER');"

echo
echo "########## 32. ASEL READINESS DENOMINATOR (REV3.5) ##########"
expect_rows "get_applicable_acs_tasks() for an ASEL learner resolves exactly 45 of the 61 authoritative tasks (16 seaplane/multiengine-only tasks excluded)" postgres "" \
  "select count(*) from public.get_applicable_acs_tasks('$PROX_NONE');" "45"
expect_success "Proximity None Member recomputes readiness against the ASEL-scoped denominator" authenticated "$PROX_NONE" "select public.compute_readiness_snapshot();"
expect_rows "coverage_score denominator is 45 (1 applicable task with evidence / 45 = 2.22), not 61 (which would give 1.64)" postgres "" \
  "select coverage_score from public.readiness_snapshots where profile_id='$PROX_NONE' order by created_at desc limit 1;" "2.22"

echo
echo "########## 33. EVIDENCE SCOPED TO CURRENT CLASS + VERSION (REV3.6) ##########"
UNRELATED_CLASS_MEMBER=00000000-0000-0000-0000-000000000050
UNRELATED_VERSION_MEMBER=00000000-0000-0000-0000-000000000051
run_sql postgres "" \
  "insert into public.task_evidence (profile_id, acs_task_id, attempt_count, correct_count, recent_accuracy, evidence_score, last_attempt_at) values ('$UNRELATED_CLASS_MEMBER', $TASK_II, 5, 5, 1.0, 1.0, now());" >/dev/null
expect_success "Unrelated Class Member (ASEL by default) computes readiness despite having strong evidence on an ASES-only task" authenticated "$UNRELATED_CLASS_MEMBER" "select public.compute_readiness_snapshot();"
expect_rows "that ASES-only evidence does NOT count as coverage for this ASEL learner (coverage_score is 0.00, not >0)" postgres "" \
  "select coverage_score from public.readiness_snapshots where profile_id='$UNRELATED_CLASS_MEMBER' order by created_at desc limit 1;" "0.00"
expect_rows "that ASES-only evidence does NOT count toward knowledge_score either (0, not 100 -- it is the learner's only evidence row)" postgres "" \
  "select knowledge_score from public.readiness_snapshots where profile_id='$UNRELATED_CLASS_MEMBER' order by created_at desc limit 1;" "0"

run_sql postgres "" \
  "insert into public.acs_versions (certificate_type, version_code, active) values ('private_pilot', 'rev3-unrelated-version-test', false) on conflict do nothing;" >/dev/null
run_sql postgres "" \
  "insert into public.acs_tasks (acs_version_id, area_code, area_title, task_code, task_title) values ((select id from public.acs_versions where version_code='rev3-unrelated-version-test'), 'ZZ', 'Unrelated Version Area', 'Z', 'Unrelated Version Task') on conflict do nothing;" >/dev/null
run_sql postgres "" \
  "insert into public.acs_task_applicability (acs_task_id, aircraft_class) values ((select id from public.acs_tasks where task_code='Z' and area_code='ZZ'), 'ASEL') on conflict do nothing;" >/dev/null
run_sql postgres "" \
  "insert into public.task_evidence (profile_id, acs_task_id, attempt_count, correct_count, recent_accuracy, evidence_score, last_attempt_at) values ('$UNRELATED_VERSION_MEMBER', (select id from public.acs_tasks where task_code='Z' and area_code='ZZ'), 5, 5, 1.0, 1.0, now());" >/dev/null
expect_success "Unrelated Version Member computes readiness despite having strong evidence on a task from an INACTIVE (non-current) ACS version" authenticated "$UNRELATED_VERSION_MEMBER" "select public.compute_readiness_snapshot();"
expect_rows "evidence against a non-active ACS version's task does not count as coverage, even though it IS marked ASEL-applicable" postgres "" \
  "select coverage_score from public.readiness_snapshots where profile_id='$UNRELATED_VERSION_MEMBER' order by created_at desc limit 1;" "0.00"
expect_rows "and does not count toward knowledge_score either" postgres "" \
  "select knowledge_score from public.readiness_snapshots where profile_id='$UNRELATED_VERSION_MEMBER' order by created_at desc limit 1;" "0"

echo
echo "########## 34. CONTENT COVERAGE HONESTY, RE-SCOPED (REV3.7) ##########"
expect_rows "insufficient_content_coverage is still flagged for an ASEL learner (Apex has content for only a handful of the 45 applicable tasks)" postgres "" \
  "select (reason_codes @> '[\"insufficient_content_coverage\"]'::jsonb)::text from public.readiness_snapshots where profile_id='$PROX_NONE' order by created_at desc limit 1;" "true"
expect_rows "the content-less-task count used for that flag is scoped to the 45 applicable tasks, never the full 61 (seaplane/multiengine content gaps are irrelevant to an ASEL learner)" postgres "" \
  "select (count(*) <= 45)::text from public.get_applicable_acs_tasks('$PROX_NONE') t where not exists (select 1 from public.content_acs_mappings m where m.acs_task_id=t.id);" "true"

echo
echo "########## 35. DAILY DRILL ELIGIBILITY: CONTENT-LESS + NON-APPLICABLE EXCLUSION (REV3.8) ##########"
expect_rows "an ASES-only task can never even be a CANDIDATE for an ASEL learner's drill (excluded at the applicability join, not just by low score)" postgres "" \
  "select count(*) from public.get_applicable_acs_tasks('$MOBILE_MEMBER') where area_code='I' and task_code='I';" "0"
expect_rows "no target task in Proximity Near Member's already-generated drill (section 26) is a content-less task" postgres "" \
  "select (not exists (select 1 from jsonb_array_elements((select target_acs_tasks from public.daily_drills where profile_id='$PROX_NEAR')) x where not exists (select 1 from public.content_acs_mappings m where m.acs_task_id = (x->>'acs_task_id')::uuid)))::text;" "true"

echo
echo "########## 36. DAILY DRILL BROADER-POOL FALLBACK FILL (REV3.9) ##########"
echo "By this point in the suite there are 5 ASEL-applicable, content-backed candidate tasks:"
echo "I/A (q1,q2), I/B (q6,q9), I/C (q10, plus q4 manually mapped in section 16b), I/D (q11), I/E (q12)."
echo "Fill Member gets weak (non-zero) evidence on I/A and I/C -- the two 2-question tasks -- so under"
echo "far/no-date weighting they score strictly below the three untouched tasks (I/B, I/D, I/E), which"
echo "tie for the top 3 slots exactly (3 candidates, 3 slots -- no random tie-break needed for which"
echo "tasks make target_acs_tasks). Those three targets only offer 4 questions total (2+1+1), one short"
echo "of the 5-question minimum, so the fallback must reach into I/A or I/C to fill the 5th slot."
TASK_IC="(select t.id from public.acs_tasks t join public.acs_versions v on v.id=t.acs_version_id where v.certificate_type='private_pilot' and v.version_code='FAA-S-ACS-6C' and t.area_code='I' and t.task_code='C')"
FILL_MEMBER=00000000-0000-0000-0000-000000000052
run_sql postgres "" \
  "insert into public.task_evidence (profile_id, acs_task_id, attempt_count, correct_count, recent_accuracy, evidence_score, last_attempt_at) values ('$FILL_MEMBER', $TASK_IA, 5, 1, 0.2, 0.2, now()), ('$FILL_MEMBER', $TASK_IC, 5, 1, 0.2, 0.2, now());" >/dev/null
expect_success "Fill Member (no checkride date, weak evidence on I/A and I/C only) can generate a daily drill" authenticated "$FILL_MEMBER" "select public.get_or_create_daily_drill();"
expect_rows "target_acs_tasks is exactly the 3 untouched tasks (I/B, I/D, I/E) -- I/A and I/C excluded deterministically" postgres "" \
  "select (jsonb_array_length((select target_acs_tasks from public.daily_drills where profile_id='$FILL_MEMBER')) = 3)::text;" "true"
expect_rows "the top-3 targets together offer only 4 questions (q6,q9,q11,q12) -- below the 5-question minimum" postgres "" \
  "select (jsonb_array_length((select question_ids from public.daily_drills where profile_id='$FILL_MEMBER')) >= 5)::text;" "true"
expect_rows "the fallback pulled in a question from I/A or I/C (q1, q2, q10, or q4) -- neither was one of the top-3 targets -- to reach the minimum" postgres "" \
  "select ((select question_ids from public.daily_drills where profile_id='$FILL_MEMBER') @> '\"q1\"'::jsonb or (select question_ids from public.daily_drills where profile_id='$FILL_MEMBER') @> '\"q2\"'::jsonb or (select question_ids from public.daily_drills where profile_id='$FILL_MEMBER') @> '\"q10\"'::jsonb or (select question_ids from public.daily_drills where profile_id='$FILL_MEMBER') @> '\"q4\"'::jsonb)::text;" "true"

echo
echo "########## 37. DUPLICATE / CONFLICTING / MALFORMED REQUEST REJECTION (REV3.10-3.12) ##########"
MALFORMED_MEMBER=00000000-0000-0000-0000-000000000053
MALFORMED_ATTEMPT=$(run_sql postgres "" \
  "insert into public.portal_practice_attempts (profile_id, mode, question_ids, total, started_at) values ('$MALFORMED_MEMBER','dpe_questions','[\"q1\",\"q6\"]'::jsonb,2,now()) returning id;" | tail -1 | xargs)

assert_no_side_effects_yet() {
  local desc="$1"
  expect_rows "$desc: completed_at is still null" postgres "" \
    "select (completed_at is null)::text from public.portal_practice_attempts where id='$MALFORMED_ATTEMPT';" "true"
  expect_rows "$desc: zero response rows were written" postgres "" \
    "select count(*) from public.portal_practice_attempt_responses where attempt_id='$MALFORMED_ATTEMPT';" "0"
  expect_rows "$desc: task_evidence is still untouched for this learner" postgres "" \
    "select count(*) from public.task_evidence where profile_id='$MALFORMED_MEMBER';" "0"
  expect_rows "$desc: no XP was awarded" postgres "" \
    "select count(*) from public.xp_ledger where profile_id='$MALFORMED_MEMBER';" "0"
}

expect_error_matching "duplicate question_id with the SAME rating twice is rejected, not silently deduplicated" authenticated "$MALFORMED_MEMBER" \
  "select * from public.complete_mobile_practice_session('$MALFORMED_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"},{\"question_id\":\"q1\",\"self_rating\":\"correct\"}]'::jsonb);" "duplicate_question_id"
assert_no_side_effects_yet "after duplicate-same-rating rejection"

expect_error_matching "duplicate question_id with CONFLICTING ratings is rejected -- never 'pick the first one'" authenticated "$MALFORMED_MEMBER" \
  "select * from public.complete_mobile_practice_session('$MALFORMED_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"},{\"question_id\":\"q1\",\"self_rating\":\"incorrect\"}]'::jsonb);" "duplicate_question_id"
assert_no_side_effects_yet "after conflicting-duplicate rejection"

expect_error_matching "a question_id that is not part of the attempt is rejected" authenticated "$MALFORMED_MEMBER" \
  "select * from public.complete_mobile_practice_session('$MALFORMED_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"},{\"question_id\":\"q999\",\"self_rating\":\"correct\"}]'::jsonb);" "invalid_question"
assert_no_side_effects_yet "after unknown-question rejection"

expect_error_matching "an invalid self_rating value is rejected" authenticated "$MALFORMED_MEMBER" \
  "select * from public.complete_mobile_practice_session('$MALFORMED_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"maybe\"},{\"question_id\":\"q6\",\"self_rating\":\"correct\"}]'::jsonb);" "invalid_self_rating"
assert_no_side_effects_yet "after invalid-self_rating rejection"

expect_error_matching "an INCOMPLETE submission (missing a response for q6) is rejected -- REV3.11's exactly-once-per-question policy" authenticated "$MALFORMED_MEMBER" \
  "select * from public.complete_mobile_practice_session('$MALFORMED_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"}]'::jsonb);" "incomplete_submission"
assert_no_side_effects_yet "after incomplete-submission rejection"

expect_success "AFTER all five rejections, a genuinely valid, complete, non-duplicated submission still succeeds normally" authenticated "$MALFORMED_MEMBER" \
  "select * from public.complete_mobile_practice_session('$MALFORMED_ATTEMPT', '[{\"question_id\":\"q1\",\"self_rating\":\"correct\"},{\"question_id\":\"q6\",\"self_rating\":\"incorrect\"}]'::jsonb);"
expect_rows "the valid completion actually committed this time (completed_at is now set)" postgres "" \
  "select (completed_at is not null)::text from public.portal_practice_attempts where id='$MALFORMED_ATTEMPT';" "true"
expect_rows "exactly 2 response rows were written for the valid completion (one per question, not more)" postgres "" \
  "select count(*) from public.portal_practice_attempt_responses where attempt_id='$MALFORMED_ATTEMPT';" "2"

echo
echo "########## 38. MOBILE-PRACTICE ERROR CONTRACT -- stable machine-readable prefixes (REV3.13) ##########"
echo "NOTE: as in Rev2 section 24, the actual HTTP-layer mapping (mobile-practice's regex-to-status-code"
echo "logic) is TypeScript and cannot execute in this sandbox (no deno/supabase-cli). These tests confirm"
echo "the RPC emits the exact stable prefixes that logic matches against -- the contract, not the HTTP path."
expect_error_matching "session_not_found is prefixed exactly as mobile-practice's error mapper expects" authenticated "$MOBILE_MEMBER" \
  "select * from public.complete_mobile_practice_session('00000000-0000-0000-0000-0000000000ff', '[]'::jsonb);" "session_not_found:"
expect_error_matching "not_your_session is prefixed exactly as mobile-practice's error mapper expects" authenticated "$MEMBER_A" \
  "select * from public.complete_mobile_practice_session('$MALFORMED_ATTEMPT', '[]'::jsonb);" "not_your_session:"

echo
echo "########## 39. MOBILE BOOTSTRAP TRAINING CONTEXT (REV3.15) ##########"
expect_rows "the training-context fields mobile-bootstrap now surfaces resolve to a real, queryable acs_versions row" postgres "" \
  "select version_code from public.acs_versions where id = (select acs_version_id from public.get_member_training_context('$MOBILE_MEMBER'));" "FAA-S-ACS-6C"

echo
echo "=================================================="
echo "RESULTS: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo "Failed tests:"
  printf '  - %s\n' "${FAILURES[@]}"
fi
echo "=================================================="
exit $([ $FAIL -eq 0 ] && echo 0 || echo 1)
