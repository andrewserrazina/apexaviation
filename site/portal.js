(function () {
  'use strict';

  /* ── Auth guard — real Supabase session + profile ────────────── */
  var member = null;
  var accessToken = null;
  var authReady = apexSupabase.auth.getSession().then(function (res) {
    var session = res.data.session;
    if (!session) { window.location.href = 'portal-login.html'; return Promise.reject('no-session'); }
    accessToken = session.access_token;
    return apexSupabase.from('profiles').select('*').eq('id', session.user.id).single().then(function (profRes) {
      var profile = profRes.data;
      member = {
        id: session.user.id,
        name: (profile && profile.full_name) || session.user.email,
        email: (profile && profile.email) || session.user.email,
        role: profile && profile.role,
        certificateStatus: (profile && profile.certificate_status) || 'None',
        memberSince: profile && profile.created_at,
        checkridePrepUnlocked: !!(profile && profile.checkride_prep_unlocked)
      };
      populateMember();
      applyUnlockState();
      return initPortalData();
    });
  }).catch(function (e) { if (e !== 'no-session') console.error(e); });

  apexSupabase.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT') window.location.href = 'portal-login.html';
  });

  function initials(name) {
    var parts = name.trim().split(/\s+/);
    var i = parts[0] ? parts[0][0] : '';
    var j = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (i + j).toUpperCase();
  }

  function firstName(name) {
    return name.trim().split(/\s+/)[0];
  }

  function populateMember() {
    document.getElementById('topbarAvatar').textContent = initials(member.name);
    document.getElementById('topbarName').textContent = firstName(member.name);
    document.getElementById('welcomeHeading').textContent = 'Welcome back, ' + firstName(member.name) + '.';
    document.getElementById('accountAvatar').textContent = initials(member.name);
    document.getElementById('accountName').textContent = member.name;
    document.getElementById('accountEmail').textContent = member.email;
    document.getElementById('accountRole').textContent = member.role ? member.role.charAt(0).toUpperCase() + member.role.slice(1) : '—';
    document.getElementById('accFullName').value = member.name;
    document.getElementById('accCertGoal').value = member.certificateStatus;
    var since = member.memberSince ? new Date(member.memberSince) : new Date();
    document.getElementById('memberSince').textContent = since.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  var toastEl = document.getElementById('portalToast');
  var toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ── Section navigation ─────────────────────────────────────── */
  var navItems = document.querySelectorAll('.portal-nav__item[data-section]');
  var sections = document.querySelectorAll('.portal-section');
  var sidebar = document.getElementById('portalSidebar');
  var overlay = document.getElementById('sidebarOverlay');

  var GATED_SECTIONS = ['checkride-prep', 'dpe-library', 'scenarios', 'progress', 'vault'];

  function showSection(id) {
    if (!document.getElementById('section-' + id)) id = 'dashboard';
    if (member && !member.checkridePrepUnlocked && GATED_SECTIONS.indexOf(id) !== -1) {
      closeSidebar();
      openUnlockModal();
      return;
    }
    sections.forEach(function (s) { s.classList.toggle('active', s.id === 'section-' + id); });
    navItems.forEach(function (b) { b.classList.toggle('active', b.dataset.section === id); });
    window.scrollTo(0, 0);
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    closeSidebar();
    if (!member) return;
    if (id === 'admin' && member.role === 'admin') loadAdminDashboard();
    if (id === 'success-wall') renderSuccessWall();
    if (id === 'ground-school') loadGroundSchool();
  }
  window.apexShowSection = showSection;

  function openSidebar() { sidebar.classList.add('open'); overlay.classList.add('show'); }
  function closeSidebar() { sidebar.classList.remove('open'); overlay.classList.remove('show'); }

  navItems.forEach(function (btn) {
    btn.addEventListener('click', function () { showSection(btn.dataset.section); });
  });
  document.querySelectorAll('[data-goto]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      showSection(el.dataset.goto);
    });
  });

  document.getElementById('portalSidebarToggle').addEventListener('click', openSidebar);
  overlay.addEventListener('click', closeSidebar);

  var initial = (window.location.hash || '#dashboard').replace('#', '');
  showSection(initial);

  /* ── Sign out ───────────────────────────────────────────────── */
  function signOut() {
    apexSupabase.auth.signOut().then(function () {
      window.location.href = 'portal-login.html';
    });
  }
  document.getElementById('signOutBtn').addEventListener('click', signOut);
  var signOutBtn2 = document.getElementById('signOutBtn2');
  if (signOutBtn2) signOutBtn2.addEventListener('click', signOut);

  /* ── Unlock state: nav lock badges + blurred dashboard widgets ─ */
  function applyUnlockState() {
    var unlocked = !!(member && member.checkridePrepUnlocked);
    document.querySelectorAll('.portal-nav__item[data-gated] [data-lock-icon]').forEach(function (el) {
      el.style.display = unlocked ? 'none' : '';
    });
    document.querySelectorAll('[data-locked-widget]').forEach(function (card) {
      var overlay = card.querySelector('.portal-locked-widget__overlay');
      var content = card.querySelector('.portal-locked-widget__content');
      if (overlay) overlay.style.display = unlocked ? 'none' : 'flex';
      if (content) {
        content.style.filter = unlocked ? 'none' : '';
        content.style.pointerEvents = unlocked ? 'auto' : 'none';
      }
    });
  }

  document.querySelectorAll('[data-unlock-trigger]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      openUnlockModal();
    });
  });

  /* ── Unlock Checkride Prep modal ────────────────────────────── */
  var unlockModalOverlay = document.getElementById('unlockModalOverlay');
  var unlockModalCta = document.getElementById('unlockModalCta');
  var unlockModalError = document.getElementById('unlockModalError');

  function openUnlockModal() {
    unlockModalError.classList.remove('show');
    unlockModalOverlay.classList.add('show');
  }
  function closeUnlockModal() { unlockModalOverlay.classList.remove('show'); }

  document.getElementById('unlockModalClose').addEventListener('click', closeUnlockModal);
  unlockModalOverlay.addEventListener('click', function (e) { if (e.target === unlockModalOverlay) closeUnlockModal(); });

  unlockModalCta.addEventListener('click', function () {
    unlockModalError.classList.remove('show');
    unlockModalCta.disabled = true;
    unlockModalCta.textContent = 'Redirecting to secure checkout…';

    apexSupabase.functions.invoke('create-checkout-session', {
      body: { purpose: 'unlock-checkride-prep', origin: window.location.origin },
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) {
      if (res.error || !res.data || !res.data.url) {
        unlockModalCta.disabled = false;
        unlockModalCta.textContent = 'Unlock Now';
        unlockModalError.textContent = (res.error && res.error.message) || (res.data && res.data.error) || 'Could not start checkout. Please try again.';
        unlockModalError.classList.add('show');
        return;
      }
      window.location.href = res.data.url;
    }).catch(function () {
      unlockModalCta.disabled = false;
      unlockModalCta.textContent = 'Unlock Now';
      unlockModalError.textContent = 'Could not start checkout. Please try again.';
      unlockModalError.classList.add('show');
    });
  });

  /* ── Ground School Scheduling ───────────────────────────────── */
  var groundSchoolLoaded = false;
  var activeGroundSession = null;

  function fmtSessionDate(iso) {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function loadGroundSchool() {
    if (groundSchoolLoaded) return;
    groundSchoolLoaded = true;
    var listEl = document.getElementById('groundSchoolList');
    var emptyEl = document.getElementById('groundSchoolEmpty');

    apexSupabase.from('ground_sessions')
      .select('*, ground_registrations(id, is_waitlisted)')
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at')
      .then(function (res) {
        var sessionsList = res.data || [];
        if (!sessionsList.length) {
          listEl.style.display = 'none';
          emptyEl.style.display = 'block';
          return;
        }
        listEl.innerHTML = '';
        listEl.className = 'portal-grid portal-grid--2';
        sessionsList.forEach(function (s) {
          var confirmed = (s.ground_registrations || []).filter(function (r) { return !r.is_waitlisted; }).length;
          var spotsLeft = s.max_students - confirmed;
          var full = spotsLeft <= 0;
          var card = document.createElement('div');
          card.className = 'portal-card';
          card.innerHTML =
            '<div class="portal-header__eyebrow" style="margin-bottom:8px">' + (s.category || 'General').toUpperCase() + '</div>' +
            '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:6px">' + s.title + '</h3>' +
            '<p style="color:rgba(255,255,255,0.55);font-size:13px;margin-bottom:4px">' + fmtSessionDate(s.scheduled_at) + '</p>' +
            '<p style="color:rgba(255,255,255,0.4);font-size:12px;margin-bottom:16px">' + (full ? 'Full — join the waitlist' : spotsLeft + ' spot' + (spotsLeft === 1 ? '' : 's') + ' left') + '</p>' +
            '<button class="btn btn--primary" data-register style="width:100%">' + (full ? 'Join Waitlist — $25' : 'Register — $25') + '</button>';
          card.querySelector('[data-register]').addEventListener('click', function () { openGroundSchoolModal(s); });
          listEl.appendChild(card);
        });
      });
  }

  var groundSchoolModalOverlay = document.getElementById('groundSchoolModalOverlay');
  var groundSchoolModalTitle = document.getElementById('groundSchoolModalTitle');
  var groundSchoolModalWhen = document.getElementById('groundSchoolModalWhen');
  var groundSchoolModalCta = document.getElementById('groundSchoolModalCta');
  var groundSchoolModalError = document.getElementById('groundSchoolModalError');

  function openGroundSchoolModal(s) {
    activeGroundSession = s;
    groundSchoolModalTitle.textContent = s.title;
    groundSchoolModalWhen.textContent = fmtSessionDate(s.scheduled_at);
    groundSchoolModalError.classList.remove('show');
    groundSchoolModalOverlay.classList.add('show');
  }
  function closeGroundSchoolModal() { groundSchoolModalOverlay.classList.remove('show'); }

  document.getElementById('groundSchoolModalClose').addEventListener('click', closeGroundSchoolModal);
  groundSchoolModalOverlay.addEventListener('click', function (e) { if (e.target === groundSchoolModalOverlay) closeGroundSchoolModal(); });

  groundSchoolModalCta.addEventListener('click', function () {
    if (!activeGroundSession || !member) return;
    groundSchoolModalError.classList.remove('show');
    groundSchoolModalCta.disabled = true;
    groundSchoolModalCta.textContent = 'Redirecting to secure checkout…';

    apexSupabase.functions.invoke('create-checkout-session', {
      body: {
        purpose: 'ground-school-registration',
        sessionId: activeGroundSession.id,
        name: member.name,
        email: member.email,
        origin: window.location.origin
      }
    }).then(function (res) {
      if (res.error || !res.data || !res.data.url) {
        groundSchoolModalCta.disabled = false;
        groundSchoolModalCta.textContent = 'Pay & Register';
        groundSchoolModalError.textContent = (res.error && res.error.message) || (res.data && res.data.error) || 'Could not start checkout. Please try again.';
        groundSchoolModalError.classList.add('show');
        return;
      }
      window.location.href = res.data.url;
    }).catch(function () {
      groundSchoolModalCta.disabled = false;
      groundSchoolModalCta.textContent = 'Pay & Register';
      groundSchoolModalError.textContent = 'Could not start checkout. Please try again.';
      groundSchoolModalError.classList.add('show');
    });
  });

  /* ── Post-Stripe-redirect toasts ────────────────────────────── */
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('unlocked') === '1') {
    authReady.then(function () {
      apexSupabase.from('profiles').select('checkride_prep_unlocked').eq('id', member.id).single().then(function (res) {
        if (res.data && res.data.checkride_prep_unlocked) {
          member.checkridePrepUnlocked = true;
          applyUnlockState();
          toast('Unlocked! Welcome to the Checkride Prep System.');
        }
      });
    });
  }
  if (urlParams.get('registered') === '1') {
    toast('You\'re registered for ground school!');
  }

  /* ── Account form ───────────────────────────────────────────── */
  document.getElementById('accountForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = e.target.querySelector('[type="submit"]');
    var newName = document.getElementById('accFullName').value.trim() || member.name;
    var newCert = document.getElementById('accCertGoal').value;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    apexSupabase.from('profiles').update({ full_name: newName, certificate_status: newCert }).eq('id', member.id).then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      if (res.error) { toast('Could not save: ' + res.error.message); return; }
      member.name = newName;
      member.certificateStatus = newCert;
      populateMember();
      toast('Profile updated.');
    });
  });

  /* ══════════════════════════════════════════════════════════════
     PERSISTED STATE — studied / favorites / last-viewed / lesson completion
     Now backed by Supabase (portal_question_progress, portal_scenario_progress,
     portal_lesson_progress, portal_study_activity, portal_achievements).
     See supabase-portal-schema.sql for the table definitions + RLS.
     Source content: Apex Advantage — Private Pilot Checkride Prep Pack (PDF)
     ══════════════════════════════════════════════════════════════ */
  var studied = {};
  var favorites = {};
  var lastViewed = {};
  var lessonComplete = {};
  var viewCounts = {};
  var answeredCounts = {};
  var firstViewed = {};
  var studyDays = {};          // 'YYYY-MM-DD' -> seconds studied that day
  var earnedAchievements = {};
  var checkrideModeDone = false;

  function progressTableFor(id) {
    if (id.indexOf('scenario-') === 0) return { table: 'portal_scenario_progress', idField: 'scenario_id' };
    if (id.indexOf('lesson-') === 0) return { table: 'portal_lesson_progress', idField: 'lesson_id' };
    return { table: 'portal_question_progress', idField: 'question_id' };
  }

  function upsertRow(table, idField, id, patch) {
    if (!member) return Promise.resolve();
    var row = { profile_id: member.id, updated_at: new Date().toISOString() };
    row[idField] = id;
    Object.keys(patch).forEach(function (k) { row[k] = patch[k]; });
    return apexSupabase.from(table).upsert(row, { onConflict: 'profile_id,' + idField });
  }

  function getTodayStr() {
    var d = new Date();
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function bumpStudyDay(extraSeconds) {
    if (!member) return;
    var today = getTodayStr();
    var isNewDay = !(today in studyDays);
    var newTotal = (studyDays[today] || 0) + (extraSeconds || 0);
    studyDays[today] = newTotal;
    apexSupabase.from('portal_study_activity')
      .upsert({ profile_id: member.id, activity_date: today, seconds: newTotal }, { onConflict: 'profile_id,activity_date' })
      .then(function () {
        renderStreak();
        renderReadiness();
        if (isNewDay) checkAchievements();
      });
  }

  function toggleStudied(id) {
    studied[id] = !studied[id];
    var conf = progressTableFor(id);
    upsertRow(conf.table, conf.idField, id, { completed: studied[id] });
    bumpStudyDay(0);
    checkAchievements();
  }

  function toggleFavorite(id) {
    favorites[id] = !favorites[id];
    var conf = progressTableFor(id);
    upsertRow(conf.table, conf.idField, id, { favorited: favorites[id] });
  }

  function touchLastViewed(id) {
    var now = Date.now();
    lastViewed[id] = now;
    var conf = progressTableFor(id);
    var patch = { last_viewed_at: new Date(now).toISOString() };
    if (conf.table !== 'portal_lesson_progress') {
      viewCounts[id] = (viewCounts[id] || 0) + 1;
      patch.viewed_count = viewCounts[id];
      if (!firstViewed[id]) { firstViewed[id] = now; patch.first_viewed_at = new Date(now).toISOString(); }
    }
    upsertRow(conf.table, conf.idField, id, patch);
    bumpStudyDay(0);
  }

  function timeAgo(ts) {
    if (!ts) return '';
    var diff = Math.round((Date.now() - ts) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return diff + 'm ago';
    var hrs = Math.round(diff / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.round(hrs / 24) + 'd ago';
  }

  /* ── Load all progress from Supabase, then render everything ──── */
  var loggedEventTypes = {};
  var emailedTypes = {};          // email_type -> most recent sent_at (ms), for throttling
  var askAndrewData = {};         // question_id -> array of {message, answer, status, mine}
  var referralCode = null;
  var referrals = [];
  var checkrideDate = null;
  var testimonialSubmitted = false;
  var checkrideResult = null;

  function loadProgress() {
    return Promise.all([
      apexSupabase.from('portal_question_progress').select('*').eq('profile_id', member.id),
      apexSupabase.from('portal_scenario_progress').select('*').eq('profile_id', member.id),
      apexSupabase.from('portal_lesson_progress').select('*').eq('profile_id', member.id),
      apexSupabase.from('portal_study_activity').select('*').eq('profile_id', member.id),
      apexSupabase.from('portal_achievements').select('*').eq('profile_id', member.id),
      apexSupabase.from('portal_practice_attempts').select('mode,completed_at').eq('profile_id', member.id).eq('mode', 'checkride').not('completed_at', 'is', null).limit(1),
      apexSupabase.from('portal_events').select('event_type').eq('profile_id', member.id),
      apexSupabase.from('portal_email_log').select('email_type,sent_at').eq('profile_id', member.id),
      apexSupabase.from('portal_question_discussions').select('*').or('status.eq.answered,profile_id.eq.' + member.id),
      apexSupabase.from('portal_referral_codes').select('*').eq('profile_id', member.id).maybeSingle(),
      apexSupabase.from('portal_referrals').select('*').eq('referrer_id', member.id).order('created_at', { ascending: false }),
      apexSupabase.from('portal_checkride_date').select('*').eq('profile_id', member.id).maybeSingle(),
      apexSupabase.from('portal_testimonials').select('id').eq('profile_id', member.id).limit(1),
      apexSupabase.from('portal_checkride_results').select('*').eq('profile_id', member.id).maybeSingle()
    ]).then(function (results) {
      (results[0].data || []).forEach(function (r) {
        studied[r.question_id] = r.completed;
        favorites[r.question_id] = r.favorited;
        if (r.last_viewed_at) lastViewed[r.question_id] = new Date(r.last_viewed_at).getTime();
        viewCounts[r.question_id] = r.viewed_count || 0;
        answeredCounts[r.question_id] = r.answered_count || 0;
        if (r.first_viewed_at) firstViewed[r.question_id] = new Date(r.first_viewed_at).getTime();
      });
      (results[1].data || []).forEach(function (r) {
        studied[r.scenario_id] = r.completed;
        favorites[r.scenario_id] = r.favorited;
        if (r.last_viewed_at) lastViewed[r.scenario_id] = new Date(r.last_viewed_at).getTime();
        viewCounts[r.scenario_id] = r.viewed_count || 0;
      });
      (results[2].data || []).forEach(function (r) {
        lessonComplete[r.lesson_id] = r.completed;
        if (r.last_viewed_at) lastViewed[r.lesson_id] = new Date(r.last_viewed_at).getTime();
      });
      (results[3].data || []).forEach(function (r) { studyDays[r.activity_date] = r.seconds || 0; });
      (results[4].data || []).forEach(function (r) { earnedAchievements[r.achievement_key] = true; });
      checkrideModeDone = (results[5].data || []).length > 0;
      (results[6].data || []).forEach(function (r) { loggedEventTypes[r.event_type] = true; });
      (results[7].data || []).forEach(function (r) {
        var t = new Date(r.sent_at).getTime();
        if (!emailedTypes[r.email_type] || t > emailedTypes[r.email_type]) emailedTypes[r.email_type] = t;
      });
      (results[8].data || []).forEach(function (r) {
        if (!askAndrewData[r.question_id]) askAndrewData[r.question_id] = [];
        askAndrewData[r.question_id].push(r);
      });
      referralCode = results[9].data ? results[9].data.code : null;
      referrals = results[10].data || [];
      checkrideDate = results[11].data ? results[11].data.checkride_date : null;
      testimonialSubmitted = (results[12].data || []).length > 0;
      checkrideResult = results[13].data || null;
    }).catch(function (e) { console.error('Failed to load portal progress', e); });
  }

  /* ── Study time tracking (feeds Readiness Score + Admin Analytics) */
  var activeSeconds = 0;
  setInterval(function () {
    if (document.visibilityState === 'visible') activeSeconds += 1;
  }, 1000);
  function flushStudyTime() {
    if (activeSeconds < 5 || !member) return;
    var toFlush = activeSeconds;
    activeSeconds = 0;
    bumpStudyDay(toFlush);
  }
  setInterval(flushStudyTime, 30000);
  window.addEventListener('beforeunload', flushStudyTime);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushStudyTime();
  });

  /* ══════════════════════════════════════════════════════════════
     SECTION 1 — CHECKRIDE SUCCESS FRAMEWORK
     ══════════════════════════════════════════════════════════════ */
  var FRAMEWORK_LESSON = {
    id: 'lesson-framework',
    title: 'Checkride Success Framework',
    meta: 'Section 1 · How the oral exam actually works',
    parts: [
      { h: 'Welcome Letter from Apex Aviation', body: [
        `Welcome to the Apex Advantage Private Pilot Checkride Prep Pack — and congratulations on making it this far. If you're holding this guide, you've already put in the real work: the flight hours, the ground school, the long study nights. What you're looking for now isn't more information. It's confidence — the kind that comes from knowing exactly what to expect and exactly how to show up prepared.`,
        `We built this guide the way we build every part of Apex Advantage: around a simple idea we call Train Beyond the Checkride. The oral exam isn't a memorization contest, and your examiner isn't trying to trip you up. A Designated Pilot Examiner is trying to find out one thing — are you the kind of pilot who can be trusted to make good decisions alone in an airplane? Every question in this guide is built to help you answer that question with real, durable understanding, not a script.`,
        `This isn't a textbook, and it isn't a cram sheet. It's a study partner — the same kind of structured, scenario-based preparation our live students get in Apex Advantage ground school, distilled into a guide you can work through at your own pace. Use it well, and you won't just pass your checkride. You'll walk into it calm, because you'll already know you're ready.`,
        `Fly safe, study well, and welcome to Apex. — The Apex Aviation Team`
      ] },
      { h: 'How to Use This Guide', list: [
        `Work section by section, in order — the sections roughly follow the structure of a real oral exam, building from documents and regulations toward judgment and real-world scenarios.`,
        `Don't just read the Model Answer — cover it, answer the question out loud in your own words first, then compare. Speaking your answer is what actually builds checkride-ready recall.`,
        `Pay close attention to the Common Student Mistakes field for every question — these are the specific, predictable ways applicants lose confidence points, and knowing them in advance is half the battle.`,
        `Use the ACS Connection field to cross-reference the current Airman Certification Standards directly — this guide is a companion to the ACS, not a replacement for reading it.`,
        `Keep the Quick Reference Appendix close during your final week of study — it's built for fast review, not first-time learning.`,
        `If a question or concept still feels shaky after working through this guide, that's useful information — bring it to your CFI directly rather than letting it go unresolved into checkride day.`
      ] },
      { h: 'Understanding the FAA ACS', body: [
        `The Airman Certification Standards (ACS) is the actual rubric your DPE uses to evaluate you — not a general guideline, the specific, official standard. Every checkride question you'll ever be asked traces back to a specific Area of Operation and Task within the ACS.`,
        `The ACS structure has three layers, and understanding this structure is itself checkride-relevant knowledge:`
      ], list: [
        `Areas of Operation — the broad phases of flight and knowledge domains (e.g., Preflight Preparation, Airspace, Slow Flight and Stalls).`,
        `Tasks — specific, named skills or knowledge sets within each Area of Operation (e.g., Task B: Airworthiness Requirements).`,
        `Elements — every Task breaks down into Knowledge, Risk Management, and Skill elements. This three-part structure is what distinguishes the modern ACS from the older Practical Test Standards (PTS): risk management is now explicitly, separately evaluated, not folded into a general skill assessment.`
      ], tip: { label: 'Instructor Tip — Read the ACS Yourself', body: `This guide maps every question to its ACS reference on purpose — use that reference to go read the actual ACS language for that Task. A DPE is quoting from that exact document, and familiarity with its actual phrasing will make you sound like you know the standard, not just the topic.` } },
      { h: 'How Oral Exams Are Evaluated', body: [
        `The oral exam is not a test of whether you can recite facts — it's a structured, scenario-based conversation designed to reveal how you think. A DPE will typically open with a real or realistic scenario (a planned flight, a specific airport, a specific day's weather) and ask you to reason through it, weaving in regulatory and technical questions naturally as the scenario unfolds.`,
        `Within each ACS Task, your examiner is listening for three things: Knowledge (do you know the correct information), Risk Management (can you identify and mitigate the relevant risks), and Skill (where applicable, can you demonstrate the associated physical or procedural skill, generally during the flight portion). A complete answer touches Knowledge and, where relevant, Risk Management — an answer that's only a fact recitation is often incomplete by ACS standards, even if factually correct.`,
        `Examiners are also evaluating your process, not just your final answer: do you know where to look something up if you're not sure? Do you stay calm and structured when you don't immediately know an answer? Composure under a moment of uncertainty is itself part of what's being evaluated — a hesitant but structured 'let me check that' response often scores better than a fast, confidently wrong one.`
      ] },
      { h: 'What DPEs Are Looking For', list: [
        `Genuine understanding over memorization — an examiner will almost always ask a 'why' or 'what if' follow-up to any definitional answer, specifically to test whether you understand the concept or just memorized a sentence.`,
        `Accurate use of current references — knowing how to find an answer in the FAR/AIM, POH, or a chart, live, is treated as equally valuable to knowing the answer from memory.`,
        `Sound aeronautical decision-making — your reasoning process when weighing a real risk (weather, performance, personal minimums) matters as much as the specific decision you land on.`,
        `Professional communication — clear, organized, confident answers, delivered the way you'd actually brief a passenger or communicate with ATC.`,
        `Honest self-assessment — examiners respond far better to 'I'm not certain, let me look that up,' than to guessing or bluffing.`
      ] },
      { h: 'Common Reasons Applicants Fail', table: {
        headers: ['Common Failure Pattern', "What's Actually Happening"],
        rows: [
          ['Memorized answers that fall apart under a follow-up question', "The applicant learned a sentence, not the underlying concept — the first 'why' question exposes the gap."],
          ['Treating the oral exam like a pop quiz instead of a conversation', 'Answering in isolated fragments instead of reasoning through the scenario the examiner is building.'],
          [`Guessing instead of saying 'I don't know, let me check'`, 'Examiners consistently rate honest uncertainty higher than a confident wrong answer — guessing erodes trust fast.'],
          ['Incomplete knowledge of personal documents and currency', 'Basic eligibility gaps (expired medical, missing endorsement) are avoidable, low-effort failure points that undermine an otherwise strong exam.'],
          ['Underprepared risk management reasoning', "Applicants who can recite regulations but can't apply a framework like PAVE or IMSAFE to a real scenario struggle with the ACS's Risk Management elements specifically."],
          ['Visible panic or shutting down under pressure', 'A single missed question is recoverable; losing composure and disengaging from the conversation is what actually derails an oral exam.']
        ]
      }, tip: { label: 'Checkride Success Tip — The Real Fix', body: `Every failure pattern above has the same root fix: work through real questions out loud, under mild time pressure, before checkride day — exactly what this guide and Apex Advantage's live Checkride Corner training are built to do.` } }
    ]
  };

  /* ══════════════════════════════════════════════════════════════
     SECTION 11 — CHECKRIDE DAY PREPARATION
     ══════════════════════════════════════════════════════════════ */
  var CHECKRIDE_DAY_LESSON = {
    id: 'lesson-checkride-day',
    title: 'Checkride Day Preparation',
    meta: 'Section 11 · Documents, timing, and composure',
    parts: [
      { h: 'Overview', body: [
        `Everything in this section is about removing avoidable friction from checkride day, so your energy goes entirely toward the exam itself — not toward finding a missing document or managing unnecessary stress.`
      ] },
      { h: 'What to Bring', list: [
        'Government-issued photo ID',
        'Student pilot certificate / medical certificate',
        'Completed and signed IACRA application (Form 8710-1)',
        'Logbook with all required endorsements',
        'Knowledge Test Report',
        'Aircraft airworthiness certificate, registration, operating limitations, and weight and balance data (ARROW)',
        'Aircraft maintenance logs (or evidence of required inspections)',
        'Current charts, plotter, E6B (electronic or manual), and your completed cross-country flight plan',
        "Examiner's fee, in the payment method they specify in advance"
      ] },
      { h: 'Day-Before Checklist', list: [
        'Confirm weather and NOTAMs for your planned checkride route one more time',
        'Verify every document above is physically gathered in one place, not scattered',
        'Review your cross-country flight plan and be ready to explain every number in it',
        "Get a full night's sleep — treat this as seriously as you would before a flight lesson",
        'Avoid last-minute cramming on brand-new material; focus instead on your weakest, already-identified areas'
      ] },
      { h: 'Morning-Of Checklist', list: [
        'Eat a real meal — low blood sugar undermines focus exactly when you need it most',
        'Arrive early, not just on time, to avoid any rushed, stressed start',
        'Do a final honest IMSAFE check on yourself',
        'Review your Quick Reference sheets one final time, calmly — not as new learning, just as a confidence check',
        "Remind yourself: your instructor endorsed you because they believe you're ready. Trust that assessment."
      ] },
      { h: 'Common Mistakes on Checkride Day', list: [
        'Arriving with incomplete paperwork, which can delay or cancel the exam entirely',
        'Trying to learn new material the morning of, instead of reinforcing what\'s already solid',
        "Guessing confidently instead of saying 'I'm not sure, let me check' when appropriate",
        'Letting one missed question derail composure for the rest of the exam',
        'Underestimating the professionalism component — how you communicate matters, not just what you know'
      ] },
      { h: 'Professionalism Tips', list: [
        'Dress and present yourself the way you would for a professional interview — this sets a tone before you say a word.',
        "Treat the DPE as a respected colleague evaluating your readiness, not an adversary trying to catch you out — because that's genuinely their role.",
        "Speak in complete, organized answers rather than fragments — structure your response the way you'd brief a passenger.",
        "If you don't know something, say so clearly and show how you'd find the answer — this is a strength, not a weakness, in a DPE's eyes."
      ] },
      { h: 'Stress Management Techniques', list: [
        'Box breathing (inhale 4 seconds, hold 4, exhale 4, hold 4) before and during the exam if you feel your nerves spike — a genuinely effective, discreet technique.',
        "Reframe the oral exam as a conversation with a fellow aviator, not an interrogation — because that's structurally closer to what it actually is.",
        'If you blank on a question, pause, breathe, and restate the question back in your own words — this buys real thinking time without appearing evasive.',
        'Remember that a single missed question is recoverable — examiners expect some hesitation and imperfection, and are evaluating your overall judgment, not a flawless performance.'
      ], tip: { label: 'Checkride Success Tip — You Are More Ready Than You Feel', body: "Checkride anxiety is nearly universal, even among applicants who are genuinely well-prepared. Your instructor's endorsement means they believe, professionally, that you're ready — let that carry some of the weight on exam morning." } }
    ]
  };

  /* ══════════════════════════════════════════════════════════════
     SECTION 12 — QUICK REFERENCE APPENDIX (7 mnemonic sheets)
     ══════════════════════════════════════════════════════════════ */
  var QUICK_REF = [
    { id: 'qr-arrow', title: 'ARROW', subtitle: 'Required aircraft documents', rows: [
      ['A', 'Airworthiness Certificate', 'Must be displayed in the aircraft, visible to passengers/occupants.'],
      ['R', 'Registration', 'Current FAA registration certificate.'],
      ['R', 'Radio Station License', 'Generally not required for domestic U.S. operations; required for certain international flights.'],
      ['O', 'Operating Limitations', 'POH/AFM, placards, or markings — whichever applies to the aircraft.'],
      ['W', 'Weight and Balance Data', 'Current weight and balance report and equipment list.']
    ] },
    { id: 'qr-tomato', title: 'A TOMATO FLAMES', subtitle: 'Required equipment for day VFR flight — 14 CFR 91.205(b)', rows: [
      ['A', 'Airspeed Indicator', ''],
      ['T', 'Tachometer (for each engine)', ''],
      ['O', 'Oil Pressure Gauge', 'For each engine using a pressure system.'],
      ['M', 'Manifold Pressure Gauge', 'For each altitude engine (controllable pitch prop).'],
      ['A', 'Altimeter', ''],
      ['T', 'Temperature Gauge', 'For each liquid-cooled engine.'],
      ['O', 'Oil Temperature Gauge', 'For each air-cooled engine.'],
      ['F', 'Fuel Gauge', 'Indicating quantity in each tank.'],
      ['L', 'Landing Gear Position Indicator', 'If retractable gear.'],
      ['A', 'Anti-Collision Lights', 'For aircraft certificated after March 11, 1996.'],
      ['M', 'Magnetic Compass', ''],
      ['E', 'ELT', 'Emergency Locator Transmitter, per 91.207.'],
      ['S', 'Seat Belts (and shoulder harnesses)', 'As required per occupant/seat.']
    ] },
    { id: 'qr-av1ates', title: 'AV1ATES', subtitle: 'Recurring aircraft inspections that keep it legal for flight', rows: [
      ['A', 'Annual', 'Required every 12 calendar months, performed by an A&P mechanic holding an Inspection Authorization (IA).'],
      ['V', 'VOR Check', 'Required every 30 days if the aircraft is flown IFR under VOR navigation.'],
      ['1', '100-Hour', 'Required if the aircraft is used for hire or for flight instruction for hire.'],
      ['A', 'Alt/Static System', 'Altimeter and static system check, required every 24 calendar months for IFR operations.'],
      ['T', 'Transponder', 'Required every 24 calendar months.'],
      ['E·S', 'ELT Inspections', 'Required every 12 calendar months, with battery replacement per manufacturer requirements or after one hour of cumulative use.']
    ] },
    { id: 'qr-imsafe', title: 'IMSAFE', subtitle: 'Personal fitness-to-fly self-assessment', rows: [
      ['I', 'Illness', 'Any symptoms that could affect performance, even minor.'],
      ['M', 'Medication', 'Prescription, over-the-counter, and their side effects.'],
      ['S', 'Stress', 'Personal, professional, or checkride-related stress.'],
      ['A', 'Alcohol', 'Apply the 8-hour/24-hour/BAC standard.'],
      ['F', 'Fatigue', 'Both acute (last night\'s sleep) and chronic (sleep pattern over weeks).'],
      ['E', 'Emotion', 'Emotional state and its effect on judgment and focus.']
    ] },
    { id: 'qr-pave', title: 'PAVE', subtitle: 'Risk management framework for every flight', rows: [
      ['P', 'Pilot', 'Your own currency, proficiency, and IMSAFE status.'],
      ['A', 'Aircraft', 'Airworthiness, performance, and equipment for the planned flight.'],
      ['V', 'enVironment', 'Weather, airspace, terrain, and airport conditions.'],
      ['E', 'External Pressures', 'Schedule, passengers, cost, or ego-driven pressure to fly.']
    ] },
    { id: 'qr-care', title: 'CARE', subtitle: 'Risk-factor identification model (used alongside TEAM)', rows: [
      ['C', 'Consequences', "What's actually at stake if this risk materializes?"],
      ['A', 'Alternatives', 'What other options exist besides the current plan?'],
      ['R', 'Reality', 'Is your assessment of the situation actually accurate?'],
      ['E', 'External Factors', 'What outside pressures might be distorting your judgment?']
    ] },
    { id: 'qr-nwkraft', title: 'NWKRAFT', subtitle: 'Preflight and cross-country briefing checklist', rows: [
      ['N', 'NOTAMs', 'Check for current NOTAMs affecting your route, departure, and destination.'],
      ['W', 'Weather', 'Full briefing — current conditions, forecasts, and any AIRMETs/SIGMETs along your route.'],
      ['K', 'Known ATC Delays', 'Check for published ground stops, delays, or routing advisories.'],
      ['R', 'Runway Lengths', 'Confirm available runway length at departure, destination, and any planned alternate.'],
      ['A', 'Alternates', 'Identify suitable alternate airports along your route in case of a diversion.'],
      ['F', 'Fuel Requirements', 'Calculate total fuel required including the appropriate day/night VFR reserve.'],
      ['T', 'Takeoff and Landing Distances', "Calculate actual performance-based distances for the day's conditions, not just legal minimums."]
    ] }
  ];

  /* ══════════════════════════════════════════════════════════════
     SECTIONS 2–10 — DPE QUESTIONS LIBRARY (72 questions, verbatim)
     ══════════════════════════════════════════════════════════════ */
  var CATEGORY_META = {
    eligibility:   { label: 'Eligibility & Documents',    section: 'Section 2', intro: "Every oral exam opens here — documents, certificates, and eligibility. It's the lowest-difficulty section of the exam in terms of content, and also the section where avoidable, embarrassing mistakes (an expired medical, a missing endorsement) do the most unnecessary damage to an applicant's confidence and first impression." },
    airworthiness: { label: 'Airworthiness',              section: 'Section 3', intro: "Airworthiness questions test whether you understand your responsibility, as PIC, to determine whether the specific aircraft you're about to fly is legal and safe — not just whether you can recite an inspection schedule from memory." },
    privileges:    { label: 'Privileges & Limitations',   section: 'Section 4', intro: "This section tests whether you know exactly what a Private Pilot Certificate allows you to do — and just as importantly, what it doesn't. Precision matters here: examiners often probe the edges of a privilege, not just its general existence." },
    airspace:      { label: 'Airspace',                   section: 'Section 5', intro: 'Airspace questions test whether you can instantly recall dimensions, entry requirements, and weather minimums — chart-independent, from memory — since real flight planning happens before you ever pull up a chart in the airplane.' },
    weather:       { label: 'Weather',                    section: 'Section 6', intro: 'Weather questions test two things at once: can you decode the raw products, and can you translate that decoded information into a real go/no-go decision. Both matter — a DPE cares less about your ability to define a term than your ability to use it.' },
    performance:   { label: 'Performance & W&B',          section: 'Section 7', intro: 'This section tests whether you can turn published aircraft numbers into an actual go/no-go decision for a specific day, specific loading, and specific runway — not just whether you can read a chart in isolation.' },
    aeromedical:   { label: 'Aeromedical Factors',        section: 'Section 8', intro: "This section blends physiology with self-awareness. It's the one part of the exam that tests judgment about yourself, not just the airplane or the airspace — and it's a section many applicants under-prepare because it feels less technical than the rest." },
    crosscountry:  { label: 'Cross-Country Planning',     section: 'Section 9', intro: "Cross-country planning ties together nearly everything else in this guide — airspace, weather, performance, and regulations — into a single, complete flight plan. This is often where the oral exam's scenario-based structure becomes most obvious." },
    emergency:     { label: 'Emergency Operations',        section: 'Section 10', intro: 'Emergency questions test whether calm, procedural thinking is already built into your instincts — examiners are listening for structured response, not dramatic language. This section rewards the pilot who sounds like they\'ve genuinely rehearsed this, not just read about it.' }
  };

  var DPE_DATA = [
    // Section 2 — Eligibility and Required Documents
    { id: 'elig-1', section: 'eligibility', q: 'What are the eligibility requirements to apply for a Private Pilot Certificate?',
      model: 'You must be at least 17 years old, be able to read, speak, write, and understand English, and hold at least a third-class medical certificate (or qualify under BasicMed for certain operations), along with the required aeronautical experience and endorsements.',
      mistakes: 'Listing only age and medical requirements, omitting the English-language proficiency requirement or required endorsements.',
      evaluating: 'Whether you can state a complete, accurate eligibility list — not just the parts that come to mind first.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'This is almost always the opening question of an oral exam — a clean, complete answer sets a confident tone for everything that follows.' },
    { id: 'elig-2', section: 'eligibility', q: 'What is the difference between a student pilot certificate and a medical certificate?',
      model: 'The student pilot certificate authorizes you to act as pilot in command while training and solo; the medical certificate establishes your medical fitness to fly. They serve different purposes, even though newer applicants often receive them as a single combined document.',
      mistakes: 'Treating the two as interchangeable, or assuming one document covers both functions.',
      evaluating: 'Whether you understand the distinct legal purpose of each document, not just that you possess them.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'If your medical lapses but your student certificate is still valid, you are no longer legal to act as PIC — understanding why matters, not just knowing you need both.' },
    { id: 'elig-3', section: 'eligibility', q: 'What are the three classes of medical certificates, and what is BasicMed?',
      model: 'First class (for ATP privileges), second class (for commercial privileges), and third class (for private/recreational privileges), each with different duration and examination requirements. BasicMed is an alternative to holding a traditional medical certificate for certain private pilot operations, requiring a physician\'s exam and an online medical education course rather than an FAA medical exam.',
      mistakes: 'Describing BasicMed as a full exemption from medical oversight rather than a defined alternative pathway with its own requirements and limitations.',
      evaluating: 'Whether you understand both pathways well enough to explain which one applies to your specific situation.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'Many private pilots fly indefinitely under BasicMed after their last FAA medical — know your own certificate\'s expiration and which pathway you\'re currently operating under.' },
    { id: 'elig-4', section: 'eligibility', q: 'What endorsements are required before you can take your Private Pilot checkride?',
      model: 'Endorsements confirming you have received and logged the required aeronautical knowledge and flight training, that you are prepared for the required knowledge test and have satisfactory knowledge of any missed subject areas, and a final endorsement that you have received training and are prepared for the practical test.',
      mistakes: 'Naming only the pre-solo endorsement, or forgetting the knowledge-test-related endorsements.',
      evaluating: 'Whether your logbook and endorsement paperwork are actually complete — this is often verified by physically reviewing your logbook.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'A DPE will check these endorsements against your logbook before the oral exam even begins — incomplete paperwork can delay or cancel a checkride entirely.' },
    { id: 'elig-5', section: 'eligibility', q: 'What is IACRA, and what role does it play in the certification process?',
      model: "IACRA (Integrated Airman Certification and Rating Application) is the FAA's online system for applying for pilot certificates and ratings, and for scheduling the Knowledge Test. Your application must be completed and often digitally signed by your instructor before your checkride.",
      mistakes: 'Being unfamiliar with how to actually navigate or complete an IACRA application, since applicants often have an instructor complete this step for them.',
      evaluating: 'Basic operational familiarity with the certification process itself, not just the flying content.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'Practice logging into and navigating your own IACRA account before checkride day — paperwork problems on the day of your exam are entirely avoidable.' },
    { id: 'elig-6', section: 'eligibility', q: 'What personal identification and documents must you bring to your checkride?',
      model: 'A government-issued photo ID, your student pilot certificate (or combined certificate/medical), your completed IACRA application (Form 8710-1), your logbook with all required endorsements, and your Knowledge Test Report.',
      mistakes: 'Forgetting the Knowledge Test Report specifically, or bringing an expired photo ID.',
      evaluating: 'Basic checkride-day readiness and attention to logistics — a low-difficulty but high-consequence area to get wrong.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'Build a physical checklist the week before your checkride and verify every item the night before — don\'t rely on memory on exam morning.' },
    { id: 'elig-7', section: 'eligibility', q: 'What must be logged in a pilot logbook?',
      model: 'Training and aeronautical experience used to meet certificate or rating requirements, and information required to show recency of experience — including date, aircraft, route, flight time, conditions of flight, and type of pilot experience (dual, solo, PIC, cross-country, night, instrument).',
      mistakes: 'Believing every flight must be logged — only flights used to meet requirements or demonstrate recency are legally required, though most pilots log all flight time as good practice.',
      evaluating: 'Whether you understand what logging is legally required versus simply customary.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'Be ready to walk a DPE through your own logbook and explain how specific entries satisfy specific aeronautical experience requirements — not just that the hours exist.' },
    { id: 'elig-8', section: 'eligibility', q: 'What is a Knowledge Test Report, and how does it connect to the ACS?',
      model: "It's the report issued after completing the FAA Knowledge Test, listing ACS codes for any subject areas missed. Those codes map directly to specific ACS Tasks, which you and your instructor should use to focus review before the checkride.",
      mistakes: 'Not knowing how to interpret the ACS codes on your own report, or not having reviewed missed areas before the oral exam.',
      evaluating: 'Whether you took your own knowledge gaps seriously and can speak to how you addressed them.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'Expect a DPE to specifically ask about any ACS codes you missed on your Knowledge Test — have a genuine, prepared answer, not a vague one.' },

    // Section 3 — Aircraft Airworthiness
    { id: 'aw-1', section: 'airworthiness', q: 'What does ARROW stand for, and why does it matter?',
      model: 'ARROW is the required-documents mnemonic: Airworthiness certificate, Registration, Radio station license (only required for certain international operations), Operating limitations (POH/AFM or placards), and Weight and balance data. These documents must be aboard the aircraft for flight.',
      mistakes: 'Forgetting that the radio station license is generally not required for domestic U.S. operations, or omitting weight and balance data.',
      evaluating: 'Whether you can recite this from memory and correctly explain any nuance (like the radio license exception), not just the acronym alone.',
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Knowledge).',
      application: 'Be ready to physically locate each ARROW document in your training aircraft during the oral exam — DPEs frequently ask you to produce them, not just name them.' },
    { id: 'aw-2', section: 'airworthiness', q: 'What makes an aircraft airworthy?',
      model: 'An aircraft is airworthy when it conforms to its type certificate (or approved alterations) and is in a condition for safe operation. Both conditions must be true — an aircraft can conform to its type design but still be unsafe due to damage or missing maintenance.',
      mistakes: 'Defining airworthiness only in terms of having a current annual inspection, which is necessary but not sufficient on its own.',
      evaluating: 'Whether you understand this as a two-part legal definition, not a single checklist item.',
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Knowledge).',
      application: 'As PIC, you are legally responsible for determining airworthiness before every flight — this isn\'t just the mechanic\'s job.' },
    { id: 'aw-3', section: 'airworthiness', q: 'What inspections does an aircraft need to remain legal for flight?',
      model: 'An annual inspection (every 12 calendar months), a 100-hour inspection (if used for hire or flight instruction for hire), a transponder and altimeter/pitot-static system check (every 24 calendar months, for operations requiring them), and an ELT inspection (every 12 calendar months, with battery replacement per manufacturer requirements or after one hour of cumulative use).',
      mistakes: 'Confusing the 24-month transponder/altimeter cycle with the 12-month annual cycle, or forgetting the ELT battery replacement rule.',
      evaluating: "Whether you can locate the actual due dates for these inspections in your own aircraft's logbooks, not just recite the intervals.",
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Knowledge).',
      application: "Practice pulling up your training aircraft's actual maintenance logs and finding each inspection's due date before your checkride — this is a very commonly tested practical skill." },
    { id: 'aw-4', section: 'airworthiness', q: 'What is required for an annual inspection, and who can perform it?',
      model: 'Every aircraft must undergo an annual inspection within the preceding 12 calendar months, performed by an FAA-certificated Airframe and Powerplant (A&P) mechanic holding an Inspection Authorization (IA).',
      mistakes: 'Believing any A&P mechanic can sign off an annual inspection — the Inspection Authorization is a specific, additional certification.',
      evaluating: "Precision in distinguishing an A&P mechanic's general privileges from an IA holder's specific annual-inspection authority.",
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Knowledge).',
      application: 'If you ever purchase or manage an aircraft, knowing this distinction matters for scheduling maintenance with the right qualified person.' },
    { id: 'aw-5', section: 'airworthiness', q: "When is a 100-hour inspection required, and what happens if it's exceeded?",
      model: 'A 100-hour inspection is required for aircraft used to carry passengers for hire or used for flight instruction for hire. If the 100-hour limit is exceeded, the aircraft may be flown up to 10 additional hours to reach a location where the inspection can be performed, but those extra hours count toward the next 100-hour interval.',
      mistakes: "Assuming the 10-hour overflight allowance is 'free' time rather than time that still counts against the next inspection cycle.",
      evaluating: 'Whether you understand this as a limited operational allowance, not a loophole.',
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Knowledge).',
      application: "This rule is most relevant to flight school and rental aircraft — understand it even if you don't own the aircraft you train in." },
    { id: 'aw-6', section: 'airworthiness', q: 'What is Airworthiness Directive (AD) compliance, and why does it matter?',
      model: "An Airworthiness Directive is a legally enforceable FAA regulation addressing an unsafe condition in a specific aircraft, engine, or component. Compliance is mandatory, and AD compliance is tracked and documented in the aircraft's maintenance records.",
      mistakes: 'Confusing an AD (mandatory) with a Service Bulletin (often optional, manufacturer-issued guidance).',
      evaluating: 'Whether you understand ADs as a distinct, non-negotiable category of maintenance requirement.',
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Knowledge).',
      application: "A DPE may ask you to find evidence of AD compliance in the aircraft's logbooks — know generally where and how this is documented." },
    { id: 'aw-7', section: 'airworthiness', q: 'What is the process under 14 CFR 91.213 when equipment is inoperative?',
      model: "First check if the aircraft has an approved Minimum Equipment List (MEL) — if so, follow it. If there's no MEL, determine whether the inoperative item is required by the type certification, by 91.205, by an Airworthiness Directive, or is otherwise flight-critical; if not required by any of those, it may be removed or deactivated and placarded inoperative, or the flight may proceed if none of those conditions apply.",
      mistakes: 'Skipping the MEL question first, or forgetting that inoperative equipment not covered by any required list may still need to be deactivated and placarded, not simply ignored.',
      evaluating: 'Whether you can walk through this multi-step decision logic in the correct order, live, without skipping a step.',
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Knowledge, Risk Management).',
      application: 'This is one of the most commonly tested, multi-step regulatory questions on the exam — practice walking through it out loud until the sequence is automatic.' },
    { id: 'aw-8', section: 'airworthiness', q: 'What are your responsibilities as PIC if you discover a discrepancy during preflight?',
      model: 'You must determine whether the discrepancy affects airworthiness or required equipment, apply the 91.213 process if equipment is involved, and document or communicate the discrepancy appropriately — and ultimately, decide not to fly if you cannot establish the aircraft is airworthy.',
      mistakes: 'Treating a discrepancy as automatically disqualifying without applying the actual regulatory decision process, or the opposite — dismissing a real discrepancy too quickly.',
      evaluating: 'Sound risk management judgment, not just regulatory recall — this element blends Knowledge with Risk Management explicitly.',
      acs: 'Area of Operation I, Task B — Airworthiness Requirements (Risk Management).',
      application: "This exact judgment call — fly or don't fly, based on a real preflight discrepancy — is one you'll actually face as a certificated pilot, likely more than once." },

    // Section 4 — Pilot Privileges and Limitations
    { id: 'priv-1', section: 'privileges', q: 'What is required to remain current to carry passengers?',
      model: 'Within the preceding 24 calendar months, you must complete a flight review (or equivalent) with an authorized instructor. To carry passengers, you must also have made three takeoffs and three landings in the preceding 90 days in an aircraft of the same category and class (and type, if required); for night currency, those takeoffs and landings must be to a full stop, between one hour after sunset and one hour before sunrise.',
      mistakes: 'Forgetting the distinction between day currency (touch-and-go acceptable) and night currency (full stop required), or confusing the 24-month flight review cycle with the 90-day passenger currency cycle.',
      evaluating: 'Precision across two different currency timeframes that are frequently confused with each other.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'Track your own three-takeoffs-and-landings currency actively — many pilots are surprised to find themselves not current to carry a passenger simply from infrequent flying.' },
    { id: 'priv-2', section: 'privileges', q: 'What is a flight review, and when is it required?',
      model: 'A flight review is a minimum one-hour flight and one-hour ground review with an authorized instructor, required within the preceding 24 calendar months to act as PIC. It is not a test with a pass/fail outcome — it\'s a review, and the instructor endorses your logbook upon satisfactory completion.',
      mistakes: 'Describing the flight review as a retest of checkride-level maneuvers, or believing it can be \'failed\' in the same sense as a practical test.',
      evaluating: "Correct understanding of the flight review's actual regulatory purpose and tone.",
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'Many activities (an additional certificate or rating, certain phase of an FAA safety program) can substitute for a flight review — know that flexibility exists.' },
    { id: 'priv-3', section: 'privileges', q: 'What are the requirements and limitations of flying under BasicMed?',
      model: "You must have held a valid medical certificate at some point after July 14, 2006, complete a physician's comprehensive medical exam using the FAA's checklist, and complete a free online medical education course. Under BasicMed, you're limited to aircraft with 6 or fewer seats and 6,000 lbs or less max takeoff weight, flying no higher than 18,000 feet MSL, no faster than 250 knots, and not for compensation or hire (with limited exceptions).",
      mistakes: 'Forgetting the aircraft weight/seat limitations, or believing BasicMed has no altitude or airspeed limits.',
      evaluating: "Detailed, specific knowledge of BasicMed's actual limitations, not just that the pathway exists.",
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'If you plan to fly under BasicMed long-term, know these limits well — they directly affect what aircraft and altitudes are available to you.' },
    { id: 'priv-4', section: 'privileges', q: 'Can a private pilot ever receive compensation for flying?',
      model: 'Generally no — a private pilot may not act as PIC for compensation or hire. Limited exceptions exist, such as sharing operating expenses pro rata with passengers on a flight where the pilot has a common purpose, or certain charitable/search-and-rescue flights under specific conditions.',
      mistakes: "Stating an absolute 'never' without acknowledging the pro rata share exception, or misapplying the exception to a flight that doesn't actually qualify.",
      evaluating: 'Whether you understand this as a general prohibition with narrow, specific exceptions — not an absolute rule or a loophole.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'The pro rata rule comes up constantly in real private flying — splitting fuel costs with friends on a trip is common, and knowing the rule precisely keeps that legal.' },
    { id: 'priv-5', section: 'privileges', q: 'What is the pro rata share rule, and how does it work?',
      model: 'A private pilot may share the operating expenses of a flight (fuel, oil, airport expenses, rental fees) with passengers, as long as the pilot pays at least an equal, pro rata share of those costs, and the pilot has their own reason for making the flight (not merely to earn compensation by carrying passengers).',
      mistakes: 'Believing passengers can cover the entire cost of the flight, or that the pilot can pay less than an equal share.',
      evaluating: 'Precise understanding of both conditions — pro rata payment AND a common purpose — not just one.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'This is the regulation that makes it legal to split costs on a weekend trip with friends — know it precisely before you rely on it.' },
    { id: 'priv-6', section: 'privileges', q: 'What preventive maintenance can a private pilot legally perform on their own aircraft?',
      model: 'A list of specific, simple maintenance tasks defined in the FARs — such as servicing landing gear wheel bearings, replacing safety wire, servicing batteries, and changing tires — may be performed by a certificated private pilot on an aircraft they own or operate, with the work properly logged.',
      mistakes: 'Believing any minor maintenance task qualifies, rather than only the specific items listed in the regulation.',
      evaluating: 'Awareness that this is a defined, limited list — not general permission to perform maintenance.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: "Relevant primarily to aircraft owners — know that this privilege exists and that it must be properly logged, even if you don't currently own an aircraft." },
    { id: 'priv-7', section: 'privileges', q: 'What flight time can a private pilot log as pilot in command?',
      model: 'You may log PIC time when you are the sole manipulator of the controls of an aircraft for which you are rated, or when you are the sole occupant, or when acting as PIC under the regulations even if not sole manipulator (such as certain instructional or safety pilot scenarios).',
      mistakes: "Believing PIC time can only be logged when you are legally the PIC of record for the flight, conflating 'logging PIC time' with 'acting as PIC.'",
      evaluating: 'Whether you understand that logging PIC time and acting as PIC are related but legally distinct concepts.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'This distinction matters most once you begin flying with other pilots or working toward additional certificates — log time accurately from the start.' },
    { id: 'priv-8', section: 'privileges', q: "What is the pilot in command's ultimate authority and responsibility under 14 CFR 91.3?",
      model: 'The PIC is directly responsible for, and is the final authority as to, the operation of the aircraft. In an in-flight emergency requiring immediate action, the PIC may deviate from any rule to the extent required to meet that emergency.',
      mistakes: 'Forgetting the emergency deviation authority, or overstating it as unlimited rather than limited to what the emergency actually requires.',
      evaluating: 'Whether you understand both halves of 91.3 — the general authority and the specific emergency exception.',
      acs: 'Area of Operation I, Task A — Pilot Qualifications (Knowledge).',
      application: 'This regulation is the foundation of everything else in this guide — as PIC, the final call is always yours, and so is the responsibility.' },

    // Section 5 — Airspace
    { id: 'asp-1', section: 'airspace', q: 'What are the basic characteristics of Class A airspace?',
      model: 'Class A airspace extends from 18,000 feet MSL up to and including FL600, covers the entire continental U.S., and requires operation under IFR with an appropriately rated pilot and equipped aircraft. VFR flight is not permitted in Class A airspace.',
      mistakes: 'Believing VFR flight is permitted with special clearance — it is not permitted at all in Class A.',
      evaluating: 'Whether you understand Class A as an absolute IFR-only environment, with no VFR exception.',
      acs: 'Area of Operation III, Task A — Airspace (Knowledge).',
      application: "As a private pilot flying VFR, Class A simply defines your operational ceiling — you'll plan cross-countries to stay well below it." },
    { id: 'asp-2', section: 'airspace', q: 'What are the entry requirements for Class B airspace?',
      model: 'You need an explicit ATC clearance to enter Class B airspace (not just two-way radio contact), a Mode C transponder with ADS-B Out where required, and for a private pilot, no additional certificate restrictions apply, though student pilots have specific training and airport restrictions.',
      mistakes: "Confusing 'established two-way radio communication' (the Class C/D standard) with the stricter 'explicit clearance' requirement for Class B.",
      evaluating: "Precision distinguishing Class B's clearance requirement from Class C/D's communication requirement.",
      acs: 'Area of Operation III, Task A — Airspace (Knowledge).',
      application: 'Misunderstanding this distinction is a real operational risk — entering Class B without an actual clearance, believing radio contact alone was sufficient, is a genuine pilot deviation.' },
    { id: 'asp-3', section: 'airspace', q: 'What is required to operate in Class C airspace?',
      model: 'Two-way radio communication must be established with ATC before entering (not necessarily a clearance), and the aircraft must have an operating Mode C transponder with ADS-B Out where required. Class C typically has a surface area and an outer shelf with different dimensions.',
      mistakes: 'Believing a clearance is required, as in Class B, rather than simply established two-way communication.',
      evaluating: "Correct, precise use of 'established two-way communication' as the specific legal standard.",
      acs: 'Area of Operation III, Task A — Airspace (Knowledge).',
      application: "Know exactly what 'established communication' means in practice — ATC using your call sign back to you, not just you calling in." },
    { id: 'asp-4', section: 'airspace', q: 'What is required to operate in Class D airspace?',
      model: 'Two-way radio communication must be established with the control tower before entering. Class D airspace typically extends from the surface up to 2,500 feet AGL around an airport with an operating control tower.',
      mistakes: 'Assuming Class D always requires a transponder — equipment requirements depend on surrounding airspace, not Class D status alone.',
      evaluating: "Whether you distinguish Class D's communication requirement from any separate equipment requirement that might apply based on nearby airspace.",
      acs: 'Area of Operation III, Task A — Airspace (Knowledge).',
      application: 'Class D airspace reverts to Class E or G when the tower is closed — know how to check tower operating hours during flight planning.' },
    { id: 'asp-5', section: 'airspace', q: 'What are the VFR weather minimums in Class E airspace below 10,000 feet MSL?',
      model: '3 statute miles visibility, and cloud clearance of 500 feet below, 1,000 feet above, and 2,000 feet horizontal from clouds.',
      mistakes: 'Confusing these minimums with the higher minimums required above 10,000 feet MSL (5 miles visibility, 1,000 below/above, 1 mile horizontal).',
      evaluating: 'Whether these specific numbers are truly memorized, not looked up — this is treated as baseline private pilot knowledge.',
      acs: 'Area of Operation III, Task A — Airspace (Knowledge).',
      application: 'These are the minimums you\'ll use on the overwhelming majority of real VFR cross-country flights — they should be completely automatic.' },
    { id: 'asp-6', section: 'airspace', q: 'What defines Class G airspace, and what are its weather minimums?',
      model: 'Class G is uncontrolled airspace, generally from the surface up to the base of the overlying Class E airspace. Weather minimums vary by altitude and day/night: below 1,200 feet AGL during the day, minimums are 1 statute mile visibility and clear of clouds; other Class G minimums scale up with altitude and at night.',
      mistakes: 'Assuming Class G has no weather minimums at all, or applying the same minimums regardless of altitude and time of day.',
      evaluating: "Whether you know Class G's minimums genuinely vary by altitude and day/night, not just a single blanket rule.",
      acs: 'Area of Operation III, Task A — Airspace (Knowledge).',
      application: "Class G's minimal requirements are exactly why 'uncontrolled' doesn't mean 'unregulated' — apply real judgment even where the legal bar is lower." },
    { id: 'asp-7', section: 'airspace', q: 'What is special use airspace, and how do you check its status?',
      model: 'Special use airspace includes restricted areas, prohibited areas, warning areas, military operations areas (MOAs), and alert areas — each with different entry rules. Status (active/inactive) can be checked via a flight briefing, NOTAMs, or overlays in an EFB like ForeFlight or Garmin Pilot.',
      mistakes: 'Treating all special use airspace the same — prohibited areas are never enterable, while MOAs may be legally transited by VFR traffic with caution even when active.',
      evaluating: 'Whether you distinguish between the different categories and their actual entry rules, not just that they all sound restrictive.',
      acs: 'Area of Operation III, Task A — Airspace (Knowledge, Risk Management).',
      application: 'Always check special use airspace status during real flight planning, not just note that it exists on the chart — an inactive MOA changes your routing decision entirely.' },
    { id: 'asp-8', section: 'airspace', q: 'What is a TFR, and how do you check for one before a flight?',
      model: 'A Temporary Flight Restriction is a short-term airspace restriction, often issued for security, disaster response, or VIP movement. Check for active TFRs via TFR.faa.gov, a standard weather briefing, or your EFB\'s NOTAM/TFR overlay, as part of routine flight planning for every flight.',
      mistakes: "Checking for TFRs only when flying near a major city or event, rather than as a standard part of every flight's preflight planning.",
      evaluating: 'Whether TFR checking is built into your habitual flight-planning process, not treated as an occasional special step.',
      acs: 'Area of Operation III, Task A — Airspace (Knowledge, Risk Management).',
      application: 'TFRs can appear with little notice — checking immediately before every flight, not just during initial planning days earlier, is the only reliable habit.' },

    // Section 6 — Weather
    { id: 'wx-1', section: 'weather', q: 'How do you decode a METAR?',
      model: 'A METAR reports, in order: station identifier, date/time, wind, visibility, weather/obstructions, sky condition, temperature/dew point, altimeter setting, and remarks. Practice decoding full strings, in order, without a reference card.',
      mistakes: 'Skipping straight to sky condition and altimeter, ignoring the remarks section, which often contains operationally important information.',
      evaluating: 'Whether you can decode a real METAR live, cold, without hesitation — this is one of the most commonly tested live-decoding skills.',
      acs: 'Area of Operation II, Task A — Weather Information (Knowledge).',
      application: "You'll read a METAR before nearly every real flight you ever take — fluency here isn't optional, it's a daily-use skill." },
    { id: 'wx-2', section: 'weather', q: 'How is a TAF different from a METAR?',
      model: 'A METAR reports current conditions at a specific time; a TAF is a forecast of expected conditions at an airport over a future period (typically 24-30 hours), including expected changes using indicators like BECMG (becoming) and TEMPO (temporary).',
      mistakes: 'Treating a TAF as a guarantee rather than a forecast, or missing the significance of a BECMG/TEMPO change group.',
      evaluating: "Whether you understand a TAF's time-based structure, not just that it's 'the forecast version of a METAR.'",
      acs: 'Area of Operation II, Task A — Weather Information (Knowledge).',
      application: "Use the TAF specifically to evaluate your planned arrival time's forecast conditions — not just the conditions at departure." },
    { id: 'wx-3', section: 'weather', q: 'What is a PIREP, and why is it valuable?',
      model: 'A Pilot Report is a real-time, in-flight observation filed by a pilot, giving actual observed conditions (turbulence, icing, cloud tops, visibility) that forecasts alone cannot capture. PIREPs can be filed via radio to Flight Service or ATC.',
      mistakes: 'Underweighting PIREPs relative to forecast products, when a recent, relevant PIREP is often more valuable than a general area forecast.',
      evaluating: 'Whether you value real, observed data appropriately relative to predictive forecasts.',
      acs: 'Area of Operation II, Task A — Weather Information (Knowledge).',
      application: "File a PIREP yourself when you encounter significant conditions — you're both a consumer and a contributor to this system." },
    { id: 'wx-4', section: 'weather', q: 'What is the difference between an AIRMET and a SIGMET?',
      model: "An AIRMET (Airmen's Meteorological Information) covers weather significant to light aircraft or less experienced pilots — moderate icing, turbulence, or extensive mountain obscuration. A SIGMET covers more severe conditions significant to all aircraft, such as severe turbulence, severe icing, or dust storms; a Convective SIGMET specifically covers thunderstorm-related hazards.",
      mistakes: 'Treating AIRMETs as unimportant compared to SIGMETs — for a light, non-icing-certified trainer, an AIRMET Zulu (icing) can be just as flight-critical as a SIGMET.',
      evaluating: 'Whether you understand the severity distinction and correctly weigh both categories for your specific aircraft.',
      acs: 'Area of Operation II, Task A — Weather Information (Knowledge, Risk Management).',
      application: "As a light aircraft pilot, AIRMETs are often more directly relevant to you day-to-day than SIGMETs — don't skip past them in a briefing." },
    { id: 'wx-5', section: 'weather', q: 'What are the primary hazards associated with thunderstorms?',
      model: 'Severe turbulence, downbursts and microbursts, hail, lightning, heavy precipitation reducing visibility, and rapid, unpredictable wind shifts. Thunderstorms progress through cumulus, mature, and dissipating stages, with the mature stage producing the most severe hazards.',
      mistakes: 'Focusing only on visible lightning/rain and underestimating the invisible hazards — wind shear and turbulence can extend well beyond the visible storm cell.',
      evaluating: "Whether your mental model of thunderstorm risk includes hazards that extend beyond the storm's visible boundary.",
      acs: 'Area of Operation II, Task A — Weather Information (Knowledge, Risk Management).',
      application: 'Give any thunderstorm cell wide berth in real flight planning — the rule of thumb of 20 nautical miles exists because these hazards extend well past what you can see.' },
    { id: 'wx-6', section: 'weather', q: 'What conditions favor structural icing, and what types exist?',
      model: 'Structural icing requires visible moisture and temperatures at or below freezing. Rime ice forms in smaller water droplets/colder conditions and appears rough and opaque; clear ice forms in larger droplets/warmer near-freezing conditions and is smooth, dense, and harder to remove; mixed ice combines both.',
      mistakes: 'Believing icing only occurs well below freezing — icing risk is often highest right around the freezing level, not at very cold temperatures.',
      evaluating: "Whether you understand icing as most dangerous near 0°C, not simply 'the colder, the worse.'",
      acs: 'Area of Operation II, Task A — Weather Information (Knowledge, Risk Management).',
      application: 'Most VFR trainers are not certified for flight into known icing — treat any forecast or observed icing as an automatic no-go, not a risk to manage in flight.' },
    { id: 'wx-7', section: 'weather', q: 'What are the main types of fog, and how do they form?',
      model: 'Radiation fog forms overnight from ground cooling under clear skies and calm wind; advection fog forms when warm, moist air moves over a cooler surface; upslope fog forms as moist air rises and cools along rising terrain. Each has different typical burn-off behavior.',
      mistakes: 'Assuming all fog burns off predictably by mid-morning — advection fog in particular can persist much longer than radiation fog.',
      evaluating: 'Whether you can identify which fog type applies to a given scenario and reason about its likely persistence.',
      acs: 'Area of Operation II, Task A — Weather Information (Knowledge, Risk Management).',
      application: "A morning departure delayed by radiation fog often clears within an hour or two after sunrise; the same delay from advection fog might not clear all day — know the difference before you commit to waiting it out." },
    { id: 'wx-8', section: 'weather', q: 'How do you use a winds and temperatures aloft forecast in flight planning?',
      model: 'The forecast gives expected wind direction/speed and temperature at specific altitudes and reporting stations, used to select cruising altitude, estimate groundspeed and fuel burn, and check for icing-favorable temperatures at planned altitudes.',
      mistakes: "Only using the forecast for headwind/tailwind planning, and overlooking the temperature data's relevance to icing risk at altitude.",
      evaluating: 'Whether you use this single product for multiple planning purposes — performance and hazard awareness together.',
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge).',
      application: 'Choosing a cruising altitude with a favorable tailwind but a freezing temperature and visible moisture is a real, avoidable planning mistake — cross-check both factors together.' },

    // Section 7 — Performance and Weight & Balance
    { id: 'perf-1', section: 'performance', q: 'What is density altitude, and how does it affect performance?',
      model: "Density altitude is pressure altitude corrected for non-standard temperature — it represents the altitude the aircraft 'feels' it's performing at. Higher density altitude (hot, high, humid conditions) reduces engine power, propeller efficiency, and lift, increasing takeoff distance and reducing climb performance.",
      mistakes: 'Confusing density altitude with pressure altitude, or forgetting that humidity also increases density altitude, not just temperature.',
      evaluating: 'Whether you understand density altitude as a performance concept, not just a number to calculate.',
      acs: 'Area of Operation V, Task A — Performance and Limitations (Knowledge).',
      application: 'A hot summer afternoon at a high-elevation airport is exactly when density altitude turns a routine departure into a genuine performance-limited decision.' },
    { id: 'perf-2', section: 'performance', q: 'Why does weight and balance matter beyond simply staying under max gross weight?',
      model: 'Center of gravity (CG) location affects stall speed, stability, and control authority — an aircraft loaded outside its CG envelope may be uncontrollable even if under max gross weight. Both weight and CG location must be within limits.',
      mistakes: 'Checking only total weight against max gross weight and skipping the CG calculation entirely.',
      evaluating: 'Whether you treat weight and balance as two distinct checks, both required, not one combined check.',
      acs: 'Area of Operation V, Task A — Performance and Limitations (Knowledge, Risk Management).',
      application: 'A rear-loaded aircraft (aft CG) can become dangerously unstable in pitch — this is a real, not theoretical, loading risk in small trainers with baggage compartments.' },
    { id: 'perf-3', section: 'performance', q: 'How does CG location affect stall speed and controllability?',
      model: 'A more forward CG generally increases stall speed slightly and improves longitudinal stability; a more aft CG decreases stall speed slightly but reduces stability and can reduce elevator authority, particularly during the flare.',
      mistakes: 'Believing CG location has no meaningful effect on stall speed, treating it as purely a stability issue.',
      evaluating: 'Detailed understanding connecting CG directly to the aerodynamic concepts (stability, stall speed) tested elsewhere in the oral exam.',
      acs: 'Area of Operation V, Task A — Performance and Limitations (Knowledge).',
      application: 'This is a direct, practical bridge between your weight and balance knowledge and your aerodynamics knowledge — DPEs like connecting these two areas in one question.' },
    { id: 'perf-4', section: 'performance', q: 'How do you use a performance chart correctly, including interpolation?',
      model: 'Enter the chart with the actual conditions (pressure altitude, temperature, weight, wind), and if your exact values fall between published data points, interpolate between the two nearest values rather than simply rounding to the nearest chart line.',
      mistakes: 'Always rounding to the nearest (and often more favorable) chart value instead of interpolating, which can understate actual required distance.',
      evaluating: 'Whether you interpolate correctly and conservatively, since misreading a performance chart has real safety consequences.',
      acs: 'Area of Operation V, Task A — Performance and Limitations (Skill, Knowledge).',
      application: "Practice interpolating on your specific aircraft's real performance charts with realistic numbers — this is often demonstrated live during the oral exam, not just discussed." },
    { id: 'perf-5', section: 'performance', q: 'What factors increase takeoff distance?',
      model: 'High density altitude, higher aircraft weight, a tailwind component, an uphill or soft/contaminated runway surface, and reduced flap settings (below the optimal takeoff setting) all increase required takeoff distance.',
      mistakes: 'Naming only density altitude and weight, forgetting runway surface, slope, and wind component factors.',
      evaluating: 'Whether you can name a comprehensive list of factors, not just the two most commonly cited.',
      acs: 'Area of Operation V, Task A — Performance and Limitations (Knowledge, Risk Management).',
      application: 'Combine factors mentally before every real departure — hot day, uphill runway, and a slight tailwind together compound quickly into a genuine performance problem.' },
    { id: 'perf-6', section: 'performance', q: 'What factors increase landing distance?',
      model: 'High density altitude, higher aircraft weight, a tailwind component, a wet, contaminated, or downhill runway, and excess airspeed over the threshold all increase required landing distance.',
      mistakes: 'Forgetting excess approach speed as a factor — landing fast, even briefly, meaningfully extends the landing roll.',
      evaluating: "Whether your factor list matches the takeoff list's logic while correctly noting landing-specific factors like approach speed discipline.",
      acs: 'Area of Operation V, Task A — Performance and Limitations (Knowledge, Risk Management).',
      application: 'Approach speed discipline is one of the most controllable variables on this entire list — flying the correct speed on final directly manages your landing distance risk.' },
    { id: 'perf-7', section: 'performance', q: 'How does wind component affect takeoff and landing performance?',
      model: 'A headwind component reduces ground roll and required distance; a tailwind component significantly increases required distance — tailwind effects are disproportionately larger than headwind benefits for the same wind speed, so even a small tailwind matters.',
      mistakes: 'Treating headwind and tailwind effects as symmetrical, when tailwind penalties are actually more severe for the same speed.',
      evaluating: 'Whether you understand this asymmetry, which is a commonly tested nuance beyond the basic headwind/tailwind concept.',
      acs: 'Area of Operation V, Task A — Performance and Limitations (Knowledge).',
      application: 'Always calculate actual crosswind and headwind/tailwind components before a flight rather than eyeballing the windsock — the numbers matter more than they look.' },
    { id: 'perf-8', section: 'performance', q: 'How does CG shift as fuel burns off during a flight?',
      model: 'As fuel burns, weight decreases, and CG typically shifts based on where the fuel tanks are located relative to the CG — in most training aircraft with wing tanks near the CG, this shift is minor, but it should still be checked for flights near a CG limit.',
      mistakes: 'Assuming CG never meaningfully changes in flight, when a flight loaded near a limit at departure could shift outside limits by the end of a long flight.',
      evaluating: 'Whether you think about weight and balance as a full-flight consideration, not just a departure-moment calculation.',
      acs: 'Area of Operation V, Task A — Performance and Limitations (Knowledge, Risk Management).',
      application: "For any flight loaded close to a CG limit, calculate both a takeoff and a landing weight and balance — don't assume the departure check is sufficient for the whole flight." },

    // Section 8 — Aeromedical Factors
    { id: 'aeromed-1', section: 'aeromedical', q: 'What is hypoxia, and what are its stages and symptoms?',
      model: 'Hypoxia is a deficiency of oxygen reaching body tissues. Symptoms progress from mild impairment (poor judgment, euphoria) to more severe cognitive and physical impairment as altitude or exposure increases, and can occur even below 10,000 feet MSL in susceptible individuals (smokers, fatigue, illness).',
      mistakes: 'Believing hypoxia only becomes a concern at very high altitudes, ignoring individual susceptibility factors.',
      evaluating: 'Whether you understand hypoxia risk as altitude-dependent but also individually variable, not a single fixed threshold.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Knowledge).',
      application: 'Supplemental oxygen use, or simply descending, are your practical tools here — know your own personal risk factors, not just the general altitude guidance.' },
    { id: 'aeromed-2', section: 'aeromedical', q: 'How is hyperventilation different from hypoxia, and how do you tell them apart?',
      model: 'Hyperventilation is excessive breathing rate, often triggered by stress or anxiety, causing symptoms (dizziness, tingling, lightheadedness) that closely mimic hypoxia. The key distinguishing action is deliberately slowing your breathing rate — if symptoms improve, it was hyperventilation; if not, treat it as hypoxia and take corrective action (oxygen, descent).',
      mistakes: 'Assuming any dizziness in flight is automatically anxiety-related without also considering hypoxia as a possibility, especially at altitude.',
      evaluating: 'Whether you have an actual decision process for distinguishing these two conditions in the moment, not just definitions of each.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Knowledge, Risk Management).',
      application: "This is a genuinely useful in-flight decision tool — know the actual test (controlled breathing) you'd perform, not just the textbook definitions." },
    { id: 'aeromed-3', section: 'aeromedical', q: 'What are common spatial disorientation illusions, and how do you prevent them?',
      model: 'Illusions include the leans, the graveyard spiral, and somatogravic illusion, among others — all caused by the inner ear and other senses providing false orientation information, especially in reduced visibility. Prevention relies on trusting flight instruments over physical sensation when visual references are limited.',
      mistakes: 'Believing spatial disorientation only affects instrument-rated pilots in IMC — it can occur in degraded visual conditions (haze, night, featureless terrain) that a VFR-only pilot may encounter.',
      evaluating: 'Whether you understand the practical prevention strategy (trust instruments), not just illusion names.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Knowledge, Risk Management).',
      application: 'This is why VFR-into-IMC is so dangerous even for skilled visual pilots — your body will lie to you convincingly, and only instrument trust reliably counters it.' },
    { id: 'aeromed-4', section: 'aeromedical', q: 'What does the IMSAFE checklist stand for, and how do you use it?',
      model: 'Illness, Medication, Stress, Alcohol, Fatigue, Emotion — a personal fitness-to-fly self-assessment performed before every flight, honestly evaluating each factor.',
      mistakes: 'Treating IMSAFE as a one-time or occasional check rather than a habitual pre-flight self-assessment for every single flight.',
      evaluating: 'Whether this is a genuine, internalized habit for you, not just a memorized acronym.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Knowledge, Risk Management).',
      application: 'Be ready to apply IMSAFE honestly to yourself, out loud, on checkride day — examiners sometimes ask directly, and a thoughtful real answer lands far better than a rushed recitation.' },
    { id: 'aeromed-5', section: 'aeromedical', q: 'What are the FAA\'s regulations regarding alcohol and flying?',
      model: 'You may not act as a crewmember within 8 hours of consuming alcohol, while under the influence of alcohol, or with a blood alcohol concentration of 0.04% or greater; some operators and the FAA also apply a stricter 24-hour guideline as best practice.',
      mistakes: "Citing only the '8 hours' rule and forgetting the BAC limit and 'under the influence' standard, which can apply even beyond 8 hours.",
      evaluating: 'Whether you know all three components of this regulation, not just the most commonly cited one.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Knowledge).',
      application: 'Apply the stricter, safer standard in your own personal minimums — the legal minimum and the genuinely safe minimum are not always the same number.' },
    { id: 'aeromed-6', section: 'aeromedical', q: 'How does fatigue affect pilot performance, and how do you recognize it in yourself?',
      model: "Fatigue degrades reaction time, judgment, attention, and decision-making, often without the pilot feeling overtly 'tired' — chronic fatigue from poor sleep patterns can be just as impairing as acute fatigue from a long, demanding day.",
      mistakes: 'Believing fatigue only matters after an obviously exhausting day, missing the risk of cumulative, chronic fatigue from ordinary life stress or poor sleep habits.',
      evaluating: 'Whether you recognize fatigue as a real IMSAFE factor deserving honest self-assessment, not something you\'d only notice if extreme.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Knowledge, Risk Management).',
      application: 'Track your own sleep before flight lessons and notice the honest correlation with your performance — this builds real self-awareness, not just textbook knowledge.' },
    { id: 'aeromed-7', section: 'aeromedical', q: 'What are the sources and symptoms of carbon monoxide poisoning in a piston aircraft?',
      model: 'CO can enter the cabin through a cracked or faulty exhaust/heater muff system, especially with cabin heat in use. Symptoms include headache, dizziness, confusion, and drowsiness — easily mistaken for fatigue or hypoxia, making it especially dangerous.',
      mistakes: 'Assuming CO poisoning would be obviously noticeable, when its symptoms actually mimic other, less dangerous-sounding conditions.',
      evaluating: 'Whether you know both the mechanical source and the deceptive symptom overlap with other aeromedical conditions.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Knowledge, Risk Management).',
      application: 'A cheap CO detector in the cabin is a genuinely worthwhile investment for any pilot flying an aircraft with a heater muff system, especially in winter.' },
    { id: 'aeromed-8', section: 'aeromedical', q: 'Why is honest self-assessment more important than technical knowledge in this section?',
      model: 'Aeromedical risks are the ones a pilot is uniquely positioned to catch — no checklist, chart, or ATC controller will notice your fatigue or stress level for you. This section of the ACS specifically tests whether you\'ll apply that self-awareness honestly, not just whether you can define the terms.',
      mistakes: 'Answering aeromedical questions purely academically, without connecting them to genuine, personal self-assessment habits.',
      evaluating: 'Maturity and honesty about your own limitations — this is arguably the most personal, judgment-based ACS content on the entire exam.',
      acs: 'Area of Operation VII, Task A — Aeromedical Factors (Risk Management).',
      application: 'The pilots who fly safely for decades are the ones who keep applying IMSAFE honestly at hour 5,000, not just during training — build the habit now.' },

    // Section 9 — Cross-Country Planning
    { id: 'xc-1', section: 'crosscountry', q: 'What are the essential components of a complete cross-country flight plan?',
      model: 'A navigation log (course, heading, groundspeed, ETE, and fuel per leg), a weather briefing, a weight and balance calculation, a performance calculation for departure and destination, and selected cruising altitude(s) based on terrain, airspace, and direction of flight.',
      mistakes: "Treating the nav log alone as 'the flight plan,' when a complete plan integrates weather, performance, and weight and balance together.",
      evaluating: 'Whether you understand cross-country planning as an integration of multiple ACS knowledge areas, not an isolated task.',
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge, Skill).',
      application: 'Bring a complete, real plan for an actual route to your checkride — expect to walk through it in detail as a central part of the oral exam.' },
    { id: 'xc-2', section: 'crosscountry', q: 'What are the VFR fuel reserve requirements for day and night flight?',
      model: 'For day VFR, you must have enough fuel to fly to the first point of intended landing and then, at normal cruising speed, fly for an additional 30 minutes. For night VFR, that reserve increases to 45 minutes.',
      mistakes: 'Applying the day reserve requirement to a flight that will arrive after dark, or forgetting the reserve applies at normal cruising speed, not an economy setting.',
      evaluating: 'Whether you correctly apply day versus night reserve based on actual arrival conditions, not just departure time.',
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge, Risk Management).',
      application: 'Plan reserves generously beyond the legal minimum on real flights — the legal reserve is a floor, not a target.' },
    { id: 'xc-3', section: 'crosscountry', q: 'What is your process for diverting to an alternate airport in flight?',
      model: 'Identify the nearest suitable airport given current position, fuel, and weather; establish a heading and rough distance/time using pilotage or your EFB; communicate your intentions if appropriate; and continuously reassess as conditions develop.',
      mistakes: 'Overcomplicating the process by trying to build a perfect new nav log in flight, rather than using a quick, practical heading-and-distance estimate.',
      evaluating: 'Whether you have a genuinely practical, fast process for a real in-flight decision, not just a textbook answer.',
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Skill, Risk Management).',
      application: "Practice this exact skill — picking a real diversion airport mid-flight and estimating heading/time — with your instructor before your checkride, since it's often demonstrated live." },
    { id: 'xc-4', section: 'crosscountry', q: "What are the 'four C's' of lost procedures?",
      model: "Climb (for a better view and radio/GPS reception), Communicate (contact ATC or Flight Service for help), Confess (state clearly that you're unsure of your position), and Comply (follow the guidance you're given).",
      mistakes: "Being reluctant to actually 'confess' being lost, when clear communication of the situation is what allows ATC to help effectively and quickly.",
      evaluating: "Whether you'd actually use this process in the moment, including the psychologically harder step of clearly stating you're lost.",
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge, Risk Management).',
      application: "There's no professional downside to admitting uncertainty to ATC — controllers deal with this constantly and are there to help, not to judge." },
    { id: 'xc-5', section: 'crosscountry', q: 'What is the difference between pilotage and dead reckoning?',
      model: 'Pilotage is navigation by visually referencing landmarks against a chart; dead reckoning is navigation by calculating heading, groundspeed, and time based on planned course and forecast wind, without relying on visual checkpoints alone.',
      mistakes: 'Treating these as mutually exclusive rather than complementary techniques typically used together on a real cross-country flight.',
      evaluating: 'Whether you understand these as a combined skill set, not an either/or choice.',
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge, Skill).',
      application: 'These are your backup navigation skills if GPS or electronics fail — practice them for real, not just as a theoretical checkride topic.' },
    { id: 'xc-6', section: 'crosscountry', q: 'How do you use a VOR for navigation, and how do you verify its accuracy?',
      model: 'Tune and identify the station via Morse code, center the CDI needle, and read the radial you\'re on or flying to/from using the TO/FROM indicator. VOR accuracy can be verified using a VOT test, a certified ground checkpoint, or a certified airborne checkpoint, generally within a specified tolerance.',
      mistakes: 'Skipping station identification, or being unfamiliar with any of the three accuracy-check methods.',
      evaluating: "Whether you can both operate a VOR practically and explain how its accuracy is verified — a two-part skill many applicants only prepare half of.",
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge, Skill).',
      application: 'Even in a GPS-heavy cockpit, VOR remains a valuable backup — stay genuinely proficient, not just checkride-ready.' },
    { id: 'xc-7', section: 'crosscountry', q: 'How do you select an appropriate cruising altitude for a cross-country flight?',
      model: 'Apply the hemispheric rule (odd thousands + 500 feet for VFR flight on courses roughly 0-179° magnetic, even thousands + 500 feet for 180-359°), while also considering terrain clearance, airspace structure, and winds aloft.',
      mistakes: "Applying the hemispheric rule mechanically without also checking it against terrain and airspace — the 'legal' altitude and the 'safe and practical' altitude must both be satisfied.",
      evaluating: 'Whether you integrate the regulatory rule with real terrain and airspace judgment, not just recite the altitude formula.',
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge, Risk Management).',
      application: 'In mountainous terrain especially, the hemispheric-rule altitude and the genuinely safe altitude can differ significantly — always cross-check both.' },
    { id: 'xc-8', section: 'crosscountry', q: 'How do you file, activate, and close a VFR flight plan, and why does it matter?',
      model: "File via Flight Service (1800wxbrief.com, phone, or many EFBs), activate it once airborne (it doesn't activate automatically), and close it upon landing, either by radio or phone — an unclosed flight plan triggers search-and-rescue procedures.",
      mistakes: 'Forgetting the flight plan must be manually activated after filing, or forgetting to close it after landing, which triggers unnecessary search-and-rescue resources.',
      evaluating: 'Whether you understand this as a full three-step process (file, activate, close), not just the filing step alone.',
      acs: 'Area of Operation IX, Task A — Navigation Systems and Flight Planning (Knowledge, Risk Management).',
      application: "A VFR flight plan isn't required, but it's genuinely good practice — it's the system that gets search-and-rescue looking for you quickly if something goes wrong." },

    // Section 10 — Emergency Operations
    { id: 'emerg-1', section: 'emergency', q: 'What is your procedure for an engine failure immediately after takeoff?',
      model: 'Establish best glide (or the appropriate pitch attitude), land essentially straight ahead within a narrow range of turn, and avoid attempting to turn back to the runway at low altitude unless you have specifically trained for and are confident in that maneuver at sufficient altitude.',
      mistakes: "Defaulting to 'turn back to the runway' as a general answer without acknowledging the significant altitude and airspeed risk this maneuver carries at low altitude — the so-called 'impossible turn.'",
      evaluating: 'Whether your default response prioritizes a safe, controlled landing over an instinctive but risky return to the runway.',
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge, Risk Management, Skill).',
      application: "Discuss your specific aircraft's and airport's numbers with your instructor — the altitude at which a return-to-field turn becomes reasonable is aircraft- and situation-specific, not a universal rule." },
    { id: 'emerg-2', section: 'emergency', q: 'What is your procedure for an engine failure in flight, away from the airport?',
      model: 'Establish best glide speed immediately, select a suitable landing field within gliding distance, run through the appropriate engine restart checklist if time and altitude allow, communicate your situation (squawk 7700, radio call) if able, and prepare the cabin and passengers for landing.',
      mistakes: 'Attempting an engine restart checklist before first establishing best glide and a landing site — the sequence matters, and aviate always comes before troubleshoot.',
      evaluating: 'Whether you can state this procedure in the correct priority order, not just list the individual steps.',
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge, Risk Management, Skill).',
      application: "Memorize your specific aircraft's best glide speed and emergency checklist — this is exactly the kind of information that must be instantly available, not looked up." },
    { id: 'emerg-3', section: 'emergency', q: 'What are the signs of an alternator failure, and what is your response?',
      model: 'A low-voltage or alternator warning light/annunciator, and a battery ammeter showing discharge rather than charge. Response includes reducing electrical load (turning off non-essential equipment), checking circuit breakers, and monitoring battery voltage to preserve remaining electrical endurance for essential equipment.',
      mistakes: 'Confusing an alternator failure with a complete electrical failure — with an alternator failure, the battery still provides limited remaining power, which should be conserved, not immediately abandoned.',
      evaluating: 'Whether you understand this as a manageable, time-limited situation requiring load-shedding, not an immediate full emergency.',
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge, Risk Management).',
      application: 'Know which equipment in your specific aircraft draws the most electrical load, so you can prioritize shedding it first in a real alternator failure.' },
    { id: 'emerg-4', section: 'emergency', q: 'What is the PIC\'s emergency authority under 14 CFR 91.3(b)?',
      model: 'In an in-flight emergency requiring immediate action, the pilot in command may deviate from any rule in Part 91 to the extent required to meet that emergency, and may be required to submit a written report of that deviation if requested by the FAA.',
      mistakes: 'Believing this authority is unlimited or requires no follow-up, when a written report may still be required after the fact.',
      evaluating: 'Whether you understand both the authority and the accountability that follows it.',
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge).',
      application: 'This regulation exists so that, in a genuine emergency, you make the safest decision without hesitating over regulatory compliance — use it if you ever truly need it, and document afterward.' },
    { id: 'emerg-5', section: 'emergency', q: 'What system malfunction indications should you recognize for a vacuum system failure?',
      model: 'A vacuum failure typically shows as a flag or visible failure on the attitude indicator and/or heading indicator (the gyroscopic instruments driven by the vacuum system), while the airspeed indicator, altimeter, and VSI (pitot-static instruments) remain unaffected.',
      mistakes: "Not knowing which specific instruments are vacuum-driven versus electrically or pitot-static driven in your specific aircraft's panel configuration.",
      evaluating: "Whether you know your own aircraft's specific instrument power sources, not just a generic answer.",
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge, Risk Management).',
      application: 'In a vacuum failure, cross-check your remaining reliable instruments (airspeed, altimeter, turn coordinator if electric) rather than trusting a failed attitude indicator.' },
    { id: 'emerg-6', section: 'emergency', q: 'What is the procedure for an emergency descent?',
      model: "Reduce power, establish the appropriate descent configuration and airspeed per your aircraft's emergency procedures (often including a specific bank angle to increase descent rate while managing structural limits), and communicate your intentions if able.",
      mistakes: "Not knowing your specific aircraft's published emergency descent procedure and airspeed, relying instead on a generic 'dive steeply' assumption.",
      evaluating: 'Aircraft-specific procedural knowledge, not just a general concept of descending quickly.',
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge, Skill).',
      application: "Review your specific POH's emergency descent procedure — the correct technique balances speed of descent against structural and control limits." },
    { id: 'emerg-7', section: 'emergency', q: 'What is the procedure for lost communications?',
      model: 'Squawk 7600 to alert ATC of the radio failure, continue navigating per your last clearance or filed plan, and if in controlled airspace requiring communication, use light gun signals if near a tower, or proceed according to standard lost-comm procedures for the type of operation.',
      mistakes: 'Forgetting to squawk 7600, or being unfamiliar with basic light gun signal meanings for arrival at a towered airport.',
      evaluating: 'Whether you have a genuinely usable, memorized procedure for this specific and realistic failure mode.',
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge).',
      application: 'Review light gun signals specifically before your checkride — this is a commonly tested, easy-to-forget detail since most pilots never actually experience it.' },
    { id: 'emerg-8', section: 'emergency', q: 'What are your basic reporting responsibilities after an aircraft accident or incident?',
      model: 'Certain accidents and serious incidents must be reported to the NTSB as soon as practicable, and specific wreckage/records preservation requirements apply following a reportable accident, per NTSB Part 830.',
      mistakes: 'Believing all incidents require NTSB notification, when the reporting threshold is specifically defined and not every abnormal event qualifies.',
      evaluating: "Basic awareness that this reporting framework exists, even if full regulatory detail isn't expected at the private pilot level.",
      acs: 'Area of Operation X, Task A — Emergency Procedures (Knowledge).',
      application: 'Know that this requirement exists before you ever need it — in the unlikely event of a reportable incident, knowing your basic obligations reduces additional stress at an already difficult time.' }
  ];

  DPE_DATA.forEach(function (item) { item.sectionLabel = CATEGORY_META[item.section].label; });

  /* ══════════════════════════════════════════════════════════════
     SCENARIO TRAINING CENTER — sourced from Section 10 (Emergency
     Operations, all 8) plus Section 9's diversion & lost-procedure
     questions (2). Same verbatim fields as the DPE library.
     ══════════════════════════════════════════════════════════════ */
  var SCENARIO_IDS = ['emerg-1', 'emerg-2', 'emerg-3', 'emerg-5', 'emerg-6', 'emerg-7', 'emerg-8', 'emerg-4', 'xc-3', 'xc-4'];
  var SCENARIOS = SCENARIO_IDS.map(function (id) {
    var q = DPE_DATA.filter(function (d) { return d.id === id; })[0];
    return {
      id: 'scenario-' + q.id,
      sourceId: q.id,
      tag: q.sectionLabel,
      title: q.q,
      brief: q.application,
      model: q.model,
      mistakes: q.mistakes,
      evaluating: q.evaluating,
      acs: q.acs
    };
  });

  /* ══════════════════════════════════════════════════════════════
     RENDER — Prep Pack tabs (product + lessons/quickref)
     ══════════════════════════════════════════════════════════════ */
  var prepTabs = document.getElementById('prepTabs');
  prepTabs.querySelectorAll('.portal-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      prepTabs.querySelectorAll('.portal-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      ['private', 'instrument', 'commercial'].forEach(function (key) {
        document.getElementById('prep' + key.charAt(0).toUpperCase() + key.slice(1)).style.display = (key === tab.dataset.prep) ? '' : 'none';
      });
    });
  });
  var prepSubtabs = document.getElementById('prepPrivateSubtabs');
  prepSubtabs.querySelectorAll('.portal-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      prepSubtabs.querySelectorAll('.portal-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById('prepLessons').style.display = (tab.dataset.sub === 'lessons') ? '' : 'none';
      document.getElementById('prepQuickRef').style.display = (tab.dataset.sub === 'quickref') ? '' : 'none';
    });
  });

  /* ══════════════════════════════════════════════════════════════
     RENDER — Lessons (Framework, 9 content sections, Checkride Day)
     ══════════════════════════════════════════════════════════════ */
  function lessonPartHtml(part) {
    var html = '';
    if (part.h) html += '<h4>' + part.h + '</h4>';
    if (part.body) part.body.forEach(function (p) { html += '<p>' + p + '</p>'; });
    if (part.list) html += '<ul>' + part.list.map(function (li) { return '<li>' + li + '</li>'; }).join('') + '</ul>';
    if (part.table) {
      html += '<table class="portal-lesson__table"><thead><tr>' +
        part.table.headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
        part.table.rows.map(function (row) { return '<tr>' + row.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table>';
    }
    if (part.tip) html += '<div class="portal-lesson__tip"><strong>' + part.tip.label + '</strong><p>' + part.tip.body + '</p></div>';
    return html;
  }

  function buildLessonEl(lessonId, num, title, meta, bodyHtml, extraFooterHtml) {
    var el = document.createElement('div');
    el.className = 'portal-card portal-lesson';
    var done = !!lessonComplete[lessonId];
    el.innerHTML =
      '<button class="portal-lesson__head" type="button">' +
        '<div class="portal-lesson__head-left">' +
          '<div class="portal-lesson__num">' + num + '</div>' +
          '<div><div class="portal-lesson__title">' + title + '</div><div class="portal-lesson__meta">' + meta + (lastViewed[lessonId] ? ' · Last viewed ' + timeAgo(lastViewed[lessonId]) : '') + '</div></div>' +
        '</div>' +
        '<div class="portal-lesson__head-left">' +
          '<label class="portal-lesson__complete" onclick="event.stopPropagation()"><input type="checkbox" ' + (done ? 'checked' : '') + ' /> Complete</label>' +
          '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</div>' +
      '</button>' +
      '<div class="portal-lesson__body"><div class="portal-lesson__body-inner">' + bodyHtml + (extraFooterHtml || '') + '</div></div>';

    el.querySelector('.portal-lesson__head').addEventListener('click', function () {
      var wasOpen = el.classList.contains('open');
      el.classList.toggle('open');
      if (!wasOpen) {
        touchLastViewed(lessonId);
        el.querySelector('.portal-lesson__meta').textContent = meta + ' · Last viewed just now';
      }
    });
    el.querySelector('.portal-lesson__complete input').addEventListener('change', function (e) {
      lessonComplete[lessonId] = e.target.checked;
      upsertRow('portal_lesson_progress', 'lesson_id', lessonId, { completed: e.target.checked });
      bumpStudyDay(0);
      checkAchievements();
      renderProgress();
      renderDashboardStats();
      renderReadiness();
    });
    return el;
  }

  function renderLessons() {
    var container = document.getElementById('prepLessons');
    container.innerHTML = '';

    // Lesson 1: Framework
    var frameworkBody = FRAMEWORK_LESSON.parts.map(lessonPartHtml).join('');
    container.appendChild(buildLessonEl(FRAMEWORK_LESSON.id, 1, FRAMEWORK_LESSON.title, FRAMEWORK_LESSON.meta, frameworkBody));

    // Lessons 2-10: the 9 content sections, each intro + link to filtered DPE library
    var order = ['eligibility', 'airworthiness', 'privileges', 'airspace', 'weather', 'performance', 'aeromedical', 'crosscountry', 'emergency'];
    order.forEach(function (cat, i) {
      var meta = CATEGORY_META[cat];
      var count = DPE_DATA.filter(function (d) { return d.section === cat; }).length;
      var studiedCount = DPE_DATA.filter(function (d) { return d.section === cat && studied[d.id]; }).length;
      var body = '<p>' + meta.intro + '</p>' +
        '<div class="portal-lesson__study-link"><button class="btn btn--primary" data-study-cat="' + cat + '">Study these ' + count + ' questions (' + studiedCount + '/' + count + ' studied)</button></div>';
      var lessonId = 'lesson-' + cat;
      container.appendChild(buildLessonEl(lessonId, i + 2, meta.section + ': ' + meta.label, meta.section + ' · ' + count + ' questions', body));
    });

    // Lesson 11: Checkride Day Prep
    var dayBody = CHECKRIDE_DAY_LESSON.parts.map(lessonPartHtml).join('');
    container.appendChild(buildLessonEl(CHECKRIDE_DAY_LESSON.id, 11, CHECKRIDE_DAY_LESSON.title, CHECKRIDE_DAY_LESSON.meta, dayBody));

    container.querySelectorAll('[data-study-cat]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        showSection('dpe-library');
        setDpeCategory(btn.dataset.studyCat);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     RENDER — Quick Reference Appendix
     ══════════════════════════════════════════════════════════════ */
  function renderQuickRef() {
    var container = document.getElementById('prepQuickRef');
    container.innerHTML = '';
    var searchWrap = document.createElement('div');
    searchWrap.className = 'portal-search';
    searchWrap.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="text" id="qrefSearch" placeholder="Search ARROW, IMSAFE, PAVE, and 4 more…" />';
    container.appendChild(searchWrap);

    var cardsWrap = document.createElement('div');
    cardsWrap.id = 'qrefCards';
    container.appendChild(cardsWrap);

    QUICK_REF.forEach(function (card) {
      var el = document.createElement('div');
      el.className = 'portal-card portal-qref-card';
      el.dataset.qrefId = card.id;
      var rowsHtml = card.rows.map(function (r) {
        return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + (r[2] || '') + '</td></tr>';
      }).join('');
      el.innerHTML =
        '<div class="portal-qref-card__title">' + card.title + '</div>' +
        '<div class="portal-qref-card__subtitle">' + card.subtitle + '</div>' +
        '<table class="portal-qref-table"><tbody>' + rowsHtml + '</tbody></table>';
      cardsWrap.appendChild(el);
    });

    document.getElementById('qrefSearch').addEventListener('input', function (e) {
      var term = e.target.value.trim().toLowerCase();
      cardsWrap.querySelectorAll('.portal-qref-card').forEach(function (card, i) {
        var ref = QUICK_REF[i];
        var haystack = (ref.title + ' ' + ref.subtitle + ' ' + ref.rows.map(function (r) { return r.join(' '); }).join(' ')).toLowerCase();
        card.hidden = term.length > 0 && haystack.indexOf(term) === -1;
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     RENDER — DPE Questions Library (72 real questions)
     ══════════════════════════════════════════════════════════════ */
  var dpeLibraryEl = document.getElementById('dpeLibrary');
  var dpeSearch = document.getElementById('dpeSearch');
  var dpeTabs = document.getElementById('dpeTabs');
  var dpeEmpty = document.getElementById('dpeEmpty');
  var dpeActiveCat = 'all';

  function setDpeCategory(cat) {
    dpeActiveCat = cat;
    dpeTabs.querySelectorAll('.portal-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.cat === cat); });
    renderDpeLibrary();
  }

  function fieldBlock(label, text) {
    if (!text) return '';
    return '<div class="portal-qitem__field"><div class="portal-qitem__field-label">' + label + '</div><p>' + text + '</p></div>';
  }

  /* ══════════════════════════════════════════════════════════════
     ASK ANDREW — question discussions (under every DPE question)
     ══════════════════════════════════════════════════════════════ */
  function renderAskAndrewFaq(container, questionId) {
    var entries = askAndrewData[questionId] || [];
    if (!entries.length) { container.innerHTML = ''; return; }
    container.innerHTML = entries.map(function (e) {
      var mine = e.profile_id === member.id;
      if (e.status === 'answered') {
        return '<div class="portal-ask-andrew__faq-item"><div class="q">' + (mine ? 'You asked: ' : 'A student asked: ') + e.message + '</div><div class="a">Andrew: ' + e.answer + '</div></div>';
      }
      if (mine) {
        return '<div class="portal-ask-andrew__faq-item"><div class="q">You asked: ' + e.message + '</div><div class="a">Waiting on Andrew\'s reply…</div></div>';
      }
      return '';
    }).join('');
  }

  function wireAskAndrew(qitem, questionId) {
    var toggle = qitem.querySelector('[data-ask-toggle]');
    var form = qitem.querySelector('[data-ask-form]');
    var input = qitem.querySelector('[data-ask-input]');
    var submitBtn = qitem.querySelector('[data-ask-submit]');
    var faqEl = qitem.querySelector('[data-ask-faq]');

    renderAskAndrewFaq(faqEl, questionId);

    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      form.classList.toggle('open');
    });
    submitBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var message = input.value.trim();
      if (!message || !member) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      apexSupabase.from('portal_question_discussions').insert({
        profile_id: member.id, question_id: questionId, message: message, status: 'open'
      }).then(function (res) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send to Andrew';
        if (res.error) { toast('Could not send: ' + res.error.message); return; }
        if (!askAndrewData[questionId]) askAndrewData[questionId] = [];
        askAndrewData[questionId].push({ profile_id: member.id, question_id: questionId, message: message, status: 'open' });
        input.value = '';
        form.classList.remove('open');
        renderAskAndrewFaq(faqEl, questionId);
        toast('Sent to Andrew — you\'ll see the answer here once he replies.');
      });
    });
  }

  function renderDpeLibrary() {
    var term = dpeSearch.value.trim().toLowerCase();
    var byCat = {};
    var totalShown = 0;

    DPE_DATA.forEach(function (item) {
      if (dpeActiveCat === 'favorites' && !favorites[item.id]) return;
      if (dpeActiveCat !== 'all' && dpeActiveCat !== 'favorites' && item.section !== dpeActiveCat) return;
      var haystack = (item.q + ' ' + item.model + ' ' + item.mistakes + ' ' + item.evaluating + ' ' + item.acs + ' ' + item.application).toLowerCase();
      if (term && haystack.indexOf(term) === -1) return;
      if (!byCat[item.section]) byCat[item.section] = [];
      byCat[item.section].push(item);
      totalShown++;
    });

    dpeLibraryEl.innerHTML = '';
    Object.keys(CATEGORY_META).forEach(function (cat) {
      if (!byCat[cat]) return;
      var meta = CATEGORY_META[cat];
      var group = document.createElement('div');
      group.className = 'portal-qgroup';
      var title = document.createElement('div');
      title.className = 'portal-qgroup__title';
      title.innerHTML = meta.label + ' <span class="count">' + byCat[cat].length + '</span>';
      group.appendChild(title);

      var list = document.createElement('div');
      list.className = 'portal-qlist';
      byCat[cat].forEach(function (item) {
        var qitem = document.createElement('div');
        qitem.className = 'portal-qitem';
        var isFav = !!favorites[item.id];
        var isStudied = !!studied[item.id];
        qitem.innerHTML =
          '<button class="portal-qitem__q" type="button">' +
            '<span class="portal-qitem__head">' +
              '<button class="portal-star-btn' + (isFav ? ' active' : '') + '" type="button" data-star="' + item.id + '" title="Star for review">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
              '</button>' +
              '<span>' + item.q + '</span>' +
            '</span>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="portal-qitem__a"><div class="portal-qitem__a-inner">' +
            fieldBlock('Model Answer', item.model) +
            fieldBlock('Common Student Mistakes', item.mistakes) +
            fieldBlock('What the DPE Is Evaluating', item.evaluating) +
            fieldBlock('Real-World Application', item.application) +
            '<div class="portal-qitem__field"><div class="portal-qitem__field-label">ACS Connection</div><span class="portal-qitem__acs">' + item.acs + '</span></div>' +
            '<div class="portal-ask-andrew">' +
              '<button class="portal-ask-andrew__toggle" type="button" data-ask-toggle>Ask Andrew about this question</button>' +
              '<div class="portal-ask-andrew__form" data-ask-form>' +
                '<textarea rows="2" placeholder="What\'s still unclear about this one?" data-ask-input></textarea>' +
                '<button class="btn btn--ghost" type="button" data-ask-submit>Send to Andrew</button>' +
              '</div>' +
              '<div class="portal-ask-andrew__faq" data-ask-faq></div>' +
            '</div>' +
          '</div></div>' +
          '<div class="portal-qitem__meta">' +
            '<div class="portal-qitem__meta-left">' +
              '<label class="portal-studied-label"><input type="checkbox" data-studied="' + item.id + '" ' + (isStudied ? 'checked' : '') + ' /> Mark as studied</label>' +
            '</div>' +
            '<span class="portal-qitem__lastviewed">' + (lastViewed[item.id] ? 'Viewed ' + timeAgo(lastViewed[item.id]) : '') + '</span>' +
          '</div>';

        qitem.querySelector('.portal-qitem__q').addEventListener('click', function (e) {
          if (e.target.closest('[data-star]') || e.target.closest('.portal-ask-andrew')) return;
          var wasOpen = qitem.classList.contains('open');
          qitem.classList.toggle('open');
          if (!wasOpen) {
            touchLastViewed(item.id);
            qitem.querySelector('.portal-qitem__lastviewed').textContent = 'Viewed just now';
          }
        });
        qitem.querySelector('[data-star]').addEventListener('click', function (e) {
          e.stopPropagation();
          toggleFavorite(item.id);
          renderDpeLibrary();
        });
        wireAskAndrew(qitem, item.id);
        qitem.querySelector('[data-studied]').addEventListener('change', function () {
          toggleStudied(item.id);
          renderProgress();
          renderDashboardStats();
        });
        list.appendChild(qitem);
      });
      group.appendChild(list);
      dpeLibraryEl.appendChild(group);
    });

    dpeEmpty.style.display = totalShown === 0 ? 'block' : 'none';
  }

  dpeSearch.addEventListener('input', renderDpeLibrary);
  dpeTabs.querySelectorAll('.portal-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setDpeCategory(tab.dataset.cat); });
  });

  /* ══════════════════════════════════════════════════════════════
     RENDER — Scenario Training Center (real emergency/XC content)
     ══════════════════════════════════════════════════════════════ */
  var scenarioGrid = document.getElementById('scenarioGrid');
  function renderScenarios() {
    scenarioGrid.innerHTML = '';
    SCENARIOS.forEach(function (s) {
      var isFav = !!favorites[s.id];
      var isStudied = !!studied[s.id];
      var card = document.createElement('div');
      card.className = 'portal-card portal-scenario-card';
      card.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
          '<span class="portal-scenario-card__tag">' + s.tag + '</span>' +
          '<button class="portal-star-btn' + (isFav ? ' active' : '') + '" type="button" data-star="' + s.id + '" title="Star for review">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<h3>' + s.title + '</h3>' +
        '<p>' + s.brief + '</p>' +
        '<button class="portal-scenario-card__toggle" type="button">Reveal model answer ' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<div class="portal-scenario-detail">' +
          '<h4>Model Answer</h4><p>' + s.model + '</p>' +
          '<h4>Common Student Mistakes</h4><p>' + s.mistakes + '</p>' +
          '<h4>What the DPE Is Evaluating</h4><p>' + s.evaluating + '</p>' +
          '<h4>ACS Connection</h4><p>' + s.acs + '</p>' +
        '</div>' +
        '<label class="portal-studied-label"><input type="checkbox" data-studied="' + s.id + '" ' + (isStudied ? 'checked' : '') + ' /> Mark as reviewed</label>';
      card.querySelector('.portal-scenario-card__toggle').addEventListener('click', function (e) {
        var expanded = card.classList.toggle('expanded');
        e.currentTarget.firstChild.textContent = expanded ? 'Hide model answer ' : 'Reveal model answer ';
        if (expanded) touchLastViewed(s.id);
      });
      card.querySelector('[data-star]').addEventListener('click', function () {
        toggleFavorite(s.id);
        renderScenarios();
      });
      card.querySelector('[data-studied]').addEventListener('change', function () {
        toggleStudied(s.id);
        renderProgress();
        renderDashboardStats();
      });
      scenarioGrid.appendChild(card);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     PROGRESS TRACKING
     ══════════════════════════════════════════════════════════════ */
  var LESSON_LIST = [FRAMEWORK_LESSON.id]
    .concat(['eligibility', 'airworthiness', 'privileges', 'airspace', 'weather', 'performance', 'aeromedical', 'crosscountry', 'emergency'].map(function (c) { return 'lesson-' + c; }))
    .concat([CHECKRIDE_DAY_LESSON.id]);

  var progressTracksEl = document.getElementById('progressTracks');

  function renderProgress() {
    progressTracksEl.innerHTML = '';

    var lessonsDone = LESSON_LIST.filter(function (id) { return lessonComplete[id]; }).length;
    var lessonPct = Math.round((lessonsDone / LESSON_LIST.length) * 100);
    var lessonLabels = { };
    lessonLabels[FRAMEWORK_LESSON.id] = FRAMEWORK_LESSON.title;
    lessonLabels[CHECKRIDE_DAY_LESSON.id] = CHECKRIDE_DAY_LESSON.title;
    Object.keys(CATEGORY_META).forEach(function (cat) { lessonLabels['lesson-' + cat] = CATEGORY_META[cat].section + ': ' + CATEGORY_META[cat].label; });

    var lessonCard = document.createElement('div');
    lessonCard.className = 'portal-card portal-track';
    lessonCard.innerHTML =
      '<div class="portal-track__head"><h3>Private Pilot Checkride Prep — Lessons</h3><span class="portal-track__pct">' + lessonPct + '% complete</span></div>' +
      '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + lessonPct + '%"></div></div>' +
      '<div class="portal-checklist">' + LESSON_LIST.map(function (id) {
        var checked = !!lessonComplete[id];
        return '<label class="portal-checkitem"><input type="checkbox" data-lesson="' + id + '" ' + (checked ? 'checked' : '') + ' /><span>' + lessonLabels[id] + '</span></label>';
      }).join('') + '</div>';
    lessonCard.querySelectorAll('[data-lesson]').forEach(function (cb) {
      cb.addEventListener('change', function (e) {
        var lessonId = e.target.dataset.lesson;
        lessonComplete[lessonId] = e.target.checked;
        upsertRow('portal_lesson_progress', 'lesson_id', lessonId, { completed: e.target.checked });
        bumpStudyDay(0);
        checkAchievements();
        renderProgress();
        renderDashboardStats();
        renderReadiness();
      });
    });
    progressTracksEl.appendChild(lessonCard);

    var qStudied = DPE_DATA.filter(function (d) { return studied[d.id]; }).length;
    var qPct = Math.round((qStudied / DPE_DATA.length) * 100);
    var qCard = document.createElement('div');
    qCard.className = 'portal-card portal-track';
    qCard.innerHTML =
      '<div class="portal-track__head"><h3>DPE Question Bank</h3><span class="portal-track__pct">' + qStudied + ' / ' + DPE_DATA.length + ' studied</span></div>' +
      '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + qPct + '%"></div></div>';
    progressTracksEl.appendChild(qCard);

    var sReviewed = SCENARIOS.filter(function (s) { return studied[s.id]; }).length;
    var sPct = Math.round((sReviewed / SCENARIOS.length) * 100);
    var sCard = document.createElement('div');
    sCard.className = 'portal-card portal-track';
    sCard.innerHTML =
      '<div class="portal-track__head"><h3>Scenario Training Center</h3><span class="portal-track__pct">' + sReviewed + ' / ' + SCENARIOS.length + ' reviewed</span></div>' +
      '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + sPct + '%"></div></div>';
    progressTracksEl.appendChild(sCard);

    var futureCard = document.createElement('div');
    futureCard.className = 'portal-card';
    futureCard.innerHTML = '<h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">Instrument Rating &amp; Commercial Pilot</h3><p style="color:rgba(255,255,255,0.5);font-size:13.5px;line-height:1.6">Progress tracking for these tracks will appear here once their Checkride Prep Packs launch.</p>';
    progressTracksEl.appendChild(futureCard);
  }

  /* ══════════════════════════════════════════════════════════════
     DASHBOARD STATS + CONTINUE WHERE YOU LEFT OFF
     ══════════════════════════════════════════════════════════════ */
  function renderDashboardStats() {
    var qStudied = DPE_DATA.filter(function (d) { return studied[d.id]; }).length;
    var overallItems = DPE_DATA.length + SCENARIOS.length + LESSON_LIST.length;
    var overallDone = qStudied + SCENARIOS.filter(function (s) { return studied[s.id]; }).length + LESSON_LIST.filter(function (id) { return lessonComplete[id]; }).length;
    document.getElementById('statOverallPct').textContent = Math.round((overallDone / overallItems) * 100) + '%';
  }

  /* ══════════════════════════════════════════════════════════════
     STUDY STREAKS
     ══════════════════════════════════════════════════════════════ */
  function computeStreaks() {
    var dates = Object.keys(studyDays).sort();
    var daysStudied = dates.length;
    if (!daysStudied) return { current: 0, longest: 0, daysStudied: 0 };

    var dateSet = {};
    dates.forEach(function (d) { dateSet[d] = true; });

    var longest = 1, run = 1;
    for (var i = 1; i < dates.length; i++) {
      var prev = new Date(dates[i - 1] + 'T00:00:00');
      var cur = new Date(dates[i] + 'T00:00:00');
      var diffDays = Math.round((cur - prev) / 86400000);
      run = (diffDays === 1) ? run + 1 : 1;
      if (run > longest) longest = run;
    }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    var current = 0;
    var cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!dateSet[getTodayStr()]) cursor.setDate(cursor.getDate() - 1);
    while (true) {
      var cStr = cursor.getFullYear() + '-' + pad(cursor.getMonth() + 1) + '-' + pad(cursor.getDate());
      if (dateSet[cStr]) { current++; cursor.setDate(cursor.getDate() - 1); } else break;
    }

    return { current: current, longest: longest, daysStudied: daysStudied };
  }

  function renderStreak() {
    var s = computeStreaks();
    document.getElementById('streakCurrent').textContent = s.current;
    document.getElementById('streakLongest').textContent = s.longest;
    document.getElementById('streakDaysStudied').textContent = s.daysStudied;
    document.getElementById('streakFlame').classList.toggle('active', s.current > 0);
  }

  /* ══════════════════════════════════════════════════════════════
     APEX CHECKRIDE READINESS SCORE
     ══════════════════════════════════════════════════════════════ */
  function categoryPct(cat) {
    var items = DPE_DATA.filter(function (d) { return d.section === cat; });
    if (!items.length) return 0;
    var done = items.filter(function (d) { return studied[d.id]; }).length;
    return done / items.length;
  }

  function computeReadiness() {
    var qPct = DPE_DATA.filter(function (d) { return studied[d.id]; }).length / DPE_DATA.length;
    var sPct = SCENARIOS.filter(function (s) { return studied[s.id]; }).length / SCENARIOS.length;
    var cats = Object.keys(CATEGORY_META);
    var acsCoverage = cats.reduce(function (sum, c) { return sum + categoryPct(c); }, 0) / cats.length;
    var streaks = computeStreaks();
    var consistency = Math.min(streaks.current / 14, 1);
    var totalSeconds = Object.keys(studyDays).reduce(function (sum, d) { return sum + (studyDays[d] || 0); }, 0);
    var timePct = Math.min(totalSeconds / (5 * 3600), 1);
    var score = Math.round(100 * (0.30 * qPct + 0.20 * sPct + 0.25 * acsCoverage + 0.15 * consistency + 0.10 * timePct));
    return Math.max(0, Math.min(100, score));
  }

  function renderReadiness() {
    var score = computeReadiness();
    document.getElementById('readinessPct').textContent = score;
    var circumference = 352;
    document.getElementById('readinessRing').style.strokeDashoffset = circumference - (circumference * score / 100);
    var label = score >= 90 ? 'Checkride ready' : score >= 70 ? 'Almost there' : score >= 40 ? 'Building momentum' : 'Just getting started';
    document.getElementById('readinessLabel').textContent = label;
    if (member) {
      checkLifecycleMilestones();
      renderTestimonialPrompt();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     WEAK AREA DETECTION + ACS COVERAGE MAP
     ══════════════════════════════════════════════════════════════ */
  function goToCategory(cat) {
    showSection('dpe-library');
    setDpeCategory(cat);
  }

  function renderWeakAreas() {
    var el = document.getElementById('weakAreasList');
    var cats = Object.keys(CATEGORY_META).map(function (cat) {
      return { cat: cat, label: CATEGORY_META[cat].label, pct: Math.round(categoryPct(cat) * 100) };
    }).filter(function (c) { return c.pct < 100; }).sort(function (a, b) { return a.pct - b.pct; }).slice(0, 3);

    if (!cats.length) {
      el.innerHTML = '<p style="color:rgba(255,255,255,0.5);font-size:13px">All ACS areas complete. Outstanding work.</p>';
      return;
    }
    el.innerHTML = cats.map(function (c) {
      return '<div class="portal-weakarea-item" data-cat="' + c.cat + '"><span class="name">' + c.label + '</span><span class="pct">' + c.pct + '%</span></div>';
    }).join('');
    el.querySelectorAll('[data-cat]').forEach(function (row) {
      row.addEventListener('click', function () { goToCategory(row.dataset.cat); });
    });
  }

  function renderAcsCoverage() {
    var el = document.getElementById('acsCoverageList');
    el.innerHTML = Object.keys(CATEGORY_META).map(function (cat) {
      var pct = Math.round(categoryPct(cat) * 100);
      return '<div class="portal-acs-row" data-cat="' + cat + '">' +
        '<div class="portal-acs-row__head"><span class="name">' + CATEGORY_META[cat].label + '</span><span class="pct">' + pct + '%</span></div>' +
        '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-cat]').forEach(function (row) {
      row.addEventListener('click', function () { goToCategory(row.dataset.cat); });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     QUESTION OF THE DAY
     ══════════════════════════════════════════════════════════════ */
  function dayOfYear() {
    var now = new Date();
    var start = new Date(now.getFullYear(), 0, 0);
    return Math.floor((now - start) / 86400000);
  }
  var qotdQuestion = DPE_DATA[dayOfYear() % DPE_DATA.length];

  function updateQotdButtons() {
    var studiedBtn = document.getElementById('qotdStudiedBtn');
    var favBtn = document.getElementById('qotdFavBtn');
    studiedBtn.textContent = studied[qotdQuestion.id] ? '✓ Studied' : 'Mark as Studied';
    studiedBtn.classList.toggle('active', !!studied[qotdQuestion.id]);
    favBtn.textContent = favorites[qotdQuestion.id] ? '★ Starred' : '☆ Star for review';
    favBtn.classList.toggle('active', !!favorites[qotdQuestion.id]);
  }

  function renderQotd() {
    document.getElementById('qotdCategory').textContent = qotdQuestion.sectionLabel;
    document.getElementById('qotdQuestion').textContent = qotdQuestion.q;
    document.getElementById('qotdModel').textContent = qotdQuestion.model;
    document.getElementById('qotdEvaluating').textContent = qotdQuestion.evaluating;
    document.getElementById('qotdApplication').textContent = qotdQuestion.application;

    var alreadyRevealed = !!answeredCounts[qotdQuestion.id];
    document.getElementById('qotdPrompt').style.display = alreadyRevealed ? 'none' : '';
    document.getElementById('qotdAnswer').style.display = alreadyRevealed ? 'block' : 'none';
    updateQotdButtons();
  }

  document.getElementById('qotdRevealBtn').addEventListener('click', function () {
    document.getElementById('qotdPrompt').style.display = 'none';
    document.getElementById('qotdAnswer').style.display = 'block';
    touchLastViewed(qotdQuestion.id);
    answeredCounts[qotdQuestion.id] = (answeredCounts[qotdQuestion.id] || 0) + 1;
    upsertRow('portal_question_progress', 'question_id', qotdQuestion.id, { answered_count: answeredCounts[qotdQuestion.id] });
  });
  document.getElementById('qotdStudiedBtn').addEventListener('click', function () {
    toggleStudied(qotdQuestion.id);
    updateQotdButtons();
    renderProgress(); renderDashboardStats(); renderReadiness(); renderAcsCoverage(); renderWeakAreas(); renderDpeLibrary();
  });
  document.getElementById('qotdFavBtn').addEventListener('click', function () {
    toggleFavorite(qotdQuestion.id);
    updateQotdButtons();
    renderDpeLibrary();
  });

  /* ══════════════════════════════════════════════════════════════
     CHECKRIDE MODE + DPE RAPID FIRE
     ══════════════════════════════════════════════════════════════ */
  var practiceState = null;

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function formatTimer(ms) {
    var totalSec = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(totalSec / 60), s = totalSec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function startPractice(mode) {
    var queue = shuffle(DPE_DATA);
    practiceState = {
      mode: mode,
      queue: mode === 'checkride' ? queue.slice(0, 20) : queue,
      index: 0,
      score: 0,
      answered: 0,
      seenIds: [],
      endTime: mode === 'rapidfire' ? Date.now() + 5 * 60 * 1000 : null,
      timerInterval: null
    };
    document.getElementById('practiceOverlay').hidden = false;
    renderPractice();
    if (mode === 'rapidfire') {
      practiceState.timerInterval = setInterval(function () {
        var remaining = practiceState.endTime - Date.now();
        var timerEl = document.getElementById('practiceTimer');
        if (timerEl) timerEl.textContent = formatTimer(remaining);
        if (remaining <= 0) { clearInterval(practiceState.timerInterval); endPractice(); }
      }, 1000);
    }
  }

  function currentPracticeQuestion() {
    if (practiceState.mode === 'rapidfire' && practiceState.index >= practiceState.queue.length) {
      practiceState.queue = practiceState.queue.concat(shuffle(DPE_DATA));
    }
    return practiceState.queue[practiceState.index];
  }

  function renderPractice() {
    var overlay = document.getElementById('practiceOverlay');
    var q = currentPracticeQuestion();
    var isCheckride = practiceState.mode === 'checkride';
    var totalLabel = isCheckride ? (practiceState.index + 1) + ' / 20' : practiceState.answered + ' answered';
    overlay.innerHTML =
      '<div class="portal-practice-panel">' +
        '<button class="portal-practice-panel__close" id="practiceCloseBtn" type="button">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<div class="portal-practice-meta">' +
          '<span>' + (isCheckride ? 'Checkride Mode' : 'DPE Rapid Fire') + ' · ' + totalLabel + '</span>' +
          (practiceState.mode === 'rapidfire'
            ? '<span class="portal-practice-meta__timer" id="practiceTimer">' + formatTimer(practiceState.endTime - Date.now()) + '</span>'
            : '<span>Score: ' + practiceState.score + '</span>') +
        '</div>' +
        '<div class="portal-practice-question">' + q.q + '</div>' +
        '<div class="portal-practice-answer" id="practiceAnswerBox"><p>' + q.model + '</p></div>' +
        '<div class="portal-practice-actions" id="practiceActions">' +
          '<button class="btn btn--primary" id="practiceRevealBtn">Reveal Answer</button>' +
        '</div>' +
      '</div>';

    document.getElementById('practiceCloseBtn').addEventListener('click', closePractice);
    document.getElementById('practiceRevealBtn').addEventListener('click', revealPracticeAnswer);
    practiceState.seenIds.push(q.id);
  }

  function revealPracticeAnswer() {
    document.getElementById('practiceAnswerBox').classList.add('show');
    document.getElementById('practiceActions').innerHTML =
      '<button class="btn btn--correct" id="practiceCorrectBtn">✓ I got it</button>' +
      '<button class="btn btn--missed" id="practiceMissedBtn">✗ Missed it</button>';
    document.getElementById('practiceCorrectBtn').addEventListener('click', function () { advancePractice(true); });
    document.getElementById('practiceMissedBtn').addEventListener('click', function () { advancePractice(false); });
  }

  function advancePractice(correct) {
    practiceState.answered++;
    if (correct) practiceState.score++;
    practiceState.index++;
    if (practiceState.mode === 'checkride' && practiceState.index >= practiceState.queue.length) { endPractice(); return; }
    renderPractice();
  }

  function endPractice() {
    if (practiceState.timerInterval) clearInterval(practiceState.timerInterval);
    var overlay = document.getElementById('practiceOverlay');
    var mode = practiceState.mode, score = practiceState.score, total = practiceState.answered;

    if (member) {
      apexSupabase.from('portal_practice_attempts').insert({
        profile_id: member.id, mode: mode, question_ids: practiceState.seenIds,
        score: score, total: total, completed_at: new Date().toISOString()
      }).then(function () {
        if (mode === 'checkride') { checkrideModeDone = true; checkAchievements(); }
      });
    }
    bumpStudyDay(0);

    overlay.innerHTML =
      '<div class="portal-practice-panel"><div class="portal-practice-summary">' +
        '<div class="portal-practice-summary__score">' + score + ' / ' + total + '</div>' +
        '<p>' + (mode === 'checkride' ? 'Checkride Mode complete.' : 'Rapid Fire session complete.') + ' Nice work.</p>' +
        '<div class="portal-practice-summary__actions">' +
          '<button class="btn btn--primary" id="practiceAgainBtn">Play Again</button>' +
          '<button class="btn btn--ghost" id="practiceExitBtn">Close</button>' +
        '</div>' +
      '</div></div>';
    document.getElementById('practiceAgainBtn').addEventListener('click', function () { startPractice(mode); });
    document.getElementById('practiceExitBtn').addEventListener('click', closePractice);
  }

  function closePractice() {
    if (practiceState && practiceState.timerInterval) clearInterval(practiceState.timerInterval);
    document.getElementById('practiceOverlay').hidden = true;
    practiceState = null;
  }

  document.getElementById('launchCheckrideMode').addEventListener('click', function () { startPractice('checkride'); });
  document.getElementById('launchRapidFire').addEventListener('click', function () { startPractice('rapidfire'); });

  /* ══════════════════════════════════════════════════════════════
     ACHIEVEMENTS
     ══════════════════════════════════════════════════════════════ */
  var ACHIEVEMENT_DEFS = [
    { key: 'first_question', icon: '🥇', label: 'First Question Completed', test: function () { return DPE_DATA.some(function (d) { return studied[d.id]; }); } },
    { key: 'fifty_questions', icon: '5️⃣0️⃣', label: '50 Questions Completed', test: function () { return DPE_DATA.filter(function (d) { return studied[d.id]; }).length >= 50; } },
    { key: 'hundred_questions', icon: '💯', label: '100 Questions Completed', test: function () { return DPE_DATA.filter(function (d) { return studied[d.id]; }).length >= 100; } },
    { key: 'seven_day_streak', icon: '🔥', label: '7 Day Streak', test: function () { return computeStreaks().longest >= 7; } },
    { key: 'all_weather_complete', icon: '⛈️', label: 'All Weather Questions Complete', test: function () { return DPE_DATA.filter(function (d) { return d.section === 'weather'; }).every(function (d) { return studied[d.id]; }); } },
    { key: 'checkride_mode_completed', icon: '🎯', label: 'Checkride Mode Completed', test: function () { return checkrideModeDone; } }
  ];

  function renderAchievements() {
    var el = document.getElementById('achievementsGrid');
    el.innerHTML = ACHIEVEMENT_DEFS.map(function (def) {
      var earned = !!earnedAchievements[def.key];
      return '<div class="portal-achievement' + (earned ? ' earned' : '') + '"><div class="portal-achievement__icon">' + def.icon + '</div><div class="portal-achievement__label">' + def.label + '</div></div>';
    }).join('');
  }

  function checkAchievements() {
    var newlyEarned = [];
    ACHIEVEMENT_DEFS.forEach(function (def) {
      if (earnedAchievements[def.key] || !def.test()) return;
      earnedAchievements[def.key] = true;
      newlyEarned.push(def);
      if (member) apexSupabase.from('portal_achievements').upsert({ profile_id: member.id, achievement_key: def.key }, { onConflict: 'profile_id,achievement_key' });
    });
    if (newlyEarned.length) {
      renderAchievements();
      toast('🏅 Achievement unlocked: ' + newlyEarned[0].label);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     ADMIN ANALYTICS (role = admin only)
     ══════════════════════════════════════════════════════════════ */
  function metricCard(label, value) {
    return '<div class="portal-card portal-stat"><div class="portal-stat__value">' + value + '</div><div class="portal-stat__label">' + label + '</div></div>';
  }
  function adminTable(rows, keyField, valField) {
    if (!rows.length) return '<p style="color:rgba(255,255,255,0.4);font-size:13px">No data yet.</p>';
    return '<table class="portal-admin-table"><tbody>' + rows.map(function (r) {
      return '<tr><td>' + r[keyField] + '</td><td>' + r[valField] + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function loadAdminDashboard() {
    var el = document.getElementById('adminDashboard');
    Promise.all([
      apexSupabase.from('profiles').select('id', { count: 'exact', head: true }),
      apexSupabase.from('invoices').select('amount_cents,status'),
      apexSupabase.from('portal_question_progress').select('question_id,completed,favorited'),
      apexSupabase.from('portal_scenario_progress').select('scenario_id,viewed_count'),
      apexSupabase.from('portal_study_activity').select('profile_id,activity_date,seconds'),
      apexSupabase.from('portal_question_discussions').select('*').eq('status', 'open').order('created_at', { ascending: false }),
      apexSupabase.from('portal_testimonials').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
      apexSupabase.from('portal_referrals').select('*').order('created_at', { ascending: false }).limit(20),
      apexSupabase.from('profiles').select('id,full_name,email')
    ]).then(function (results) {
      var totalUsers = results[0].count || 0;
      var invoices = results[1].data || [];
      var paidInvoices = invoices.filter(function (i) { return i.status === 'paid'; });
      var totalRevenueCents = paidInvoices.reduce(function (sum, i) { return sum + (i.amount_cents || 0); }, 0);

      var qRows = results[2].data || [];
      var questionsCompleted = qRows.filter(function (r) { return r.completed; }).length;
      var favByQuestion = {};
      qRows.forEach(function (r) { if (r.favorited) favByQuestion[r.question_id] = (favByQuestion[r.question_id] || 0) + 1; });
      var mostDifficult = Object.keys(favByQuestion).map(function (id) {
        var q = DPE_DATA.filter(function (d) { return d.id === id; })[0];
        return { q: q ? q.q : id, count: favByQuestion[id] };
      }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

      var sRows = results[3].data || [];
      var viewsByScenario = {};
      sRows.forEach(function (r) { viewsByScenario[r.scenario_id] = (viewsByScenario[r.scenario_id] || 0) + (r.viewed_count || 0); });
      var mostViewedScenarios = Object.keys(viewsByScenario).map(function (id) {
        var s = SCENARIOS.filter(function (x) { return x.id === id; })[0];
        return { title: s ? s.title : id, views: viewsByScenario[id] };
      }).sort(function (a, b) { return b.views - a.views; }).slice(0, 5);

      var actRows = results[4].data || [];
      var totalSeconds = actRows.reduce(function (sum, r) { return sum + (r.seconds || 0); }, 0);
      var activeUsers30d = {};
      var cutoff = Date.now() - 30 * 24 * 3600 * 1000;
      actRows.forEach(function (r) { if (new Date(r.activity_date).getTime() >= cutoff) activeUsers30d[r.profile_id] = true; });

      var openDiscussions = results[5].data || [];
      var pendingTestimonials = results[6].data || [];
      var recentReferrals = results[7].data || [];
      var profileMap = {};
      (results[8].data || []).forEach(function (p) { profileMap[p.id] = p; });

      el.innerHTML =
        '<div class="portal-admin-metrics">' +
          metricCard('Total Users', totalUsers) +
          metricCard('Paid Invoices', paidInvoices.length + ' ($' + (totalRevenueCents / 100).toLocaleString() + ')') +
          metricCard('Questions Completed', questionsCompleted) +
          metricCard('Active Students (30d)', Object.keys(activeUsers30d).length) +
        '</div>' +
        '<div class="portal-grid portal-grid--2">' +
          '<div class="portal-card"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Most Difficult Questions (most starred)</h3>' + adminTable(mostDifficult, 'q', 'count') + '</div>' +
          '<div class="portal-card"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Most Viewed Scenarios</h3>' + adminTable(mostViewedScenarios, 'title', 'views') + '</div>' +
        '</div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">Total Study Time (all students)</h3><p style="color:var(--gold);font-size:24px;font-weight:800">' + Math.round(totalSeconds / 3600) + ' hours</p></div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">Ask Andrew — Open Questions (' + openDiscussions.length + ')</h3><p style="color:rgba(255,255,255,0.4);font-size:12.5px;margin-bottom:14px">These are exactly the topics your students want content on — FAQs, reels, ground school material.</p><div id="adminAskInbox"></div></div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Testimonials Awaiting Approval (' + pendingTestimonials.length + ')</h3><div id="adminTestimonialInbox"></div></div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Recent Referrals</h3><div id="adminReferralList"></div></div>';

      renderAdminAskInbox(openDiscussions, profileMap);
      renderAdminTestimonialInbox(pendingTestimonials, profileMap);
      renderAdminReferralList(recentReferrals, profileMap);
    }).catch(function (e) {
      el.innerHTML = '<p style="color:#ff8b8b;font-size:14px">Could not load admin data: ' + e.message + '</p>';
    });
  }

  function renderAdminAskInbox(rows, profileMap) {
    var el = document.getElementById('adminAskInbox');
    if (!rows.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px">No open questions right now.</p>'; return; }
    el.innerHTML = rows.map(function (r) {
      var q = DPE_DATA.filter(function (d) { return d.id === r.question_id; })[0];
      var studentName = (profileMap[r.profile_id] && profileMap[r.profile_id].full_name) || 'A student';
      return '<div class="portal-admin-inbox-item" data-discussion="' + r.id + '">' +
        '<div class="meta">' + studentName + ' · on: "' + (q ? q.q : r.question_id) + '"</div>' +
        '<div class="msg">' + r.message + '</div>' +
        '<textarea rows="2" placeholder="Type your answer…" data-answer-input></textarea>' +
        '<button class="btn btn--primary" data-answer-submit>Send Answer</button>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-discussion]').forEach(function (item) {
      item.querySelector('[data-answer-submit]').addEventListener('click', function () {
        var id = item.dataset.discussion;
        var answer = item.querySelector('[data-answer-input]').value.trim();
        if (!answer) return;
        apexSupabase.from('portal_question_discussions').update({
          status: 'answered', answer: answer, answered_at: new Date().toISOString()
        }).eq('id', id).then(function (res) {
          if (res.error) { toast('Could not save answer: ' + res.error.message); return; }
          item.remove();
          toast('Answer sent.');
        });
      });
    });
  }

  function renderAdminTestimonialInbox(rows, profileMap) {
    var el = document.getElementById('adminTestimonialInbox');
    if (!rows.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px">Nothing pending.</p>'; return; }
    el.innerHTML = rows.map(function (r) {
      return '<div class="portal-admin-inbox-item" data-testimonial="' + r.id + '">' +
        '<div class="meta">' + (r.display_name || 'Student') + ' · readiness ' + (r.readiness_score_at_submission || '—') + '%</div>' +
        '<div class="msg">"' + r.content + '"</div>' +
        '<button class="btn btn--correct" data-approve>Approve</button> ' +
        '<button class="btn btn--missed" data-reject>Reject</button>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-testimonial]').forEach(function (item) {
      var id = item.dataset.testimonial;
      item.querySelector('[data-approve]').addEventListener('click', function () {
        apexSupabase.from('portal_testimonials').update({ status: 'approved' }).eq('id', id).then(function () { item.remove(); toast('Approved.'); });
      });
      item.querySelector('[data-reject]').addEventListener('click', function () {
        apexSupabase.from('portal_testimonials').update({ status: 'rejected' }).eq('id', id).then(function () { item.remove(); toast('Rejected.'); });
      });
    });
  }

  function renderAdminReferralList(rows, profileMap) {
    var el = document.getElementById('adminReferralList');
    if (!rows.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px">No referrals yet.</p>'; return; }
    el.innerHTML = rows.map(function (r) {
      var referrerName = (profileMap[r.referrer_id] && profileMap[r.referrer_id].full_name) || 'A student';
      return '<div class="portal-referral-row"><span class="email">' + referrerName + ' → ' + r.referred_email + '</span><span class="status">' + r.status + '</span></div>';
    }).join('');
  }

  function renderAdminIfApplicable() {
    if (!member || member.role !== 'admin') return;
    document.getElementById('adminNavItem').hidden = false;
    loadAdminDashboard();
  }

  /* ══════════════════════════════════════════════════════════════
     EMAIL ENGINE — reuses the apexadvantage `send-email` Edge
     Function (Resend). Milestone/recommendation emails fire directly
     from the client since they're tied to real-time user actions;
     7-day inactivity is handled by a separate scheduled Edge Function
     (supabase/functions/portal-inactivity-nudge in the apexadvantage repo)
     since there's no client open to trigger it from.
     ══════════════════════════════════════════════════════════════ */
  function emailTemplate(contentHtml) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="margin:0;padding:32px 16px;background:#06080f;font-family:\'Helvetica Neue\',Arial,sans-serif;color:#e0e0e0;">' +
      '<div style="max-width:560px;margin:0 auto;">' +
      '<div style="margin-bottom:28px;"><span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#fff;">APEX</span>' +
      '<span style="font-size:22px;font-style:italic;color:#F4B400;font-family:Georgia,serif;"> Advantage</span></div>' +
      contentHtml +
      '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:32px 0 16px;">' +
      '<p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;">Apex Aviation · San Marcos, TX (KHYI)</p>' +
      '</div></body></html>';
  }

  function sendPortalEmail(to, subject, contentHtml) {
    if (!to) return Promise.resolve();
    return apexSupabase.functions.invoke('send-email', {
      body: { to: to, subject: subject, html: emailTemplate(contentHtml) }
    }).catch(function (e) { console.warn('Email send failed', e); });
  }

  function logEventOnce(type, metadata) {
    if (!member || loggedEventTypes[type]) return;
    loggedEventTypes[type] = true;
    apexSupabase.from('portal_events').insert({ profile_id: member.id, event_type: type, metadata: metadata || {} });
  }

  function daysSinceEmail(emailType) {
    if (!emailedTypes[emailType]) return Infinity;
    return (Date.now() - emailedTypes[emailType]) / (24 * 3600 * 1000);
  }

  function sendThrottledEmail(emailType, to, subject, contentHtml, minDays) {
    if (!member || daysSinceEmail(emailType) < minDays) return;
    emailedTypes[emailType] = Date.now();
    sendPortalEmail(to, subject, contentHtml);
    apexSupabase.from('portal_email_log').insert({ profile_id: member.id, email_type: emailType });
  }

  /* ── Lifecycle milestone emails ───────────────────────────────── */
  function checkLifecycleMilestones() {
    if (!member) return;

    logEventOnce('first_login');

    if (DPE_DATA.some(function (d) { return studied[d.id]; })) {
      var wasNew = !loggedEventTypes['first_question_completed'];
      logEventOnce('first_question_completed');
      if (wasNew) {
        sendPortalEmail(member.email, 'You completed your first question 🎉', emailTemplate1FirstQuestion());
      }
    }

    var score = computeReadiness();
    [25, 50, 75, 90].forEach(function (threshold) {
      var key = 'readiness_' + threshold;
      if (score >= threshold && !loggedEventTypes[key]) {
        logEventOnce(key);
        sendPortalEmail(member.email, score + '% Checkride Ready', emailTemplateMilestone(threshold));
      }
    });

    if (checkrideModeDone && !loggedEventTypes['checkride_mode_completed_email']) {
      logEventOnce('checkride_mode_completed_email');
      sendPortalEmail(member.email, 'Checkride Mode: complete', emailTemplateCheckrideModeDone());
    }
  }

  function emailTemplate1FirstQuestion() {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">First question, done.</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">That\'s one down, 71 to go — and every one after this gets a little more familiar. Keep the momentum going.</p>' +
      '<a href="https://apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Keep Studying →</a>';
  }
  function emailTemplateMilestone(threshold) {
    var copy = {
      25: 'You\'re a quarter of the way to checkride-ready. The hardest part — starting — is behind you.',
      50: 'Halfway there. Your ACS coverage is filling in and it shows.',
      75: 'Three-quarters of the way to checkride-ready. Time to start tightening up your weakest areas.',
      90: 'You are checkride-ready in every way that matters. Book a mock oral and go show a DPE what you know.'
    }[threshold];
    return '<h2 style="color:#F4B400;margin:0 0 4px;">' + threshold + '% Checkride Ready</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">' + copy + '</p>' +
      '<a href="https://apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">View Your Dashboard →</a>';
  }
  function emailTemplateCheckrideModeDone() {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">Checkride Mode: complete</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">You just simulated a real oral exam — 20 questions, no labels, no hints. That\'s exactly the kind of pressure practice that makes checkride day feel routine.</p>';
  }

  /* ── Weak-area recommendation emails ──────────────────────────── */
  var WEAK_AREA_CONTENT = {
    eligibility: { subject: "Don't Let Paperwork Delay Your Checkride", body: 'Missing endorsements and expired medicals are the single most avoidable reason checkrides get delayed. A quick review of Eligibility &amp; Documents now saves you a bad surprise later.' },
    airworthiness: { subject: 'The ARROW Documents DPEs Always Check First', body: 'Examiners routinely ask you to physically produce ARROW documents in the aircraft — not just recite the acronym. A few minutes reviewing Airworthiness pays off fast.' },
    privileges: { subject: 'The Pro Rata Rule Most Students Get Wrong', body: 'Precision matters in Privileges &amp; Limitations — examiners probe the edges of what a private pilot can and can\'t do. Worth another pass.' },
    airspace: { subject: 'Class Bravo Scenarios That Fail Applicants', body: 'Confusing Class B\'s clearance requirement with Class C/D\'s communication requirement is one of the most common real deviations — and a common oral exam trap.' },
    weather: { subject: '5 Weather Questions Students Miss Most', body: 'METAR decoding, AIRMET vs. SIGMET, and icing conditions come up in almost every oral exam. A quick weather review goes a long way.' },
    performance: { subject: 'Why DPEs Always Ask About Aft CG', body: 'Weight and balance questions test more than arithmetic — examiners want to see you connect CG location to stall speed and control authority.' },
    aeromedical: { subject: 'The IMSAFE Check Most Pilots Skip', body: 'Aeromedical Factors is the most personal, judgment-based section of the exam. Worth revisiting before checkride day.' },
    crosscountry: { subject: "The Four C's That Save a Lost Pilot", body: 'Cross-Country Planning ties together everything else in the guide — and it\'s often where the oral exam\'s scenario-based structure becomes most obvious.' },
    emergency: { subject: "The 'Impossible Turn' Question Every DPE Asks", body: 'Emergency Operations questions test whether calm, procedural thinking is already automatic for you. A quick review before checkride day is always worth it.' }
  };

  function checkWeakAreaEmail() {
    if (!member) return;
    var weakest = Object.keys(CATEGORY_META).map(function (cat) {
      return { cat: cat, pct: categoryPct(cat) };
    }).sort(function (a, b) { return a.pct - b.pct; })[0];
    if (!weakest || weakest.pct >= 1) return;
    var content = WEAK_AREA_CONTENT[weakest.cat];
    if (!content) return;
    var html = '<h2 style="color:#F4B400;margin:0 0 4px;">' + content.subject + '</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">' + content.body + '</p>' +
      '<a href="https://apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review ' + CATEGORY_META[weakest.cat].label + ' →</a>';
    sendThrottledEmail('weak_area_' + weakest.cat, member.email, content.subject, html, 14);
  }

  /* ══════════════════════════════════════════════════════════════
     CHECKRIDE DATE + COUNTDOWN
     ══════════════════════════════════════════════════════════════ */
  function renderCheckrideCountdown() {
    var setEl = document.getElementById('checkrideCountdownSet');
    var unsetEl = document.getElementById('checkrideCountdownUnset');
    var card = document.getElementById('checkrideCountdownCard');
    if (!checkrideDate) {
      setEl.style.display = 'none';
      unsetEl.style.display = 'block';
      card.className = 'portal-card portal-countdown';
      return;
    }
    unsetEl.style.display = 'none';
    setEl.style.display = 'block';
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var target = new Date(checkrideDate + 'T00:00:00');
    var days = Math.round((target - today) / 86400000);
    var valueEl = document.getElementById('checkrideCountdownValue');
    card.className = 'portal-card portal-countdown';
    if (days < 0) { valueEl.textContent = 'Checkride day has passed'; }
    else if (days === 0) { valueEl.textContent = 'Checkride is today!'; card.className += ' portal-countdown--urgent'; }
    else {
      valueEl.textContent = days + ' Day' + (days === 1 ? '' : 's') + ' Until Checkride';
      if (days <= 7) card.className += ' portal-countdown--urgent';
      else if (days <= 30) card.className += ' portal-countdown--soon';
    }
  }

  document.getElementById('checkrideDateSaveBtn').addEventListener('click', function () {
    var val = document.getElementById('checkrideDateInput').value;
    if (!val || !member) return;
    apexSupabase.from('portal_checkride_date').upsert({ profile_id: member.id, checkride_date: val, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' }).then(function (res) {
      if (res.error) { toast('Could not save date: ' + res.error.message); return; }
      checkrideDate = val;
      renderCheckrideCountdown();
      toast('Checkride date saved.');
    });
  });
  document.getElementById('checkrideDateEditBtn').addEventListener('click', function () {
    document.getElementById('checkrideCountdownSet').style.display = 'none';
    document.getElementById('checkrideCountdownUnset').style.display = 'block';
    if (checkrideDate) document.getElementById('checkrideDateInput').value = checkrideDate;
  });

  /* ══════════════════════════════════════════════════════════════
     MOCK ORAL BOOKING
     ══════════════════════════════════════════════════════════════ */
  // Set this once a Calendly (or other scheduling) link exists.
  var MOCK_ORAL_BOOKING_URL = '';

  document.getElementById('bookMockOralBtn').addEventListener('click', function () {
    if (member) {
      apexSupabase.from('portal_mock_oral_bookings').insert({ profile_id: member.id });
      logEventOnce('mock_oral_requested_' + Date.now(), {}); // always log the request itself (not deduped)
    }
    if (MOCK_ORAL_BOOKING_URL) {
      window.open(MOCK_ORAL_BOOKING_URL, '_blank', 'noopener');
    } else {
      window.location.href = 'contact.html';
    }
  });

  /* ══════════════════════════════════════════════════════════════
     REFERRAL PROGRAM
     ══════════════════════════════════════════════════════════════ */
  function makeReferralCode() {
    var base = (member.name || 'PILOT').split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'PILOT';
    return base + Math.floor(1000 + Math.random() * 9000);
  }

  function renderReferralProgram() {
    var codeEl = document.getElementById('referralCode');
    var link = referralCode ? ('https://apexaviationtx.com/contact.html?ref=' + referralCode) : '—';
    codeEl.textContent = link;

    var listEl = document.getElementById('referralList');
    if (!referrals.length) { listEl.innerHTML = ''; }
    else {
      listEl.innerHTML = referrals.map(function (r) {
        return '<div class="portal-referral-row"><span class="email">' + r.referred_email + '</span><span class="status">' + r.status + '</span></div>';
      }).join('');
    }
  }

  document.getElementById('referralCopyBtn').addEventListener('click', function () {
    if (!referralCode) { toast('Generating your referral link — try again in a moment.'); return; }
    var link = 'https://apexaviationtx.com/contact.html?ref=' + referralCode;
    navigator.clipboard.writeText(link).then(function () { toast('Referral link copied.'); }).catch(function () { toast(link); });
  });

  document.getElementById('referralForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = document.getElementById('referralEmail').value.trim();
    if (!email || !member) return;
    apexSupabase.from('portal_referrals').insert({ referrer_id: member.id, referred_email: email }).then(function (res) {
      if (res.error) { toast('Could not save referral: ' + res.error.message); return; }
      referrals.unshift({ referred_email: email, status: 'pending' });
      renderReferralProgram();
      document.getElementById('referralEmail').value = '';
      toast('Thanks! We\'ll follow up with your friend.');
    });
  });

  function ensureReferralCode() {
    if (referralCode || !member) { renderReferralProgram(); return; }
    var code = makeReferralCode();
    apexSupabase.from('portal_referral_codes').upsert({ profile_id: member.id, code: code }, { onConflict: 'profile_id' }).then(function (res) {
      referralCode = (res.data && res.data[0] && res.data[0].code) || code;
      renderReferralProgram();
    });
  }

  /* ══════════════════════════════════════════════════════════════
     TESTIMONIAL COLLECTION (prompted once readiness > 80%)
     ══════════════════════════════════════════════════════════════ */
  var testimonialDismissedThisSession = false;

  function renderTestimonialPrompt() {
    var card = document.getElementById('testimonialPromptCard');
    var score = computeReadiness();
    var shouldShow = score > 80 && !testimonialSubmitted && !testimonialDismissedThisSession;
    card.style.display = shouldShow ? 'block' : 'none';
  }

  document.getElementById('testimonialSubmitBtn').addEventListener('click', function () {
    var content = document.getElementById('testimonialText').value.trim();
    if (!content || !member) return;
    apexSupabase.from('portal_testimonials').insert({
      profile_id: member.id,
      display_name: firstName(member.name) + ' ' + (member.name.trim().split(/\s+/).slice(-1)[0] || '').charAt(0) + '.',
      content: content,
      readiness_score_at_submission: computeReadiness()
    }).then(function (res) {
      if (res.error) { toast('Could not submit: ' + res.error.message); return; }
      testimonialSubmitted = true;
      renderTestimonialPrompt();
      toast('Thank you! We may feature this on the Success Wall.');
    });
  });
  document.getElementById('testimonialDismissBtn').addEventListener('click', function () {
    testimonialDismissedThisSession = true;
    renderTestimonialPrompt();
  });

  /* ══════════════════════════════════════════════════════════════
     SUCCESS TRACKING — "I Passed My Checkride"
     ══════════════════════════════════════════════════════════════ */
  function renderPassedBanner() {
    var banner = document.getElementById('passedBanner');
    if (checkrideResult) banner.style.display = 'none';
    else banner.style.display = 'flex';
  }

  document.getElementById('openPassedFormBtn').addEventListener('click', function () {
    var overlay = document.getElementById('passedOverlay');
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="portal-practice-panel">' +
        '<button class="portal-practice-panel__close" id="passedCloseBtn" type="button">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<h3 style="color:#fff;font-size:19px;font-weight:700;margin-bottom:18px">🎉 You passed your checkride!</h3>' +
        '<div class="form-group" style="margin-bottom:14px"><label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Exam date</label>' +
          '<input type="date" id="passedDate" style="width:100%;padding:11px 14px;border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none" /></div>' +
        '<div class="form-group" style="margin-bottom:14px"><label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Examiner</label>' +
          '<input type="text" id="passedExaminer" style="width:100%;padding:11px 14px;border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none" /></div>' +
        '<div class="form-group" style="margin-bottom:20px"><label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Aircraft</label>' +
          '<input type="text" id="passedAircraft" placeholder="e.g. Cessna 172" style="width:100%;padding:11px 14px;border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none" /></div>' +
        '<button class="btn btn--primary btn--full" id="passedSubmitBtn">Save &amp; Celebrate</button>' +
      '</div>';
    document.getElementById('passedCloseBtn').addEventListener('click', function () { overlay.hidden = true; });
    document.getElementById('passedSubmitBtn').addEventListener('click', function () {
      var examDate = document.getElementById('passedDate').value || getTodayStr();
      var examiner = document.getElementById('passedExaminer').value.trim();
      var aircraft = document.getElementById('passedAircraft').value.trim();
      apexSupabase.from('portal_checkride_results').upsert({
        profile_id: member.id,
        display_name: firstName(member.name) + ' ' + (member.name.trim().split(/\s+/).slice(-1)[0] || '').charAt(0) + '.',
        passed: true, exam_date: examDate, examiner_name: examiner, aircraft: aircraft
      }, { onConflict: 'profile_id' }).then(function (res) {
        if (res.error) { toast('Could not save: ' + res.error.message); return; }
        checkrideResult = { exam_date: examDate, examiner_name: examiner, aircraft: aircraft, passed: true };
        renderPassedBanner();
        renderSuccessWall();
        logEventOnce('checkride_passed');
        sendPortalEmail(member.email, 'Congratulations on passing your checkride! 🎉', emailTemplatePassed());
        showCelebration();
      });
    });
  });

  function emailTemplatePassed() {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">You did it. Congratulations!</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">Every question, every scenario, every study streak led here. Welcome to the ranks of certificated pilots — fly safe out there.</p>';
  }

  function showCelebration() {
    var overlay = document.getElementById('passedOverlay');
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="portal-practice-panel"><div class="portal-celebration">' +
        '<div class="portal-celebration__emoji">🎉🛩️🎓</div>' +
        '<h2>You passed your checkride!</h2>' +
        '<p>Congratulations from everyone at Apex Aviation. You\'ll now show up on the Success Wall for other students to see.</p>' +
        '<button class="btn btn--primary" id="celebrationCloseBtn">Close</button>' +
      '</div></div>';
    document.getElementById('celebrationCloseBtn').addEventListener('click', function () { overlay.hidden = true; });
  }

  /* ══════════════════════════════════════════════════════════════
     SUCCESS WALL
     ══════════════════════════════════════════════════════════════ */
  function renderSuccessWall() {
    var wallGrid = document.getElementById('successWallGrid');
    var testimonialGrid = document.getElementById('testimonialWallGrid');
    Promise.all([
      apexSupabase.from('portal_checkride_results').select('*').eq('passed', true).order('exam_date', { ascending: false }).limit(12),
      apexSupabase.from('portal_testimonials').select('*').eq('status', 'approved').order('created_at', { ascending: false }).limit(9)
    ]).then(function (results) {
      var passes = results[0].data || [];
      var testimonials = results[1].data || [];

      wallGrid.innerHTML = passes.length ? passes.map(function (p) {
        return '<div class="portal-card portal-success-card">' +
          '<div class="portal-success-card__badge">🎓</div>' +
          '<h3>' + (p.display_name || 'Apex Student') + '</h3>' +
          '<p>' + (p.aircraft ? p.aircraft + ' · ' : '') + new Date(p.exam_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '</p>' +
        '</div>';
      }).join('') : '<p style="color:rgba(255,255,255,0.4);font-size:14px">No results yet — be the first on the wall.</p>';

      testimonialGrid.innerHTML = testimonials.length ? testimonials.map(function (t) {
        return '<div class="portal-card portal-testimonial-card">' +
          '<p class="quote">"' + t.content + '"</p>' +
          '<p class="name">' + (t.display_name || 'Apex Student') + '</p>' +
        '</div>';
      }).join('') : '<p style="color:rgba(255,255,255,0.4);font-size:14px">No testimonials yet.</p>';
    }).catch(function (e) {
      wallGrid.innerHTML = '<p style="color:#ff8b8b;font-size:14px">Could not load: ' + e.message + '</p>';
    });
  }

  /* ══════════════════════════════════════════════════════════════
     DASHBOARD STATS
     ══════════════════════════════════════════════════════════════ */
  function renderDashboardStats() {
    var qStudied = DPE_DATA.filter(function (d) { return studied[d.id]; }).length;
    var overallItems = DPE_DATA.length + SCENARIOS.length + LESSON_LIST.length;
    var overallDone = qStudied + SCENARIOS.filter(function (s) { return studied[s.id]; }).length + LESSON_LIST.filter(function (id) { return lessonComplete[id]; }).length;
    document.getElementById('statOverallPct').textContent = Math.round((overallDone / overallItems) * 100) + '%';
  }

  /* ── Init — waits for the real Supabase session + profile ────── */
  function initPortalData() {
    return loadProgress().then(function () {
      renderLessons();
      renderQuickRef();
      renderDpeLibrary();
      renderScenarios();
      renderProgress();
      renderDashboardStats();
      renderReadiness();
      renderStreak();
      renderWeakAreas();
      renderAcsCoverage();
      renderQotd();
      renderAchievements();
      checkAchievements();
      renderAdminIfApplicable();
      renderCheckrideCountdown();
      ensureReferralCode();
      renderPassedBanner();
      renderSuccessWall();
      checkWeakAreaEmail();
    });
  }
})();
