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
      applyUnlockPricing();
      // Fire-and-forget: feeds the 7-day inactivity nudge
      // (send-lifecycle-emails, Phase 3) a real "last seen" signal.
      // Once per page load is enough — this isn't a click-tracking beacon.
      apexSupabase.from('profiles').update({ portal_last_active_at: new Date().toISOString() }).eq('id', member.id);
      return loadPremiumContent().then(function () {
        return initPortalData();
      });
    });
  }).catch(function (e) { if (e !== 'no-session') console.error(e); });

  /* ── Premium content — fetched server-side, never bundled here ──
     DPE_DATA/CATEGORY_META/QUICK_REF/FRAMEWORK_LESSON/CHECKRIDE_DAY_LESSON
     start empty above. get-premium-content only returns real content if
     the caller's own account has checkride_prep_unlocked = true (403
     otherwise) — this is the actual server-side enforcement; the nav
     gating in showSection() is a UI convenience on top of it, not the
     security boundary. */
  function loadPremiumContent() {
    if (!member.checkridePrepUnlocked) return Promise.resolve();

    return apexSupabase.functions.invoke('get-premium-content', {
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) {
      if (res.error || !res.data) {
        extractInvokeError(res).then(function (msg) { console.error('loadPremiumContent failed:', msg); });
        return;
      }
      var data = res.data;

      (data.categories || []).forEach(function (c) {
        CATEGORY_META[c.id] = { label: c.label, section: c.section_label, intro: c.intro };
      });

      DPE_DATA.length = 0;
      (data.questions || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; }).forEach(function (q) {
        DPE_DATA.push({
          id: q.id, section: q.category, q: q.question, model: q.model_answer,
          mistakes: q.common_mistakes, evaluating: q.dpe_evaluating, acs: q.acs_reference,
          application: q.real_world_application
        });
      });
      DPE_DATA.forEach(function (item) { item.sectionLabel = CATEGORY_META[item.section].label; });

      SCENARIO_IDS.length = 0;
      (data.questions || [])
        .filter(function (q) { return q.is_scenario; })
        .sort(function (a, b) { return a.scenario_order - b.scenario_order; })
        .forEach(function (q) { SCENARIO_IDS.push(q.id); });
      SCENARIOS.length = 0;
      SCENARIO_IDS.forEach(function (id) {
        var q = DPE_DATA.filter(function (d) { return d.id === id; })[0];
        if (!q) return;
        SCENARIOS.push({ id: 'scenario-' + q.id, sourceId: q.id, tag: q.sectionLabel, title: q.q, brief: q.application, model: q.model, mistakes: q.mistakes, evaluating: q.evaluating, acs: q.acs });
      });

      QUICK_REF.length = 0;
      (data.quickReference || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; }).forEach(function (s) {
        QUICK_REF.push({ id: s.id, title: s.title, subtitle: s.subtitle, rows: s.rows });
      });

      (data.lessons || []).forEach(function (l) {
        var target = l.id === FRAMEWORK_LESSON.id ? FRAMEWORK_LESSON : (l.id === CHECKRIDE_DAY_LESSON.id ? CHECKRIDE_DAY_LESSON : null);
        if (!target) return;
        target.title = l.title;
        target.meta = l.meta;
        target.parts = l.parts;
      });

      computeQotdQuestion();
    }).catch(function (err) { console.error('loadPremiumContent error', err); });
  }

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
  var ADMIN_PREVIEW_SECTIONS = ['guided-notes', 'learning-path'];
  var ADMIN_ONLY_SECTIONS = ['admin', 'admin-ground-schedule'];
  var STAFF_ONLY_SECTIONS = ['operations'];

  function showSection(id) {
    if (!document.getElementById('section-' + id)) id = 'dashboard';
    if (member && !member.checkridePrepUnlocked && GATED_SECTIONS.indexOf(id) !== -1) {
      closeSidebar();
      openUnlockModal();
      return;
    }
    // Admin preview sections are not just hidden from the nav. A non-admin
    // who already has member.role loaded (e.g. clicked a stale link, or
    // called this from the console) gets bounced to the dashboard instead
    // of ever seeing the section become active. The other half of this
    // guard is enforceAdminPreviewAccess(), which catches the same case on
    // first page load, before member.role is known yet.
    if ((ADMIN_PREVIEW_SECTIONS.indexOf(id) !== -1 || ADMIN_ONLY_SECTIONS.indexOf(id) !== -1) && member && member.role !== 'admin') id = 'dashboard';
    if (STAFF_ONLY_SECTIONS.indexOf(id) !== -1 && member && ['admin', 'instructor'].indexOf(member.role) === -1) id = 'dashboard';
    sections.forEach(function (s) { s.classList.toggle('active', s.id === 'section-' + id); });
    navItems.forEach(function (b) { b.classList.toggle('active', b.dataset.section === id); });
    window.scrollTo(0, 0);
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    closeSidebar();
    if (!member) return;
    if (id === 'admin' && member.role === 'admin') loadAdminDashboard();
    if (id === 'admin-ground-schedule' && member.role === 'admin') loadAdminGroundSchedule();
    if (id === 'guided-notes' && member.role === 'admin') loadGuidedNotes();
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

  hideLearningPathPreview();
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
  var refreshAccessBtn = document.getElementById('refreshAccessBtn');
  var refreshAccessStatus = document.getElementById('refreshAccessStatus');
  if (refreshAccessBtn) {
    refreshAccessBtn.addEventListener('click', function () {
      refreshAccessBtn.disabled = true;
      refreshAccessStatus.textContent = 'Checking your purchase record…';
      reconcileCheckrideAccess(false).then(function (unlocked) {
        refreshAccessStatus.textContent = unlocked
          ? 'Access is unlocked on this account.'
          : 'No matching Checkride Prep purchase was found yet. If Stripe charged you, contact Apex support.';
        refreshAccessBtn.disabled = false;
      });
    });
  }

  // supabase-js's functions.invoke() throws a FunctionsHttpError on any
  // non-2xx response, whose .message is ALWAYS the generic literal "Edge
  // Function returned a non-2xx status code" -- regardless of what the
  // function's own response body actually says. The real message create-
  // checkout-session sent (e.g. "Invalid or expired session", "Checkride
  // Prep is already unlocked on this account", or the Stripe/auth error
  // that actually caused a 500) is still sitting in the unconsumed
  // Response object at res.error.context, readable via .json(). Confirmed
  // against the actual @supabase/functions-js source (FunctionsClient.ts):
  // on failure `data` is always null and `error.context` is the raw,
  // never-yet-read Response. Used by both checkout flows below so a
  // failure actually tells the member (and us) what went wrong instead of
  // a useless generic string.
  function extractInvokeError(res) {
    if (res.data && res.data.error) return Promise.resolve(res.data.error);
    var fallback = (res.error && res.error.message) || 'Could not start checkout. Please try again.';
    if (res.error && res.error.context && typeof res.error.context.json === 'function') {
      return res.error.context.json().then(function (body) {
        return (body && body.error) || fallback;
      }).catch(function () { return fallback; });
    }
    return Promise.resolve(fallback);
  }

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

  /* ── Live founding/standard price preview — the "$29 · Tap to unlock"
     labels and the unlock modal's price both used to be static HTML that
     kept advertising $29 forever, even after the 25 founding seats were
     gone and every new member was actually being charged $49 at checkout.
     get_checkride_prep_pricing() mirrors the same server-side rule
     create-checkout-session uses to decide the real charge, so what a
     member sees here always matches what they're about to pay. ──────── */
  function applyUnlockPricing() {
    if (member && member.checkridePrepUnlocked) return;
    apexSupabase.rpc('get_checkride_prep_pricing').then(function (res) {
      var row = res.data && res.data[0];
      if (res.error || !row) return;
      var priceLabel = '$' + Math.round(row.amount_cents / 100);
      document.querySelectorAll('.portal-locked-widget__overlay small').forEach(function (el) {
        el.textContent = priceLabel + ' · Tap to unlock';
      });
      var modalPrice = document.getElementById('unlockModalPrice');
      var modalNote = document.getElementById('unlockModalPriceNote');
      if (modalPrice) modalPrice.textContent = priceLabel;
      if (modalNote) {
        modalNote.textContent = row.tier === 'founding'
          ? row.founding_seats_remaining + ' founding spot' + (row.founding_seats_remaining === 1 ? '' : 's') + ' left at $29, then $49'
          : 'Founding pricing has ended — $49 for full access';
      }
    }).catch(function (e) { console.error('applyUnlockPricing failed', e); });
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
        return extractInvokeError(res).then(function (msg) {
          unlockModalCta.disabled = false;
          unlockModalCta.textContent = 'Unlock Now';
          unlockModalError.textContent = msg;
          unlockModalError.classList.add('show');
        });
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
        if (res.error) throw res.error;
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
      }).catch(function (e) {
        groundSchoolLoaded = false;
        listEl.innerHTML = '<p style="color:#ff8b8b;font-size:14px">Could not load ground school sessions: ' + e.message + '</p>';
        emptyEl.style.display = 'none';
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
        return extractInvokeError(res).then(function (msg) {
          groundSchoolModalCta.disabled = false;
          groundSchoolModalCta.textContent = 'Pay & Register';
          groundSchoolModalError.textContent = msg;
          groundSchoolModalError.classList.add('show');
        });
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
      reconcileCheckrideAccess(true).then(function (unlocked) {
        if (unlocked) {
          toast('Unlocked! Welcome to the Checkride Prep System.');
          if (window.gtag) gtag('event', 'purchase', { currency: 'USD', items: [{ item_name: 'Checkride Prep Unlock' }] });
        }
      });
    });
  }
  if (urlParams.get('registered') === '1') {
    toast('You\'re registered for ground school!');
  }

  function reconcileCheckrideAccess(silent) {
    if (!member) return Promise.resolve(false);
    return apexSupabase.rpc('reconcile_own_checkride_prep_access').then(function (res) {
      if (res.error) throw res.error;
      if (res.data) {
        member.checkridePrepUnlocked = true;
        applyUnlockState();
        return loadPremiumContent().then(function () {
          renderDpeLibrary();
          renderScenarios();
          renderProgress();
          renderDashboardStats();
          renderMembership();
          if (!silent) toast('Access refreshed — Checkride Prep is unlocked.');
          return true;
        });
      }
      if (!silent) toast('No Checkride Prep purchase found on this account yet.');
      return false;
    }).catch(function (err) {
      if (!silent) toast('Could not refresh access: ' + err.message);
      return false;
    });
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
  var myPurchase = null;
  var myInvoices = [];
  var myGroundRegistrations = [];

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
      apexSupabase.from('portal_checkride_results').select('*').eq('profile_id', member.id).maybeSingle(),
      apexSupabase.from('portal_access_purchases').select('*').eq('profile_id', member.id).maybeSingle(),
      apexSupabase.from('invoices').select('*').eq('student_id', member.id).order('issued_at', { ascending: false }),
      apexSupabase.from('ground_registrations').select('*, session:ground_sessions(*)').eq('profile_id', member.id)
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
      myPurchase = results[14].data || null;
      myInvoices = results[15].data || [];
      myGroundRegistrations = results[16].data || [];
      if (myPurchase && !member.checkridePrepUnlocked) reconcileCheckrideAccess(true);
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
  var FRAMEWORK_LESSON = { id: 'lesson-framework', title: '', meta: '', parts: [] };

  /* ══════════════════════════════════════════════════════════════
     SECTION 11 — CHECKRIDE DAY PREPARATION
     ══════════════════════════════════════════════════════════════ */
  var CHECKRIDE_DAY_LESSON = { id: 'lesson-checkride-day', title: '', meta: '', parts: [] };

  /* ══════════════════════════════════════════════════════════════
     SECTION 12 — QUICK REFERENCE APPENDIX (7 mnemonic sheets)
     ══════════════════════════════════════════════════════════════ */
  var QUICK_REF = [];

  /* ══════════════════════════════════════════════════════════════
     SECTIONS 2–10 — DPE QUESTIONS LIBRARY (72 questions, verbatim)
     ══════════════════════════════════════════════════════════════ */
  var CATEGORY_META = {};

  var DPE_DATA = [];

  /* ══════════════════════════════════════════════════════════════
     SCENARIO TRAINING CENTER — sourced from Section 10 (Emergency
     Operations, all 8) plus Section 9's diversion & lost-procedure
     questions (2). Same verbatim fields as the DPE library.
     ══════════════════════════════════════════════════════════════ */
  var SCENARIO_IDS = [];
  var SCENARIOS = [];

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
    if (!Object.keys(CATEGORY_META).length) return; // not unlocked yet — nothing fetched to render

    // Lesson 1: Framework
    var frameworkBody = FRAMEWORK_LESSON.parts.map(lessonPartHtml).join('');
    container.appendChild(buildLessonEl(FRAMEWORK_LESSON.id, 1, FRAMEWORK_LESSON.title, FRAMEWORK_LESSON.meta, frameworkBody));

    // Lessons 2-10: the 9 content sections, each intro + link to filtered DPE library
    var order = ['eligibility', 'airworthiness', 'privileges', 'airspace', 'weather', 'performance', 'aeromedical', 'crosscountry', 'emergency'];
    order.forEach(function (cat, i) {
      var meta = CATEGORY_META[cat];
      if (!meta) return;
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
  var qotdQuestion = null;
  function computeQotdQuestion() {
    qotdQuestion = DPE_DATA.length ? DPE_DATA[dayOfYear() % DPE_DATA.length] : null;
  }
  computeQotdQuestion();

  function updateQotdButtons() {
    if (!qotdQuestion) return;
    var studiedBtn = document.getElementById('qotdStudiedBtn');
    var favBtn = document.getElementById('qotdFavBtn');
    studiedBtn.textContent = studied[qotdQuestion.id] ? '✓ Studied' : 'Mark as Studied';
    studiedBtn.classList.toggle('active', !!studied[qotdQuestion.id]);
    favBtn.textContent = favorites[qotdQuestion.id] ? '★ Starred' : '☆ Star for review';
    favBtn.classList.toggle('active', !!favorites[qotdQuestion.id]);
  }

  function renderQotd() {
    if (!qotdQuestion) return;
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
    if (!qotdQuestion) return;
    document.getElementById('qotdPrompt').style.display = 'none';
    document.getElementById('qotdAnswer').style.display = 'block';
    touchLastViewed(qotdQuestion.id);
    answeredCounts[qotdQuestion.id] = (answeredCounts[qotdQuestion.id] || 0) + 1;
    upsertRow('portal_question_progress', 'question_id', qotdQuestion.id, { answered_count: answeredCounts[qotdQuestion.id] });
  });
  document.getElementById('qotdStudiedBtn').addEventListener('click', function () {
    if (!qotdQuestion) return;
    toggleStudied(qotdQuestion.id);
    updateQotdButtons();
    renderProgress(); renderDashboardStats(); renderReadiness(); renderAcsCoverage(); renderWeakAreas(); renderDpeLibrary();
  });
  document.getElementById('qotdFavBtn').addEventListener('click', function () {
    if (!qotdQuestion) return;
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
    if (!DPE_DATA.length) return; // not unlocked yet — nothing meaningful to check (avoids vacuous-true achievement tests like .every() on an empty array)
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

  var adminGroundScheduleLoaded = false;
  var adminGroundInstructors = [];

  function adminGroundSessionCard(s) {
    var instructor = adminGroundInstructors.filter(function (i) { return i.id === s.instructor_id; })[0];
    var when = s.scheduled_at ? fmtSessionDate(s.scheduled_at) : 'Date not set';
    return '<div class="portal-card">' +
      '<div class="portal-header__eyebrow" style="margin-bottom:8px">' + (s.category || 'General').toUpperCase() + '</div>' +
      '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:6px">' + (s.title || 'Untitled session') + '</h3>' +
      '<p style="color:rgba(255,255,255,0.55);font-size:13px;margin-bottom:6px">' + when + '</p>' +
      '<p style="color:rgba(255,255,255,0.45);font-size:13px;margin-bottom:6px">Instructor: ' + (instructor ? (instructor.full_name || instructor.email) : 'Not assigned') + '</p>' +
      '<p style="color:rgba(255,255,255,0.4);font-size:12px;margin:0">Capacity: ' + (s.max_students || 0) + ' · Duration: ' + (s.duration_minutes || 0) + ' min</p>' +
    '</div>';
  }

  function adminGroundScheduleFormHtml() {
    var instructorOptions = adminGroundInstructors.map(function (i) {
      return '<option value="' + i.id + '">' + (i.full_name || i.email || 'Instructor') + '</option>';
    }).join('');
    return '<div class="portal-card" style="margin-bottom:20px">' +
      '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:12px">Create Class</h3>' +
      '<form id="adminGroundScheduleForm" class="portal-admin-ground-form">' +
        '<label>Class Title<input required name="title" type="text" placeholder="Private Pilot Ground School" /></label>' +
        '<label>Date & Time<input required name="scheduled_at" type="datetime-local" /></label>' +
        '<label>Category<select name="category"><option value="private">Private Pilot</option><option value="instrument">Instrument</option><option value="commercial">Commercial</option><option value="general">General</option></select></label>' +
        '<label>Instructor<select name="instructor_id"><option value="">Unassigned</option>' + instructorOptions + '</select></label>' +
        '<label>Duration<select name="duration_minutes"><option>60</option><option selected>90</option><option>120</option><option>150</option><option>180</option></select></label>' +
        '<label>Capacity<input required name="max_students" type="number" min="1" value="20" /></label>' +
        '<label>Location<input name="location" type="text" placeholder="Apex Aviation / Online" /></label>' +
        '<label>Meeting Link<input name="meet_link" type="url" placeholder="https://..." /></label>' +
        '<label class="portal-admin-ground-form__wide">Description<textarea name="description" rows="3" placeholder="Optional class overview"></textarea></label>' +
        '<div class="portal-admin-ground-form__wide"><button class="btn btn--primary" type="submit">Create Class</button><span id="adminGroundScheduleStatus" style="margin-left:12px;color:rgba(255,255,255,0.5);font-size:13px"></span></div>' +
      '</form>' +
    '</div>';
  }

  function renderAdminGroundSchedule(rows) {
    var root = document.getElementById('adminGroundScheduleRoot');
    root.innerHTML = adminGroundScheduleFormHtml() +
      '<div class="portal-card"><h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:12px">Upcoming Classes</h3>' +
      (rows.length ? '<div class="portal-grid portal-grid--2">' + rows.map(adminGroundSessionCard).join('') + '</div>' : '<p style="color:rgba(255,255,255,0.45);font-size:14px;margin:0">No upcoming classes scheduled yet.</p>') +
      '</div>';

    document.getElementById('adminGroundScheduleForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.currentTarget;
      var status = document.getElementById('adminGroundScheduleStatus');
      var payload = {
        title: form.title.value.trim(),
        scheduled_at: form.scheduled_at.value,
        category: form.category.value,
        instructor_id: form.instructor_id.value || null,
        duration_minutes: parseInt(form.duration_minutes.value, 10),
        max_students: parseInt(form.max_students.value, 10),
        location: form.location.value.trim() || null,
        meet_link: form.meet_link.value.trim() || null,
        description: form.description.value.trim() || null
      };
      if (!payload.title || !payload.scheduled_at || !payload.max_students || payload.max_students < 1) {
        status.style.color = '#ff8b8b';
        status.textContent = 'Title, date/time, and positive capacity are required.';
        return;
      }
      status.style.color = 'rgba(255,255,255,0.5)';
      status.textContent = 'Saving…';
      apexSupabase.from('ground_sessions').insert(payload).then(function (res) {
        if (res.error) throw res.error;
        status.style.color = 'var(--gold)';
        status.textContent = 'Class created.';
        adminGroundScheduleLoaded = false;
        loadAdminGroundSchedule();
      }).catch(function (err) {
        status.style.color = '#ff8b8b';
        status.textContent = err.message;
      });
    });
  }

  function loadAdminGroundSchedule() {
    if (adminGroundScheduleLoaded) return;
    adminGroundScheduleLoaded = true;
    var root = document.getElementById('adminGroundScheduleRoot');
    root.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:14px">Loading classes…</p>';
    var now = new Date().toISOString();
    Promise.all([
      apexSupabase.from('profiles').select('id,full_name,email').eq('role', 'instructor').order('full_name'),
      apexSupabase.from('ground_sessions').select('*').gte('scheduled_at', now).order('scheduled_at')
    ]).then(function (results) {
      if (results[0].error) throw results[0].error;
      if (results[1].error) throw results[1].error;
      adminGroundInstructors = results[0].data || [];
      renderAdminGroundSchedule(results[1].data || []);
    }).catch(function (e) {
      adminGroundScheduleLoaded = false;
      root.innerHTML = '<div class="portal-card"><p style="color:#ff8b8b;font-size:14px;margin:0">Could not load class scheduler: ' + e.message + '</p></div>';
    });
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

  // DPE content CMS state (Phase 4) — held in memory and patched locally
  // after each save/delete rather than re-fetched from Supabase every
  // time, same lightweight-update pattern already used for the Ask
  // Andrew/testimonial/referral inboxes above.
  var cmsCategories = [];
  var cmsQuestions = [];
  var cmsActiveCategory = null;

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
      apexSupabase.from('profiles').select('id,full_name,email,created_at,checkride_prep_unlocked'),
      apexSupabase.from('dpe_categories').select('*').order('sort_order'),
      apexSupabase.from('dpe_questions').select('*').order('sort_order'),
      apexSupabase.from('portal_access_purchases').select('profile_id,tier,amount_cents,created_at'),
      apexSupabase.from('ground_registrations').select('payment_status,amount_cents,profile_id,registered_at')
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
      cmsCategories = results[9].data || [];
      cmsQuestions = results[10].data || [];
      if (!cmsActiveCategory || !cmsCategories.some(function (c) { return c.id === cmsActiveCategory; })) {
        cmsActiveCategory = cmsCategories.length ? cmsCategories[0].id : null;
      }

      /* ── Phase 5: Funnel & Revenue ──────────────────────────────
         Revenue/funnel counts are read directly from
         portal_access_purchases/ground_registrations/invoices rather
         than portal_events -- ANALYTICS_EVENT_MAP.md's own
         recommendation, since portal_events undercounts anything that
         only ever fired client-side (see Phase 3). Ground school
         revenue lives in ground_registrations, not invoices -- adding
         it here fixes what would otherwise be a silently incomplete
         "total revenue" figure (invoices alone only ever contained
         Checkride Prep purchases + manual tuition, never ground school). */
      var purchases = results[11].data || [];
      var purchaseByProfile = {};
      purchases.forEach(function (p) { if (p.profile_id) purchaseByProfile[p.profile_id] = p; });
      var unlockMismatches = Object.keys(purchaseByProfile).map(function (profileId) {
        return profileMap[profileId];
      }).filter(function (p) { return p && !p.checkride_prep_unlocked; });
      var foundingUnlocks = purchases.filter(function (p) { return p.tier === 'founding'; }).length;
      var standardUnlocks = purchases.filter(function (p) { return p.tier === 'standard'; }).length;
      var premiumRevenueCents = purchases.reduce(function (sum, p) { return sum + (p.amount_cents || 0); }, 0);
      var conversionRate = totalUsers ? Math.round((purchases.length / totalUsers) * 100) : 0;

      var groundRegs = results[12].data || [];
      var paidGroundRegs = groundRegs.filter(function (r) { return r.payment_status === 'paid'; });
      var groundRevenueCents = paidGroundRegs.reduce(function (sum, r) { return sum + (r.amount_cents || 0); }, 0);

      // totalRevenueCents (paid invoices) already includes every premium
      // unlock's mirrored invoice row -- add ground school revenue
      // alongside it, not premiumRevenueCents too, or unlocks would be
      // double-counted.
      var combinedRevenueCents = totalRevenueCents + groundRevenueCents;

      /* ── Phase 5: Retention (Day 1/7/30) + streak distribution ───
         Cohort-based, derived straight from profiles.created_at +
         portal_study_activity -- no new instrumentation needed, per
         ANALYTICS_EVENT_MAP.md. Uses UTC "today" throughout (both for
         the cohort math and the streak walk-back) purely for internal
         consistency across profiles in different browser timezones;
         activity_date itself was written using each member's own
         browser-local date client-side, so this is the same
         one-day-fuzziness approximation already documented in
         RETENTION_SYSTEM.md for the lifecycle email job -- a coarse
         aggregate metric, not a per-member-exact one. */
      var allProfiles = results[8].data || [];
      var actByProfile = {};
      actRows.forEach(function (r) {
        if (!actByProfile[r.profile_id]) actByProfile[r.profile_id] = {};
        actByProfile[r.profile_id][r.activity_date] = true;
      });
      function utcDateKey(d) { return d.toISOString().slice(0, 10); }
      function retentionRate(days) {
        var eligible = 0, retained = 0;
        var now = new Date();
        allProfiles.forEach(function (p) {
          if (!p.created_at) return;
          var cohortDay = new Date(p.created_at);
          cohortDay.setUTCHours(0, 0, 0, 0);
          var targetDay = new Date(cohortDay);
          targetDay.setUTCDate(targetDay.getUTCDate() + days);
          if (targetDay > now) return; // cohort hasn't reached day N yet
          eligible++;
          var dates = actByProfile[p.id];
          if (dates && dates[utcDateKey(targetDay)]) retained++;
        });
        return eligible ? Math.round((retained / eligible) * 100) : null;
      }
      function currentStreakFromDates(dates) {
        if (!dates) return 0;
        var current = 0;
        var cursor = new Date();
        cursor.setUTCHours(0, 0, 0, 0);
        if (!dates[utcDateKey(cursor)]) cursor.setUTCDate(cursor.getUTCDate() - 1);
        while (dates[utcDateKey(cursor)]) {
          current++;
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        }
        return current;
      }
      var day1Retention = retentionRate(1);
      var day7Retention = retentionRate(7);
      var day30Retention = retentionRate(30);
      var streakBuckets = { '0 days': 0, '1–2 days': 0, '3–6 days': 0, '7–13 days': 0, '14+ days': 0 };
      allProfiles.forEach(function (p) {
        var streak = currentStreakFromDates(actByProfile[p.id]);
        if (streak === 0) streakBuckets['0 days']++;
        else if (streak <= 2) streakBuckets['1–2 days']++;
        else if (streak <= 6) streakBuckets['3–6 days']++;
        else if (streak <= 13) streakBuckets['7–13 days']++;
        else streakBuckets['14+ days']++;
      });

      el.innerHTML =
        '<div class="portal-admin-metrics">' +
          metricCard('Total Users', totalUsers) +
          metricCard('Paid Invoices', paidInvoices.length + ' ($' + (totalRevenueCents / 100).toLocaleString() + ')') +
          metricCard('Questions Completed', questionsCompleted) +
          metricCard('Active Students (30d)', Object.keys(activeUsers30d).length) +
        '</div>' +
        '<div class="portal-grid portal-grid--2" style="margin-top:20px">' +
          '<div class="portal-card">' +
            '<h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Funnel &amp; Revenue</h3>' +
            '<div class="portal-membership-row"><strong>Signup → Unlock Conversion</strong><span>' + conversionRate + '% (' + purchases.length + ' of ' + totalUsers + ')</span></div>' +
            '<div class="portal-membership-row"><strong>Premium Unlocks</strong><span>' + purchases.length + ' — ' + foundingUnlocks + ' founding, ' + standardUnlocks + ' standard ($' + (premiumRevenueCents / 100).toLocaleString() + ')</span></div>' +
            '<div class="portal-membership-row"><strong>Ground School (paid)</strong><span>' + paidGroundRegs.length + ' registrations ($' + (groundRevenueCents / 100).toLocaleString() + ')</span></div>' +
            '<div class="portal-membership-row"><strong>Total Platform Revenue</strong><span style="color:var(--gold);font-weight:700">$' + (combinedRevenueCents / 100).toLocaleString() + '</span></div>' +
          '</div>' +
          '<div class="portal-card">' +
            '<h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Retention</h3>' +
            '<div class="portal-membership-row"><strong>Day 1</strong><span>' + (day1Retention === null ? '—' : day1Retention + '%') + '</span></div>' +
            '<div class="portal-membership-row"><strong>Day 7</strong><span>' + (day7Retention === null ? '—' : day7Retention + '%') + '</span></div>' +
            '<div class="portal-membership-row"><strong>Day 30</strong><span>' + (day30Retention === null ? '—' : day30Retention + '%') + '</span></div>' +
            Object.keys(streakBuckets).map(function (k) {
              return '<div class="portal-membership-row"><strong>Streak: ' + k + '</strong><span>' + streakBuckets[k] + '</span></div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="portal-grid portal-grid--2" style="margin-top:20px">' +
          '<div class="portal-card"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Most Difficult Questions (most starred)</h3>' + adminTable(mostDifficult, 'q', 'count') + '</div>' +
          '<div class="portal-card"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Most Viewed Scenarios</h3>' + adminTable(mostViewedScenarios, 'title', 'views') + '</div>' +
        '</div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">Total Study Time (all students)</h3><p style="color:var(--gold);font-size:24px;font-weight:800">' + Math.round(totalSeconds / 3600) + ' hours</p></div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">Unlock Repair Queue (' + unlockMismatches.length + ')</h3><p style="color:rgba(255,255,255,0.4);font-size:12.5px;margin-bottom:14px">Paid members whose purchase exists but whose Checkride Prep flag is still locked.</p><div id="adminUnlockRepair"></div></div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">Ask Andrew — Open Questions (' + openDiscussions.length + ')</h3><p style="color:rgba(255,255,255,0.4);font-size:12.5px;margin-bottom:14px">These are exactly the topics your students want content on — FAQs, reels, ground school material.</p><div id="adminAskInbox"></div></div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Testimonials Awaiting Approval (' + pendingTestimonials.length + ')</h3><div id="adminTestimonialInbox"></div></div>' +
        '<div class="portal-card" style="margin-top:20px"><h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:14px">Recent Referrals</h3><div id="adminReferralList"></div></div>' +
        '<div class="portal-card" style="margin-top:20px">' +
          '<h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">DPE Question Library (Content Management)</h3>' +
          '<p style="color:rgba(255,255,255,0.4);font-size:12.5px;margin-bottom:14px">Add, edit, or remove questions from the Checkride Prep question bank. Changes appear for members next time they load the portal.</p>' +
          '<div id="cmsCategoryBar" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;align-items:center"></div>' +
          '<div id="cmsCategoryInfo" style="margin-bottom:16px"></div>' +
          '<div id="cmsQuestionList"></div>' +
        '</div>';

      renderAdminUnlockRepair(unlockMismatches);
      renderAdminAskInbox(openDiscussions, profileMap);
      renderAdminTestimonialInbox(pendingTestimonials, profileMap);
      renderAdminReferralList(recentReferrals, profileMap);
      renderCmsCategoryBar();
      renderCmsCategoryInfo();
      renderCmsQuestionList();
    }).catch(function (e) {
      el.innerHTML = '<p style="color:#ff8b8b;font-size:14px">Could not load admin data: ' + e.message + '</p>';
    });
  }

  function renderAdminUnlockRepair(rows) {
    var el = document.getElementById('adminUnlockRepair');
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px;margin:0">No mismatched paid accounts right now.</p>';
      return;
    }
    el.innerHTML = rows.map(function (p) {
      return '<div class="portal-admin-inbox-item" data-unlock-profile="' + p.id + '">' +
        '<div><strong>' + (p.full_name || 'Unnamed member') + '</strong><p>' + (p.email || '') + '</p></div>' +
        '<button class="btn btn--primary" style="padding:6px 14px;font-size:12.5px" data-admin-unlock>Unlock</button>' +
      '</div>';
    }).join('');
    el.querySelectorAll('[data-admin-unlock]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('[data-unlock-profile]');
        var profileId = row.dataset.unlockProfile;
        btn.disabled = true;
        btn.textContent = 'Unlocking…';
        apexSupabase.rpc('admin_unlock_checkride_prep', { p_profile_id: profileId }).then(function (res) {
          if (res.error) throw res.error;
          row.remove();
          if (!el.querySelector('[data-unlock-profile]')) {
            el.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px;margin:0">No mismatched paid accounts right now.</p>';
          }
          toast('Member access unlocked.');
        }).catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Unlock';
          toast('Could not unlock: ' + err.message);
        });
      });
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

  // Referral status transitions, admin-only. Previously portal_referrals
  // had no admin write path at all -- "Users manage their own referrals"
  // only ever let the referrer touch their own row, and the existing
  // lock_referral_status trigger correctly stops them from self-approving
  // it, but nothing granted an admin write access to a row that isn't
  // theirs either. Fixed via the "Admins can manage all referrals" policy
  // in supabase-portal-schema-v9.sql.
  var REFERRAL_NEXT_STATUS = { pending: 'signed_up', signed_up: 'rewarded' };
  var REFERRAL_NEXT_LABEL = { pending: 'Mark Signed Up', signed_up: 'Mark Rewarded' };

  function renderAdminReferralList(rows, profileMap) {
    var el = document.getElementById('adminReferralList');
    if (!rows.length) { el.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px">No referrals yet.</p>'; return; }
    el.innerHTML = rows.map(function (r) {
      var referrerName = (profileMap[r.referrer_id] && profileMap[r.referrer_id].full_name) || 'A student';
      var next = REFERRAL_NEXT_STATUS[r.status];
      var actionBtn = next ? '<button class="btn btn--ghost" style="margin-left:10px;padding:4px 12px;font-size:11.5px" data-referral-advance="' + r.id + '" data-next-status="' + next + '">' + REFERRAL_NEXT_LABEL[r.status] + '</button>' : '';
      return '<div class="portal-referral-row" data-referral-row="' + r.id + '"><span class="email">' + referrerName + ' → ' + r.referred_email + '</span><span style="display:flex;align-items:center"><span class="status">' + r.status + '</span>' + actionBtn + '</span></div>';
    }).join('');
    el.querySelectorAll('[data-referral-advance]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.referralAdvance;
        var nextStatus = btn.dataset.nextStatus;
        btn.disabled = true;
        apexSupabase.from('portal_referrals').update({ status: nextStatus }).eq('id', id).then(function (res) {
          if (res.error) { toast('Could not update referral: ' + res.error.message); btn.disabled = false; return; }
          var row = el.querySelector('[data-referral-row="' + id + '"]');
          if (row) {
            row.querySelector('.status').textContent = nextStatus;
            var nextNext = REFERRAL_NEXT_STATUS[nextStatus];
            var oldBtn = row.querySelector('[data-referral-advance]');
            if (nextNext) {
              oldBtn.dataset.nextStatus = nextNext;
              oldBtn.textContent = REFERRAL_NEXT_LABEL[nextStatus];
              oldBtn.disabled = false;
            } else if (oldBtn) {
              oldBtn.remove();
            }
          }
          toast('Referral updated.');
        });
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     DPE CONTENT MANAGEMENT (Phase 4) — create/edit/delete questions
     within a category, and edit each category's own label/section
     label/intro. dpe_questions/dpe_categories were view-only for
     admins before supabase-portal-schema-v9.sql added write access;
     this is that CMS. Creating brand-new categories is out of scope —
     the 9 categories map to fixed ACS knowledge areas — only their
     text fields are editable here.
     ══════════════════════════════════════════════════════════════ */
  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function renderCmsCategoryBar() {
    var el = document.getElementById('cmsCategoryBar');
    if (!el) return;
    el.innerHTML = cmsCategories.map(function (c) {
      var active = c.id === cmsActiveCategory;
      return '<button type="button" class="btn ' + (active ? 'btn--primary' : 'btn--ghost') + '" style="padding:6px 14px;font-size:12.5px" data-cms-category="' + c.id + '">' + c.label + '</button>';
    }).join('');
    el.querySelectorAll('[data-cms-category]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cmsActiveCategory = btn.dataset.cmsCategory;
        renderCmsCategoryBar();
        renderCmsCategoryInfo();
        renderCmsQuestionList();
      });
    });
  }

  function renderCmsCategoryInfo() {
    var el = document.getElementById('cmsCategoryInfo');
    if (!el) return;
    var cat = cmsCategories.filter(function (c) { return c.id === cmsActiveCategory; })[0];
    if (!cat) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<div class="portal-admin-inbox-item">' +
        '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">Label</label><input type="text" data-cms-cat-field="label" value="' + escapeAttr(cat.label) + '" /></div>' +
        '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">Section Label</label><input type="text" data-cms-cat-field="section_label" value="' + escapeAttr(cat.section_label) + '" /></div>' +
        '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">Intro</label><textarea rows="2" data-cms-cat-field="intro">' + escapeAttr(cat.intro) + '</textarea></div>' +
        '<button type="button" class="btn btn--ghost" style="padding:6px 14px;font-size:12.5px" data-cms-cat-save>Save Category Info</button>' +
      '</div>';
    el.querySelector('[data-cms-cat-save]').addEventListener('click', function () {
      var btn = el.querySelector('[data-cms-cat-save]');
      var patch = {
        label: el.querySelector('[data-cms-cat-field="label"]').value.trim(),
        section_label: el.querySelector('[data-cms-cat-field="section_label"]').value.trim(),
        intro: el.querySelector('[data-cms-cat-field="intro"]').value.trim()
      };
      btn.disabled = true;
      apexSupabase.from('dpe_categories').update(patch).eq('id', cat.id).then(function (res) {
        btn.disabled = false;
        if (res.error) { toast('Could not save category: ' + res.error.message); return; }
        Object.assign(cat, patch);
        renderCmsCategoryBar();
        toast('Category updated.');
      });
    });
  }

  function cmsQuestionFormHtml(q) {
    return (
      '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">Question</label><textarea rows="2" data-cms-q-field="question">' + escapeAttr(q.question) + '</textarea></div>' +
      '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">Model Answer</label><textarea rows="3" data-cms-q-field="model_answer">' + escapeAttr(q.model_answer) + '</textarea></div>' +
      '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">Common Mistakes</label><textarea rows="2" data-cms-q-field="common_mistakes">' + escapeAttr(q.common_mistakes) + '</textarea></div>' +
      '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">What the DPE Is Evaluating</label><textarea rows="2" data-cms-q-field="dpe_evaluating">' + escapeAttr(q.dpe_evaluating) + '</textarea></div>' +
      '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">ACS Reference</label><input type="text" data-cms-q-field="acs_reference" value="' + escapeAttr(q.acs_reference) + '" /></div>' +
      '<div class="form-group" style="margin-bottom:8px"><label style="font-size:12px;color:rgba(255,255,255,0.5)">Real-World Application</label><textarea rows="2" data-cms-q-field="real_world_application">' + escapeAttr(q.real_world_application) + '</textarea></div>' +
      '<div class="form-group" style="margin-bottom:8px;display:flex;gap:16px;align-items:center">' +
        '<label style="font-size:12px;color:rgba(255,255,255,0.6);display:flex;align-items:center;gap:6px"><input type="checkbox" data-cms-q-field="is_scenario"' + (q.is_scenario ? ' checked' : '') + ' /> Include in Scenario Training</label>' +
        '<label style="font-size:12px;color:rgba(255,255,255,0.5)">Sort Order <input type="number" data-cms-q-field="sort_order" value="' + (q.sort_order || 0) + '" style="width:64px;margin-left:6px" /></label>' +
      '</div>'
    );
  }

  function readCmsQuestionForm(container) {
    return {
      question: container.querySelector('[data-cms-q-field="question"]').value.trim(),
      model_answer: container.querySelector('[data-cms-q-field="model_answer"]').value.trim(),
      common_mistakes: container.querySelector('[data-cms-q-field="common_mistakes"]').value.trim() || null,
      dpe_evaluating: container.querySelector('[data-cms-q-field="dpe_evaluating"]').value.trim() || null,
      acs_reference: container.querySelector('[data-cms-q-field="acs_reference"]').value.trim() || null,
      real_world_application: container.querySelector('[data-cms-q-field="real_world_application"]').value.trim() || null,
      is_scenario: container.querySelector('[data-cms-q-field="is_scenario"]').checked,
      sort_order: parseInt(container.querySelector('[data-cms-q-field="sort_order"]').value, 10) || 0
    };
  }

  function renderCmsQuestionList() {
    var el = document.getElementById('cmsQuestionList');
    if (!el) return;
    var rows = cmsQuestions.filter(function (q) { return q.category === cmsActiveCategory; })
      .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

    el.innerHTML =
      '<button type="button" class="btn btn--ghost" style="padding:6px 14px;font-size:12.5px;margin-bottom:12px" id="cmsAddQuestionBtn">+ Add Question</button>' +
      '<div id="cmsQuestionRows"></div>';

    var rowsEl = document.getElementById('cmsQuestionRows');
    if (!rows.length) rowsEl.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px">No questions in this category yet.</p>';
    else rowsEl.innerHTML = rows.map(function (q) {
      return '<div class="portal-admin-inbox-item" data-cms-question="' + q.id + '">' +
        '<div class="meta">' + (q.is_scenario ? '🎬 Scenario · ' : '') + 'Sort ' + (q.sort_order || 0) + '</div>' +
        '<div class="msg">' + escapeAttr(q.question) + '</div>' +
        '<button type="button" class="btn btn--ghost" style="padding:4px 12px;font-size:11.5px" data-cms-q-edit>Edit</button> ' +
        '<button type="button" class="btn btn--missed" style="padding:4px 12px;font-size:11.5px" data-cms-q-delete>Delete</button>' +
      '</div>';
    }).join('');

    rowsEl.querySelectorAll('[data-cms-question]').forEach(function (item) {
      var id = item.dataset.cmsQuestion;
      item.querySelector('[data-cms-q-edit]').addEventListener('click', function () {
        var q = cmsQuestions.filter(function (x) { return x.id === id; })[0];
        if (!q) return;
        item.innerHTML = cmsQuestionFormHtml(q) +
          '<button type="button" class="btn btn--primary" style="padding:6px 14px;font-size:12.5px" data-cms-q-save>Save</button> ' +
          '<button type="button" class="btn btn--ghost" style="padding:6px 14px;font-size:12.5px" data-cms-q-cancel>Cancel</button>';
        item.querySelector('[data-cms-q-cancel]').addEventListener('click', renderCmsQuestionList);
        item.querySelector('[data-cms-q-save]').addEventListener('click', function () {
          var saveBtn = item.querySelector('[data-cms-q-save]');
          var patch = readCmsQuestionForm(item);
          saveBtn.disabled = true;
          apexSupabase.from('dpe_questions').update(patch).eq('id', id).then(function (res) {
            saveBtn.disabled = false;
            if (res.error) { toast('Could not save question: ' + res.error.message); return; }
            Object.assign(q, patch);
            renderCmsQuestionList();
            toast('Question saved.');
          });
        });
      });
      item.querySelector('[data-cms-q-delete]').addEventListener('click', function () {
        if (!window.confirm('Delete this question? This cannot be undone.')) return;
        apexSupabase.from('dpe_questions').delete().eq('id', id).then(function (res) {
          if (res.error) { toast('Could not delete question: ' + res.error.message); return; }
          cmsQuestions = cmsQuestions.filter(function (x) { return x.id !== id; });
          renderCmsQuestionList();
          toast('Question deleted.');
        });
      });
    });

    var addBtn = document.getElementById('cmsAddQuestionBtn');
    addBtn.addEventListener('click', function () {
      if (document.getElementById('cmsNewQuestionForm')) return;
      var blank = { question: '', model_answer: '', common_mistakes: '', dpe_evaluating: '', acs_reference: '', real_world_application: '', is_scenario: false, sort_order: rows.length };
      var form = document.createElement('div');
      form.className = 'portal-admin-inbox-item';
      form.id = 'cmsNewQuestionForm';
      form.innerHTML = cmsQuestionFormHtml(blank) +
        '<button type="button" class="btn btn--primary" style="padding:6px 14px;font-size:12.5px" data-cms-q-create>Add Question</button> ' +
        '<button type="button" class="btn btn--ghost" style="padding:6px 14px;font-size:12.5px" data-cms-q-cancel>Cancel</button>';
      rowsEl.insertBefore(form, rowsEl.firstChild);
      form.querySelector('[data-cms-q-cancel]').addEventListener('click', function () { form.remove(); });
      form.querySelector('[data-cms-q-create]').addEventListener('click', function () {
        var createBtn = form.querySelector('[data-cms-q-create]');
        var fields = readCmsQuestionForm(form);
        if (!fields.question || !fields.model_answer) { toast('Question and model answer are required.'); return; }
        var newRow = Object.assign({ id: cmsActiveCategory + '-custom-' + Date.now(), category: cmsActiveCategory }, fields);
        createBtn.disabled = true;
        apexSupabase.from('dpe_questions').insert(newRow).then(function (res) {
          createBtn.disabled = false;
          if (res.error) { toast('Could not add question: ' + res.error.message); return; }
          cmsQuestions.push(newRow);
          renderCmsQuestionList();
          toast('Question added.');
        });
      });
    });
  }

  function renderStaffIfApplicable() {
    var isStaff = !!member && ['admin', 'instructor'].indexOf(member.role) !== -1;
    var operationsNavItem = document.getElementById('operationsNavItem');
    if (operationsNavItem) operationsNavItem.hidden = !isStaff;
    var activeId = (window.location.hash || '#dashboard').replace('#', '');
    if (activeId === 'operations' && !isStaff) showSection('dashboard');
  }

  function renderAdminIfApplicable() {
    if (!member || member.role !== 'admin') return;
    // Just unhides the nav item -- showSection('admin') is what actually
    // loads the dashboard (same lazy-load-on-visit pattern loadGroundSchool()
    // uses). This used to also call loadAdminDashboard() here directly,
    // meaning every admin session fired the same ~11-query Promise.all
    // twice on login (once here, again the moment they clicked into the
    // section) -- wasteful on its own, and a real correctness risk now
    // that Phase 4 added live writes (CMS edits, referral status changes)
    // to this dashboard: a stale second load resolving after a write was
    // already in flight could silently clobber it or duplicate rows in
    // the rendered list. Found via testing the new CMS, not by inspection.
    document.getElementById('adminNavItem').hidden = false;
    document.getElementById('guidedNotesNavItem').hidden = false;
    var adminGroundScheduleNavItem = document.getElementById('adminGroundScheduleNavItem');
    if (adminGroundScheduleNavItem) adminGroundScheduleNavItem.hidden = false;
    hideLearningPathPreview();

    // If an admin opens the portal directly to an admin-only hash, the
    // first showSection() call happens before the profile has loaded and
    // intentionally cannot run admin queries yet. Kick the lazy loader once
    // the role is known so the page never stays stuck on its static
    // "Loading…" placeholder.
    var activeId = (window.location.hash || '#dashboard').replace('#', '');
    if (activeId === 'admin') loadAdminDashboard();
    if (activeId === 'admin-ground-schedule') loadAdminGroundSchedule();
    if (activeId === 'guided-notes') loadGuidedNotes();
  }

  // Catches a non-admin who bookmarked or typed an admin-preview section
  // directly. The very first showSection() call (script init, before the
  // Supabase session/profile resolves) can't check member.role yet -- this
  // runs once it's known. Real enforcement still belongs at the data layer
  // for preview features with backing tables, but this prevents unfinished
  // UI from being exposed to students.
  function hideLearningPathPreview() {
    document.querySelectorAll('.portal-nav__item[data-section="learning-path"], a[href="#learning-path"], [data-goto="learning-path"]').forEach(function (el) {
      el.hidden = true;
      el.style.display = 'none';
    });
    var learningPathSection = document.getElementById('section-learning-path');
    if (learningPathSection) learningPathSection.hidden = true;
  }

  function enforceAdminPreviewAccess() {
    var isAdmin = !!member && member.role === 'admin';
    hideLearningPathPreview();
    var adminGroundScheduleNavItem = document.getElementById('adminGroundScheduleNavItem');
    if (adminGroundScheduleNavItem) adminGroundScheduleNavItem.hidden = !isAdmin;
    var activeId = (window.location.hash || '#dashboard').replace('#', '');
    if ((ADMIN_PREVIEW_SECTIONS.indexOf(activeId) !== -1 || ADMIN_ONLY_SECTIONS.indexOf(activeId) !== -1) && !isAdmin) showSection('dashboard');
  }

  /* ══════════════════════════════════════════════════════════════
     GUIDED NOTES — admin-only feature preview.

     Per-prompt free-text responses a student will eventually fill in on
     every Apex Advantage module page. Hidden from students entirely for
     now: the nav item stays `hidden` unless renderAdminIfApplicable()
     unhides it, and showSection()/enforceAdminPreviewAccess() bounce any
     non-admin who reaches #guided-notes straight back to the dashboard.
     None of that is the real security boundary, though -- it's UI
     convenience on top of the actual one, same as loadPremiumContent()
     above: guided_notes' RLS policy (supabase-portal-schema-v14.sql)
     only grants a row to its own profile_id AND a caller whose profile
     has role = 'admin'. A signed-in student calling the Supabase client
     directly gets rejected at the database, not just kept off the page.

     Opening this to every student later is a single migration (drop the
     "and exists(...role='admin')" clause from that policy) plus removing
     the `hidden` attribute from the nav button -- every query here
     already scopes to the caller's own profile_id, so nothing else in
     this file needs to change.

     Course/module IDs follow the PPL-M03-Aircraft-Systems convention
     from the Apex Advantage Content Architecture doc. Each module is
     just one more entry in GUIDED_NOTES_MODULES below, with its own
     prompt list -- no schema or rendering changes needed to add the
     rest of these two modules' guided-notes pages, or any other
     module in the curriculum. The tab row lets the admin switch
     between whichever modules exist so far while testing. ── */
  var GUIDED_NOTES_MODULES = [
    {
      courseId: 'PPL',
      moduleId: 'PPL-M01-Becoming-a-Pilot',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 01 · Becoming a Pilot',
      prompts: [
        { id: 'eligibility-certificates', section: 'Eligibility & Certificates', prompt: 'What are the eligibility requirements to apply for a Private Pilot Certificate, and how do the student pilot certificate and medical certificate differ from each other?' },
        { id: 'part-61-vs-141', section: 'Part 61 vs. Part 141', prompt: 'What is the difference between Part 61 and Part 141 flight training, and why does Apex operate under Part 61?' },
        { id: 'aeronautical-experience', section: 'Required Aeronautical Experience', prompt: 'What is the regulatory minimum flight time for a Private Pilot Certificate, and how does that compare to the realistic national average?' },
        { id: 'roles', section: 'Roles', prompt: 'What are the distinct roles of the FAA, the DPE, and your CFI in the certification process?' },
        { id: 'the-acs', section: 'The ACS', prompt: 'How is the ACS organized, and what three elements does every Task contain?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M02-Aerodynamics',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 02 · Aerodynamics',
      prompts: [
        { id: 'four-forces', section: 'The Four Forces', prompt: 'What are the four forces of flight, and what does it mean for them to be in balance during steady, unaccelerated flight?' },
        { id: 'lift-generation', section: 'How Lift Is Generated', prompt: 'How do Bernoulli’s Principle and Newton’s Third Law each explain lift, and why are both considered valid rather than competing explanations?' },
        { id: 'angle-of-attack', section: 'Angle of Attack & Critical AoA', prompt: 'What is angle of attack, how does it differ from pitch attitude, and what happens at the critical angle of attack?' },
        { id: 'load-factor', section: 'Load Factor & Accelerated Stalls', prompt: 'How does load factor relate to angle of attack in a turn, and why does stall speed increase as bank angle increases?' },
        { id: 'drag', section: 'Drag', prompt: 'What is the difference between parasite drag and induced drag, and what does the point of minimum total drag (L/D-max) correspond to?' },
        { id: 'stability-control', section: 'Stability & Control', prompt: 'What is the difference between stability and controllability, and what are the three axes of stability?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M03-Aircraft-Systems',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 03 · Aircraft Systems',
      prompts: [
        { id: 'engine-responsibilities', section: 'Engine', prompt: 'What are the main responsibilities of the engine system?' },
        { id: 'fuel-components', section: 'Fuel System', prompt: 'What are the main components of the fuel system?' },
        { id: 'alternator-failure', section: 'Electrical System', prompt: 'What indications might suggest an alternator failure?' },
        { id: 'vacuum-failure', section: 'Vacuum System', prompt: 'What instruments are affected by a vacuum system failure?' },
        { id: 'pitot-blocked', section: 'Pitot-Static System', prompt: 'What happens when the pitot tube becomes blocked?' },
        { id: 'review-topic', section: 'Self-Assessment', prompt: 'What is one aircraft systems topic you need to review before your checkride?' }
      ]
    }
  ];

  var guidedNotesActiveModuleIndex = 0;
  var guidedNotesSaveTimers = {};

  // Textarea content is round-tripped back into innerHTML on every render,
  // so a literal "</textarea>" in a saved response would otherwise truncate
  // the field early. This one only guards that path -- see loadGuidedNotes.
  function escapeForTextarea(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function loadGuidedNotes() {
    if (!member || member.role !== 'admin') return;
    var moduleDef = GUIDED_NOTES_MODULES[guidedNotesActiveModuleIndex];
    var root = document.getElementById('guidedNotesRoot');

    apexSupabase.from('guided_notes').select('*')
      .eq('profile_id', member.id)
      .eq('course_id', moduleDef.courseId)
      .eq('module_id', moduleDef.moduleId)
      .then(function (res) {
        if (res.error) {
          root.innerHTML = '<p style="color:#ff8b8b;font-size:14px">Could not load guided notes: ' + res.error.message + '</p>';
          return;
        }
        var existingByPrompt = {};
        (res.data || []).forEach(function (row) { existingByPrompt[row.prompt_id] = row; });
        renderGuidedNotes(root, existingByPrompt, moduleDef);
      });
  }

  function renderGuidedNotes(root, existingByPrompt, moduleDef) {
    var tabsHtml = '<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">' +
      GUIDED_NOTES_MODULES.map(function (m, i) {
        var isActive = i === guidedNotesActiveModuleIndex;
        return '<button class="btn ' + (isActive ? 'btn--primary' : 'btn--ghost') + '" data-guided-module-tab data-module-index="' + i + '" style="padding:9px 16px;font-size:13px">' + m.moduleLabel + '</button>';
      }).join('') +
      '</div>';

    var headerHtml = '<div class="portal-card" style="margin-bottom:20px">' +
      '<div class="portal-header__eyebrow" style="margin-bottom:6px">' + moduleDef.courseLabel + ' · ' + moduleDef.moduleLabel.split(' · ')[0] + '</div>' +
      '<h3 style="color:#fff;font-size:18px;font-weight:700;margin:0">' + moduleDef.moduleLabel.split(' · ')[1] + '</h3>' +
      '</div>';

    var cardsHtml = moduleDef.prompts.map(function (p) {
      var row = existingByPrompt[p.id];
      var savedValue = row ? escapeForTextarea(row.response_text) : '';
      var statusText = row && row.response_text ? 'Saved ' + timeAgo(new Date(row.updated_at).getTime()) : 'Not started';
      return '<div class="portal-card" style="margin-bottom:16px" data-guided-note-card data-prompt-id="' + p.id + '">' +
        '<div class="portal-header__eyebrow" style="margin-bottom:6px">' + p.section + '</div>' +
        '<h3 style="color:#fff;font-size:15px;font-weight:700;margin-bottom:12px">' + p.prompt + '</h3>' +
        '<textarea data-guided-note-input rows="4" placeholder="Type your response…" style="width:100%;padding:12px 14px;border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none;resize:vertical;margin-bottom:10px">' + savedValue + '</textarea>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
          '<span data-guided-note-status style="font-size:12.5px;color:rgba(255,255,255,0.4)">' + statusText + '</span>' +
          '<button class="btn btn--ghost" data-guided-note-save style="padding:8px 16px;font-size:13px">Save</button>' +
        '</div>' +
      '</div>';
    }).join('');

    root.innerHTML = tabsHtml + headerHtml + cardsHtml;

    root.querySelectorAll('[data-guided-module-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        guidedNotesActiveModuleIndex = parseInt(btn.dataset.moduleIndex, 10);
        loadGuidedNotes();
      });
    });

    wireGuidedNotesInputs(root, moduleDef);
  }

  function wireGuidedNotesInputs(root, moduleDef) {
    root.querySelectorAll('[data-guided-note-card]').forEach(function (card) {
      var promptId = card.dataset.promptId;
      var promptDef = moduleDef.prompts.filter(function (p) { return p.id === promptId; })[0];
      var textarea = card.querySelector('[data-guided-note-input]');
      var status = card.querySelector('[data-guided-note-status]');
      var saveBtn = card.querySelector('[data-guided-note-save]');
      var timerKey = moduleDef.moduleId + ':' + promptId;

      function save() {
        saveBtn.disabled = true;
        status.style.color = 'rgba(255,255,255,0.4)';
        status.textContent = 'Saving…';
        apexSupabase.from('guided_notes').upsert({
          profile_id: member.id,
          course_id: moduleDef.courseId,
          module_id: moduleDef.moduleId,
          section_id: promptDef ? promptDef.section : promptId,
          prompt_id: promptId,
          response_text: textarea.value,
          updated_at: new Date().toISOString()
        }, { onConflict: 'profile_id,course_id,module_id,section_id,prompt_id' }).then(function (res) {
          saveBtn.disabled = false;
          if (res.error) {
            status.style.color = '#ff8b8b';
            status.textContent = 'Could not save — try again';
            return;
          }
          status.style.color = 'rgba(255,255,255,0.4)';
          status.textContent = 'Saved just now';
        });
      }

      saveBtn.addEventListener('click', save);

      // Autosave 1.5s after the admin stops typing, in addition to the
      // manual Save button -- matches the "autosave or manual save"
      // requirement without making the button feel redundant.
      textarea.addEventListener('input', function () {
        status.style.color = 'rgba(255,255,255,0.4)';
        status.textContent = 'Unsaved changes…';
        clearTimeout(guidedNotesSaveTimers[timerKey]);
        guidedNotesSaveTimers[timerKey] = setTimeout(save, 1500);
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     EMAIL ENGINE — reuses the `send-email` Edge Function (Resend).
     Milestone/recommendation emails fire directly from the client
     since they're tied to real-time user actions, so a member sees the
     payoff immediately. They're also recomputed server-side on a daily
     schedule by send-lifecycle-emails (Phase 3 — see
     portal/supabase/functions/send-lifecycle-emails and
     RETENTION_SYSTEM.md), which catches whatever this client-side path
     misses (tab never reopened at the right moment) and is the only
     path for the two email types with no client-side equivalent at
     all: the 7-day inactivity nudge and the checkride countdown.
     ══════════════════════════════════════════════════════════════ */
  function emailTemplate(contentHtml) {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
      '<body style="margin:0;padding:32px 16px;background:#06080f;font-family:\'Helvetica Neue\',Arial,sans-serif;color:#e0e0e0;">' +
      '<div style="max-width:560px;margin:0 auto;">' +
      '<div style="margin-bottom:28px;"><span style="font-size:22px;font-weight:900;letter-spacing:3px;color:#fff;">APEX</span>' +
      '<span style="font-size:22px;font-style:italic;color:#F4B400;font-family:Georgia,serif;"> Advantage</span></div>' +
      contentHtml +
      '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:32px 0 16px;">' +
      '<p style="font-size:12px;color:rgba(255,255,255,0.3);margin:0;">Apex Aviation · Austin, TX</p>' +
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
    apexSupabase.from('portal_email_log').insert({ profile_id: member.id, email_type: emailType }).then(function (res) {
      if (res.error) {
        if (res.error.code !== '23505') console.warn('Email log insert failed', res.error);
        return;
      }
      sendPortalEmail(to, subject, contentHtml);
    });
  }

  // One-time milestone emails dedupe via portal_events (loggedEventTypes,
  // above) rather than portal_email_log, but also log to
  // portal_email_log here so the two stay consistent with each other and
  // with what send-lifecycle-emails (the server-side reconciliation job,
  // Phase 3) writes when it's the one that ends up sending instead.
  function logEmailSent(emailType) {
    if (!member) return;
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
        logEmailSent('first_question_completed');
      }
    }

    var score = computeReadiness();
    [25, 50, 75, 90].forEach(function (threshold) {
      var key = 'readiness_' + threshold;
      if (score >= threshold && !loggedEventTypes[key]) {
        logEventOnce(key);
        sendPortalEmail(member.email, score + '% Checkride Ready', emailTemplateMilestone(threshold));
        logEmailSent(key);
      }
    });

    if (checkrideModeDone && !loggedEventTypes['checkride_mode_completed_email']) {
      logEventOnce('checkride_mode_completed_email');
      sendPortalEmail(member.email, 'Checkride Mode: complete', emailTemplateCheckrideModeDone());
      logEmailSent('checkride_mode_completed_email');
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
     MEMBERSHIP + BILLING HISTORY (Account Management)
     ══════════════════════════════════════════════════════════════ */
  function formatCents(cents) {
    return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function renderMembership() {
    var planEl = document.getElementById('membershipPlan');
    var unlockedRow = document.getElementById('membershipUnlockedRow');
    var unlockedDateEl = document.getElementById('membershipUnlockedDate');

    if (member.checkridePrepUnlocked && myPurchase) {
      var tierLabel = myPurchase.tier === 'founding' ? 'Unlocked (Founding Pricing)' : 'Unlocked';
      planEl.textContent = tierLabel + ' — ' + formatCents(myPurchase.amount_cents);
      unlockedRow.hidden = false;
      unlockedDateEl.textContent = new Date(myPurchase.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } else if (member.checkridePrepUnlocked) {
      planEl.textContent = 'Unlocked';
      unlockedRow.hidden = true;
    } else {
      planEl.textContent = 'Not yet unlocked';
      unlockedRow.hidden = true;
    }
  }

  function renderBillingHistory() {
    var listEl = document.getElementById('billingHistoryList');
    var emptyEl = document.getElementById('billingHistoryEmpty');
    if (!myInvoices.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = myInvoices.map(function (inv) {
      var date = inv.issued_at ? new Date(inv.issued_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
      return '<div class="portal-billing-row">' +
        '<div><div class="portal-billing-row__desc">' + (inv.description || 'Charge') + '</div><div class="portal-billing-row__date">' + date + '</div></div>' +
        '<div><div class="portal-billing-row__amount">' + formatCents(inv.amount_cents) + '</div><span class="portal-billing-row__status portal-billing-row__status--' + inv.status + '">' + inv.status + '</span></div>' +
        '</div>';
    }).join('');
  }

  // Phase 6: student-facing "My Sessions" -- ground_registrations.profile_id
  // is populated by the Stripe webhook (or an admin's manual add), but
  // nothing surfaced it back to the member; "Students can view their own
  // registrations" (supabase-portal-schema-v6.sql) already made this
  // readable, it just had no UI. Sorted by session date descending so the
  // next upcoming session (or the most recent past one) shows first.
  var SESSION_STATUS_LABEL = { registered: 'Registered', checked_in: 'Checked In', completed: 'Attended', no_show: 'No Show' };
  function renderMySessions() {
    var listEl = document.getElementById('mySessionsList');
    var emptyEl = document.getElementById('mySessionsEmpty');
    var rows = myGroundRegistrations.filter(function (r) { return r.session; })
      .sort(function (a, b) { return new Date(b.session.scheduled_at) - new Date(a.session.scheduled_at); });
    if (!rows.length) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';
    listEl.innerHTML = rows.map(function (r) {
      var s = r.session;
      var date = new Date(s.scheduled_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      var statusKey = r.is_waitlisted ? 'waitlisted' : (r.attendance_status || 'registered');
      var statusLabel = r.is_waitlisted ? 'Waitlisted' : (SESSION_STATUS_LABEL[r.attendance_status] || 'Registered');
      return '<div class="portal-session-row">' +
        '<div><div class="portal-session-row__title">' + s.title + '</div><div class="portal-session-row__meta">' + date + (s.location ? ' · ' + s.location : '') + '</div></div>' +
        '<span class="portal-session-row__status portal-session-row__status--' + statusKey + '">' + statusLabel + '</span>' +
      '</div>';
    }).join('');
  }

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
      renderStaffIfApplicable();
      renderAdminIfApplicable();
      enforceAdminPreviewAccess();
      renderCheckrideCountdown();
      renderMembership();
      renderBillingHistory();
      renderMySessions();
      ensureReferralCode();
      renderPassedBanner();
      renderSuccessWall();
      checkWeakAreaEmail();
    });
  }
})();
