(function () {
  'use strict';

  /* ── Meta Pixel Purchase event — Checkride Prep Pack unlock ─────
     Fires when an already-registered member completes the dashboard
     "Unlock Now" checkout (create-checkout-session's success_url for
     purpose 'unlock-checkride-prep' redirects here as ?unlocked=1).
     session_id comes from that same success_url; the localStorage guard
     keyed on it stops a page refresh from double-counting the same sale.
     Independent of the auth guard below since it only needs the URL, not
     the signed-in member.

     amount_cents (also on that URL) is the price *quoted* when checkout
     started -- since Stripe Promotion Codes were added, that's no longer
     guaranteed to be what was actually charged, so it's only used as a
     last-resort fallback if the real amount can't be fetched. The real,
     post-discount amount lives in portal_access_purchases (written by
     stripe-webhook from session.amount_total), fetched here via
     get_checkout_session_amount() -- a public RPC (see
     supabase-portal-schema-v55.sql) rather than a direct table select,
     since this IIFE intentionally doesn't wait for a signed-in session. */
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('unlocked') !== '1') return;
    var sessionId = params.get('session_id');
    var quotedAmountCents = parseInt(params.get('amount_cents'), 10);

    function fireTracking(amountCents) {
      var value = isNaN(amountCents) ? 29 : amountCents / 100;
      var dedupeKey = sessionId ? 'apex_fbq_purchase_' + sessionId : null;
      if (window.fbq && (!dedupeKey || !localStorage.getItem(dedupeKey))) {
        fbq('track', 'Purchase', { value: value, currency: 'USD', content_name: 'Checkride Prep Pack' });
        if (dedupeKey) localStorage.setItem(dedupeKey, '1');
      }
      // purchase_completed funnel event -- same dedupe guard as the fbq
      // call above (a page refresh on ?unlocked=1 must not double-log).
      var funnelDedupeKey = sessionId ? 'apex_funnel_purchase_' + sessionId : null;
      if (window.apexTrack && (!funnelDedupeKey || !localStorage.getItem(funnelDedupeKey))) {
        apexTrack('purchase_completed', { product: 'checkride_prep', price: value });
        if (funnelDedupeKey) localStorage.setItem(funnelDedupeKey, '1');
      }
    }

    if (sessionId) {
      apexSupabase.rpc('get_checkout_session_amount', { p_stripe_session_id: sessionId }).then(function (res) {
        fireTracking(res && !res.error && typeof res.data === 'number' ? res.data : quotedAmountCents);
      }).catch(function () { fireTracking(quotedAmountCents); });
    } else {
      fireTracking(quotedAmountCents);
    }
  })();

  /* ── Meta Pixel Purchase event — Apex Advantage Membership ───────
     Same dedupe-by-session_id pattern as the Checkride Prep block
     above, for the separate ?membership=1 success_url (join-membership
     purpose, create-checkout-session). */
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('membership') !== '1') return;
    var sessionId = params.get('session_id');
    var tier = params.get('tier') || 'monthly';
    var amountCents = parseInt(params.get('amount_cents'), 10);
    var dedupeKey = sessionId ? 'apex_fbq_membership_' + sessionId : null;
    if (window.fbq && (!dedupeKey || !localStorage.getItem(dedupeKey))) {
      fbq('track', 'Purchase', {
        value: isNaN(amountCents) ? 19 : amountCents / 100,
        currency: 'USD',
        content_name: 'Apex Advantage Membership (' + tier + ')',
      });
      if (dedupeKey) localStorage.setItem(dedupeKey, '1');
    }
    var funnelDedupeKey = sessionId ? 'apex_funnel_membership_' + sessionId : null;
    if (window.apexTrack && (!funnelDedupeKey || !localStorage.getItem(funnelDedupeKey))) {
      apexTrack('purchase_completed', { product: 'membership', tier: tier, price: isNaN(amountCents) ? 19 : amountCents / 100 });
      if (funnelDedupeKey) localStorage.setItem(funnelDedupeKey, '1');
    }
  })();

  /* ── Meta Pixel Purchase event — Private Pilot Ground School pack ─
     Same dedupe-by-session_id pattern as the blocks above, for the
     separate ?groundschoolpack=1 success_url (unlock-ground-school-pack
     purpose, create-checkout-session). Flat $400 with no discount path
     (no allow_promotion_codes on this product), so unlike Checkride
     Prep's tracking the quoted amount_cents on the URL is always the
     real charged amount -- no need for get_checkout_session_amount()'s
     lookup, which only covers portal_access_purchases (Checkride Prep)
     anyway and would never resolve this product's session id. */
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('groundschoolpack') !== '1') return;
    var sessionId = params.get('session_id');
    var amountCents = parseInt(params.get('amount_cents'), 10);
    var value = isNaN(amountCents) ? 400 : amountCents / 100;
    var dedupeKey = sessionId ? 'apex_fbq_groundschoolpack_' + sessionId : null;
    if (window.fbq && (!dedupeKey || !localStorage.getItem(dedupeKey))) {
      fbq('track', 'Purchase', { value: value, currency: 'USD', content_name: 'Private Pilot Ground School — Full Course' });
      if (dedupeKey) localStorage.setItem(dedupeKey, '1');
    }
    var funnelDedupeKey = sessionId ? 'apex_funnel_groundschoolpack_' + sessionId : null;
    if (window.apexTrack && (!funnelDedupeKey || !localStorage.getItem(funnelDedupeKey))) {
      apexTrack('purchase_completed', { product: 'ground_school_pack', price: value });
      if (funnelDedupeKey) localStorage.setItem(funnelDedupeKey, '1');
    }
  })();

  /* ── New Member Activation email click tracking ───────────────
     activation_email_N_sent is logged server-side (create-free-account
     and send-lifecycle-emails' processNewMemberActivation both write
     directly to analytics_events, same pattern as checkout_abandoned).
     This is the _clicked half of that funnel -- fires once per page load
     whenever the arriving URL still carries the utm_campaign=
     new_member_activation marker, whether that's a direct hit (member
     already had a session) or the tail end of a logged-out round trip
     through portal-login.html/portal-reset-password.html, both of which
     now forward these same UTM params rather than dropping them (see
     portalDestUrl() and portal-reset-password.html's reset handler).
     Independent of the auth guard below, same reasoning as the Purchase-
     tracking IIFEs above: this only needs the URL, not a signed-in
     session, and must still fire even if this exact load is the one that
     gets bounced to login. */
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('utm_campaign') !== 'new_member_activation') return;
    var content = params.get('utm_content') || '';
    var match = /^welcome_([1-4])$/.exec(content);
    if (!match || !window.apexTrack) return;
    apexTrack('activation_email_' + match[1] + '_clicked', {});
  })();

  /* ── Auth guard — real Supabase session + profile ────────────── */
  var member = null;
  var accessToken = null;
  var authReady = apexSupabase.auth.getSession().then(function (res) {
    var session = res.data.session;
    if (!session) {
      // Preserve intended destination through the login round-trip, for
      // two cases: ?upgrade=checkride-prep (the member-upgrade email/
      // retargeting deep link) and a plain #hash (every other lifecycle/
      // activation email links straight to portal.html#<section>, e.g.
      // #dpe-library, #ground-school -- previously dropped entirely on a
      // logged-out visit, silently bouncing to a bare login form with no
      // memory of what the visitor actually clicked). portal-login.html's
      // existing dest= param already maps a bare slug to a #hash on
      // return (portalDestUrl()), and #checkride-prep already bounces a
      // locked member into the unlock modal via the GATED_SECTIONS check
      // in showSection() below -- so reusing dest here needs no changes
      // to the login page itself. UTMs are forwarded too (portalDestUrl()
      // carries them the rest of the way back), so an email click's
      // attribution survives even when the recipient wasn't already
      // signed in.
      var deepLinkParams = new URLSearchParams(window.location.search);
      var loginUrl = 'portal-login.html';
      var loginQs = [];
      if (deepLinkParams.get('upgrade') === 'checkride-prep') {
        loginQs.push('dest=checkride-prep');
      } else if (deepLinkParams.get('registered') === '1') {
        // GS -> Portal Growth Funnel, section 3 -- an anonymous $25 Ground
        // School purchaser (checkout never requires an account) landing
        // here with no session used to lose every bit of purchase context
        // right at this point: only dest/UTMs forwarded below, silently
        // dropping registered=1, amount_cents, class_title/class_when,
        // email, and name. Forwarding them lets portal-login.html show
        // real "You're booked for X on Y" copy and a prefilled signup
        // form instead of a bare, contextless login screen.
        loginQs.push('dest=ground-school', 'registered=1');
        ['amount_cents', 'class_title', 'class_when', 'email', 'name'].forEach(function (k) {
          if (deepLinkParams.has(k)) loginQs.push(k + '=' + encodeURIComponent(deepLinkParams.get(k)));
        });
      } else if (window.location.hash) {
        var hashDest = window.location.hash.slice(1);
        if (/^[a-z0-9-]{1,60}$/.test(hashDest)) loginQs.push('dest=' + hashDest);
      }
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach(function (k) {
        if (deepLinkParams.has(k)) loginQs.push(k + '=' + encodeURIComponent(deepLinkParams.get(k)));
      });
      if (loginQs.length) loginUrl += '?' + loginQs.join('&');
      window.location.href = loginUrl;
      return Promise.reject('no-session');
    }
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
        checkridePrepUnlocked: !!(profile && profile.checkride_prep_unlocked),
        groundSchoolPackUnlocked: !!(profile && profile.private_pilot_ground_school_pack_unlocked),
        checkrideTiming: profile && profile.checkride_timing,
        trainingStage: profile && profile.training_stage,
        currentRating: (profile && profile.current_rating) || 'private',
        nextRatingInterest: profile && profile.next_rating_interest,
        totalXp: (profile && profile.total_xp) || 0,
        currentRank: (profile && profile.current_rank) || 'student_pilot',
        streakFreezesBanked: (profile && profile.streak_freezes_banked) || 0,
        hasMembership: false
      };
      populateMember();
      applyUnlockState();
      applyUnlockPricing();
      // Fire-and-forget: feeds the 7-day inactivity nudge
      // (send-lifecycle-emails, Phase 3) a real "last seen" signal.
      // Once per page load is enough — this isn't a click-tracking beacon.
      apexSupabase.from('profiles').update({ portal_last_active_at: new Date().toISOString() }).eq('id', member.id);
      // Server-authoritative XP for opening today's Dispatch (+5, once
      // per member-local day -- see log_daily_dispatch_open() in
      // supabase-portal-schema-v47.sql). Fire-and-forget, same as above;
      // a failure here should never block the portal from loading.
      apexSupabase.rpc('log_daily_dispatch_open').then(function (res) {
        if (res && res.error) console.warn('log_daily_dispatch_open failed:', res.error);
      });
      return Promise.all([loadPremiumContent(), loadMembershipCapability()]).then(function () {
        return initPortalData();
      });
    });
  }).catch(function (e) { if (e !== 'no-session') console.error(e); });

  /* ── Membership capability check — for gating Membership-exclusive
     sections (Ask Andrew) client-side. Same "UI convenience, not the
     security boundary" caveat as loadPremiumContent below: the real
     enforcement is ai-cfi-chat's requireCapability() check against
     get_member_capabilities() server-side (supabase-portal-schema-v51/
     v53.sql). Admins always pass client-side too, matching every other
     gated section in this file. */
  function loadMembershipCapability() {
    if (member.role === 'admin') { member.hasMembership = true; return Promise.resolve(); }
    return apexSupabase.rpc('member_has_active_membership', { p_profile_id: member.id }).then(function (res) {
      member.hasMembership = !!(res && res.data);
    }).catch(function () { member.hasMembership = false; });
  }

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
        SCENARIOS.push({ id: 'scenario-' + q.id, sourceId: q.id, category: q.section, tag: q.sectionLabel, title: q.q, brief: q.application, model: q.model, mistakes: q.mistakes, evaluating: q.evaluating, acs: q.acs });
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
      // computeQotdQuestion() now runs once, in initPortalData() below,
      // after this and loadMembershipCapability() have both resolved --
      // no need to pre-populate it here too.
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

  var GATED_SECTIONS = ['checkride-prep', 'dpe-library', 'ai-dpe-practice', 'scenarios', 'progress', 'vault', 'missions', 'pilot-journey'];

  function showSection(id) {
    if (!document.getElementById('section-' + id)) id = 'dashboard';
    if (member && !member.checkridePrepUnlocked && GATED_SECTIONS.indexOf(id) !== -1) {
      closeSidebar();
      openUnlockModal();
      return;
    }
    // Guided Notes is an admin-only feature preview -- not just hidden from
    // the nav. A non-admin who already has member.role loaded (e.g. clicked
    // a stale link, or called this from the console) gets bounced to the
    // dashboard instead of ever seeing the section become active. The other
    // half of this guard is enforceGuidedNotesAccess(), which catches the
    // same case on first page load, before member.role is known yet.
    if (id === 'guided-notes' && member && member.role !== 'admin') id = 'dashboard';
    // Apex Advantage Membership isn't public yet -- admin-only preview.
    if (id === 'ask-andrew' && member && member.role !== 'admin') id = 'dashboard';
    sections.forEach(function (s) { s.classList.toggle('active', s.id === 'section-' + id); });
    navItems.forEach(function (b) { b.classList.toggle('active', b.dataset.section === id); });
    window.scrollTo(0, 0);
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    closeSidebar();
    if (!member) return;
    runSectionEnterEffects(id);
  }
  window.apexShowSection = showSection;

  // The per-section on-enter side effects (data loads + analytics), split
  // out of showSection() so initPortalData() can replay them below.
  // showSection(initial) at script init (further down) always runs
  // synchronously, before authReady's .then() has had a chance to run even
  // one microtask -- so `member` is unconditionally undefined on that very
  // first call, for every section, every load. Landing directly on a
  // non-dashboard hash (a reload, a bookmark, a shared link -- anything
  // that isn't a fresh in-app nav click) always hit the `!member` guard
  // above and silently skipped this block, e.g. Ground School staying on
  // "Loading sessions..." forever with no retry. initPortalData() runs
  // once member is actually loaded, so replaying this there for whatever
  // section the URL hash says is active is the real first execution --
  // never a duplicate, since the guarded call above never got this far.
  function runSectionEnterEffects(id) {
    if (id === 'admin' && member.role === 'admin') loadAdminDashboard();
    if (id === 'guided-notes' && member.role === 'admin') loadGuidedNotes();
    if (id === 'success-wall') renderSuccessWall();
    if (id === 'ground-school') {
      loadGroundSchool();
      logEventOnce('ground_school_calendar_viewed');
      if (window.apexTrack) apexTrack('product_preview_viewed', { product: 'ground_school' });
    }
    if (id === 'checkride-prep') {
      logEventOnce('checkride_prep_viewed');
      if (window.apexTrack) apexTrack('product_preview_viewed', { product: 'checkride_prep' });
      if (window.apexTrackStandard) apexTrackStandard('ViewContent', { content_name: 'Checkride Prep Pack' });
    }
    if (id === 'ai-dpe-practice' && window.apexTrack) apexTrack('first_lesson_started', { profile_id: member.id, feature: 'ai_dpe_practice' });
    if (id === 'ask-andrew') loadAskAndrewHistory();
  }

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
    document.querySelectorAll('.portal-nav__item[data-gated="true"] [data-lock-icon]').forEach(function (el) {
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
  // Aug 31, 2026 Early Access campaign (supabase-portal-schema-v66.sql):
  // get_checkride_prep_pricing() now returns the same real calendar
  // deadline in launch_expires_at for both the founding and launch
  // tiers (previously null for founding, since that tier used to be
  // purely seat-capped) -- so both get one consistent date-based label
  // here instead of the old "X founding spots left"/"X hours left"
  // copy, which no longer matches how the deadline actually works.
  function earlyAccessDeadlineLabel(expiresAt) {
    var d = expiresAt ? new Date(expiresAt) : null;
    if (!d || isNaN(d.getTime())) return 'soon';
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/New_York' });
  }

  function applyUnlockPricing() {
    if (member && member.checkridePrepUnlocked) return;
    apexSupabase.rpc('get_checkride_prep_pricing', { p_profile_id: member ? member.id : null }).then(function (res) {
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
        modalNote.textContent = row.tier === 'standard'
          ? 'Early Access pricing has ended — $49 for full access'
          : 'Early Access pricing — ends ' + earlyAccessDeadlineLabel(row.launch_expires_at) + ', then $49';
      }
      // Every "Unlock the Complete Prep Pack" CTA across the free guide
      // pages and the Free Resources hub (site/portal.html) mirrors the
      // same live price/urgency rather than a static "$29" hardcoded per
      // copy of the button.
      document.querySelectorAll('.portal-live-price').forEach(function (el) {
        el.textContent = row.tier === 'standard' ? priceLabel : priceLabel + ' — Early Access';
      });
    }).catch(function (e) { console.error('applyUnlockPricing failed', e); });
  }

  function lockedWidgetName(el) {
    var card = el.closest('[data-locked-widget]');
    return (card && card.dataset.widget) || 'unknown';
  }

  document.querySelectorAll('[data-unlock-trigger]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      if (window.apexTrack) apexTrack('upgrade_prompt_clicked', { widget: lockedWidgetName(el) });
      openUnlockModal();
    });
  });

  // upgrade_prompt_viewed -- fires once per widget the first time its
  // overlay actually scrolls into view. An unlocked widget's overlay is
  // display:none (see applyUnlockState above) and never intersects, so
  // this naturally only counts free members actually seeing the prompt.
  if (window.apexTrack && window.IntersectionObserver) {
    var upgradePromptSeen = {};
    var upgradePromptObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var widget = lockedWidgetName(entry.target);
        if (upgradePromptSeen[widget]) return;
        upgradePromptSeen[widget] = true;
        apexTrack('upgrade_prompt_viewed', { widget: widget });
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-unlock-trigger]').forEach(function (el) { upgradePromptObserver.observe(el); });
  }

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
      body: { purpose: 'unlock-checkride-prep', origin: window.location.origin, utm: window.apexGetUtm ? apexGetUtm() : undefined },
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
      if (window.apexTrackStandard) apexTrackStandard('InitiateCheckout', { content_name: 'Checkride Prep Pack' });
      window.location.href = res.data.url;
    }).catch(function () {
      unlockModalCta.disabled = false;
      unlockModalCta.textContent = 'Unlock Now';
      unlockModalError.textContent = 'Could not start checkout. Please try again.';
      unlockModalError.classList.add('show');
    });
  });

  /* ── Mock Oral booking ──────────────────────────────────────── */
  var mockOralBookBtn = document.getElementById('mockOralBookBtn');
  var mockOralError = document.getElementById('mockOralError');

  mockOralBookBtn.addEventListener('click', function () {
    mockOralError.classList.remove('show');
    mockOralBookBtn.disabled = true;
    mockOralBookBtn.textContent = 'Redirecting to secure checkout…';

    apexSupabase.functions.invoke('create-checkout-session', {
      body: { purpose: 'book-mock-oral', origin: window.location.origin, utm: window.apexGetUtm ? apexGetUtm() : undefined },
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) {
      if (res.error || !res.data || !res.data.url) {
        return extractInvokeError(res).then(function (msg) {
          mockOralBookBtn.disabled = false;
          mockOralBookBtn.textContent = 'Book Now — $99';
          mockOralError.textContent = msg;
          mockOralError.classList.add('show');
        });
      }
      if (window.apexTrackStandard) apexTrackStandard('InitiateCheckout', { content_name: '60-Minute Mock Oral', value: 99, currency: 'USD' });
      window.location.href = res.data.url;
    }).catch(function () {
      mockOralBookBtn.disabled = false;
      mockOralBookBtn.textContent = 'Book Now — $99';
      mockOralError.textContent = 'Could not start checkout. Please try again.';
      mockOralError.classList.add('show');
    });
  });

  /* ── AI DPE Practice (simulated oral exam) ─────────────────────
     Chat client for the dpe-chat Edge Function. The function itself
     owns all exam logic (question sequencing, follow-ups, the
     debrief) via a Claude call per turn -- this is just render +
     transport. Every response is the same shape regardless of action
     (start/message/end): {sessionId, phase, message, debrief,
     questionsAsked, status}, so one handleTurn() covers all three. */
  (function () {
    var startCard = document.getElementById('aiDpeStart');
    if (!startCard) return; // section not present on this page

    var startBtn = document.getElementById('aiDpeStartBtn');
    var startError = document.getElementById('aiDpeStartError');
    var chatEl = document.getElementById('aiDpeChat');
    var messagesEl = document.getElementById('aiDpeMessages');
    var typingEl = document.getElementById('aiDpeTyping');
    var formEl = document.getElementById('aiDpeForm');
    var inputEl = document.getElementById('aiDpeInput');
    var sendBtn = document.getElementById('aiDpeSendBtn');
    var endBtn = document.getElementById('aiDpeEndBtn');
    var debriefEl = document.getElementById('aiDpeDebrief');

    var sessionId = null;
    var busy = false;

    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str == null ? '' : String(str);
      return div.innerHTML;
    }

    function addBubble(role, text) {
      var bubble = document.createElement('div');
      bubble.className = 'portal-chat__bubble portal-chat__bubble--' + role;
      bubble.textContent = text;
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setBusy(isBusy) {
      busy = isBusy;
      typingEl.hidden = !isBusy;
      inputEl.disabled = isBusy;
      sendBtn.disabled = isBusy;
      endBtn.disabled = isBusy;
      if (isBusy) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function verdictLabel(v) {
      return v === 'ready' ? 'Ready for Checkride' : v === 'not_yet' ? 'Not Yet — Keep Practicing' : 'Almost There';
    }

    function renderDebrief(debrief) {
      chatEl.hidden = true;
      debriefEl.hidden = false;
      var badgeClass = 'portal-debrief__badge--' + (debrief.overallReadiness || 'almost');
      var strengths = (debrief.strengths || []).map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');
      var weaknesses = (debrief.weaknesses || []).map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');
      var domains = (debrief.perDomain || []).map(function (d) {
        return '<div class="portal-debrief__domain"><span>' + escapeHtml(d.domain) + ' — ' + escapeHtml(d.note) + '</span>' +
          '<span class="portal-debrief__domain-verdict portal-debrief__domain-verdict--' + escapeHtml(d.verdict) + '">' + escapeHtml(d.verdict) + '</span></div>';
      }).join('');
      debriefEl.innerHTML =
        '<span class="portal-debrief__badge ' + badgeClass + '">' + verdictLabel(debrief.overallReadiness) + '</span>' +
        '<p class="portal-debrief__summary">' + escapeHtml(debrief.summary || '') + '</p>' +
        '<div class="portal-debrief__cols">' +
          '<div><h4 style="color:#fff;font-size:14px;font-weight:700">Strengths</h4><ul class="portal-debrief__list">' + (strengths || '<li>—</li>') + '</ul></div>' +
          '<div><h4 style="color:#fff;font-size:14px;font-weight:700">Focus Areas</h4><ul class="portal-debrief__list">' + (weaknesses || '<li>—</li>') + '</ul></div>' +
        '</div>' +
        (domains ? '<h4 style="color:#fff;font-size:14px;font-weight:700;margin-bottom:10px">By ACS Area</h4>' + domains : '') +
        '<div class="portal-debrief__actions">' +
          '<button class="btn btn--primary" id="aiDpeAgainBtn">Practice Again</button>' +
          '<button class="btn btn--ghost" data-goto="dpe-library" type="button">Review DPE Questions Library</button>' +
        '</div>';
      document.getElementById('aiDpeAgainBtn').addEventListener('click', resetToStart);
      debriefEl.querySelectorAll('[data-goto]').forEach(function (el) {
        el.addEventListener('click', function () { window.apexShowSection(el.dataset.goto); });
      });
    }

    function resetToStart() {
      sessionId = null;
      messagesEl.innerHTML = '';
      debriefEl.hidden = true;
      debriefEl.innerHTML = '';
      chatEl.hidden = true;
      startCard.hidden = false;
      startBtn.disabled = false;
      startBtn.textContent = 'Start Practice Oral Exam';
    }

    function handleTurn(res) {
      setBusy(false);
      var data = res.data;
      sessionId = data.sessionId;
      addBubble('dpe', data.message);
      if (data.phase === 'debrief' || data.status === 'completed') {
        renderDebrief(data.debrief || {});
      }
    }

    startBtn.addEventListener('click', function () {
      startError.classList.remove('show');
      startBtn.disabled = true;
      startBtn.textContent = 'Starting…';

      apexSupabase.functions.invoke('dpe-chat', {
        body: { action: 'start' },
        headers: { Authorization: 'Bearer ' + accessToken }
      }).then(function (res) {
        if (res.error || !res.data || res.data.error) {
          return extractInvokeError(res).then(function (msg) {
            startBtn.disabled = false;
            startBtn.textContent = 'Start Practice Oral Exam';
            startError.textContent = msg;
            startError.classList.add('show');
          });
        }
        startCard.hidden = true;
        chatEl.hidden = false;
        messagesEl.innerHTML = '';
        handleTurn(res);
        inputEl.focus();
      }).catch(function () {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Practice Oral Exam';
        startError.textContent = 'Could not start your session. Please try again.';
        startError.classList.add('show');
      });
    });

    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy || !sessionId) return;
      var text = inputEl.value.trim();
      if (!text) return;
      addBubble('student', text);
      inputEl.value = '';
      setBusy(true);

      apexSupabase.functions.invoke('dpe-chat', {
        body: { action: 'message', sessionId: sessionId, message: text },
        headers: { Authorization: 'Bearer ' + accessToken }
      }).then(function (res) {
        if (res.error || !res.data || res.data.error) {
          setBusy(false);
          return extractInvokeError(res).then(function (msg) { addBubble('dpe', 'Sorry — something went wrong on my end: ' + msg); });
        }
        handleTurn(res);
      }).catch(function () {
        setBusy(false);
        addBubble('dpe', 'Sorry — something went wrong on my end. Please try again.');
      });
    });

    endBtn.addEventListener('click', function () {
      if (busy || !sessionId) return;
      setBusy(true);

      apexSupabase.functions.invoke('dpe-chat', {
        body: { action: 'end', sessionId: sessionId },
        headers: { Authorization: 'Bearer ' + accessToken }
      }).then(function (res) {
        if (res.error || !res.data || res.data.error) {
          setBusy(false);
          return extractInvokeError(res).then(function (msg) { addBubble('dpe', 'Sorry — something went wrong on my end: ' + msg); });
        }
        handleTurn(res);
      }).catch(function () {
        setBusy(false);
        addBubble('dpe', 'Sorry — something went wrong ending the session. Please try again.');
      });
    });
  })();

  /* ── Ask Andrew (AI Flight Instructor) ─────────────────────────
     One continuous thread per member (unlike AI DPE Practice's bounded,
     restartable sessions above) -- ai-cfi-chat/index.ts owns all writes
     to ai_cfi_messages; this code only reads history directly (RLS
     select-own) and calls the function to send/receive a turn.
     Gated by member.hasMembership client-side (loadMembershipCapability
     above); the real enforcement is ai-cfi-chat's requireCapability()
     check server-side. */
  var askAndrewLoaded = false;
  var askAndrewBusy = false;

  function addAskAndrewBubble(role, text) {
    var messagesEl = document.getElementById('askAndrewMessages');
    if (!messagesEl) return;
    var bubble = document.createElement('div');
    bubble.className = 'portal-chat__bubble portal-chat__bubble--' + role;
    bubble.textContent = text;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function setAskAndrewBusy(isBusy) {
    askAndrewBusy = isBusy;
    var typingEl = document.getElementById('askAndrewTyping');
    var inputEl = document.getElementById('askAndrewInput');
    var sendBtn = document.getElementById('askAndrewSendBtn');
    if (typingEl) typingEl.hidden = !isBusy;
    if (inputEl) inputEl.disabled = isBusy;
    if (sendBtn) sendBtn.disabled = isBusy;
    var messagesEl = document.getElementById('askAndrewMessages');
    if (isBusy && messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function loadAskAndrewHistory() {
    if (askAndrewLoaded || !member || !member.hasMembership) return;
    askAndrewLoaded = true;
    apexSupabase.from('ai_cfi_messages').select('role, content').eq('profile_id', member.id)
      .order('created_at', { ascending: true }).limit(200).then(function (res) {
        var messagesEl = document.getElementById('askAndrewMessages');
        if (!messagesEl) return;
        if (!res.data || !res.data.length) {
          messagesEl.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px">Ask anything — regulations, procedures, checkride prep, career questions. Nothing to see yet, so ask your first question below.</p>';
          return;
        }
        messagesEl.innerHTML = '';
        res.data.forEach(function (m) { addAskAndrewBubble(m.role, m.content); });
      });
  }

  var askAndrewForm = document.getElementById('askAndrewForm');
  if (askAndrewForm) {
    askAndrewForm.addEventListener('submit', function (e) {
      e.preventDefault();
      if (askAndrewBusy) return;
      var inputEl = document.getElementById('askAndrewInput');
      var errorEl = document.getElementById('askAndrewError');
      var text = inputEl.value.trim();
      if (!text) return;
      if (errorEl) errorEl.classList.remove('show');
      var messagesEl = document.getElementById('askAndrewMessages');
      if (messagesEl && messagesEl.querySelector('p')) messagesEl.innerHTML = '';
      addAskAndrewBubble('user', text);
      inputEl.value = '';
      setAskAndrewBusy(true);

      apexSupabase.functions.invoke('ai-cfi-chat', {
        body: { message: text },
        headers: { Authorization: 'Bearer ' + accessToken }
      }).then(function (res) {
        setAskAndrewBusy(false);
        if (res.error || !res.data || res.data.error) {
          return extractInvokeError(res).then(function (msg) {
            if (errorEl) { errorEl.textContent = msg; errorEl.classList.add('show'); }
          });
        }
        addAskAndrewBubble('assistant', res.data.message);
      }).catch(function () {
        setAskAndrewBusy(false);
        if (errorEl) { errorEl.textContent = 'Could not send that. Please try again.'; errorEl.classList.add('show'); }
      });
    });
  }

  /* ── Ground School Scheduling ───────────────────────────────── */
  var groundSchoolLoaded = false;
  var activeGroundSession = null;

  // Admin scheduling only offers 5 fixed IANA zones (AdminGroundSchoolSchedule.jsx
  // TIME_ZONES) -- scheduled_ground_classes.class_date/start_time are a wall-clock
  // time IN THAT ZONE, not the viewer's local zone. `new Date(class_date+'T'+
  // start_time)` silently parses that wall-clock string as if it were already in
  // the browser's own timezone, which is only correct for a Central-time viewer.
  // This converts a wall-clock date/time + IANA zone into the real UTC instant by
  // asking what that same instant looks like in the target zone vs. UTC and
  // correcting for the difference -- handles each zone's own DST rules correctly
  // since toLocaleString reflects the actual offset in effect on that date.
  function tzOffsetMs(instant, timeZone) {
    var parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(instant).forEach(function (p) { parts[p.type] = p.value; });
    var asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - instant.getTime();
  }

  // Converts a class's wall-clock date/time + IANA zone (scheduled_ground_
  // classes.timezone) into the real UTC instant. A single offset guess can
  // land on the wrong side of a DST transition, so this takes a second pass
  // using the first guess's instant to re-derive the offset -- only matters
  // for the ~1hr/year transition window, but it's free to get right.
  function zonedWallClockToUtc(dateStr, timeStr, timeZone) {
    var naiveUtc = new Date(dateStr + 'T' + timeStr + 'Z');
    if (!timeZone) return naiveUtc;
    var guess = new Date(naiveUtc.getTime() - tzOffsetMs(naiveUtc, timeZone));
    return new Date(naiveUtc.getTime() - tzOffsetMs(guess, timeZone));
  }

  function fmtSessionDate(iso) {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  var groundSchoolSessions = [];
  var groundSchoolView = 'cards';
  var groundSchoolCalMonth = new Date();
  var groundSchoolWeekStart = (function () {
    var d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  function loadGroundSchool() {
    if (groundSchoolLoaded) return Promise.resolve();
    groundSchoolLoaded = true;
    var today = new Date().toISOString().slice(0, 10);

    return Promise.all([
      apexSupabase.from('ground_sessions')
        .select('*')
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at'),
      // Admin-scheduled Private Pilot curriculum classes
      // (supabase-portal-schema-v15.sql/v17.sql) -- a separate table from
      // the legacy ground_sessions above, with its own capacity/enrolled
      // tracking maintained server-side by confirm_scheduled_ground_class_
      // enrollment() (v17), so no join/count needed here the way the
      // legacy path needs ground_registrations.
      apexSupabase.from('scheduled_ground_classes')
        .select('*')
        .eq('status', 'published')
        .gte('class_date', today)
        .order('class_date')
        .order('start_time'),
      // Real per-session confirmed counts (v63) -- NOT the embedded
      // `ground_registrations(id, is_waitlisted)` select this used to
      // use, which silently returned only the CALLER's own row (RLS on
      // the embedded table), making every member see a confirmed-count
      // of 0 or 1 regardless of the real headcount.
      apexSupabase.rpc('get_legacy_ground_session_confirmed_counts')
    ]).then(function (results) {
      var confirmedCounts = {};
      (results[2].data || []).forEach(function (row) { confirmedCounts[row.session_id] = row.confirmed_count; });

      var legacy = (results[0].data || []).map(function (s) {
        var confirmed = confirmedCounts[s.id] || 0;
        var alreadyRegistered = myGroundRegistrations.some(function (r) {
          return r.session_id === s.id && r.payment_status !== 'refunded' && r.payment_status !== 'canceled';
        });
        return {
          kind: 'legacy',
          id: s.id,
          title: s.title,
          category: s.category || 'General',
          scheduled_at: s.scheduled_at,
          spotsLeft: s.max_students - confirmed,
          alreadyRegistered: alreadyRegistered,
          packCovers: false
        };
      });
      var scheduled = (results[1].data || []).map(function (s) {
        var alreadyRegistered = myScheduledEnrollments.some(function (e) {
          return e.scheduled_ground_class_id === s.id && e.attendance_status !== 'canceled';
        });
        return {
          kind: 'scheduled_class',
          id: s.id,
          courseId: s.course_id,
          title: s.title,
          category: s.module_title || 'Private Pilot',
          // Wall-clock class_date/start_time are in the class's own
          // timezone column, not the viewer's -- convert to a true UTC
          // instant so every render (Cards/Calendar/Week/modal) shows
          // the correct time for whoever is looking at it, not the
          // class's own local time mislabeled as the viewer's.
          scheduled_at: zonedWallClockToUtc(s.class_date, s.start_time, s.timezone).toISOString(),
          spotsLeft: s.capacity - s.enrolled_count,
          alreadyRegistered: alreadyRegistered,
          packCovers: s.course_id === 'PPL' && member && member.groundSchoolPackUnlocked
        };
      });
      groundSchoolSessions = legacy.concat(scheduled).sort(function (a, b) {
        return new Date(a.scheduled_at) - new Date(b.scheduled_at);
      });

      var emptyEl = document.getElementById('groundSchoolEmpty');
      if (!groundSchoolSessions.length) {
        document.getElementById('groundSchoolList').style.display = 'none';
        emptyEl.style.display = 'block';
        return;
      }
      emptyEl.style.display = 'none';
      renderGroundSchoolView(groundSchoolView);
    });
  }

  // Growth Sprint section 12 -- reuses the exact normalize+word-subset
  // matching approach as matchesTopic()/normalizeTopicWords() in
  // site/apex-advantage-private-pilot.html (duplicated per this codebase's
  // established cross-file convention, since that page has no shared
  // module to import from) to find a real upcoming class whose title or
  // module_title covers a member's weakest ACS category.
  var GS_MATCH_STOPWORDS = { and: 1, the: 1, a: 1, of: 1, for: 1, to: 1 };
  function normalizeGsMatchWords(text) {
    return (text || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(function (w) { return w && !GS_MATCH_STOPWORDS[w]; });
  }
  function findGsClassForWeakArea(label) {
    var topicWords = normalizeGsMatchWords(label);
    if (!topicWords.length) return null;
    return groundSchoolSessions.filter(function (s) {
      if (s.alreadyRegistered) return false;
      var haystack = normalizeGsMatchWords((s.category || '') + ' ' + (s.title || ''));
      return topicWords.every(function (w) { return haystack.indexOf(w) !== -1; });
    })[0] || null;
  }

  function renderGroundSchoolView(mode) {
    groundSchoolView = mode;
    var listEl = document.getElementById('groundSchoolList');
    var calEl = document.getElementById('groundSchoolCalendar');
    var weekEl = document.getElementById('groundSchoolWeek');
    listEl.style.display = mode === 'cards' ? 'block' : 'none';
    calEl.style.display = mode === 'calendar' ? 'block' : 'none';
    weekEl.style.display = mode === 'week' ? 'block' : 'none';
    if (mode === 'cards') renderGroundSchoolCards();
    else if (mode === 'calendar') renderGroundSchoolCalendar();
    else renderGroundSchoolWeek();
  }

  document.querySelectorAll('#groundSchoolViewTabs .portal-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('#groundSchoolViewTabs .portal-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      renderGroundSchoolView(tab.dataset.gsView);
    });
  });

  function renderGroundSchoolCards() {
    var listEl = document.getElementById('groundSchoolList');
    listEl.innerHTML = '';
    listEl.className = 'portal-grid portal-grid--2';
    groundSchoolSessions.forEach(function (s) {
      var full = s.spotsLeft <= 0;
      var registerLabel = s.alreadyRegistered ? 'Already Registered' : (s.packCovers ? 'Register — Included in Your Pack' : (full ? 'Join Waitlist — $25' : 'Register — $25'));
      var card = document.createElement('div');
      card.className = 'portal-card';
      card.innerHTML =
        '<div class="portal-header__eyebrow" style="margin-bottom:8px">' + s.category.toUpperCase() + '</div>' +
        '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:6px">' + s.title + '</h3>' +
        '<p style="color:rgba(255,255,255,0.55);font-size:13px;margin-bottom:4px">' + fmtSessionDate(s.scheduled_at) + '</p>' +
        '<p style="color:rgba(255,255,255,0.4);font-size:12px;margin-bottom:16px">' + (full && !s.packCovers ? 'Full — join the waitlist' : s.spotsLeft + ' spot' + (s.spotsLeft === 1 ? '' : 's') + ' left') + '</p>' +
        '<button class="btn btn--primary" data-register style="width:100%"' + (s.alreadyRegistered ? ' disabled' : '') + '>' + registerLabel + '</button>';
      if (!s.alreadyRegistered) card.querySelector('[data-register]').addEventListener('click', function () { openGroundSchoolModal(s); });
      listEl.appendChild(card);
    });
  }

  function renderGroundSchoolCalendar() {
    var calEl = document.getElementById('groundSchoolCalendar');
    var year = groundSchoolCalMonth.getFullYear();
    var month = groundSchoolCalMonth.getMonth();
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var today = new Date();

    function sessionsOnDay(day) {
      return groundSchoolSessions.filter(function (s) {
        var d = new Date(s.scheduled_at);
        return d.getDate() === day && d.getMonth() === month && d.getFullYear() === year;
      });
    }

    var html = '<div class="gs-cal-nav">' +
      '<button type="button" class="gs-cal-nav__btn" id="gsCalPrev">‹</button>' +
      '<span class="gs-cal-nav__label">' + monthNames[month] + ' ' + year + '</span>' +
      '<button type="button" class="gs-cal-nav__btn" id="gsCalNext">›</button>' +
      '</div><div class="gs-calendar"><div class="gs-calendar__header">';
    dayLabels.forEach(function (d) { html += '<div class="gs-calendar__day-label">' + d + '</div>'; });
    html += '</div><div class="gs-calendar__grid">';
    for (var e = 0; e < firstDay; e++) html += '<div class="gs-calendar__cell gs-calendar__cell--empty"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var isToday = today.getDate() === day && today.getMonth() === month && today.getFullYear() === year;
      html += '<div class="gs-calendar__cell' + (isToday ? ' gs-calendar__cell--today' : '') + '">' +
        '<span class="gs-calendar__cell-num">' + day + '</span>';
      sessionsOnDay(day).forEach(function (s) {
        html += '<div class="gs-cal-event" data-gs-event="' + s.id + '">' +
          '<span>' + new Date(s.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + (s.alreadyRegistered ? ' · Registered' : '') + '</span>' +
          '<span>' + s.title + '</span></div>';
      });
      html += '</div>';
    }
    html += '</div></div>';
    calEl.innerHTML = html;

    document.getElementById('gsCalPrev').addEventListener('click', function () {
      groundSchoolCalMonth = new Date(year, month - 1, 1);
      renderGroundSchoolCalendar();
    });
    document.getElementById('gsCalNext').addEventListener('click', function () {
      groundSchoolCalMonth = new Date(year, month + 1, 1);
      renderGroundSchoolCalendar();
    });
    calEl.querySelectorAll('[data-gs-event]').forEach(function (el) {
      el.addEventListener('click', function () {
        var session = groundSchoolSessions.filter(function (s) { return String(s.id) === el.dataset.gsEvent; })[0];
        if (session) openGroundSchoolModal(session);
      });
    });
  }

  function renderGroundSchoolWeek() {
    var weekEl = document.getElementById('groundSchoolWeek');
    var start = groundSchoolWeekStart;
    var end = new Date(start.getTime() + 6 * 86400000);
    var html = '<div class="gs-cal-nav">' +
      '<button type="button" class="gs-cal-nav__btn" id="gsWeekPrev">‹</button>' +
      '<span class="gs-cal-nav__label">' + start.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' – ' + end.toLocaleDateString([], { month: 'short', day: 'numeric' }) + '</span>' +
      '<button type="button" class="gs-cal-nav__btn" id="gsWeekNext">›</button>' +
      '</div><div class="portal-card">';

    for (var i = 0; i < 7; i++) {
      var day = new Date(start.getTime() + i * 86400000);
      var daySessions = groundSchoolSessions.filter(function (s) {
        return new Date(s.scheduled_at).toDateString() === day.toDateString();
      });
      html += '<div class="gs-week-day"><div class="gs-week-day__label">' +
        day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) + '</div>';
      if (!daySessions.length) {
        html += '<p class="gs-week-day__empty">No sessions</p>';
      } else {
        daySessions.forEach(function (s) {
          html += '<div class="gs-week-row">' +
            '<div><span class="gs-week-row__title">' + s.title + '</span>' +
            '<span class="gs-week-row__time">' + new Date(s.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
            '<button type="button" class="btn btn--ghost" data-gs-event="' + s.id + '" style="padding:6px 14px;font-size:12px"' + (s.alreadyRegistered ? ' disabled' : '') + '>' +
            (s.alreadyRegistered ? 'Registered' : (s.spotsLeft <= 0 ? 'Waitlist' : 'Sign Up')) + '</button></div>';
        });
      }
      html += '</div>';
    }
    html += '</div>';
    weekEl.innerHTML = html;

    document.getElementById('gsWeekPrev').addEventListener('click', function () {
      groundSchoolWeekStart = new Date(groundSchoolWeekStart.getTime() - 7 * 86400000);
      renderGroundSchoolWeek();
    });
    document.getElementById('gsWeekNext').addEventListener('click', function () {
      groundSchoolWeekStart = new Date(groundSchoolWeekStart.getTime() + 7 * 86400000);
      renderGroundSchoolWeek();
    });
    weekEl.querySelectorAll('[data-gs-event]').forEach(function (el) {
      el.addEventListener('click', function () {
        var session = groundSchoolSessions.filter(function (s) { return String(s.id) === el.dataset.gsEvent; })[0];
        if (session) openGroundSchoolModal(session);
      });
    });
  }

  var groundSchoolModalOverlay = document.getElementById('groundSchoolModalOverlay');
  var groundSchoolModalTitle = document.getElementById('groundSchoolModalTitle');
  var groundSchoolModalWhen = document.getElementById('groundSchoolModalWhen');
  var groundSchoolModalCta = document.getElementById('groundSchoolModalCta');
  var groundSchoolModalRedeemBtn = document.getElementById('groundSchoolModalRedeemBtn');
  var groundSchoolModalPackBtn = document.getElementById('groundSchoolModalPackBtn');
  var groundSchoolModalError = document.getElementById('groundSchoolModalError');

  function openGroundSchoolModal(s) {
    activeGroundSession = s;
    logEventOnce('ground_school_class_viewed', { class_id: s.id });
    if (window.apexTrack) apexTrack('product_preview_viewed', { product: 'ground_school_class', class_id: s.id });
    groundSchoolModalTitle.textContent = s.title;
    groundSchoolModalWhen.textContent = fmtSessionDate(s.scheduled_at);
    groundSchoolModalError.classList.remove('show');
    // Single defense-in-depth check for "already registered," covering
    // Calendar/Week's click-to-open paths too -- those don't check
    // alreadyRegistered before calling this (unlike Cards, which never
    // attaches the click handler in the first place), so without this a
    // member could still reach the paid-checkout CTA from those views.
    if (s.alreadyRegistered) {
      groundSchoolModalRedeemBtn.style.display = 'none';
      groundSchoolModalPackBtn.style.display = 'none';
      groundSchoolModalCta.style.display = 'none';
      groundSchoolModalError.textContent = 'You\'re already registered for this class.';
      groundSchoolModalError.classList.add('show');
      groundSchoolModalOverlay.classList.add('show');
      return;
    }
    // redeem_referral_reward() (v24) only spends against the legacy
    // ground_sessions/ground_registrations path -- not wired to
    // scheduled_ground_classes, so the option isn't offered there.
    groundSchoolModalRedeemBtn.style.display = (s.kind === 'legacy' && availableReferralRewards > 0) ? 'block' : 'none';
    // A member with the $400 full-course pack never needs the $25 CTA
    // for a Private Pilot class -- swap it for the pack-covered button
    // instead of offering both.
    groundSchoolModalPackBtn.style.display = s.packCovers ? 'block' : 'none';
    groundSchoolModalCta.style.display = s.packCovers ? 'none' : 'block';
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
        sessionId: activeGroundSession.kind === 'legacy' ? activeGroundSession.id : undefined,
        scheduledClassId: activeGroundSession.kind === 'scheduled_class' ? activeGroundSession.id : undefined,
        name: member.name,
        email: member.email,
        origin: window.location.origin,
        utm: window.apexGetUtm ? apexGetUtm() : undefined
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
      if (window.apexTrackStandard) apexTrackStandard('InitiateCheckout', { content_name: 'Ground School — ' + activeGroundSession.title, value: 25, currency: 'USD' });
      window.location.href = res.data.url;
    }).catch(function () {
      groundSchoolModalCta.disabled = false;
      groundSchoolModalCta.textContent = 'Pay & Register';
      groundSchoolModalError.textContent = 'Could not start checkout. Please try again.';
      groundSchoolModalError.classList.add('show');
    });
  });

  // Spends one earned-but-unredeemed referral reward on the selected
  // session. redeem_referral_reward() (supabase-portal-schema-v24.sql)
  // is the real boundary here -- it picks the caller's own oldest
  // unredeemed 'rewarded' referral server-side and raises an exception
  // if there isn't one, rather than trusting availableReferralRewards
  // (which only controls whether this button is shown, same as every
  // other gated-UI/server-boundary split in this file).
  groundSchoolModalRedeemBtn.addEventListener('click', function () {
    if (!activeGroundSession || !member) return;
    groundSchoolModalError.classList.remove('show');
    groundSchoolModalRedeemBtn.disabled = true;
    groundSchoolModalRedeemBtn.textContent = 'Redeeming…';

    apexSupabase.rpc('redeem_referral_reward', { p_session_id: activeGroundSession.id }).then(function (res) {
      groundSchoolModalRedeemBtn.disabled = false;
      groundSchoolModalRedeemBtn.textContent = '🎁 Use a Free Referral Reward';
      if (res.error) {
        groundSchoolModalError.textContent = res.error.message || 'Could not redeem your reward. Please try again.';
        groundSchoolModalError.classList.add('show');
        return;
      }
      var row = res.data && res.data[0];
      closeGroundSchoolModal();
      toast(row && row.is_waitlisted ? 'Added to the waitlist with your free session credit.' : 'Registered! Your free session credit has been used.');

      // Reflect the spent credit locally (oldest unredeemed row, matching
      // the RPC's own ordering) so the banner/list update immediately
      // without waiting on a full refetch.
      var spent = referrals.filter(function (r) { return r.status === 'rewarded' && !r.redeemed_at; })[0];
      if (spent) spent.redeemed_at = new Date().toISOString();
      renderReferralProgram();

      groundSchoolLoaded = false;
      loadGroundSchool();
      renderMySessions();
    });
  });

  // Registers via the $400 full-course pack -- enroll_in_ground_school_via_pack()
  // (v57) is the real boundary here: it re-checks
  // private_pilot_ground_school_pack_unlocked and the class's course_id
  // server-side rather than trusting this button having been shown.
  // Returns a single row (scheduled_ground_class_enrollments), not a
  // set, so res.data is the row itself -- not res.data[0].
  groundSchoolModalPackBtn.addEventListener('click', function () {
    if (!activeGroundSession || !member) return;
    groundSchoolModalError.classList.remove('show');
    groundSchoolModalPackBtn.disabled = true;
    groundSchoolModalPackBtn.textContent = 'Registering…';

    apexSupabase.rpc('enroll_in_ground_school_via_pack', { p_scheduled_ground_class_id: activeGroundSession.id }).then(function (res) {
      groundSchoolModalPackBtn.disabled = false;
      groundSchoolModalPackBtn.textContent = 'Register — Included in Your Pack';
      if (res.error) {
        groundSchoolModalError.textContent = res.error.message || 'Could not register. Please try again.';
        groundSchoolModalError.classList.add('show');
        return;
      }
      closeGroundSchoolModal();
      toast(res.data && res.data.is_waitlisted ? 'Added to the waitlist for this class.' : 'Registered! No charge — included in your Ground School pack.');
      groundSchoolLoaded = false;
      loadGroundSchool();
      renderMySessions();
    });
  });

  // Hides the $400 unlock card once purchased -- mirrors the other
  // unlock-status renders (renderMembership(), renderMembershipSubscription())
  // in that it's purely a display concern; the real gate is server-side
  // in enroll_in_ground_school_via_pack() and create-checkout-session's
  // duplicate-purchase check.
  function renderGroundSchoolPackCard() {
    var card = document.getElementById('groundSchoolPackCard');
    if (!card || !member) return;
    card.style.display = member.groundSchoolPackUnlocked ? 'none' : 'flex';
  }

  var groundSchoolPackUnlockBtn = document.getElementById('groundSchoolPackUnlockBtn');
  if (groundSchoolPackUnlockBtn) {
    groundSchoolPackUnlockBtn.addEventListener('click', function () {
      var errorEl = document.getElementById('groundSchoolPackError');
      errorEl.classList.remove('show');
      groundSchoolPackUnlockBtn.disabled = true;
      groundSchoolPackUnlockBtn.textContent = 'Redirecting to secure checkout…';

      apexSupabase.functions.invoke('create-checkout-session', {
        body: { purpose: 'unlock-ground-school-pack', origin: window.location.origin, utm: window.apexGetUtm ? apexGetUtm() : undefined },
        headers: { Authorization: 'Bearer ' + accessToken }
      }).then(function (res) {
        if (res.error || !res.data || !res.data.url) {
          return extractInvokeError(res).then(function (msg) {
            groundSchoolPackUnlockBtn.disabled = false;
            groundSchoolPackUnlockBtn.textContent = 'Unlock for $400';
            errorEl.textContent = msg;
            errorEl.classList.add('show');
          });
        }
        if (window.apexTrackStandard) apexTrackStandard('InitiateCheckout', { content_name: 'Private Pilot Ground School — Full Course', value: 400, currency: 'USD' });
        window.location.href = res.data.url;
      }).catch(function () {
        groundSchoolPackUnlockBtn.disabled = false;
        groundSchoolPackUnlockBtn.textContent = 'Unlock for $400';
        errorEl.textContent = 'Could not start checkout. Please try again.';
        errorEl.classList.add('show');
      });
    });
  }

  /* ── Post-Stripe-redirect toasts ────────────────────────────── */
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('unlocked') === '1') {
    authReady.then(function () {
      apexSupabase.from('profiles').select('checkride_prep_unlocked').eq('id', member.id).single().then(function (res) {
        if (res.data && res.data.checkride_prep_unlocked) {
          member.checkridePrepUnlocked = true;
          applyUnlockState();
          toast('Unlocked! Welcome to the Checkride Prep System.');
          // Founding ($29) vs standard ($49) isn't known client-side --
          // pull the real charged amount from the purchase record itself
          // so GA4 revenue reporting reflects what was actually paid,
          // not a guessed/static value.
          apexSupabase.from('portal_access_purchases').select('amount_cents, tier')
            .eq('profile_id', member.id).order('created_at', { ascending: false }).limit(1)
            .then(function (purchaseRes) {
              var purchase = purchaseRes.data && purchaseRes.data[0];
              var value = purchase ? purchase.amount_cents / 100 : 49;
              if (window.gtag) gtag('event', 'purchase', {
                currency: 'USD', value: value,
                items: [{ item_name: 'Checkride Prep Unlock', item_variant: purchase ? purchase.tier : undefined, price: value, quantity: 1 }]
              });
            });
        }
      });
    });
  }
  if (urlParams.get('registered') === '1') {
    toast('You\'re registered for ground school!');
    var gsAmountCents = parseInt(urlParams.get('amount_cents'), 10);
    var gsValue = isNaN(gsAmountCents) ? 25 : gsAmountCents / 100;
    if (window.gtag) gtag('event', 'purchase', {
      currency: 'USD', value: gsValue,
      items: [{ item_name: 'Ground School Session', price: gsValue, quantity: 1 }]
    });
    // Meta Pixel Purchase -- this $25 purchase had no tracking at all
    // before (only the GA4 event above existed). Same session_id dedup
    // pattern as the Checkride Prep/Membership/Ground-School-Pack blocks
    // at the top of this file; no discount path on this product (flat
    // $25, no allow_promotion_codes), so the quoted amount is always
    // what was actually charged.
    var gsSessionId = urlParams.get('session_id');
    var gsDedupeKey = gsSessionId ? 'apex_fbq_purchase_gs_' + gsSessionId : null;
    if (window.fbq && (!gsDedupeKey || !localStorage.getItem(gsDedupeKey))) {
      fbq('track', 'Purchase', { value: gsValue, currency: 'USD', content_name: 'Ground School Session' });
      if (gsDedupeKey) localStorage.setItem(gsDedupeKey, '1');
    }
    var gsFunnelDedupeKey = gsSessionId ? 'apex_funnel_purchase_gs_' + gsSessionId : null;
    if (window.apexTrack && (!gsFunnelDedupeKey || !localStorage.getItem(gsFunnelDedupeKey))) {
      apexTrack('purchase_completed', { product: 'ground_school_class', price: gsValue });
      apexTrack('ground_school_class_purchased', { price: gsValue });
      if (gsFunnelDedupeKey) localStorage.setItem(gsFunnelDedupeKey, '1');
    }
  }
  if (urlParams.get('mockoral') === '1') {
    toast('Payment received! Andrew will email you to schedule your Mock Oral.');
    if (window.gtag) gtag('event', 'purchase', {
      currency: 'USD', value: 99,
      items: [{ item_name: '60-Minute Mock Oral', price: 99, quantity: 1 }]
    });
  }
  if (urlParams.get('groundschoolpack') === '1') {
    authReady.then(function () {
      apexSupabase.from('profiles').select('private_pilot_ground_school_pack_unlocked').eq('id', member.id).single().then(function (res) {
        if (res.data && res.data.private_pilot_ground_school_pack_unlocked) {
          member.groundSchoolPackUnlocked = true;
          toast('Unlocked! Every Private Pilot ground school class is now included.');
          groundSchoolLoaded = false;
          loadGroundSchool();
          if (window.gtag) gtag('event', 'purchase', {
            currency: 'USD', value: 400,
            items: [{ item_name: 'Private Pilot Ground School — Full Course', price: 400, quantity: 1 }]
          });
        }
      });
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
  var availableReferralRewards = 0; // rewarded referrals not yet spent on a free session — see renderReferralProgram
  var checkrideDate = null;
  var testimonialSubmitted = false;
  var checkrideResult = null;
  var myPurchase = null;
  var myInvoices = [];
  var myGroundRegistrations = [];
  var myScheduledEnrollments = []; // scheduled_ground_classes-based registrations (v58 get_my_ground_school_enrollments), separate from the legacy myGroundRegistrations above
  var groundSchoolModuleCount = 0; // total published PPL modules -- denominator for Ground School Progress
  var myAiDpeSessions = []; // most-recent-first, from get_my_recent_ai_dpe_sessions (v64) -- feeds Training Plan + future AI DPE History view

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
      apexSupabase.from('ground_registrations').select('*, session:ground_sessions(*)').eq('profile_id', member.id),
      apexSupabase.rpc('get_my_ground_school_enrollments'),
      apexSupabase.rpc('get_ground_school_module_count', { p_course_id: 'PPL' }),
      apexSupabase.rpc('get_my_recent_ai_dpe_sessions', { p_limit: 10 })
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
      myScheduledEnrollments = results[17].data || [];
      groundSchoolModuleCount = typeof results[18].data === 'number' ? results[18].data : 0;
      myAiDpeSessions = results[19].data || [];
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
    el.id = lessonId;
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
     WEIGHT & BALANCE CALCULATOR — free resource, PA-28-181 example.
     Mirrors the "Apex Weight & Balance Worksheet" xlsx formula for
     formula: Moment = Weight x Arm, CG = Total Moment / Total Weight,
     Pressure Altitude = 1000*(29.92-Altimeter)+FieldElevation,
     Density Altitude = 120*(OAT-15)+PressureAltitude,
     Va at Weight = Va at Max Gross x sqrt(Weight/Max Gross Weight).
     Pure client-side math, no session/data dependency, so it's wired
     up unconditionally at script load rather than inside initPortalData.
     ══════════════════════════════════════════════════════════════ */
  function initWeightBalanceCalculator() {
    var wbForm = document.getElementById('wb-bew-weight');
    if (!wbForm) return; // section not present on this page

    function num(id) {
      var el = document.getElementById(id);
      var v = parseFloat(el.value);
      return isNaN(v) ? 0 : v;
    }
    function setText(id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val;
    }
    function fmt1(n) { return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
    function fmt0(n) { return Math.round(n).toLocaleString(); }

    function recalc() {
      var bewW = num('wb-bew-weight'), bewM = num('wb-bew-moment');
      var bewA = bewW ? bewM / bewW : 0;

      var frontW = num('wb-front-weight'), frontA = num('wb-front-arm'), frontM = frontW * frontA;
      var rearW = num('wb-rear-weight'), rearA = num('wb-rear-arm'), rearM = rearW * rearA;
      var bagW = num('wb-bag-weight'), bagA = num('wb-bag-arm'), bagM = bagW * bagA;

      var zfwW = bewW + frontW + rearW + bagW;
      var zfwM = bewM + frontM + rearM + bagM;
      var zfwA = zfwW ? zfwM / zfwW : 0;

      var fuelW = num('wb-fuel-weight'), fuelA = num('wb-fuel-arm'), fuelM = fuelW * fuelA;

      var rampW = zfwW + fuelW;
      var rampM = zfwM + fuelM;
      var rampA = rampW ? rampM / rampW : 0;

      var taxiW = num('wb-taxi-weight'), taxiA = num('wb-taxi-arm'), taxiM = taxiW * taxiA;

      var toW = rampW - taxiW;
      var toM = rampM - taxiM;
      var toA = toW ? toM / toW : 0;

      var burnW = num('wb-burn-weight'), burnA = num('wb-burn-arm'), burnM = burnW * burnA;

      var ldgW = toW - burnW;
      var ldgM = toM - burnM;
      var ldgA = ldgW ? ldgM / ldgW : 0;

      var mgw = num('wb-mgw');

      setText('wb-bew-arm', bewW ? fmt1(bewA) : '');
      setText('wb-front-moment', fmt0(frontM));
      setText('wb-rear-moment', fmt0(rearM));
      setText('wb-bag-moment', fmt0(bagM));
      setText('wb-zfw-weight', fmt1(zfwW));
      setText('wb-zfw-arm', zfwW ? fmt1(zfwA) : '');
      setText('wb-zfw-moment', fmt0(zfwM));
      setText('wb-fuel-moment', fmt0(fuelM));
      setText('wb-ramp-weight', fmt1(rampW));
      setText('wb-ramp-arm', rampW ? fmt1(rampA) : '');
      setText('wb-ramp-moment', fmt0(rampM));
      setText('wb-taxi-moment', fmt0(taxiM));
      setText('wb-to-weight', fmt1(toW));
      setText('wb-to-arm', toW ? fmt1(toA) : '');
      setText('wb-to-moment', fmt0(toM));
      setText('wb-burn-moment', fmt0(burnM));
      setText('wb-ldg-weight', fmt1(ldgW));
      setText('wb-ldg-arm', ldgW ? fmt1(ldgA) : '');
      setText('wb-ldg-moment', fmt0(ldgM));

      var toFwd = num('wb-cg-to-fwd'), toAft = num('wb-cg-to-aft');
      var ldgFwd = num('wb-cg-ldg-fwd'), ldgAft = num('wb-cg-ldg-aft');
      setText('wb-cg-to-actual', fmt1(toA));
      setText('wb-cg-ldg-actual', fmt1(ldgA));
      var toStatusEl = document.getElementById('wb-cg-to-status');
      var toPass = toA >= toFwd && toA <= toAft;
      toStatusEl.textContent = toPass ? 'PASS' : 'CHECK';
      toStatusEl.className = toPass ? 'wb-status-pass' : 'wb-status-check';
      var ldgStatusEl = document.getElementById('wb-cg-ldg-status');
      var ldgPass = ldgA >= ldgFwd && ldgA <= ldgAft;
      ldgStatusEl.textContent = ldgPass ? 'PASS' : 'CHECK';
      ldgStatusEl.className = ldgPass ? 'wb-status-pass' : 'wb-status-check';

      var altimeter = num('wb-altimeter'), fieldElev = num('wb-field-elev'), oat = num('wb-oat');
      var pa = 1000 * (29.92 - altimeter) + fieldElev;
      var da = 120 * (oat - 15) + pa;
      setText('wb-pa', fmt0(pa));
      setText('wb-da', fmt0(da));

      var vaMax = num('wb-va-max');
      setText('wb-va-to-weight', fmt0(toW));
      setText('wb-va-ldg-weight', fmt0(ldgW));
      setText('wb-va-mgw', fmt0(mgw));
      var vaTo = mgw > 0 && toW > 0 ? vaMax * Math.sqrt(toW / mgw) : 0;
      var vaLdg = mgw > 0 && ldgW > 0 ? vaMax * Math.sqrt(ldgW / mgw) : 0;
      setText('wb-va-to', fmt1(vaTo));
      setText('wb-va-ldg', fmt1(vaLdg));
    }

    document.querySelectorAll('#section-weight-balance .wb-input').forEach(function (input) {
      input.addEventListener('input', recalc);
    });
    recalc();
  }
  initWeightBalanceCalculator();

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

  function updateDpeTabBadges() {
    dpeTabs.querySelectorAll('.portal-tab[data-cat]').forEach(function (tab) {
      var cat = tab.dataset.cat;
      if (cat === 'all' || cat === 'favorites') return;
      if (!tab.dataset.label) tab.dataset.label = tab.textContent.trim();
      var items = DPE_DATA.filter(function (d) { return d.section === cat; });
      if (!items.length) { tab.textContent = tab.dataset.label; return; }
      var done = items.filter(function (d) { return studied[d.id]; }).length;
      tab.innerHTML = tab.dataset.label + ' <span class="portal-tab__badge">(' + done + '/' + items.length + ')</span>';
    });
  }

  function renderDpeSuggestedStrip() {
    var el = document.getElementById('dpeSuggestedStrip');
    if (!el) return;
    var weakest = weakestCategory();
    if (!weakest) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML =
      '<span class="portal-suggested-strip__text">Suggested for you: <strong>' + weakest.label + '</strong> is ' + Math.round(weakest.pct * 100) + '% complete — the fastest way to move your readiness score.</span>' +
      '<span class="portal-suggested-strip__cta">Jump In →</span>';
    el.onclick = function () { goToCategory(weakest.cat); };
  }

  function renderDpeLibrary() {
    updateDpeTabBadges();
    renderDpeSuggestedStrip();

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
              (isStudied ? '<span class="portal-qitem__studied-dot" title="Studied">✓</span>' : '') +
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

        // Whole card opens/closes the answer -- not just the question-text
        // row -- so the "Mark as studied" footer is also part of the click
        // target. Excludes the star (favorite-only), the studied checkbox/
        // label (studied-only), Ask Andrew, and the answer body itself (so
        // selecting/reading the open answer never accidentally re-closes it).
        qitem.addEventListener('click', function (e) {
          if (
            e.target.closest('[data-star]') ||
            e.target.closest('.portal-ask-andrew') ||
            e.target.closest('.portal-studied-label') ||
            e.target.closest('.portal-qitem__a')
          ) return;
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
     RENDER — Scenario Training Center (real emergency/XC content),
     presented as dispatch cards: ACS area + estimated review time up
     top, a "your decision" beat before the reveal, and a direct link
     to the related ACS lesson.
     ══════════════════════════════════════════════════════════════ */
  var scenarioGrid = document.getElementById('scenarioGrid');

  function goToLesson(lessonId) {
    showSection('checkride-prep');
    var lessonsTab = document.querySelector('#prepPrivateSubtabs [data-sub="lessons"]');
    if (lessonsTab && !lessonsTab.classList.contains('active')) lessonsTab.click();
    setTimeout(function () {
      var el = document.getElementById(lessonId);
      if (!el) return;
      el.classList.add('open');
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  // Real, derived estimate (word count / 200wpm reading speed) -- not a
  // fabricated difficulty/time value, just the same math a "3 min read"
  // label on any article uses.
  function estimatedReviewMinutes(s) {
    var words = (s.title + ' ' + s.brief + ' ' + s.model + ' ' + s.mistakes + ' ' + s.evaluating).trim().split(/\s+/).length;
    return Math.max(2, Math.round(words / 200));
  }

  function renderScenarios() {
    scenarioGrid.innerHTML = '';
    SCENARIOS.forEach(function (s) {
      var isFav = !!favorites[s.id];
      var isStudied = !!studied[s.id];
      var mins = estimatedReviewMinutes(s);
      var lessonId = 'lesson-' + s.category;
      var lessonLabel = CATEGORY_META[s.category] ? CATEGORY_META[s.category].label : s.tag;
      var card = document.createElement('div');
      card.className = 'portal-card portal-scenario-card';
      card.innerHTML =
        '<div class="portal-scenario-card__header">' +
          '<div class="portal-scenario-card__header-left">' +
            '<span class="portal-scenario-card__tag">' + s.tag + '</span>' +
            '<span class="portal-scenario-card__time">⏱ ' + mins + ' min review</span>' +
            '<span class="portal-scenario-card__status' + (isStudied ? ' portal-scenario-card__status--done' : '') + '">' + (isStudied ? '✓ Reviewed' : 'Not Reviewed') + '</span>' +
          '</div>' +
          '<button class="portal-star-btn' + (isFav ? ' active' : '') + '" type="button" data-star="' + s.id + '" title="Star for review">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="' + (isFav ? 'currentColor' : 'none') + '"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="portal-scenario-card__body">' +
          '<p class="portal-scenario-card__label">The Scenario</p>' +
          '<h3>' + s.title + '</h3>' +
          '<p>' + s.brief + '</p>' +
          '<p class="portal-scenario-card__prompt">Think through your decision out loud before revealing the model answer — that\'s what actually builds checkride-ready recall.</p>' +
          '<button class="portal-scenario-card__toggle" type="button">Reveal model answer ' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="portal-scenario-detail">' +
            '<h4>Model Answer</h4><p>' + s.model + '</p>' +
            '<h4>Common Student Mistakes</h4><p>' + s.mistakes + '</p>' +
            '<h4>What the DPE Is Evaluating</h4><p>' + s.evaluating + '</p>' +
            '<h4>ACS Connection</h4><p>' + s.acs + '</p>' +
            '<div class="portal-scenario-detail__related" data-related-lesson>Review the related lesson: ' + lessonLabel + ' →</div>' +
          '</div>' +
          '<label class="portal-studied-label"><input type="checkbox" data-studied="' + s.id + '" ' + (isStudied ? 'checked' : '') + ' /> Mark as reviewed</label>' +
        '</div>';
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
      card.querySelector('[data-related-lesson]').addEventListener('click', function (e) {
        e.stopPropagation();
        goToLesson(lessonId);
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

    var freezeMeta = document.getElementById('streakFreezeMeta');
    var freezeCount = member ? (member.streakFreezesBanked || 0) : 0;
    if (freezeMeta) {
      document.getElementById('streakFreezeCount').textContent = freezeCount;
      freezeMeta.hidden = freezeCount === 0;
    }
    renderRecoverySortieBanner();
  }

  // A pending Recovery Sortie is offered server-side (run_streak_maintenance(),
  // supabase-portal-schema-v48.sql) when a streak breaks with no freeze
  // banked. This just surfaces it -- completing 3 questions today closes
  // it out automatically via a DB trigger, no client action needed here
  // beyond studying normally.
  function renderRecoverySortieBanner() {
    var banner = document.getElementById('recoverySortieBanner');
    if (!banner || !member) return;
    apexSupabase
      .from('recovery_sorties')
      .select('id')
      .eq('profile_id', member.id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .limit(1)
      .then(function (res) {
        banner.style.display = (res.data && res.data.length) ? 'block' : 'none';
      });
  }

  /* ══════════════════════════════════════════════════════════════
     PILOT RANK + XP
     Keep PILOT_RANKS in sync with the pilot_ranks seed data in
     supabase-portal-schema-v47.sql -- duplicated here so rank progress
     renders without an extra round trip, same reasoning as the
     ACHIEVEMENT_DEFS/CATEGORY_META constants elsewhere in this file.
     Ranks are display-only and never imply a real FAA certificate or
     rating -- see the disclaimer text below, shown for any rank that
     could otherwise be misread that way.
     ══════════════════════════════════════════════════════════════ */
  var PILOT_RANKS = [
    { key: 'student_pilot', label: 'Student Pilot', minXp: 0 },
    { key: 'pre_solo', label: 'Pre-Solo', minXp: 250 },
    { key: 'cross_country_pilot', label: 'Cross-Country Pilot', minXp: 750 },
    { key: 'night_rated', label: 'Night Rated', minXp: 1500, disclaimer: 'Portal rank only — not FAA night currency or an endorsement.' },
    { key: 'instrument_ready', label: 'Instrument Ready', minXp: 2750, disclaimer: 'Portal rank only — not an FAA Instrument Rating.' },
    { key: 'commercial_candidate', label: 'Commercial Candidate', minXp: 4500, disclaimer: 'Portal rank only — not a Commercial Pilot Certificate.' },
    { key: 'checkride_ace', label: 'Checkride Ace', minXp: 7000 },
    { key: 'apex_captain', label: 'Apex Captain', minXp: 10000, disclaimer: 'Portal rank only — not a Private Pilot Certificate.' },
    { key: 'legend', label: 'Legend', minXp: 15000, disclaimer: 'Portal rank only — not any FAA certificate or rating.' }
  ];

  function renderXpRank() {
    var xpEl = document.getElementById('xpTotal');
    if (!xpEl || !member) return;
    var xp = member.totalXp || 0;
    var idx = 0;
    for (var i = 0; i < PILOT_RANKS.length; i++) { if (xp >= PILOT_RANKS[i].minXp) idx = i; }
    var current = PILOT_RANKS[idx];
    var next = PILOT_RANKS[idx + 1];

    xpEl.textContent = xp;
    document.getElementById('xpRankLabel').textContent = current.label;
    var disclaimerEl = document.getElementById('xpRankDisclaimer');
    if (disclaimerEl) disclaimerEl.textContent = current.disclaimer || '';
    var barEl = document.getElementById('xpRankBar');
    var nextEl = document.getElementById('xpRankNext');
    if (next) {
      var pct = Math.min(100, Math.round(((xp - current.minXp) / (next.minXp - current.minXp)) * 100));
      if (barEl) barEl.style.width = pct + '%';
      if (nextEl) nextEl.textContent = (next.minXp - xp) + ' XP to ' + next.label;
    } else {
      if (barEl) barEl.style.width = '100%';
      if (nextEl) nextEl.textContent = 'Top rank reached';
    }
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

    // Supplementary, not blended: the ACS categories above are 100%
    // coverage-based ("% marked studied"), the only weak-area signal that
    // currently exists. ai_dpe_sessions.debrief.perDomain does carry a
    // real accuracy-based "weak" verdict per domain (dpe-chat/index.ts),
    // but its domain names are free text the AI generates per session
    // ("ACS areas you actually asked about") -- not guaranteed to match
    // CATEGORY_META's fixed category ids/casing, so folding it into the
    // scoring above risks a wrong or missed match with no way to verify
    // against real AI-generated output from this sandbox. Shown here as
    // its own distinct, clearly-labeled line instead.
    var aiDpeNote = document.getElementById('weakAreasAiDpeNote');
    if (aiDpeNote) {
      var latestDebrief = myAiDpeSessions.filter(function (s) { return s.status === 'completed' && s.debrief; })[0];
      var weakDomains = latestDebrief ? (latestDebrief.debrief.perDomain || []).filter(function (d) { return d.verdict === 'weak'; }).map(function (d) { return d.domain; }) : [];
      if (weakDomains.length) {
        aiDpeNote.textContent = 'Your last AI DPE session also flagged: ' + weakDomains.join(', ');
        aiDpeNote.hidden = false;
      } else {
        aiDpeNote.hidden = true;
      }
    }
  }

  /* Maps our 11 topic categories onto the REAL FAA Private Pilot ACS
     (FAA-S-ACS-6C, Nov 2023) Areas of Operation and Tasks -- verified
     directly against the ACS document, not the app's own acs_reference
     text (which mislabels ~7 of these 11 categories with the wrong Area
     number; e.g. "emergency" cites Area X, which is actually Multiengine
     Operations, not Emergency Operations -- that's really Area IX).
     Only areas/tasks this oral-exam question bank actually has content
     for are listed -- flight-maneuver areas (Takeoffs/Landings, Slow
     Flight, Instrument Maneuvers, etc.) are demonstrated in the airplane,
     not asked about here, so they're deliberately left off rather than
     shown as a permanent, misleading 0%.
     "crosscountry" and "emergency" each genuinely span multiple real ACS
     tasks (Cross-Country Planning + all of Navigation; all four
     Emergency Operations tasks) without per-question tagging to tell
     which specific task each one belongs to -- rather than guess a false
     per-task split, those two are shown as a single honest rollup. */
  var ACS_TRACKER = [
    { id: 'area-i', label: 'Area I — Preflight Preparation', tasks: [
      { code: 'I.A', title: 'Pilot Qualifications', categories: ['eligibility', 'privileges'] },
      { code: 'I.B', title: 'Airworthiness Requirements', categories: ['airworthiness'] },
      { code: 'I.C', title: 'Weather Information', categories: ['weather'] },
      { code: 'I.E', title: 'National Airspace System', categories: ['airspace'] },
      { code: 'I.F', title: 'Performance and Limitations', categories: ['performance'] },
      { code: 'I.G', title: 'Operation of Systems', categories: ['aircraft-systems'] },
      { code: 'I.H', title: 'Human Factors', categories: ['aeromedical'] }
    ] },
    { id: 'xc-nav', label: 'Area I.D &amp; VI — Cross-Country Planning &amp; Navigation', tasks: [
      { code: null, title: null, categories: ['crosscountry'] }
    ] },
    { id: 'emergency-ops', label: 'Area IX — Emergency Operations', tasks: [
      { code: null, title: null, categories: ['emergency'] }
    ] },
    { id: 'adm', label: 'Special Emphasis — Aeronautical Decision-Making &amp; Risk Management', tasks: [
      { code: null, title: null, categories: ['adm'] }
    ] }
  ];

  /* Maps each of the 20 Private Pilot Ground School modules (real IDs/
     titles from portal/src/data/privatePilotCurriculum.js, mirrored into
     scheduled_ground_classes.module_id) onto the 11 DPE/scenario topic
     categories above, plus a related free resource page where one exists.
     No module<->category mapping existed anywhere in the codebase before
     this -- built by matching module topic to category topic, same
     judgment call ACS_TRACKER already makes for "Human Factors" ->
     'aeromedical' (I.H above). Where a module doesn't map cleanly onto
     any one category (Aerodynamics, FARs Simplified) the closest fit is
     used and noted below; two modules (Airplane... wait) -- ACS Mastery
     and Mock Oral Exam are cumulative review, not tied to one category,
     so `categories` is empty and `cumulative: true` instead.
     See docs/training-plan-architecture.md for the full writeup. */
  var GS_MODULE_CONTENT_MAP = {
    'PPL-M01': { title: 'Becoming a Pilot', categories: ['eligibility'], freeResource: null },
    'PPL-M02': { title: 'Aerodynamics', categories: ['performance'], freeResource: null, approximate: true },
    'PPL-M03': { title: 'Aircraft Systems', categories: ['aircraft-systems'], freeResource: null },
    'PPL-M04': { title: 'FARs Simplified', categories: ['privileges', 'eligibility'], freeResource: null, approximate: true },
    'PPL-M05': { title: 'Airspace Mastery', categories: ['airspace'], freeResource: null },
    'PPL-M06': { title: 'Airport Operations', categories: ['airspace'], freeResource: 'radio-calls' },
    'PPL-M07': { title: 'Sectional Charts', categories: ['crosscountry'], freeResource: null },
    'PPL-M08': { title: 'Pilotage & Dead Reckoning', categories: ['crosscountry'], freeResource: null },
    'PPL-M09': { title: 'Navigation Systems', categories: ['crosscountry'], freeResource: null },
    'PPL-M10': { title: 'Weather Theory', categories: ['weather'], freeResource: null },
    'PPL-M11': { title: 'Weather Products', categories: ['weather'], freeResource: null },
    'PPL-M12': { title: 'Weather Decision Making', categories: ['weather', 'adm'], freeResource: null },
    'PPL-M13': { title: 'Weight & Balance', categories: ['performance'], freeResource: 'weight-balance' },
    'PPL-M14': { title: 'Aircraft Performance', categories: ['performance'], freeResource: null },
    'PPL-M15': { title: 'Cross-Country Planning', categories: ['crosscountry'], freeResource: null },
    'PPL-M16': { title: 'Aeronautical Decision Making', categories: ['adm'], freeResource: null },
    'PPL-M17': { title: 'Human Factors', categories: ['aeromedical'], freeResource: null },
    'PPL-M18': { title: 'Emergency Procedures', categories: ['emergency'], freeResource: 'spin-awareness' },
    'PPL-M19': { title: 'ACS Mastery', categories: [], freeResource: null, cumulative: true },
    'PPL-M20': { title: 'Mock Oral Exam', categories: [], freeResource: null, cumulative: true }
  };

  function getModuleContent(moduleId) {
    return GS_MODULE_CONTENT_MAP[moduleId] || null;
  }

  // Ground School companion/Guided Notes entitlement: the $400 pack
  // unlocks every module (profiles.private_pilot_ground_school_pack_
  // unlocked, same flag enroll_in_ground_school_via_pack checks
  // server-side, v57.sql); a $25 single-class purchase only entitles the
  // one module actually bought -- that fact lives as a row in
  // scheduled_ground_class_enrollments (surfaced to the client as
  // myScheduledEnrollments via get_my_ground_school_enrollments, v63.sql),
  // keyed by lesson_id, not a flag on profiles. This mirrors the exact
  // per-row entitlement pattern already used for "already registered"
  // checks in loadGroundSchool() -- see zonedWallClockToUtc's neighbors
  // above. Client-side gate only; the real boundary is still RLS on
  // guided_notes once that table's policy is opened past admin-only
  // (see docs/training-plan-architecture.md).
  function hasModuleAccess(moduleId) {
    if (!member) return false;
    if (member.groundSchoolPackUnlocked) return true;
    return myScheduledEnrollments.some(function (e) {
      return e.lesson_id === moduleId && (e.payment_status === 'paid' || e.payment_status === 'ground_school_pack');
    });
  }

  function taskCoverage(categories) {
    var done = 0, total = 0;
    categories.forEach(function (cat) {
      var items = DPE_DATA.filter(function (d) { return d.section === cat; });
      total += items.length;
      done += items.filter(function (d) { return studied[d.id]; }).length;
    });
    return { done: done, total: total, pct: total ? done / total : 0 };
  }

  function renderAcsCoverage() {
    var el = document.getElementById('acsCoverageList');
    el.innerHTML = ACS_TRACKER.map(function (group) {
      var groupCats = [];
      group.tasks.forEach(function (t) { groupCats = groupCats.concat(t.categories); });
      var overallPct = Math.round(taskCoverage(groupCats).pct * 100);
      var hasSubtasks = group.tasks.length > 1;
      var subtasksHtml = hasSubtasks ? group.tasks.map(function (t) {
        var pct = Math.round(taskCoverage(t.categories).pct * 100);
        return '<div class="portal-acs-subtask" data-cats="' + t.categories.join(',') + '">' +
          '<div class="portal-acs-subtask__head"><span class="code">' + t.code + '</span><span class="name">' + t.title + '</span><span class="pct">' + pct + '%</span></div>' +
          '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + pct + '%"></div></div>' +
        '</div>';
      }).join('') : '';
      return '<div class="portal-acs-group" data-group="' + group.id + '">' +
        '<div class="portal-acs-row" data-cats="' + groupCats.join(',') + '">' +
          '<div class="portal-acs-row__head"><span class="name">' + group.label + '</span><span class="pct">' + overallPct + '%</span></div>' +
          '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + overallPct + '%"></div></div>' +
        '</div>' +
        (hasSubtasks ? '<div class="portal-acs-subtasks" hidden>' + subtasksHtml + '</div>' : '') +
      '</div>';
    }).join('');

    el.querySelectorAll('.portal-acs-group').forEach(function (groupEl) {
      var headRow = groupEl.querySelector('.portal-acs-row');
      var subtasks = groupEl.querySelector('.portal-acs-subtasks');
      headRow.addEventListener('click', function () {
        if (subtasks) subtasks.hidden = !subtasks.hidden;
        else goToCategory(headRow.dataset.cats.split(',')[0]);
      });
    });
    el.querySelectorAll('.portal-acs-subtask').forEach(function (row) {
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        goToCategory(row.dataset.cats.split(',')[0]);
      });
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
  // Question of the Day is deliberately free for every member (Retention
  // Sprint Tier 1) -- but DPE_DATA only ever gets populated for unlocked
  // members (loadPremiumContent() is a premium-only fetch, see get-
  // premium-content), so an unlocked member's question comes from the
  // already-loaded full bank client-side (no extra request), while a
  // locked member's comes from get_daily_question() (v68.sql), a
  // security-definer RPC that returns just today's single question
  // server-side without ever exposing the rest of the gated bank. Both
  // paths pick the exact same question for the exact same calendar day
  // (dayOfYear() % count here, extract(doy)::int % count server-side).
  function computeQotdQuestion() {
    if (DPE_DATA.length) {
      qotdQuestion = DPE_DATA[dayOfYear() % DPE_DATA.length];
      return Promise.resolve();
    }
    return apexSupabase.rpc('get_daily_question', { p_exam_type: 'private_pilot' }).then(function (res) {
      var row = res.data && res.data[0];
      qotdQuestion = row ? {
        id: row.id, sectionLabel: row.category_label,
        q: row.question, model: row.model_answer,
        evaluating: row.dpe_evaluating, application: row.real_world_application
      } : null;
    }).catch(function (err) { console.error('get_daily_question failed', err); qotdQuestion = null; });
  }

  function updateQotdButtons() {
    if (!qotdQuestion) return;
    var studiedBtn = document.getElementById('qotdStudiedBtn');
    var favBtn = document.getElementById('qotdFavBtn');
    studiedBtn.textContent = studied[qotdQuestion.id] ? '✓ Studied' : 'Mark as Studied';
    studiedBtn.classList.toggle('active', !!studied[qotdQuestion.id]);
    favBtn.textContent = favorites[qotdQuestion.id] ? '★ Starred' : '☆ Star for review';
    favBtn.classList.toggle('active', !!favorites[qotdQuestion.id]);
  }

  // Hours until the next UTC calendar day -- matches get_daily_question()'s
  // own extract(doy from now()) rotation (supabase-portal-schema-v68.sql)
  // and the client-side dayOfYear() fallback above, so "new question in
  // X hours" is never off from when the question actually changes.
  // Informational only, no countdown-timer urgency styling -- brief
  // explicitly says not to manufacture urgency here.
  function hoursUntilNextQotd() {
    var now = new Date();
    var nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
    return Math.max(1, Math.round((nextUtcMidnight - now.getTime()) / 3600000));
  }

  function renderQotdStreakNote() {
    var el = document.getElementById('qotdStreakNote');
    if (!el) return;
    var s = computeStreaks();
    var streakLine = s.current >= 2
      ? "You're on a " + s.current + "-day streak. "
      : (s.current === 1 ? "Streak started today. " : '');
    el.innerHTML = escapeHtmlSafe(streakLine + 'New DPE question every day — come back tomorrow (unlocks in about ' + hoursUntilNextQotd() + 'h).') +
      // Growth Sprint section 6 -- a single, dismissable-by-ignoring nudge
      // toward the 7-Day Challenge, only shown before it's been started
      // (never after, so this doesn't compete with the challenge's own
      // dashboard card once a member is already using it).
      (loggedEventTypes['challenge_started'] ? '' :
        '<div style="margin-top:10px"><button type="button" id="qotdChallengeNudge" style="background:none;border:none;padding:0;color:var(--gold-light);font-size:13px;font-weight:600;cursor:pointer;text-decoration:underline">Want a structured plan? Start the 7-Day Checkride Challenge →</button></div>');
    var nudgeBtn = document.getElementById('qotdChallengeNudge');
    if (nudgeBtn) nudgeBtn.addEventListener('click', function () {
      var card = document.getElementById('challengeCard');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
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
    if (alreadyRevealed) renderQotdStreakNote();
  }

  document.getElementById('qotdRevealBtn').addEventListener('click', function () {
    if (!qotdQuestion) return;
    document.getElementById('qotdPrompt').style.display = 'none';
    document.getElementById('qotdAnswer').style.display = 'block';
    touchLastViewed(qotdQuestion.id);
    answeredCounts[qotdQuestion.id] = (answeredCounts[qotdQuestion.id] || 0) + 1;
    upsertRow('portal_question_progress', 'question_id', qotdQuestion.id, { answered_count: answeredCounts[qotdQuestion.id] });
    // touchLastViewed() above already bumped today's study day, so the
    // streak count here already reflects this reveal.
    renderQotdStreakNote();
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
  // Base achievements, tagged with a category for the grouped Logbook
  // view (renderAchievements below). Categories loosely follow the
  // product's "Collections" taxonomy (milestone / consistency / acs /
  // scenarios) -- only what's derivable from real, already-loaded data;
  // no fabricated per-topic badges (a "METAR Decoder" badge, say) that
  // don't map to an actual verified piece of content.
  var ACHIEVEMENT_DEFS = [
    { key: 'first_question', icon: '🥇', label: 'First Question Completed', category: 'milestone', test: function () { return DPE_DATA.some(function (d) { return studied[d.id]; }); } },
    { key: 'fifty_questions', icon: '5️⃣0️⃣', label: '50 Questions Completed', category: 'milestone', test: function () { return DPE_DATA.filter(function (d) { return studied[d.id]; }).length >= 50; } },
    { key: 'hundred_questions', icon: '💯', label: '100 Questions Completed', category: 'milestone', test: function () { return DPE_DATA.filter(function (d) { return studied[d.id]; }).length >= 100; } },
    { key: 'seven_day_streak', icon: '🔥', label: '7 Day Streak', category: 'consistency', test: function () { return computeStreaks().longest >= 7; } },
    { key: 'checkride_mode_completed', icon: '🎯', label: 'Checkride Mode Completed', category: 'milestone', test: function () { return checkrideModeDone; } },
    { key: 'all_scenarios_complete', icon: '🧭', label: 'All Scenarios Complete', category: 'scenarios', test: function () { return SCENARIOS.length > 0 && SCENARIOS.every(function (s) { return studied[s.id]; }); } }
  ];

  var ACHIEVEMENT_CATEGORY_LABELS = { milestone: 'Milestones', consistency: 'Consistency', acs: 'ACS Areas', scenarios: 'Scenarios' };

  // One achievement per real ACS category (CATEGORY_META, loaded from
  // dpe_categories server-side) rather than hand-picking a subset --
  // this is a direct generalization of the achievement this replaced
  // (all_weather_complete, which only ever covered one category) to
  // every category the question bank actually has, so every real Area
  // of Operation gets its own "collection" to complete.
  function acsAchievementDefs() {
    return Object.keys(CATEGORY_META).map(function (cat) {
      return {
        key: 'acs_complete_' + cat,
        icon: '📘',
        label: 'All ' + CATEGORY_META[cat].label + ' Questions Complete',
        category: 'acs',
        test: function () { return categoryPct(cat) >= 1; }
      };
    });
  }

  function allAchievementDefs() {
    return ACHIEVEMENT_DEFS.concat(acsAchievementDefs());
  }

  /* ══════════════════════════════════════════════════════════════
     STUDY ANALYTICS — heatmap + weekly bar chart, both derived
     entirely from studyDays (date -> seconds), already loaded via
     portal_study_activity. No new tables, no new tracking.
     ══════════════════════════════════════════════════════════════ */
  function dateStr(d) {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function renderStudyHeatmap() {
    var el = document.getElementById('studyHeatmap');
    if (!el) return;
    var WEEKS = 12;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    // Start on the Sunday on/before (today - 11 weeks) so the grid lines up
    // into full weekly columns, GitHub-contribution-graph style.
    var start = new Date(today);
    start.setDate(start.getDate() - (WEEKS - 1) * 7 - today.getDay());

    var cols = [];
    for (var w = 0; w < WEEKS; w++) {
      var col = [];
      for (var d = 0; d < 7; d++) {
        var day = new Date(start);
        day.setDate(day.getDate() + w * 7 + d);
        var key = dateStr(day);
        var seconds = studyDays[key] || 0;
        var level = seconds <= 0 ? 0 : seconds < 600 ? 1 : seconds < 1800 ? 2 : 3;
        col.push({ date: day, key: key, seconds: seconds, level: level, future: day > today });
      }
      cols.push(col);
    }

    el.innerHTML = '<div class="portal-heatmap">' + cols.map(function (col) {
      return '<div class="portal-heatmap__col">' + col.map(function (cell) {
        if (cell.future) return '<div class="portal-heatmap__cell portal-heatmap__cell--future"></div>';
        var mins = Math.round(cell.seconds / 60);
        var title = cell.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ': ' + (mins > 0 ? mins + ' min studied' : 'no activity');
        return '<div class="portal-heatmap__cell portal-heatmap__cell--' + cell.level + '" title="' + title + '"></div>';
      }).join('') + '</div>';
    }).join('') + '</div>' +
    '<div class="portal-heatmap__legend"><span>Less</span>' +
      '<span class="portal-heatmap__cell portal-heatmap__cell--0"></span>' +
      '<span class="portal-heatmap__cell portal-heatmap__cell--1"></span>' +
      '<span class="portal-heatmap__cell portal-heatmap__cell--2"></span>' +
      '<span class="portal-heatmap__cell portal-heatmap__cell--3"></span>' +
    '<span>More</span></div>';
  }

  function renderWeeklyActivityChart() {
    var el = document.getElementById('weeklyActivityChart');
    if (!el) return;
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var day = new Date(today);
      day.setDate(day.getDate() - i);
      var seconds = studyDays[dateStr(day)] || 0;
      days.push({ label: day.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1), minutes: Math.round(seconds / 60) });
    }
    var maxMin = Math.max.apply(null, days.map(function (d) { return d.minutes; }).concat([1]));
    var totalMin = days.reduce(function (sum, d) { return sum + d.minutes; }, 0);

    el.innerHTML = '<div class="portal-weekchart">' + days.map(function (d) {
      var pct = Math.max(4, Math.round((d.minutes / maxMin) * 100));
      return '<div class="portal-weekchart__bar-wrap" title="' + d.minutes + ' min">' +
        '<div class="portal-weekchart__bar" style="height:' + pct + '%"></div>' +
        '<span class="portal-weekchart__label">' + d.label + '</span>' +
      '</div>';
    }).join('') + '</div>' +
    '<p class="portal-weekchart__total">' + totalMin + ' minutes studied this week</p>';
  }

  var achievementRarity = {}; // achievement_key -> pct_earned (0-1), fetched once

  function renderAchievements() {
    var defs = allAchievementDefs();
    var byCategory = {};
    defs.forEach(function (def) {
      (byCategory[def.category] = byCategory[def.category] || []).push(def);
    });

    var html = Object.keys(byCategory).map(function (cat) {
      var defsInCat = byCategory[cat];
      var earnedCount = defsInCat.filter(function (d) { return !!earnedAchievements[d.key]; }).length;
      var cards = defsInCat.map(function (def) {
        var earned = !!earnedAchievements[def.key];
        var rarity = achievementRarity[def.key];
        var rarityLabel = (typeof rarity === 'number') ? Math.round(rarity * 100) + '% of pilots' : '';
        return '<div class="portal-achievement' + (earned ? ' earned' : '') + '" title="' + (rarityLabel || def.label) + '">' +
          '<div class="portal-achievement__icon">' + def.icon + '</div>' +
          '<div class="portal-achievement__label">' + def.label + '</div>' +
          (rarityLabel ? '<div class="portal-achievement__rarity">' + rarityLabel + '</div>' : '') +
        '</div>';
      }).join('');
      return '<div class="portal-achievements-category">' +
        '<div class="portal-achievements-category__head">' + (ACHIEVEMENT_CATEGORY_LABELS[cat] || cat) + ' <span>' + earnedCount + '/' + defsInCat.length + '</span></div>' +
        '<div class="portal-achievements">' + cards + '</div>' +
      '</div>';
    }).join('');

    // Rendered in two places: Account Management (original location) and
    // Readiness & Analytics (Progress page) -- same data, same markup,
    // just surfaced somewhere students actually look instead of buried
    // only in account settings.
    ['achievementsGrid', 'achievementsGridProgress'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = html;
    });
  }

  var CADENCE_LABELS = { weekly: 'This Week', monthly: 'This Month', seasonal: 'Seasonal Event' };

  // Missions and progress are both server-computed (missions/
  // member_mission_progress, refreshed by refresh_mission_progress() on
  // the lifecycle cron -- supabase-portal-schema-v50.sql) -- this just
  // reads and renders, same trust boundary as everything else fetched
  // from these RLS-protected tables.
  function renderMissions() {
    var el = document.getElementById('missionsList');
    if (!el || !member) return;
    var today = getTodayStr();
    apexSupabase.from('missions').select('*').lte('starts_on', today).gte('ends_on', today).order('cadence').then(function (missionsRes) {
      // Apex Advantage Membership isn't public yet (admin-only preview,
      // see renderAdminIfApplicable/enforceAskAndrewAccess) -- showing a
      // "Requires Membership" mission to a regular member would advertise
      // an unreleased product before it's ready. Admin still sees these
      // so Andrew can test the mission before launch.
      var missions = (missionsRes.data || []).filter(function (m) {
        return !m.is_premium_only || (member && member.role === 'admin');
      });
      if (!missions.length) {
        el.innerHTML = '<p style="color:rgba(255,255,255,0.4);font-size:13px">No missions are active right now — check back soon.</p>';
        return;
      }
      apexSupabase.from('member_mission_progress').select('mission_id, progress, target, completed_at').eq('profile_id', member.id).then(function (progressRes) {
        var progressByMission = {};
        (progressRes.data || []).forEach(function (p) { progressByMission[p.mission_id] = p; });

        el.innerHTML = missions.map(function (m) {
          var p = progressByMission[m.id];
          // Premium-only missions are skipped entirely by refresh_mission_
          // progress() (v51) for a profile with no active Membership --
          // no progress row means "not eligible", not "0% done".
          var membershipLocked = m.is_premium_only && !p;
          var progress = p ? p.progress : 0;
          var target = p ? p.target : 1;
          var pct = Math.min(100, Math.round((progress / Math.max(target, 1)) * 100));
          var done = !!(p && p.completed_at);
          return '<div class="portal-card portal-mission' + (done ? ' portal-mission--done' : '') + '" style="margin-bottom:16px">' +
            '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px">' +
              '<div>' +
                '<span class="portal-header__eyebrow">' + (CADENCE_LABELS[m.cadence] || m.cadence) + (m.is_premium_only ? ' · Membership' : '') + '</span>' +
                '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-top:6px">' + m.title + '</h3>' +
              '</div>' +
              '<span style="color:#F4B400;font-size:13px;font-weight:700;white-space:nowrap">' + (done ? '✓ Complete' : '+' + m.xp_reward + ' XP') + '</span>' +
            '</div>' +
            (m.description ? '<p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:12px">' + m.description + '</p>' : '') +
            (membershipLocked
              ? '<p style="color:rgba(244,180,0,0.7);font-size:12.5px">🔒 Requires Apex Advantage Membership — <a href="#account" style="color:#F4B400">join in Account Management</a></p>'
              : '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + pct + '%"></div></div>' +
                '<p style="color:rgba(255,255,255,0.4);font-size:12px;margin-top:6px">' + Math.min(progress, target) + ' / ' + target + '</p>') +
            (m.premium_reward ? '<p style="color:rgba(244,180,0,0.7);font-size:12px;margin-top:6px">🏆 ' + m.premium_reward + '</p>' : '') +
          '</div>';
        }).join('');
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     PILOT JOURNEY — real aviation progress, separate from XP.
     journey_milestone_types is a reference table (v52), not a
     hardcoded list here, so a future certificate/rating just needs a
     new row server-side, never a client code change. Verification
     (self-reported vs instructor/Apex verified) is decided entirely
     server-side (trg_protect_milestone_verification) -- this code
     never has a path to mark its own entry verified.
     ══════════════════════════════════════════════════════════════ */
  var VERIFICATION_BADGES = {
    self_reported: '<span style="color:rgba(255,255,255,0.4);font-size:11px">Self-reported</span>',
    instructor_verified: '<span style="color:#4ade80;font-size:11px">✓ Instructor Verified</span>',
    apex_verified: '<span style="color:#F4B400;font-size:11px">✓ Apex Verified</span>',
  };

  function openMilestoneForm(milestoneType, existing) {
    var overlay = document.getElementById('passedOverlay');
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="portal-practice-panel">' +
        '<button class="portal-practice-panel__close" id="journeyFormCloseBtn" type="button">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<h3 style="color:#fff;font-size:18px;font-weight:700;margin-bottom:18px">' + milestoneType.label + '</h3>' +
        '<div class="form-group" style="margin-bottom:14px"><label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Date</label>' +
          '<input type="date" id="journeyFormDate" value="' + (existing ? existing.achieved_on : getTodayStr()) + '" style="width:100%;padding:11px 14px;border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none" /></div>' +
        '<div class="form-group" style="margin-bottom:14px"><label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Notes (optional)</label>' +
          '<textarea id="journeyFormNotes" rows="2" style="width:100%;padding:11px 14px;border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none;resize:vertical">' + (existing && existing.notes ? existing.notes : '') + '</textarea></div>' +
        '<div class="form-group" style="margin-bottom:20px"><label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Reflection (optional) — how did it feel?</label>' +
          '<textarea id="journeyFormReflection" rows="3" style="width:100%;padding:11px 14px;border:1.5px solid rgba(255,255,255,0.1);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none;resize:vertical">' + (existing && existing.reflection ? existing.reflection : '') + '</textarea></div>' +
        '<button class="btn btn--primary btn--full" id="journeyFormSaveBtn">Save Milestone</button>' +
      '</div>';
    document.getElementById('journeyFormCloseBtn').addEventListener('click', function () { overlay.hidden = true; });
    document.getElementById('journeyFormSaveBtn').addEventListener('click', function () {
      var achievedOn = document.getElementById('journeyFormDate').value || getTodayStr();
      var notes = document.getElementById('journeyFormNotes').value.trim();
      var reflection = document.getElementById('journeyFormReflection').value.trim();
      apexSupabase.from('member_milestones').upsert({
        profile_id: member.id,
        milestone_key: milestoneType.milestone_key,
        achieved_on: achievedOn,
        notes: notes || null,
        reflection: reflection || null,
      }, { onConflict: 'profile_id,milestone_key' }).then(function (res) {
        if (res.error) { toast('Could not save: ' + res.error.message); return; }
        overlay.hidden = true;
        toast('🎉 Milestone logged: ' + milestoneType.label);
        renderPilotJourney();
      });
    });
  }

  function renderPilotJourney() {
    var el = document.getElementById('pilotJourneyList');
    if (!el || !member) return;
    Promise.all([
      apexSupabase.from('journey_milestone_types').select('*').order('sort_order'),
      apexSupabase.from('member_milestones').select('*').eq('profile_id', member.id),
    ]).then(function (results) {
      var types = results[0].data || [];
      var logged = {};
      (results[1].data || []).forEach(function (m) { logged[m.milestone_key] = m; });

      el.innerHTML = types.map(function (t) {
        var m = logged[t.milestone_key];
        if (m) {
          var dateLabel = new Date(m.achieved_on + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          return '<div class="portal-card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px">' +
            '<div>' +
              '<h3 style="color:#fff;font-size:14.5px;font-weight:700;margin-bottom:3px">✓ ' + t.label + '</h3>' +
              '<p style="color:rgba(255,255,255,0.45);font-size:12.5px;margin-bottom:4px">' + dateLabel + '</p>' +
              (m.notes ? '<p style="color:rgba(255,255,255,0.5);font-size:12.5px;margin-bottom:4px">' + m.notes + '</p>' : '') +
              (VERIFICATION_BADGES[m.verification_status] || '') +
            '</div>' +
            '<button class="btn-link-journey" data-edit-milestone="' + t.milestone_key + '" style="background:none;border:none;color:#F4B400;font-size:12.5px;cursor:pointer;white-space:nowrap">Edit</button>' +
          '</div>';
        }
        return '<div class="portal-card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:12px;opacity:0.55">' +
          '<h3 style="color:#fff;font-size:14.5px;font-weight:600">' + t.label + '</h3>' +
          '<button class="btn btn--ghost" data-log-milestone="' + t.milestone_key + '" style="white-space:nowrap;padding:8px 14px;font-size:12.5px">Log This Milestone</button>' +
        '</div>';
      }).join('');

      el.querySelectorAll('[data-log-milestone]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = types.find(function (x) { return x.milestone_key === btn.dataset.logMilestone; });
          if (t) openMilestoneForm(t, null);
        });
      });
      el.querySelectorAll('[data-edit-milestone]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var key = btn.dataset.editMilestone;
          var t = types.find(function (x) { return x.milestone_key === key; });
          if (t) openMilestoneForm(t, logged[key]);
        });
      });
    });
  }

  function loadAchievementRarity() {
    apexSupabase.rpc('get_achievement_rarity').then(function (res) {
      (res.data || []).forEach(function (r) { achievementRarity[r.achievement_key] = r.pct_earned; });
      renderAchievements();
    });
  }

  function checkAchievements() {
    if (!DPE_DATA.length) return; // not unlocked yet — nothing meaningful to check (avoids vacuous-true achievement tests like .every() on an empty array)
    var newlyEarned = [];
    allAchievementDefs().forEach(function (def) {
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
      apexSupabase.from('portal_access_purchases').select('tier,amount_cents,created_at'),
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
      var statusText = r.status === 'rewarded' && r.redeemed_at ? 'rewarded (redeemed)' : r.status;
      return '<div class="portal-referral-row" data-referral-row="' + r.id + '"><span class="email">' + referrerName + ' → ' + r.referred_email + '</span><span style="display:flex;align-items:center"><span class="status">' + statusText + '</span>' + actionBtn + '</span></div>';
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
    // Apex Advantage Membership isn't public yet -- same admin-only
    // feature-preview treatment as Guided Notes above, until it's ready
    // to launch to real members.
    document.getElementById('askAndrewNavItem').hidden = false;
    document.getElementById('membershipCard').hidden = false;
  }

  // Catches a non-admin who bookmarked or typed #guided-notes directly.
  // The very first showSection() call (script init, before the Supabase
  // session/profile resolves) can't check member.role yet -- this runs
  // once it's known. Real enforcement is still server-side: guided_notes'
  // RLS policy rejects the query regardless of what the UI shows.
  function enforceGuidedNotesAccess() {
    var activeId = (window.location.hash || '#dashboard').replace('#', '');
    if (activeId === 'guided-notes' && (!member || member.role !== 'admin')) showSection('dashboard');
  }

  // Same admin-only-preview boundary as enforceGuidedNotesAccess() above,
  // for Ask Andrew -- Apex Advantage Membership isn't public yet. Real
  // enforcement is still server-side: ai-cfi-chat's requireCapability()
  // check rejects any non-Member/non-admin regardless of what the UI shows.
  function enforceAskAndrewAccess() {
    var activeId = (window.location.hash || '#dashboard').replace('#', '');
    if (activeId === 'ask-andrew' && (!member || member.role !== 'admin')) showSection('dashboard');
  }

  /* ── Checkride Prep member-upgrade deep link (?upgrade=checkride-prep) ──
     For the email/retargeting conversion flow -- lets a link skip
     straight to the existing unlock modal instead of a member having to
     find a locked feature to tap first. The query param NEVER grants
     access on its own; it only decides whether to call the same
     openUnlockModal()/showSection() this page already uses everywhere
     else. Real entitlement is still exactly what applyUnlockState() and
     get-premium-content's server-side check already enforce.

     Runs once, from initPortalData() (member state is guaranteed
     populated by then), and strips the param via replaceState right
     after acting on it -- refresh, back-button, or closing the modal
     must not repeatedly reopen it, only a fresh click on the email link
     should. UTM params are left in the URL (useful for anything reading
     them from the address bar later, e.g. a support screenshot); they're
     already captured into localStorage by analytics-events.js
     regardless of when/whether this URL gets cleaned. ─────────────── */
  // Growth Sprint section 18 -- content deep links. Reuses the exact
  // normalize+word-subset matcher already built for the Ground School
  // weak-area cross-sell (findGsClassForWeakArea/normalizeGsMatchWords)
  // to resolve a real ?topic= param (e.g. a Weather video's link) to a
  // real dpe_categories row, then hands off to the existing
  // goToCategory()/showSection() routing -- no new navigation mechanism.
  // No-ops for locked members rather than forcing an unlock pitch:
  // CATEGORY_META is empty until checkridePrepUnlocked anyway, and
  // enforceUpgradeDeepLink() below already owns the "sell the unlock"
  // deep-link path via ?upgrade=checkride-prep.
  function enforceTopicDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var topic = params.get('topic');
    if (!topic || !member || !member.checkridePrepUnlocked) return;
    var topicWords = normalizeGsMatchWords(topic);
    if (!topicWords.length) return;
    var cat = Object.keys(CATEGORY_META).filter(function (c) {
      var haystack = normalizeGsMatchWords(CATEGORY_META[c].label);
      return topicWords.every(function (w) { return haystack.indexOf(w) !== -1; });
    })[0];
    if (!cat) return;
    goToCategory(cat);
    params.delete('topic');
    var cleanedSearch = params.toString();
    if (history.replaceState) history.replaceState(null, '', window.location.pathname + (cleanedSearch ? '?' + cleanedSearch : '') + window.location.hash);
    if (window.apexTrack) apexTrack('content_deeplink_topic_matched', { topic: topic, category: cat });
  }

  function enforceUpgradeDeepLink() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('upgrade') !== 'checkride-prep') return;

    params.delete('upgrade');
    var cleanedSearch = params.toString();
    var cleanedUrl = window.location.pathname + (cleanedSearch ? '?' + cleanedSearch : '') + window.location.hash;

    if (member && member.checkridePrepUnlocked) {
      // Already owns it -- take them to the section itself rather than
      // showing an "unlock" pitch for something they already have.
      showSection('checkride-prep');
      if (history.replaceState) history.replaceState(null, '', cleanedUrl);
      return;
    }

    if (window.apexTrack) {
      apexTrack('checkride_prep_upgrade_deeplink_viewed', {
        source: params.get('utm_source') || null,
        campaign: params.get('utm_campaign') || null,
        content: params.get('utm_content') || null,
        member_state: member ? (member.role || 'student') : 'unknown'
      });
    }
    openUnlockModal();
    if (window.apexTrack) apexTrack('checkride_prep_upgrade_modal_opened', { trigger: 'deeplink' });
    if (history.replaceState) history.replaceState(null, '', cleanedUrl);
  }

  /* ══════════════════════════════════════════════════════════════
     GUIDED NOTES — admin-only feature preview.

     Per-prompt free-text responses a student will eventually fill in on
     every Apex Advantage module page. Hidden from students entirely for
     now: the nav item stays `hidden` unless renderAdminIfApplicable()
     unhides it, and showSection()/enforceGuidedNotesAccess() bounce any
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
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M04-FARs-Simplified',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 04 · FARs Simplified',
      prompts: [
        { id: 'part-authority', section: 'Foundations', prompt: 'What is the difference between what Part 61, Part 91, and Part 43 each govern, and why is emergency authority under § 91.3(b) not a “blank check”?' },
        { id: 'currency-vs-proficiency', section: 'Currency & Medical', prompt: 'What is the difference between currency and proficiency, and what are the day and night passenger-currency requirements under § 61.57?' },
        { id: 'arrow-aviates', section: 'Documents & Inspections', prompt: 'What do the five ARROW documents and the AV1ATES inspections cover, and how does a Service Bulletin differ from an Airworthiness Directive?' },
        { id: 'inoperative-equipment', section: 'Required & Inoperative Equipment', prompt: 'When a piece of equipment is inoperative, how does the decision differ depending on whether the aircraft has an approved Minimum Equipment List (MEL)?' },
        { id: 'right-of-way-altitudes-fuel', section: 'Right-of-Way, Altitudes & Fuel', prompt: 'What are the right-of-way rules for head-on, converging, and overtaking traffic, and what are the minimum fuel reserves for day and night VFR?' },
        { id: 'imsafe-6hits', section: 'Personal Fitness & Airspace Equipment', prompt: 'What does 6-HITS check that IMSAFE alone does not, and in which classes of airspace — and above what altitude — is ADS-B Out required?' },
        { id: 'legal-vs-safe', section: 'Putting It Together', prompt: 'Why doesn’t meeting every regulatory minimum automatically mean a flight is a good idea — what’s the difference between legal and safe?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M05-Airspace-Mastery',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 05 · Airspace Mastery',
      prompts: [
        { id: 'controlled-vs-uncontrolled', section: 'Foundations', prompt: 'What is the difference between controlled and uncontrolled airspace, and what are the six classes from most to least structured?' },
        { id: 'class-g-class-e', section: 'Class G & Class E', prompt: 'What determines where Class G ends and Class E begins, and why doesn’t the absence of a control tower mean the airspace is uncontrolled?' },
        { id: 'class-d', section: 'Class D', prompt: 'What does it mean for two-way communication to be “established” before entering Class D airspace, and what equipment does Class D require?' },
        { id: 'class-c', section: 'Class C', prompt: 'How does Class C’s core-and-shelf structure work, and what equipment does Class C require beyond Class D?' },
        { id: 'class-b', section: 'Class B', prompt: 'How does the clearance required to enter Class B differ from the communication-established standard in Class C/D, and what training do student pilots need before flying into Class B airspace?' },
        { id: 'class-a-special-use', section: 'Class A & Special Use Airspace', prompt: 'Why is VFR never permitted in Class A airspace, and how do Restricted Areas, Warning Areas, and MOAs differ in what they require of a VFR pilot?' },
        { id: 'sectional-chart-mastery', section: 'Other Airspace & Sectional Chart Mastery', prompt: 'What do solid vs. dashed blue and magenta lines represent on a sectional chart, and why can a TFR never be confirmed from a printed chart alone?' },
        { id: 'airspace-decision-framework', section: 'Putting It Together', prompt: 'What are the five steps of the airspace decision framework, and why does the same sequence work for every class of airspace, not just one?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M06-Airport-Operations',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 06 · Airport Operations',
      prompts: [
        { id: 'runway-markings-signs', section: 'Runway Markings & Signage', prompt: 'What do hold-short lines, the ILS critical area marking, and a displaced threshold each tell you, and what’s your required action at each?' },
        { id: 'traffic-pattern', section: 'Traffic Pattern', prompt: 'What is a standard traffic pattern entry at a non-towered airport, and what determines pattern altitude and direction of turns?' },
        { id: 'communication-procedures', section: 'Communication Procedures', prompt: 'What is the ground/tower communication sequence at a towered airport, and how does that compare to the CTAF self-announce sequence at a non-towered field?' },
        { id: 'runway-incursion', section: 'Runway Incursion Avoidance', prompt: 'What is a runway incursion hot spot, and why does read-back discipline matter when you’re instructed to hold short?' },
        { id: 'lighting-systems', section: 'Lighting Systems', prompt: 'How do you interpret a PAPI or VASI on approach, and how does pilot-controlled lighting (PCL) work at an airport without a tower?' },
        { id: 'wake-turbulence', section: 'Wake Turbulence', prompt: 'What is wake turbulence, and how do you adjust your flightpath to avoid it when following a larger aircraft?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M07-Sectional-Charts',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 07 · Sectional Charts',
      prompts: [
        { id: 'airport-symbology', section: 'Airport Symbols', prompt: 'What does an airport symbol tell you about whether it’s towered, what services are available, and runway length?' },
        { id: 'airspace-boundary-lines', section: 'Airspace Boundaries', prompt: 'What’s the difference between the solid blue, dashed blue, and magenta lines used to depict airspace boundaries on a sectional?' },
        { id: 'terrain-obstacles', section: 'Terrain & Obstacles', prompt: 'How do contour colors and Maximum Elevation Figures (MEFs) help you judge terrain and obstacle clearance along a route?' },
        { id: 'special-use-airspace-depiction', section: 'Special Use Airspace', prompt: 'How is special use airspace depicted and labeled on a sectional, and how would you check whether it’s currently active?' },
        { id: 'navaid-symbology', section: 'Navaid Symbology', prompt: 'What information does a VOR compass rose and frequency box give you, and how do you confirm you’re tuned to the correct station?' },
        { id: 'measuring-tools', section: 'Measuring Tools', prompt: 'How do you use a plotter to measure true course and distance on a sectional?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M08-Pilotage-Dead-Reckoning',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 08 · Pilotage & Dead Reckoning',
      prompts: [
        { id: 'course-heading-conversion', section: 'Course to Heading', prompt: 'What is the conversion chain from true course to magnetic course to compass heading, and what gets applied at each step?' },
        { id: 'wind-correction', section: 'Wind Triangle & Correction Angle', prompt: 'What is a wind correction angle, and how do you find it using an E6B — manual or electronic?' },
        { id: 'groundspeed-ete', section: 'Groundspeed & ETE', prompt: 'How do you calculate groundspeed and estimated time en route for a planned leg?' },
        { id: 'fuel-planning-pilotage', section: 'Fuel Planning', prompt: 'What goes into total fuel required for a flight, including the required reserve?' },
        { id: 'variation-deviation', section: 'Variation & Deviation', prompt: 'What is the difference between magnetic variation and compass deviation, and where does each correction come from?' },
        { id: 'lost-procedures', section: 'Lost Procedures', prompt: 'What is the “4 C’s” lost procedure, and how would you use pilotage to re-fix your position if your GPS failed?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M09-Navigation-Systems',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 09 · Navigation Systems',
      prompts: [
        { id: 'gps-waas-fundamentals', section: 'GPS & WAAS Fundamentals', prompt: 'What does WAAS add to basic GPS accuracy, and what does a RAIM/GPS integrity warning mean to a pilot?' },
        { id: 'gps-programming', section: 'GPS Programming', prompt: 'How do you program a direct-to or a full flight plan route in a G1000/GNS430-class unit, and how would you verify it’s correct before trusting it?' },
        { id: 'vor-theory', section: 'VOR Theory', prompt: 'What do radials, the TO/FROM flag, and CDI sensitivity each tell you when navigating by VOR?' },
        { id: 'vor-accuracy-checks', section: 'VOR Accuracy Checks', prompt: 'What are the ways to check VOR receiver accuracy, and how often is a check required?' },
        { id: 'dme-autopilot', section: 'DME & Autopilot', prompt: 'What does DME slant range actually measure, and what do the basic autopilot modes — heading, nav, altitude hold — each do?' },
        { id: 'nav-system-failures', section: 'System Failure Indications', prompt: 'What indications tell you a GPS or VOR system has failed or degraded, and what’s your backup?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M10-Weather-Theory',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 10 · Weather Theory',
      prompts: [
        { id: 'atmosphere-pressure', section: 'Atmosphere & Pressure', prompt: 'What is the standard lapse rate, and how do pressure and temperature change with altitude in the standard atmosphere?' },
        { id: 'fronts', section: 'Air Masses & Fronts', prompt: 'What weather is typically associated with a cold front versus a warm front?' },
        { id: 'stability', section: 'Stability & Cloud Formation', prompt: 'What’s the difference between a stable and an unstable air mass, and how does cloud type indicate which one you’re in?' },
        { id: 'thunderstorm-lifecycle', section: 'Thunderstorms', prompt: 'What are the three stages of a thunderstorm’s life cycle, and what hazard is most associated with each?' },
        { id: 'icing', section: 'Icing', prompt: 'What conditions are most favorable for structural icing, and what’s the difference between rime, clear, and mixed ice?' },
        { id: 'density-altitude-windshear', section: 'Density Altitude & Wind Shear', prompt: 'What is density altitude and how does it affect performance, and what are the main sources of wind shear a VFR pilot might encounter?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M11-Weather-Products',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 11 · Weather Products',
      prompts: [
        { id: 'metar-taf', section: 'METAR & TAF', prompt: 'How do you fully decode a METAR and a TAF without a reference card?' },
        { id: 'surface-analysis', section: 'Surface Analysis Chart', prompt: 'What do the symbols on a surface analysis chart tell you about fronts and pressure systems along your route?' },
        { id: 'airmet-sigmet', section: 'AIRMETs & SIGMETs', prompt: 'What’s the difference between an AIRMET, a SIGMET, and a convective SIGMET, and what does each warn about?' },
        { id: 'gfa', section: 'Graphical Forecast for Aviation', prompt: 'How do you use the GFA’s clouds/weather and turbulence/icing panels to plan a route?' },
        { id: 'pirep', section: 'PIREPs', prompt: 'What information does a PIREP give you that a forecast alone can’t, and what would you include if filing one?' },
        { id: 'briefing-sources', section: 'Getting a Briefing', prompt: 'What are the standard sources for obtaining a weather briefing before a cross-country flight?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M12-Weather-Decision-Making',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 12 · Weather Decision Making',
      prompts: [
        { id: 'personal-minimums', section: 'Personal Minimums', prompt: 'What are personal minimums, and why might they be more conservative than legal VFR minimums?' },
        { id: 'deteriorating-weather', section: 'Recognizing Deteriorating Weather', prompt: 'What in-flight cues tell you conditions are deteriorating, and what triggers a 180-degree turn decision?' },
        { id: 'diversion', section: 'Diversion Planning', prompt: 'What does the decision process for a precautionary landing or diversion actually look like?' },
        { id: 'vfr-into-imc', section: 'VFR-into-IMC Risk', prompt: 'Why is VFR-into-IMC one of the highest-fatality accident categories, and what human factors typically lead a pilot into it?' },
        { id: 'risk-frameworks', section: 'Risk Assessment Frameworks', prompt: 'How would you apply the PAVE checklist or the 3P model specifically to a weather go/no-go decision?' },
        { id: 'scud-running', section: 'Scud Running & Get-There-Itis', prompt: 'What is scud running, and why is “get-there-itis” considered a weather-specific hazardous attitude?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M13-Weight-Balance',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 13 · Weight & Balance',
      prompts: [
        { id: 'wb-terminology', section: 'Weight & Balance Terminology', prompt: 'What is the difference between empty weight, useful load, ramp weight, and moment?' },
        { id: 'wb-methods', section: 'Calculation Methods', prompt: 'How do the POH computation method and the graphical method each arrive at your loaded CG?' },
        { id: 'cg-effects', section: 'CG Aerodynamic Effects', prompt: 'What happens aerodynamically if you’re loaded outside the forward or aft CG limit?' },
        { id: 'cg-envelope', section: 'CG Envelope', prompt: 'How do you read a CG envelope graph to determine if a loading is legal?' },
        { id: 'fuel-burnoff', section: 'Fuel Burn-Off Shift', prompt: 'How does your CG shift as fuel burns off during a flight, and why does that matter for a flight near the CG limit?' },
        { id: 'wb-records', section: 'Aircraft Records', prompt: 'Where do you find your specific aircraft’s empty weight and moment, and why can’t you assume it matches another aircraft of the same model?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M14-Aircraft-Performance',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 14 · Aircraft Performance',
      prompts: [
        { id: 'poh-charts', section: 'POH Performance Charts', prompt: 'How do you read a POH performance chart in table versus graph format to find takeoff and landing distance?' },
        { id: 'density-altitude-performance', section: 'Density Altitude Effects', prompt: 'How does density altitude affect your takeoff roll, climb rate, and landing distance?' },
        { id: 'wind-components', section: 'Wind Component Calculations', prompt: 'How do you calculate the headwind and crosswind components for a given wind and runway?' },
        { id: 'runway-considerations', section: 'Runway Considerations', prompt: 'How do runway surface, slope, and contamination each change your takeoff and landing performance?' },
        { id: 'climb-performance', section: 'Climb Performance', prompt: 'What factors degrade climb performance, and what does service ceiling actually mean?' },
        { id: 'cruise-performance', section: 'Cruise Performance', prompt: 'How do you plan cruise performance — power setting, true airspeed, and fuel flow — for a given leg?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M15-Cross-Country-Planning',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 15 · Cross-Country Planning',
      prompts: [
        { id: 'nav-log', section: 'Navigation Log', prompt: 'What does a complete navigation log include for each leg of a cross-country flight?' },
        { id: 'cruising-altitude', section: 'Cruising Altitude Selection', prompt: 'How do the hemispheric rule, terrain, and airspace each factor into your choice of cruising altitude?' },
        { id: 'total-fuel-planning', section: 'Total Fuel Planning', prompt: 'What goes into your total fuel required for a full cross-country route, including reserves?' },
        { id: 'alternate-selection', section: 'Alternates & Contingencies', prompt: 'What criteria would you use to select an alternate or contingency airport along your route?' },
        { id: 'vfr-flight-plan', section: 'Filing a VFR Flight Plan', prompt: 'Why is filing a VFR flight plan good practice even though it isn’t required, and what do activation and closing actually involve?' },
        { id: 'cross-country-integration', section: 'Putting It Together', prompt: 'How does a complete cross-country plan integrate navigation, weather, performance, and regulatory knowledge into one package?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M16-Aeronautical-Decision-Making',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 16 · Aeronautical Decision Making',
      prompts: [
        { id: 'pave-checklist', section: 'PAVE Checklist', prompt: 'What are the four components of the PAVE checklist, and how would you apply it to today’s flight?' },
        { id: '3p-model', section: '3P Model', prompt: 'What do Perceive, Process, and Perform each mean in the 3P decision-making model?' },
        { id: 'hazardous-attitudes', section: 'Hazardous Attitudes', prompt: 'What are the five hazardous attitudes, and what’s the antidote to each?' },
        { id: 'imsafe', section: 'IMSAFE', prompt: 'What does IMSAFE stand for, and how would you use it before a flight?' },
        { id: 'srm', section: 'Single-Pilot Resource Management', prompt: 'What is single-pilot resource management, and how does it apply when you’re flying alone?' },
        { id: 'external-pressures', section: 'External Pressures', prompt: 'What are common sources of external pressure on a pilot’s decisions, and how can they distort judgment?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M17-Human-Factors',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 17 · Human Factors',
      prompts: [
        { id: 'hypoxia', section: 'Hypoxia', prompt: 'What are the types of hypoxia, and at what altitudes should a pilot start being concerned?' },
        { id: 'spatial-disorientation', section: 'Spatial Disorientation', prompt: 'What illusions can cause spatial disorientation, and why are they dangerous even to an experienced pilot?' },
        { id: 'fatigue', section: 'Fatigue', prompt: 'What’s the difference between acute and chronic fatigue, and how does each affect decision-making and reaction time?' },
        { id: 'alcohol-drugs', section: 'Alcohol, Drugs & Medications', prompt: 'What is the FAA’s rule on alcohol and flying, and why can even an over-the-counter medication ground you?' },
        { id: 'stress-tunneling', section: 'Stress & Cognitive Tunneling', prompt: 'How does stress affect cognitive performance, and what does “tunneling” under workload look like in the cockpit?' },
        { id: 'co-poisoning', section: 'Carbon Monoxide', prompt: 'How can carbon monoxide enter the cabin of a piston aircraft, and how would you detect it?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M18-Emergency-Procedures',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 18 · Emergency Procedures',
      prompts: [
        { id: 'engine-failure-takeoff', section: 'Engine Failure After Takeoff', prompt: 'What is the “impossible turn,” and what is the standard procedure if your engine fails immediately after takeoff?' },
        { id: 'engine-failure-flight', section: 'Engine Failure In Flight', prompt: 'What is best glide speed, and how do you go about selecting a field and setting up a forced landing pattern?' },
        { id: 'inflight-restart', section: 'In-Flight Restart', prompt: 'What’s the general procedure for attempting an in-flight engine restart?' },
        { id: 'fire-procedures', section: 'Fire Procedures', prompt: 'How does your response differ between an engine fire on the ground, an engine fire in flight, and an electrical or cabin fire?' },
        { id: 'memory-items', section: 'Memory Items vs. Checklist Items', prompt: 'What’s the difference between a memory item and a checklist-read item, and why does that distinction matter under stress?' },
        { id: 'post-emergency', section: 'Emergency Communication & Post-Landing', prompt: 'What are your priorities for emergency communication — like squawking 7700 — and for what happens immediately after a forced landing?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M19-ACS-Mastery',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 19 · ACS Mastery',
      prompts: [
        { id: 'acs-structure', section: 'ACS Structure', prompt: 'What are the three elements — knowledge, risk management, skill — within an ACS Task, and how do they differ from each other?' },
        { id: 'special-emphasis-areas', section: 'Special Emphasis Areas', prompt: 'What is a special emphasis area, and can you name three that appear throughout the practical test?' },
        { id: 'maneuver-tolerances', section: 'Maneuver Tolerances', prompt: 'Where do you find the tolerances for a maneuver in the ACS, and what happens if you bust one momentarily?' },
        { id: 'examiner-plan', section: 'Examiner’s Plan of Action', prompt: 'What is an examiner’s Plan of Action, and how does it affect which Tasks get combined or tested?' },
        { id: 'aktr-crossref', section: 'Knowledge Test Report', prompt: 'How would you use your Knowledge Test report (AKTR) and its ACS codes to focus your checkride prep?' }
      ]
    },
    {
      courseId: 'PPL',
      moduleId: 'PPL-M20-Mock-Oral-Exam',
      courseLabel: 'Private Pilot',
      moduleLabel: 'Module 20 · Mock Oral Exam',
      prompts: [
        { id: 'reference-technique', section: 'Using References Live', prompt: 'What’s the difference between using your references well during an oral exam versus relying on pure memorization?' },
        { id: 'admitting-uncertainty', section: 'Composure Under Uncertainty', prompt: 'What’s the right way to handle a question you don’t immediately know the answer to during your oral exam?' },
        { id: 'dpe-follow-ups', section: 'DPE Follow-Up Patterns', prompt: 'What are common DPE follow-up question patterns — “why,” “what if,” “show me where” — and why do they matter more than the first answer?' },
        { id: 'weak-areas', section: 'Self-Assessment', prompt: 'Based on tonight’s mock oral, what are your two weakest topics, and what’s your plan to address them before your checkride?' }
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
    // Log-before-send, mirroring send-lifecycle-emails' processWeakArea:
    // only actually send once the log row is confirmed written, so a
    // reload that re-hydrates emailedTypes from a not-yet-committed (or
    // never-committed, e.g. this insert racing the daily cron's own
    // log-then-send for the same member+category) row can't slip past
    // the daysSinceEmail() check above and re-send the same email.
    // Sending first and logging as an unchecked fire-and-forget (the
    // previous behavior here) meant a failed or merely-slow insert left
    // no record to block the next page load from sending again.
    apexSupabase.from('portal_email_log').insert({ profile_id: member.id, email_type: emailType }).then(function (res) {
      if (res.error) return;
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

    var isFirstLogin = !loggedEventTypes['first_login'];
    logEventOnce('first_login');
    if (isFirstLogin && window.apexTrack) apexTrack('portal_first_login', { profile_id: member.id });
    // CompleteRegistration -- fires once, at the member's actual first
    // login (password set + portal opened for real), not at account
    // creation (that's Lead, fired in portal-login.html's signup
    // handler). This is the "portal signup completion" moment.
    if (isFirstLogin && window.apexTrackStandard) apexTrackStandard('CompleteRegistration', { content_name: 'Apex Advantage Portal' });
    if (isFirstLogin) showWelcomeOnboarding();

    if (DPE_DATA.some(function (d) { return studied[d.id]; })) {
      var wasNew = !loggedEventTypes['first_question_completed'];
      logEventOnce('first_question_completed');
      if (wasNew) {
        sendPortalEmail(member.email, 'You completed your first question 🎉', emailTemplate1FirstQuestion());
        logEmailSent('first_question_completed');
        if (window.apexTrack) apexTrack('first_lesson_completed', { profile_id: member.id });
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

  // Lightweight first-session welcome -- shown exactly once (gated on the
  // same isFirstLogin flag as the CompleteRegistration pixel event above,
  // so it can never reappear on a later login). Three low-commitment
  // actions, no purchase CTA -- a brand-new free member should get
  // oriented before any contextual conversion logic (getMemberConversionState
  // below) starts recommending paid products.
  // Two quick questions (training_stage, primary_focus_area --
  // supabase-portal-schema-v70.sql), then a real, completable first task
  // -- not the old 3 static buttons, which asked nothing and fed no
  // signal into any recommendation. Same isFirstLogin gate as before, so
  // this can never reappear on a later login; each step's answer is
  // saved to profiles the moment it's picked (not batched at the end),
  // so a member who dismisses mid-flow still keeps whatever they already
  // answered. No purchase CTA anywhere in this flow.
  function showWelcomeOnboarding() {
    var card = document.getElementById('welcomeOnboardingCard');
    if (!card) return;
    card.hidden = false;
    document.getElementById('welcomeOnboardingName').textContent = firstName(member.name);
    document.getElementById('welcomeOnboardingDismiss').addEventListener('click', function () {
      card.hidden = true;
    });

    var step1 = document.getElementById('welcomeOnboardingStep1');
    var step2 = document.getElementById('welcomeOnboardingStep2');
    var step3 = document.getElementById('welcomeOnboardingStep3');

    document.querySelectorAll('[data-onboarding-stage] [data-value]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var value = btn.dataset.value;
        apexSupabase.from('profiles').update({ training_stage: value }).eq('id', member.id);
        if (window.apexTrack) apexTrack('onboarding_training_goal_saved', { training_stage: value });
        step1.hidden = true;
        step2.hidden = false;
      });
    });

    document.querySelectorAll('[data-onboarding-focus] [data-value]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var value = btn.dataset.value;
        apexSupabase.from('profiles').update({ primary_focus_area: value }).eq('id', member.id);
        if (window.apexTrack) apexTrack('onboarding_focus_area_saved', { primary_focus_area: value });
        step2.hidden = true;
        step3.hidden = false;

        var plan = computeTrainingPlan();
        var firstTask = plan.tasks.filter(function (t) { return !t.done; })[0] || plan.tasks[0];
        var labelEl = document.getElementById('welcomeOnboardingFirstTaskLabel');
        if (labelEl) labelEl.textContent = firstTask ? firstTask.label : 'Explore your dashboard';
        var goFn = firstTask ? firstTask.go : function () { showSection('dashboard'); };

        var startFirstTask = function () {
          card.hidden = true;
          if (window.apexTrack) apexTrack('onboarding_first_training_started', { task: firstTask ? firstTask.label : null });
          goFn();
        };
        var taskBtn = document.getElementById('welcomeOnboardingFirstTask');
        var startBtn = document.getElementById('welcomeOnboardingStartBtn');
        if (taskBtn) taskBtn.onclick = startFirstTask;
        if (startBtn) startBtn.onclick = startFirstTask;
      });
    });
  }

  function emailTemplate1FirstQuestion() {
    return '<h2 style="color:#F4B400;margin:0 0 4px;">First question, done.</h2>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:15px;line-height:1.7;">That\'s one down, 71 to go — and every one after this gets a little more familiar. Keep the momentum going.</p>' +
      '<a href="https://advantage.apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Keep Studying →</a>';
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
      '<a href="https://advantage.apexaviationtx.com/portal.html" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">View Your Dashboard →</a>';
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
      '<a href="https://advantage.apexaviationtx.com/portal.html#dpe-library" style="display:inline-block;margin-top:8px;background:#F4B400;color:#0B1F3A;border-radius:8px;padding:12px 22px;text-decoration:none;font-weight:700;font-size:14px;">Review ' + CATEGORY_META[weakest.cat].label + ' →</a>';
    sendThrottledEmail('weak_area_' + weakest.cat, member.email, content.subject, html, 14);
  }

  /* ══════════════════════════════════════════════════════════════
     CHECKRIDE DATE + COUNTDOWN
     ══════════════════════════════════════════════════════════════ */
  // Growth Sprint section 13 -- personalizes the unset-date prompt using
  // the checkride_timing bucket the member already picked at signup
  // (create-free-account), rather than inventing a new onboarding step.
  // Real signal, not fabricated urgency.
  var CHECKRIDE_TIMING_PROMPT_COPY = {
    within_14_days: 'You mentioned your checkride is within 14 days — add the exact date to unlock a live countdown and your pre-checkride plan.',
    within_30_days: 'You mentioned your checkride is within 30 days — add the exact date to unlock a live countdown and your pre-checkride plan.',
    within_60_days: 'You mentioned your checkride is within 60 days — add the exact date to unlock a live countdown and your pre-checkride plan.'
  };

  function renderCheckrideCountdown() {
    var setEl = document.getElementById('checkrideCountdownSet');
    var unsetEl = document.getElementById('checkrideCountdownUnset');
    var card = document.getElementById('checkrideCountdownCard');
    if (!checkrideDate) {
      setEl.style.display = 'none';
      unsetEl.style.display = 'block';
      card.className = 'portal-card portal-countdown';
      var copyEl = document.getElementById('checkrideCountdownUnsetCopy');
      if (copyEl) {
        copyEl.textContent = (member && CHECKRIDE_TIMING_PROMPT_COPY[member.checkrideTiming]) ||
          'Add your expected checkride date to see a live countdown and get more urgency-aware reminders.';
      }
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
      renderMyTraining();
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

  // Apex Advantage Membership -- a separate, recurring product from the
  // Checkride Prep Pack above (member_subscriptions, v51). Deliberately
  // never reuses the word "unlock"/"upgrade" in this block's copy --
  // the spec calling for this was explicit that a member must always
  // know which product a button is about to charge them for.
  function fmtDate(iso) {
    return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
  }

  function joinMembership(tier) {
    var block = document.getElementById('membershipStatusBlock');
    var btn = document.getElementById('joinMembershipBtn_' + tier);
    if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to secure checkout…'; }
    apexSupabase.functions.invoke('create-checkout-session', {
      body: { purpose: 'join-membership', tier: tier, origin: window.location.origin },
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) {
      if (res.error || !res.data || !res.data.url) {
        return extractInvokeError(res).then(function (msg) {
          block.insertAdjacentHTML('beforeend', '<p style="color:#f87171;font-size:13px;margin-top:10px">' + msg + '</p>');
          if (btn) { btn.disabled = false; btn.textContent = tier === 'annual' ? 'Join Annual — $190/yr' : 'Join Monthly — $19/mo'; }
        });
      }
      window.location.href = res.data.url;
    });
  }

  function manageMembershipBilling() {
    var btn = document.getElementById('manageMembershipBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening billing portal…'; }
    apexSupabase.functions.invoke('create-billing-portal-session', {
      body: { returnUrl: window.location.origin + '/portal.html#account' },
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function (res) {
      if (res.error || !res.data || !res.data.url) {
        if (btn) { btn.disabled = false; btn.textContent = 'Manage Billing'; }
        toast('Could not open the billing portal. Please try again.');
        return;
      }
      window.location.href = res.data.url;
    });
  }

  function renderMembershipSubscription() {
    var block = document.getElementById('membershipStatusBlock');
    // Apex Advantage Membership isn't public yet -- admin-only preview
    // (membershipCard itself stays `hidden` for everyone else; this guard
    // just avoids the wasted query for the common case).
    if (!block || !member || member.role !== 'admin') return;
    apexSupabase.from('member_subscriptions').select('tier, status, current_period_end, cancel_at_period_end')
      .eq('profile_id', member.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(function (res) {
        var sub = res.data;
        if (!sub || sub.status === 'canceled') {
          block.innerHTML =
            '<div class="portal-grid portal-grid--2">' +
              '<button class="btn btn--primary" id="joinMembershipBtn_monthly">Join Monthly — $19/mo</button>' +
              '<button class="btn btn--ghost" id="joinMembershipBtn_annual">Join Annual — $190/yr</button>' +
            '</div>' +
            (sub ? '<p style="color:rgba(255,255,255,0.35);font-size:12px;margin-top:10px">Your previous membership ended ' + fmtDate(sub.current_period_end) + '.</p>' : '');
          document.getElementById('joinMembershipBtn_monthly').addEventListener('click', function () { joinMembership('monthly'); });
          document.getElementById('joinMembershipBtn_annual').addEventListener('click', function () { joinMembership('annual'); });
          return;
        }

        var statusLine;
        if (sub.status === 'past_due') {
          statusLine = '<p style="color:#f87171;font-size:14px;font-weight:700;margin-bottom:6px">Payment failed</p><p style="color:rgba(255,255,255,0.5);font-size:13px">Update your payment method to keep your membership active.</p>';
        } else if (sub.cancel_at_period_end) {
          statusLine = '<p style="color:#F4B400;font-size:14px;font-weight:700;margin-bottom:6px">Canceling</p><p style="color:rgba(255,255,255,0.5);font-size:13px">Your access continues through ' + fmtDate(sub.current_period_end) + '.</p>';
        } else {
          statusLine = '<p style="color:#4ade80;font-size:14px;font-weight:700;margin-bottom:6px">Active — ' + sub.tier + '</p><p style="color:rgba(255,255,255,0.5);font-size:13px">Renews ' + fmtDate(sub.current_period_end) + '.</p>';
        }
        block.innerHTML = statusLine + '<button class="btn btn--ghost" id="manageMembershipBtn" style="margin-top:14px">Manage Billing</button>';
        document.getElementById('manageMembershipBtn').addEventListener('click', manageMembershipBilling);
      });
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

  var REFERRAL_STATUS_LABEL = { pending: 'Pending', signed_up: 'Signed Up', rewarded: '🎁 Reward Ready' };

  function renderReferralProgram() {
    var codeEl = document.getElementById('referralCode');
    var link = referralCode ? ('https://apexaviationtx.com/contact.html?ref=' + referralCode) : '—';
    codeEl.textContent = link;

    availableReferralRewards = referrals.filter(function (r) { return r.status === 'rewarded' && !r.redeemed_at; }).length;

    var banner = document.getElementById('referralRewardBanner');
    if (availableReferralRewards > 0) {
      banner.style.display = 'block';
      banner.textContent = '🎁 You have ' + availableReferralRewards + ' free ground school session' + (availableReferralRewards === 1 ? '' : 's') + ' to use — register for any session and choose "Use a Free Referral Reward" instead of paying.';
    } else {
      banner.style.display = 'none';
    }

    var listEl = document.getElementById('referralList');
    if (!referrals.length) { listEl.innerHTML = ''; }
    else {
      listEl.innerHTML = referrals.map(function (r) {
        var statusText = r.status === 'rewarded' && r.redeemed_at ? '✓ Redeemed' : (REFERRAL_STATUS_LABEL[r.status] || r.status);
        return '<div class="portal-referral-row"><span class="email">' + r.referred_email + '</span><span class="status">' + statusText + '</span></div>';
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

  // ── Training Report ─────────────────────────────────────────────
  // Print/PDF-only, generated entirely from data already loaded client-side
  // for other widgets on this page (readiness, category coverage, Ground
  // School enrollments, AI DPE sessions) -- no new RPC. Deliberately
  // excludes billing/invoices and email; instructor-facing, not a full
  // account export.
  function computeTrainingReportData() {
    var unlocked = !!(member && member.checkridePrepUnlocked);
    var catList = Object.keys(CATEGORY_META).map(function (cat) {
      return { cat: cat, label: CATEGORY_META[cat].label, pct: categoryPct(cat) };
    });
    var weakest3 = catList.slice().sort(function (a, b) { return a.pct - b.pct; }).slice(0, 3);
    var strongest3 = catList.slice().sort(function (a, b) { return b.pct - a.pct; }).slice(0, 3);

    var attendedClasses = myScheduledEnrollments.filter(function (e) { return e.attendance_status === 'attended'; });
    var registeredUpcoming = upcomingRegisteredClass();

    var aiDpeCompleted = myAiDpeSessions.filter(function (s) { return s.status === 'completed'; });
    var latestDebrief = aiDpeCompleted[0] ? aiDpeCompleted[0].debrief : null;

    var studyDayKeys = Object.keys(studyDays).sort();

    return {
      unlocked: unlocked,
      name: member.name,
      certificateStatus: member.certificateStatus,
      checkrideDate: checkrideDate,
      readinessPct: unlocked ? computeReadiness() : null,
      questionsStudied: unlocked ? DPE_DATA.filter(function (d) { return studied[d.id]; }).length : 0,
      questionsTotal: unlocked ? DPE_DATA.length : 0,
      scenariosCompleted: unlocked ? SCENARIOS.filter(function (s) { return studied[s.id]; }).length : 0,
      scenariosTotal: unlocked ? SCENARIOS.length : 0,
      weakest3: unlocked ? weakest3.filter(function (c) { return c.pct < 1; }) : [],
      strongest3: unlocked ? strongest3.filter(function (c) { return c.pct > 0; }) : [],
      attendedClasses: attendedClasses,
      registeredUpcoming: registeredUpcoming,
      groundSchoolModuleCount: groundSchoolModuleCount,
      aiDpeCompletedCount: aiDpeCompleted.length,
      latestDebrief: latestDebrief,
      aiDpeTrend: unlocked ? computeAiDpeTrend() : [],
      lastActiveDate: studyDayKeys.length ? studyDayKeys[studyDayKeys.length - 1] : null,
      studyDaysTotal: studyDayKeys.length,
      generatedAt: new Date()
    };
  }

  function fmtReportDate(d) {
    if (!d) return null;
    var dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
    return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function renderTrainingReport() {
    var data = computeTrainingReportData();
    var el = document.getElementById('trainingReportContent');

    var statRow = function (stats) {
      return '<div class="portal-report__stat-row">' + stats.map(function (s) {
        return '<div class="portal-report__stat"><div class="portal-report__stat-value">' + escapeHtmlSafe(s.value) + '</div><div class="portal-report__stat-label">' + escapeHtmlSafe(s.label) + '</div></div>';
      }).join('') + '</div>';
    };
    var catListHtml = function (cats) {
      return cats.length
        ? '<ul class="portal-report__list">' + cats.map(function (c) { return '<li>' + escapeHtmlSafe(c.label) + ' — ' + Math.round(c.pct * 100) + '% complete</li>'; }).join('') + '</ul>'
        : '<p class="portal-report__empty">Not enough data yet.</p>';
    };

    el.innerHTML =
      '<p class="portal-report__eyebrow">Apex Advantage</p>' +
      '<h1 class="portal-report__title">Training Report — ' + escapeHtmlSafe(data.name) + '</h1>' +
      '<p class="portal-report__meta">Certificate goal: ' + escapeHtmlSafe(data.certificateStatus || 'Not set') +
        (data.checkrideDate ? ' &nbsp;·&nbsp; Checkride: ' + fmtReportDate(data.checkrideDate) : '') +
        ' &nbsp;·&nbsp; Generated ' + fmtReportDate(data.generatedAt) + '</p>' +

      '<div class="portal-report__section"><h4>Readiness</h4>' +
      (data.unlocked
        ? statRow([{ value: data.readinessPct + '%', label: 'Apex Checkride Readiness' }, { value: data.questionsStudied + '/' + data.questionsTotal, label: 'DPE questions studied' }, { value: data.scenariosCompleted + '/' + data.scenariosTotal, label: 'Scenarios completed' }])
        : '<p class="portal-report__empty">Checkride Prep is not unlocked on this account, so readiness data isn\'t available yet.</p>') +
      '</div>' +

      (data.unlocked ? '<div class="portal-report__section"><h4>Strongest Areas</h4>' + catListHtml(data.strongest3) + '</div>' : '') +
      (data.unlocked ? '<div class="portal-report__section"><h4>Areas Needing Work</h4>' + catListHtml(data.weakest3) + '</div>' : '') +

      '<div class="portal-report__section"><h4>Ground School</h4>' +
      statRow([{ value: data.attendedClasses.length + '/' + (data.groundSchoolModuleCount || 20), label: 'Modules attended' }]) +
      (data.attendedClasses.length ? '<ul class="portal-report__list" style="margin-top:12px">' + data.attendedClasses.map(function (e) { return '<li>' + escapeHtmlSafe(e.class_title || e.lesson_title) + '</li>'; }).join('') + '</ul>' : '') +
      (data.registeredUpcoming ? '<p style="font-size:13px;color:#5a6b84;margin-top:10px">Next registered class: ' + escapeHtmlSafe(data.registeredUpcoming.title) + ' — ' + fmtReportDate(data.registeredUpcoming.when) + '</p>' : '') +
      '</div>' +

      '<div class="portal-report__section"><h4>AI DPE Practice</h4>' +
      (data.aiDpeCompletedCount
        ? statRow([{ value: String(data.aiDpeCompletedCount), label: 'Sessions completed' }]) +
          (data.latestDebrief ? '<p style="font-size:13px;color:#33445e;margin-top:12px"><strong>Most recent verdict:</strong> ' + escapeHtmlSafe(data.latestDebrief.overallReadiness === 'ready' ? 'Ready for Checkride' : data.latestDebrief.overallReadiness === 'not_yet' ? 'Not Yet — Keep Practicing' : 'Almost There') + '</p>' : '') +
          (data.aiDpeTrend.length ? '<ul class="portal-report__list" style="margin-top:8px">' + data.aiDpeTrend.map(function (t) { return '<li>' + escapeHtmlSafe(t.text) + '</li>'; }).join('') + '</ul>' : '')
        : '<p class="portal-report__empty">No AI DPE Practice sessions completed yet.</p>') +
      '</div>' +

      '<div class="portal-report__section"><h4>Recent Activity</h4>' +
      statRow([{ value: String(data.studyDaysTotal), label: 'Total days studied' }, { value: data.lastActiveDate ? fmtReportDate(data.lastActiveDate) : '—', label: 'Last active' }]) +
      '</div>' +

      '<p class="portal-report__footer">Generated from Apex Advantage member portal data. Does not include billing or account credential information.</p>';
  }

  document.getElementById('openTrainingReportBtn').addEventListener('click', function () {
    renderTrainingReport();
    document.getElementById('trainingReportOverlay').hidden = false;
  });
  document.getElementById('trainingReportCloseBtn').addEventListener('click', function () {
    document.getElementById('trainingReportOverlay').hidden = true;
  });
  document.getElementById('trainingReportPrintBtn').addEventListener('click', function () {
    window.print();
  });

  // ── Delete Account ──────────────────────────────────────────────
  // Required for App Store submission (Guideline 5.1.1(v): any app with
  // account creation must offer in-app account deletion). Type-to-confirm
  // with the member's own email, since this is irreversible -- calls the
  // delete-account edge function, which anonymizes identity fields,
  // erases AI chat/Guided Notes content, cancels any active subscription,
  // and soft-deletes the auth account server-side.
  document.getElementById('openDeleteAccountBtn').addEventListener('click', function () {
    var overlay = document.getElementById('deleteAccountOverlay');
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="portal-practice-panel">' +
        '<button class="portal-practice-panel__close" id="deleteAccountCloseBtn" type="button">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
        '</button>' +
        '<h3 style="color:#f87171;font-size:19px;font-weight:700;margin-bottom:14px">Delete your account?</h3>' +
        '<p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;margin-bottom:18px">This immediately disables your login, cancels any active subscription, and erases your name, email, and AI chat history. Purchase and Ground School attendance records are kept in anonymized form for accounting purposes. <strong style="color:#fff">This can\'t be undone.</strong></p>' +
        '<div class="form-group" style="margin-bottom:18px"><label style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.6);display:block;margin-bottom:6px">Type your email (' + escapeHtmlSafe(member.email) + ') to confirm</label>' +
          '<input type="text" id="deleteAccountConfirmInput" autocomplete="off" style="width:100%;padding:11px 14px;border:1.5px solid rgba(248,113,113,0.3);border-radius:8px;font-family:var(--font);font-size:14px;color:#fff;background:rgba(11,31,58,0.6);outline:none" /></div>' +
        '<button class="btn btn--full" id="deleteAccountConfirmBtn" disabled style="background:#f87171;color:#1a0a0a;opacity:0.5;cursor:not-allowed">Permanently Delete My Account</button>' +
        '<p id="deleteAccountError" class="portal-modal__error"></p>' +
      '</div>';
    document.getElementById('deleteAccountCloseBtn').addEventListener('click', function () { overlay.hidden = true; });
    var input = document.getElementById('deleteAccountConfirmInput');
    var confirmBtn = document.getElementById('deleteAccountConfirmBtn');
    input.addEventListener('input', function () {
      var matches = input.value.trim().toLowerCase() === String(member.email || '').trim().toLowerCase();
      confirmBtn.disabled = !matches;
      confirmBtn.style.opacity = matches ? '1' : '0.5';
      confirmBtn.style.cursor = matches ? 'pointer' : 'not-allowed';
    });
    confirmBtn.addEventListener('click', function () {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Deleting…';
      var errorEl = document.getElementById('deleteAccountError');
      errorEl.classList.remove('show');
      apexSupabase.functions.invoke('delete-account', {
        headers: { Authorization: 'Bearer ' + accessToken }
      }).then(function (res) {
        if (res.error || !res.data || !res.data.success) {
          return extractInvokeError(res).then(function (msg) {
            errorEl.textContent = msg || 'Could not delete your account. Please try again or contact info@apexaviationtx.com.';
            errorEl.classList.add('show');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Permanently Delete My Account';
          });
        }
        apexSupabase.auth.signOut().then(function () {
          window.location.href = 'portal-login.html?deleted=1';
        });
      });
    });
  });

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

  var NEXT_RATING_OPTIONS = [
    { value: 'build_confidence', label: 'Build confidence as a new Private Pilot' },
    { value: 'instrument', label: 'Begin Instrument training' },
    { value: 'cross_country_experience', label: 'Build cross-country experience' },
    { value: 'commercial', label: 'Prepare for Commercial' },
    { value: 'stay_current', label: 'Stay current with live workshops' },
    { value: 'not_sure', label: "Not sure yet" },
  ];

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
    document.getElementById('celebrationCloseBtn').addEventListener('click', function () {
      overlay.hidden = true;
      showNextRatingPrompt();
    });
  }

  // Per the product spec: don't let the experience end at "you passed."
  // The answer is stored (profiles.next_rating_interest, v52) for future
  // Dispatch personalization -- not yet wired to any actual personalized
  // content, so this is a real, honest data-capture step, not a
  // finished personalization feature.
  function showNextRatingPrompt() {
    var overlay = document.getElementById('passedOverlay');
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="portal-practice-panel">' +
        '<h3 style="color:#fff;font-size:18px;font-weight:700;margin-bottom:8px">What\'s next in your Pilot Journey?</h3>' +
        '<p style="color:rgba(255,255,255,0.5);font-size:13.5px;margin-bottom:18px">This just helps us point you toward what\'s actually useful next — no wrong answer.</p>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
          NEXT_RATING_OPTIONS.map(function (o) {
            return '<button class="btn btn--ghost" data-next-rating="' + o.value + '" style="text-align:left">' + o.label + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    overlay.querySelectorAll('[data-next-rating]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        apexSupabase.from('profiles').update({ next_rating_interest: btn.dataset.nextRating }).eq('id', member.id).then(function () {
          overlay.hidden = true;
          toast("Got it — we'll tailor what we show you next.");
        });
      });
    });
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

    // DPE_DATA/SCENARIOS only populate for unlocked members (get-premium-content
    // returns nothing otherwise) -- leave the marketing-copy defaults in the
    // markup alone rather than overwrite them with a misleading "0".
    if (DPE_DATA.length) document.getElementById('statQuestionsCount').textContent = DPE_DATA.length;
    if (SCENARIOS.length) document.getElementById('statScenariosCount').textContent = SCENARIOS.length;

    // "Available" means actually downloadable today, not a coming-soon
    // placeholder card -- computed from the real vault markup so this
    // number can never drift out of sync with what's actually in the vault.
    var vaultCards = document.querySelectorAll('.portal-vault-card');
    var vaultAvailable = Array.prototype.filter.call(vaultCards, function (card) {
      return !card.querySelector('.portal-badge-locked');
    }).length;
    document.getElementById('statVaultCount').textContent = vaultAvailable + ' of ' + vaultCards.length;
  }

  /* ══════════════════════════════════════════════════════════════
     CONVERSION STATE — a single, reusable read of "where is this member
     in the acquisition funnel" (Visitor -> Free Member -> Engaged Member
     -> $25 Ground School -> $400 Full Pack / Checkride Prep), built
     entirely from data already loaded above (entitlements, real
     enrollment counts, the member's own checkride date/timing, logged
     portal_events). No new tracking, no invasive signals -- this exists
     so the "Recommended Next Step" card (and anything else contextual
     going forward) reads member state from one place instead of
     scattering ad hoc if/else checks through the UI.
     ══════════════════════════════════════════════════════════════ */
  var CONVERSION_STATES = [
    'multi_product_customer', 'full_ground_school_student', 'checkride_prep_customer',
    'repeat_class_student', 'individual_class_student', 'checkride_soon',
    'ground_school_interested', 'active_free_member', 'new_free_member'
  ];

  function daysToCheckride() {
    if (!checkrideDate) return null;
    var target = new Date(checkrideDate + 'T00:00:00');
    return Math.ceil((target - new Date()) / 86400000);
  }

  function paidClassCount() {
    var scheduled = myScheduledEnrollments.filter(function (e) {
      return e.payment_status === 'paid' || e.payment_status === 'ground_school_pack';
    }).length;
    var legacy = myGroundRegistrations.filter(function (r) {
      return r.payment_status === 'paid' || r.payment_status === 'free_referral';
    }).length;
    return scheduled + legacy;
  }

  function getMemberConversionState() {
    if (!member) return 'new_free_member';

    if (member.checkridePrepUnlocked && member.groundSchoolPackUnlocked) return 'multi_product_customer';
    if (member.groundSchoolPackUnlocked) return 'full_ground_school_student';
    if (member.checkridePrepUnlocked) return 'checkride_prep_customer';

    var classCount = paidClassCount();
    if (classCount >= 2) return 'repeat_class_student';
    if (classCount === 1) return 'individual_class_student';

    // "Soon" prefers the member's own real checkride date
    // (portal_checkride_date) over the coarser signup-time
    // checkride_timing bucket whenever they've set one -- it's the more
    // precise, self-maintained signal of the two.
    var realDaysOut = daysToCheckride();
    var soonByRealDate = realDaysOut !== null && realDaysOut <= 30;
    var soonByTimingBucket = realDaysOut === null &&
      (member.checkrideTiming === 'within_14_days' || member.checkrideTiming === 'within_30_days');
    if (soonByRealDate || soonByTimingBucket) return 'checkride_soon';

    if (loggedEventTypes['ground_school_calendar_viewed'] || loggedEventTypes['ground_school_class_viewed']) {
      return 'ground_school_interested';
    }

    var hasEngaged = DPE_DATA.some(function (d) { return studied[d.id]; }) ||
      SCENARIOS.some(function (s) { return studied[s.id]; }) ||
      checkrideModeDone ||
      Object.keys(studyDays).length > 0;
    return hasEngaged ? 'active_free_member' : 'new_free_member';
  }

  // Recommended Next Step -- contextual by design (spec: "Apex knows what
  // would help me next," not an ad slot). Deliberately separate from
  // renderMyTraining's study-progress "Next Best Action" card below --
  // that one is about *what to study*, this one is about *what stage of
  // the program you're at*. Never links straight to checkout; every
  // paid-product recommendation goes to the section/page where the
  // member can read about it first (spec: "allow the member to
  // understand the product first").
  function renderRecommendedNextStep() {
    var el = document.getElementById('recommendedNextStepCard');
    if (!el) return;
    var state = getMemberConversionState();
    var content;

    if (state === 'multi_product_customer' || state === 'full_ground_school_student') {
      content = null; // handled by the Ground School Progress card instead -- see renderGroundSchoolProgress
    } else if (state === 'checkride_prep_customer') {
      content = {
        eyebrow: 'Keep Going',
        title: 'Stay Sharp for Checkride Day',
        body: "You're unlocked. Keep working weak areas and running AI DPE Practice so nothing on oral exam day is a surprise.",
        cta: 'Open AI DPE Practice',
        go: function () { showSection('ai-dpe-practice'); }
      };
    } else if (state === 'repeat_class_student') {
      content = {
        eyebrow: 'Complete the Full Ground School',
        title: "You've Already Started Training With Apex Advantage",
        body: 'Enroll in the complete Private Pilot Ground School for access to the full 20-module program — $400, no per-class charge after.',
        cta: 'View Full Ground School',
        go: function () { showSection('ground-school'); }
      };
    } else if (state === 'individual_class_student') {
      content = {
        eyebrow: 'Keep Going',
        title: 'Continue Building Your Private Pilot Knowledge',
        body: 'Register for the next Apex Advantage Ground School class in the series.',
        cta: 'View Next Class',
        go: function () { showSection('ground-school'); }
      };
    } else if (state === 'checkride_soon') {
      content = {
        eyebrow: 'Your Checkride Is Getting Close',
        title: 'Turn Studying Into Checkride-Ready Answers',
        body: 'The complete Apex Advantage Checkride Prep System — DPE question bank, scenarios, AI DPE Practice, and progress tracking — is built for exactly this window.',
        cta: 'Explore Checkride Prep',
        go: function () { showSection('checkride-prep'); }
      };
    } else if (state === 'ground_school_interested') {
      content = {
        eyebrow: 'Join Us Live',
        title: 'Apex Advantage Ground School Is Live',
        body: 'Instructor-led, scenario-based training built to help you understand the material — not just memorize it. Classes are $25 individually.',
        cta: 'View Upcoming Classes',
        go: function () { showSection('ground-school'); }
      };
    } else if (state === 'active_free_member') {
      content = {
        eyebrow: 'Keep Exploring',
        title: 'Round Out Your Free Account',
        body: "You've started studying — Apex Advantage Ground School classes are live if you'd rather train with an instructor in real time.",
        cta: 'View Upcoming Classes',
        go: function () { showSection('ground-school'); }
      };
    } else {
      // Explicitly an upsell card (eyebrow "Get Started"), unlike the
      // welcome onboarding card -- so a locked AI DPE CTA here is fine,
      // but the label has to say so; it can't read as a free action.
      content = {
        eyebrow: 'Get Started',
        title: 'Start Practicing for Your Checkride',
        body: 'Practice realistic oral-exam questions with AI DPE Practice and start building confidence answering out loud.',
        cta: member.checkridePrepUnlocked ? 'Start AI DPE Practice' : 'Unlock AI DPE Practice — $29',
        go: function () { if (member.checkridePrepUnlocked) showSection('ai-dpe-practice'); else openUnlockModal(); }
      };
    }

    if (!content) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML =
      '<div class="portal-header__eyebrow" style="margin-bottom:8px">' + content.eyebrow + '</div>' +
      '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:8px">' + content.title + '</h3>' +
      '<p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin-bottom:16px">' + content.body + '</p>' +
      '<button type="button" class="btn btn--primary" id="recommendedNextStepCta">' + content.cta + '</button>';
    document.getElementById('recommendedNextStepCta').addEventListener('click', content.go);
  }

  // Full Ground School students: replace the sales pitch with a coherent
  // "Your Ground School" progress card instead -- real enrollment/
  // attendance data only (get_my_ground_school_enrollments,
  // get_ground_school_module_count, supabase-portal-schema-v58.sql),
  // never fabricated from the calendar date alone. "Completed" means
  // attendance_status = 'attended', not just that the class date passed.
  // Ground school $25-class registration success card -- confirmation is
  // the dominant purpose; the Full Ground School mention is one line at
  // the bottom, not a competing pitch (spec: don't overwhelm the
  // confirmation). Reads the real most-recently-registered class from
  // already-loaded data (myScheduledEnrollments/myGroundRegistrations)
  // rather than needing extra params on the Stripe success_url.
  function renderGroundSchoolRegistrationSuccess() {
    var el = document.getElementById('groundSchoolRegistrationSuccessCard');
    if (!el || urlParams.get('registered') !== '1') return;

    var scheduled = myScheduledEnrollments.slice().sort(function (a, b) {
      return (a.class_date + a.start_time) < (b.class_date + b.start_time) ? 1 : -1;
    })[0];
    var legacy = myGroundRegistrations.filter(function (r) { return r.session; }).sort(function (a, b) {
      return new Date(b.session.scheduled_at) - new Date(a.session.scheduled_at);
    })[0];

    var title, whenText, meetingUrl;
    if (scheduled) {
      title = scheduled.class_title;
      whenText = zonedWallClockToUtc(scheduled.class_date, scheduled.start_time, scheduled.timezone).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      meetingUrl = scheduled.meeting_url;
    } else if (legacy) {
      title = legacy.session.title;
      whenText = new Date(legacy.session.scheduled_at).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      meetingUrl = null;
    } else {
      title = null;
      whenText = null;
      meetingUrl = null;
    }

    // Post-purchase $400-pack upgrade offer: only for a member who (a)
    // isn't already pack-unlocked and (b) has at least one real *paid*
    // enrollment on file (amount_cents from get_my_ground_school_
    // enrollments, v65.sql) -- 'ground_school_pack'-status rows aren't
    // real payments and credit nothing. Shows the real computed credit
    // client-side for a clear offer, but create-checkout-session
    // recomputes and verifies this same figure server-side at checkout
    // time from the same source rows -- this display is informational,
    // not the authority.
    var creditedCents = myScheduledEnrollments
      .filter(function (e) { return e.payment_status === 'paid'; })
      .reduce(function (sum, e) { return sum + (e.amount_cents || 0); }, 0);
    var upgradeEligible = !member.groundSchoolPackUnlocked && creditedCents > 0 && creditedCents < 40000;
    var upgradeRemainingCents = 40000 - creditedCents;

    el.hidden = false;
    el.innerHTML =
      '<div class="portal-header__eyebrow" style="margin-bottom:8px">Registration Confirmed</div>' +
      '<h3 style="color:#fff;font-size:19px;font-weight:800;margin-bottom:10px">You\'re registered.</h3>' +
      (title ? '<p style="color:rgba(255,255,255,0.7);font-size:14px;margin-bottom:4px"><strong style="color:#fff">' + title + '</strong></p><p style="color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:16px">' + whenText + '</p>' : '<p style="color:rgba(255,255,255,0.55);font-size:14px;margin-bottom:16px">Check your email for the exact class time and any prep materials.</p>') +
      (meetingUrl ? '<a href="' + meetingUrl + '" target="_blank" rel="noopener" class="btn btn--primary" style="width:100%;margin-bottom:14px">Join the Class →</a>' : '') +
      '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0 0 14px" />' +
      (upgradeEligible
        ? '<p style="color:#fff;font-size:15px;font-weight:700;margin-bottom:6px">Want the complete Ground School?</p>' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:6px"><span>All 20 live classes</span><span>$400</span></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:13px;color:rgba(255,255,255,0.55);margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgba(255,255,255,0.08)"><span>You already paid</span><span>-$' + (creditedCents / 100).toFixed(0) + '</span></div>' +
          '<div style="display:flex;justify-content:space-between;font-size:15px;color:var(--gold);font-weight:800;margin-bottom:14px"><span>Upgrade remaining access</span><span>$' + (upgradeRemainingCents / 100).toFixed(0) + '</span></div>' +
          '<button type="button" class="btn btn--primary" id="gsRegistrationSuccessUpgradeBtn" style="width:100%;margin-bottom:10px">Upgrade to Complete Ground School</button>' +
          '<p id="gsRegistrationSuccessUpgradeError" class="portal-modal__error"></p>'
        : '<p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:12px">Enjoy Apex Advantage? Your class is part of the same live Ground School curriculum. Students who want the complete program can enroll in the Full Ground School.</p>' +
          '<button type="button" class="btn btn--ghost" id="gsRegistrationSuccessFullPackBtn">Explore Full Ground School</button>');

    var fullPackBtn = document.getElementById('gsRegistrationSuccessFullPackBtn');
    if (fullPackBtn) fullPackBtn.addEventListener('click', function () { el.hidden = true; document.getElementById('groundSchoolPackCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); });

    var upgradeBtn = document.getElementById('gsRegistrationSuccessUpgradeBtn');
    if (upgradeBtn) upgradeBtn.addEventListener('click', function () {
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = 'Redirecting to secure checkout…';
      var errorEl = document.getElementById('gsRegistrationSuccessUpgradeError');
      errorEl.classList.remove('show');
      apexSupabase.functions.invoke('create-checkout-session', {
        body: { purpose: 'upgrade-ground-school-pack', origin: window.location.origin, utm: window.apexGetUtm ? apexGetUtm() : undefined },
        headers: { Authorization: 'Bearer ' + accessToken }
      }).then(function (res) {
        if (res.error || !res.data || !res.data.url) {
          return extractInvokeError(res).then(function (msg) {
            errorEl.textContent = msg || 'Could not start checkout. Please try again.';
            errorEl.classList.add('show');
            upgradeBtn.disabled = false;
            upgradeBtn.textContent = 'Upgrade to Complete Ground School';
          });
        }
        if (window.apexTrackStandard) apexTrackStandard('InitiateCheckout', { content_name: 'Ground School Upgrade', value: upgradeRemainingCents / 100, currency: 'USD' });
        window.location.href = res.data.url;
      });
    });
  }

  function renderGroundSchoolProgress() {
    var el = document.getElementById('groundSchoolProgressCard');
    if (!el) return;
    if (!member || !member.groundSchoolPackUnlocked) { el.hidden = true; return; }
    el.hidden = false;

    var completed = myScheduledEnrollments.filter(function (e) { return e.attendance_status === 'attended'; }).length;
    var todayStr = new Date().toISOString().slice(0, 10);
    var next = myScheduledEnrollments
      .filter(function (e) { return e.attendance_status === 'registered' && e.class_date >= todayStr; })
      .sort(function (a, b) { return (a.class_date + a.start_time) < (b.class_date + b.start_time) ? -1 : 1; })[0];

    var totalLabel = groundSchoolModuleCount > 0 ? groundSchoolModuleCount : '—';
    var nextHtml = next
      ? '<p style="color:rgba(255,255,255,0.6);font-size:14px"><strong style="color:#fff">Next class:</strong> ' + next.class_title + ' — ' + zonedWallClockToUtc(next.class_date, next.start_time, next.timezone).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) +
        (next.meeting_url ? ' &middot; <a href="' + next.meeting_url + '" target="_blank" rel="noopener" style="color:#fff;text-decoration:underline">Join link</a>' : '') +
        '</p>'
      : '<p style="color:rgba(255,255,255,0.5);font-size:14px">No upcoming class registered yet — register for your next session below.</p>';

    el.innerHTML =
      '<div class="portal-header__eyebrow" style="margin-bottom:8px">Your Ground School</div>' +
      '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:10px">' + completed + ' of ' + totalLabel + ' Modules</h3>' +
      '<div class="portal-progress-bar" style="margin-bottom:14px"><div class="portal-progress-bar__fill" style="width:' + (groundSchoolModuleCount > 0 ? Math.round((completed / groundSchoolModuleCount) * 100) : 0) + '%"></div></div>' +
      nextHtml;
  }

  /* ══════════════════════════════════════════════════════════════
     MY TRAINING — "what should I study today" panel + study plan.
     Every recommendation here is derived live from real progress data
     (studied{}, CATEGORY_META coverage, SCENARIOS, myGroundRegistrations)
     -- nothing here is static placeholder copy.
     ══════════════════════════════════════════════════════════════ */
  function weakestCategory() {
    var cats = Object.keys(CATEGORY_META).map(function (cat) {
      return { cat: cat, label: CATEGORY_META[cat].label, pct: categoryPct(cat) };
    }).filter(function (c) { return c.pct < 1; }).sort(function (a, b) { return a.pct - b.pct; });
    return cats.length ? cats[0] : null;
  }

  function truncate(text, max) {
    return text.length > max ? text.slice(0, max - 1).trim() + '…' : text;
  }

  // Merges both Ground School sources (scheduled_ground_classes via
  // myScheduledEnrollments, and legacy ground_sessions via
  // myGroundRegistrations) into one "what's the member's next class"
  // answer -- the old Next Class card only ever checked the legacy
  // source, so a member registered only for a modern scheduled class saw
  // "No registered class yet".
  function upcomingRegisteredClass() {
    var now = new Date();
    var candidates = [];
    myScheduledEnrollments.forEach(function (e) {
      if (e.attendance_status === 'canceled') return;
      if (e.payment_status !== 'paid' && e.payment_status !== 'ground_school_pack') return;
      var when = zonedWallClockToUtc(e.class_date, e.start_time, e.timezone);
      if (when > now) candidates.push({ title: e.class_title, when: when, meetingUrl: e.meeting_url, moduleId: e.lesson_id });
    });
    myGroundRegistrations.forEach(function (r) {
      if (!r.session) return;
      if (r.payment_status === 'refunded' || r.payment_status === 'canceled') return;
      var when = new Date(r.session.scheduled_at);
      if (when > now) candidates.push({ title: r.session.title, when: when, meetingUrl: null, moduleId: null });
    });
    candidates.sort(function (a, b) { return a.when - b.when; });
    return candidates[0] || null;
  }

  // ── Apex Training Plan ──────────────────────────────────────────
  // Single source of truth for "what should this member do today,"
  // superseding what used to be three independently-computed answers
  // (My Training's Next Best Action, Recommended Next Step, and the
  // Checkride Countdown card all read the same underlying signals but
  // never shared logic). Priority order is deliberate and deterministic
  // -- see docs/training-plan-architecture.md for the full writeup and
  // the reasoning behind computing this live instead of persisting a
  // daily_tasks table.
  //
  // Every `done` flag reflects a real, already-tracked completion signal
  // (studied{}, SCENARIOS completion) -- never fabricated. Action-type
  // tasks (join a class, run AI DPE, Rapid Fire) have no "done" concept
  // because there's no persisted "did they actually do it today" signal
  // for those yet; they're always offered as an open action, same as
  // they were as standalone buttons before this.
  function computeTrainingPlan() {
    var next = upcomingRegisteredClass();
    var hoursToClass = next ? (next.when.getTime() - Date.now()) / 3600000 : null;
    var classImminent = hoursToClass !== null && hoursToClass <= 24;
    var checkrideDays = checkrideDate ? Math.ceil((new Date(checkrideDate + 'T00:00:00') - new Date()) / 86400000) : null;
    var unlocked = !!(member && member.checkridePrepUnlocked);
    var readinessPct = unlocked ? computeReadiness() : 0;
    var weakest = unlocked ? weakestCategory() : null;

    var tasks = [];
    if (classImminent) {
      tasks.push({
        type: 'ground_school_class',
        label: 'Join ' + next.title + ' — ' + next.when.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' }),
        done: false,
        go: function () { showSection('ground-school'); }
      });
    }

    // Today's oral-exam question is free for every member (Retention
    // Sprint Tier 1 -- computeQotdQuestion() now populates qotdQuestion
    // for locked members too, via get_daily_question()), so this is
    // pushed before the locked/unlocked split below: a free member's
    // first Training Plan task should be something they can actually do,
    // not a paywall dressed up as a task ("Answer your first oral exam
    // question" used to route straight to openUnlockModal() here, which
    // stopped being true the moment QOTD was unlocked -- fixed as part
    // of Tier 3, since the new onboarding flow surfaces this task first).
    if (qotdQuestion) {
      tasks.push({
        label: "Answer today's oral exam question",
        done: !!studied[qotdQuestion.id],
        go: function () {
          showSection('dashboard');
          var el = document.getElementById('qotdRevealBtn');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    if (!unlocked) {
      // Growth Sprint section 15 -- an early-stage member (not yet solo,
      // no checkride in sight) got the same two-paywall-CTA task list as
      // someone actively checkride-prepping, making the whole product
      // read as "only for people already scheduled." training_stage is
      // real, self-reported data (the onboarding survey at line ~4380),
      // not a guess -- when it says the member is early, the second task
      // points at something free and actually useful for that stage
      // (Ground School) instead of a second unlock pitch.
      var earlyStage = member && (member.trainingStage === 'just_starting' || member.trainingStage === 'pre_solo');
      tasks.push({ label: 'Unlock the Checkride Prep System', done: false, go: function () { openUnlockModal(); } });
      if (earlyStage) {
        tasks.push({ label: 'Browse upcoming Ground School classes', done: false, go: function () { showSection('ground-school'); } });
      } else {
        tasks.push({ label: 'Try your first training scenario', done: false, go: function () { openUnlockModal(); } });
      }
      return {
        unlocked: false, checkrideDays: checkrideDays, readinessPct: 0, primaryFocus: null,
        nextClass: next, classImminent: classImminent, tasks: tasks,
        whyText: classImminent ? null : (earlyStage
          ? "You're early in training — Ground School and free daily questions are the best use of Apex Advantage right now."
          : "You haven't unlocked Checkride Prep yet — every recommendation below depends on real study data, so start there.")
      };
    }

    if (weakest) {
      tasks.push({
        label: 'Review ' + weakest.label + ' (' + Math.round(weakest.pct * 100) + '% complete)',
        done: false,
        go: function () { goToCategory(weakest.cat); }
      });
      var weakScenario = SCENARIOS.filter(function (s) { return s.category === weakest.cat && !studied[s.id]; })[0];
      if (weakScenario) {
        tasks.push({ label: 'Complete the ' + truncate(weakScenario.title, 60) + ' scenario', done: false, go: function () { showSection('scenarios'); } });
      }
    } else {
      var allScenariosDone = SCENARIOS.length > 0 && SCENARIOS.every(function (s) { return studied[s.id]; });
      tasks.push({ label: 'All ACS areas complete', done: true, go: function () { showSection('dpe-library'); } });
      tasks.push({ label: allScenariosDone ? 'Scenario Training complete' : 'Complete Scenario Training', done: allScenariosDone, go: function () { showSection('scenarios'); } });
    }

    // AI DPE Practice if not run in the last 7 days, else a lighter
    // Rapid Fire suggestion -- myAiDpeSessions is most-recent-first
    // (get_my_recent_ai_dpe_sessions, v64.sql).
    if (tasks.length < 4) {
      var lastAiDpe = myAiDpeSessions[0];
      var daysSinceAiDpe = lastAiDpe ? Math.floor((Date.now() - new Date(lastAiDpe.started_at).getTime()) / 86400000) : null;
      if (daysSinceAiDpe === null || daysSinceAiDpe >= 7) {
        tasks.push({ label: 'Run an AI DPE Practice round', done: false, go: function () { showSection('ai-dpe-practice'); } });
      } else {
        tasks.push({
          label: 'Complete a 5-minute DPE Rapid Fire', done: false,
          go: function () {
            showSection('dpe-library');
            var btn = document.getElementById('launchRapidFire');
            if (btn) btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      }
    }

    var whyText;
    if (classImminent) {
      whyText = next.title + ' starts ' + (hoursToClass <= 1 ? 'within the hour' : 'today') + ' — get ready before it starts.';
    } else if (checkrideDays !== null && checkrideDays >= 0 && checkrideDays <= 14 && weakest) {
      whyText = 'Your checkride is ' + checkrideDays + ' day' + (checkrideDays === 1 ? '' : 's') + ' away, and ' + weakest.label + ' is your lowest-scoring area — this is the fastest way to move readiness before then.';
    } else if (weakest) {
      whyText = weakest.label + ' is currently your lowest-performing ACS category.';
    } else {
      whyText = "You're fully caught up on questions and scenarios. Keep your streak alive with a Rapid Fire review.";
    }

    return {
      unlocked: true, checkrideDays: checkrideDays, readinessPct: readinessPct, primaryFocus: weakest,
      nextClass: next, classImminent: classImminent, tasks: tasks, whyText: whyText
    };
  }

  // ── AI DPE History ──────────────────────────────────────────────
  // ai_dpe_sessions has always stored a full transcript + qualitative
  // debrief per session (v32.sql); this is the first place any of it is
  // shown back to the member. Trend is derived deterministically by
  // comparing the two most recent COMPLETED sessions' per-domain verdicts
  // -- no numeric scoring exists anywhere in the AI DPE pipeline, so this
  // stays qualitative throughout rather than inventing a percentage.
  var AI_DPE_VERDICT_RANK = { weak: 0, ok: 1, strong: 2 };
  var AI_DPE_VERDICT_LABEL = { weak: 'Weak', ok: 'OK', strong: 'Strong' };

  function computeAiDpeTrend() {
    var completed = myAiDpeSessions.filter(function (s) { return s.status === 'completed' && s.debrief; });
    if (!completed.length) return [];
    var latest = completed[0].debrief;
    var prior = completed[1] ? completed[1].debrief : null;
    return (latest.perDomain || []).map(function (d) {
      var priorDomain = prior ? (prior.perDomain || []).filter(function (p) { return p.domain === d.domain; })[0] : null;
      var direction = 'flat';
      if (priorDomain && AI_DPE_VERDICT_RANK[d.verdict] > AI_DPE_VERDICT_RANK[priorDomain.verdict]) direction = 'up';
      else if (priorDomain && AI_DPE_VERDICT_RANK[d.verdict] < AI_DPE_VERDICT_RANK[priorDomain.verdict]) direction = 'down';
      var text = direction === 'up' ? d.domain + ' improving' : direction === 'down' ? d.domain + ' slipping' : d.domain + ' — ' + AI_DPE_VERDICT_LABEL[d.verdict];
      return { text: text, direction: direction };
    });
  }

  function escapeHtmlSafe(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderAiDpeHistory() {
    var card = document.getElementById('aiDpeHistoryCard');
    if (!card) return;
    if (!myAiDpeSessions.length) { card.hidden = true; return; }
    card.hidden = false;

    var trend = computeAiDpeTrend();
    var trendEl = document.getElementById('aiDpeTrendList');
    trendEl.innerHTML = trend.length
      ? '<div class="portal-dpe-history__trend">' + trend.map(function (t) {
          return '<span class="portal-dpe-history__trend-pill' + (t.direction === 'up' ? ' portal-dpe-history__trend-pill--up' : t.direction === 'down' ? ' portal-dpe-history__trend-pill--down' : '') + '">' + escapeHtmlSafe(t.text) + '</span>';
        }).join('') + '</div>'
      : '<p style="color:rgba(255,255,255,0.4);font-size:13px">Complete a second session to see a trend by ACS area.</p>';

    var listEl = document.getElementById('aiDpeSessionList');
    listEl.innerHTML = myAiDpeSessions.slice(0, 5).map(function (s) {
      var when = new Date(s.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      var badge = (s.status === 'completed' && s.debrief && s.debrief.overallReadiness)
        ? '<span class="portal-debrief__badge portal-debrief__badge--' + escapeHtmlSafe(s.debrief.overallReadiness) + '" style="padding:4px 10px;font-size:11px">' +
          (s.debrief.overallReadiness === 'ready' ? 'Ready' : s.debrief.overallReadiness === 'not_yet' ? 'Not Yet' : 'Almost') + '</span>'
        : '<span style="color:rgba(255,255,255,0.4);font-size:12px;text-transform:capitalize">' + escapeHtmlSafe(String(s.status || '').replace('_', ' ')) + '</span>';
      return '<div class="portal-dpe-history__session">' +
        '<div><div class="portal-dpe-history__session-date">' + when + '</div>' +
        '<div class="portal-dpe-history__session-meta">' + (s.questions_asked || 0) + ' question' + (s.questions_asked === 1 ? '' : 's') + '</div></div>' +
        badge + '</div>';
    }).join('');
  }

  function renderMyTraining() {
    var plan = computeTrainingPlan();

    var continueBtn = document.getElementById('continueTrainingBtn');
    var firstIncomplete = plan.tasks.filter(function (t) { return !t.done; })[0];
    if (continueBtn) continueBtn.onclick = function (e) { e.preventDefault(); (firstIncomplete || plan.tasks[0]).go(); };

    var preclassEl = document.getElementById('trainingPlanPreclassBanner');
    if (plan.classImminent && plan.nextClass) {
      preclassEl.hidden = false;
      preclassEl.innerHTML =
        '<div><div class="portal-header__eyebrow">Starting Soon</div><h3>' + plan.nextClass.title + '</h3><p>' +
        plan.nextClass.when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</p></div>' +
        '<div class="portal-my-training__preclass-actions">' +
        '<button type="button" class="btn btn--ghost" id="trainingPlanPreclassGs">View in Ground School</button>' +
        (plan.nextClass.meetingUrl ? '<a href="' + plan.nextClass.meetingUrl + '" target="_blank" rel="noopener" class="btn btn--primary">Join Class →</a>' : '') +
        '</div>';
      var gsBtn = document.getElementById('trainingPlanPreclassGs');
      if (gsBtn) gsBtn.addEventListener('click', function () { showSection('ground-school'); });
    } else {
      preclassEl.hidden = true;
    }

    // Growth Sprint section 12 -- "Want help with this live?" cross-sell,
    // real scheduled-class data only. Skipped if the same class is already
    // the imminent-class banner above, or if the member has no weak area
    // yet (locked, or already 100% across the board).
    var crossSellEl = document.getElementById('trainingPlanGsCrossSell');
    if (crossSellEl) {
      var gsMatch = plan.unlocked && plan.primaryFocus ? findGsClassForWeakArea(plan.primaryFocus.label) : null;
      if (gsMatch && !(plan.classImminent && plan.nextClass && String(plan.nextClass.id) === String(gsMatch.id))) {
        crossSellEl.hidden = false;
        var gsWhen = new Date(gsMatch.scheduled_at);
        var gsPriceLabel = gsMatch.packCovers ? 'Included in Your Pack' : '$25';
        crossSellEl.innerHTML =
          '<div><div class="portal-header__eyebrow">Want Help With This Live?</div><h3>' + escapeHtmlSafe(gsMatch.title) + '</h3><p>' +
          gsWhen.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' · ' + gsPriceLabel +
          (typeof gsMatch.spotsLeft === 'number' ? ' · ' + Math.max(gsMatch.spotsLeft, 0) + ' seat' + (gsMatch.spotsLeft === 1 ? '' : 's') + ' left' : '') +
          '</p></div>' +
          '<div class="portal-my-training__preclass-actions">' +
          '<button type="button" class="btn btn--primary" id="trainingPlanGsCrossSellBtn">View Live Class →</button>' +
          '</div>';
        var crossSellBtn = document.getElementById('trainingPlanGsCrossSellBtn');
        if (crossSellBtn) crossSellBtn.addEventListener('click', function () {
          apexSupabase.from('portal_events').insert({ profile_id: member.id, event_type: 'gs_cross_sell_clicked', metadata: { category: plan.primaryFocus.cat, class_id: gsMatch.id } });
          showSection('ground-school');
        });
        logEventOnce('gs_cross_sell_shown', { category: plan.primaryFocus.cat, class_id: gsMatch.id });
      } else {
        crossSellEl.hidden = true;
      }
    }

    var checkrideEl = document.getElementById('trainingPlanCheckride');
    checkrideEl.querySelector('h3').textContent = plan.checkrideDays === null ? 'Not set'
      : plan.checkrideDays < 0 ? 'Passed'
      : plan.checkrideDays === 0 ? 'Today'
      : plan.checkrideDays + ' day' + (plan.checkrideDays === 1 ? '' : 's');
    checkrideEl.onclick = function () {
      var card = document.getElementById('checkrideCountdownCard');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    var readinessEl = document.getElementById('trainingPlanReadiness');
    readinessEl.querySelector('h3').textContent = plan.unlocked ? plan.readinessPct + '%' : 'Locked';
    readinessEl.onclick = function () { showSection('progress'); };

    var focusEl = document.getElementById('trainingPlanFocus');
    focusEl.querySelector('h3').textContent = !plan.unlocked ? 'Unlock to see' : (plan.primaryFocus ? plan.primaryFocus.label : 'All areas covered');
    focusEl.onclick = function () { if (plan.primaryFocus) goToCategory(plan.primaryFocus.cat); else showSection('dpe-library'); };

    var planEl = document.getElementById('studentStudyPlanList');
    var planCompleteEl = document.getElementById('studentStudyPlanComplete');
    var whyEl = document.getElementById('trainingPlanWhy');
    var allPlanItemsDone = plan.unlocked && plan.tasks.length > 0 && plan.tasks.every(function (item) { return item.done; });

    planEl.hidden = allPlanItemsDone;
    planCompleteEl.hidden = !allPlanItemsDone;
    if (whyEl) { whyEl.hidden = !plan.whyText || allPlanItemsDone; whyEl.textContent = plan.whyText || ''; }

    planEl.innerHTML = plan.tasks.map(function (item, i) {
      return '<div class="portal-plan-item' + (item.done ? ' portal-plan-item--done' : '') + '" data-plan-idx="' + i + '">' +
        '<span class="portal-plan-item__check">' + (item.done ? '✓' : '') + '</span>' +
        '<span class="portal-plan-item__label">' + item.label + '</span>' +
      '</div>';
    }).join('');
    planEl.querySelectorAll('[data-plan-idx]').forEach(function (row, i) {
      row.addEventListener('click', function () { plan.tasks[i].go(); });
    });
  }

  /* ══════════════════════════════════════════════════════════════
     7-DAY CHECKRIDE CHALLENGE -- Growth Sprint Tier 2
     Free-tier feature: content comes from get_challenge_day_questions()
     (supabase-portal-schema-v74.sql), a small SECURITY DEFINER slice of
     the DPE bank granted to every authenticated member -- DPE_DATA/
     CATEGORY_META are empty client-side for locked members, so this
     can't reuse those arrays. Progress is tracked entirely through
     existing portal_events rows (challenge_started, challenge_day_N_
     completed) via logEventOnce/loggedEventTypes -- no new table.
     Days 1-6 map to real dpe_categories ids (verified against the
     actual seeded set in supabase-portal-schema-v5.sql); 9 real
     categories exist but only 6 are used here by design, since a 7-day
     on-ramp is meant to be a fast, representative preview, not full
     coverage -- the remaining categories are still fully covered in the
     DPE Library after unlock. Day 7 pulls one question from each of the
     six to form a "mixed mock oral" review.
     ══════════════════════════════════════════════════════════════ */
  var CHALLENGE_DAYS = [
    { day: 1, title: 'Documents & Eligibility', category: 'eligibility' },
    { day: 2, title: 'Airworthiness & Aircraft Systems', category: 'airworthiness' },
    { day: 3, title: 'Weather', category: 'weather' },
    { day: 4, title: 'Airspace', category: 'airspace' },
    { day: 5, title: 'Performance & Weight/Balance', category: 'performance' },
    { day: 6, title: 'ADM & Emergency Scenarios', category: 'emergency' },
    { day: 7, title: 'Mock Oral — Mixed Review', category: null }
  ];
  var challengeQuestionsCache = {};
  var challengeRevealed = {};

  function challengeCurrentDay() {
    for (var i = 0; i < CHALLENGE_DAYS.length; i++) {
      if (!loggedEventTypes['challenge_day_' + CHALLENGE_DAYS[i].day + '_completed']) return CHALLENGE_DAYS[i].day;
    }
    return null;
  }

  function fetchChallengeDayQuestions(dayInfo) {
    if (challengeQuestionsCache[dayInfo.day]) return Promise.resolve(challengeQuestionsCache[dayInfo.day]);
    var req = dayInfo.category
      ? apexSupabase.rpc('get_challenge_day_questions', { p_category: dayInfo.category, p_limit: 3 })
      : Promise.all(CHALLENGE_DAYS.filter(function (d) { return d.category; }).map(function (d) {
          return apexSupabase.rpc('get_challenge_day_questions', { p_category: d.category, p_limit: 1 });
        })).then(function (results) {
          return { data: results.reduce(function (acc, r) { return acc.concat((r && r.data) || []); }, []) };
        });
    return Promise.resolve(req).then(function (res) {
      var qs = (res && res.data) || [];
      challengeQuestionsCache[dayInfo.day] = qs;
      return qs;
    });
  }

  function renderChallengeDots() {
    var dotsEl = document.getElementById('challengeDots');
    if (!dotsEl) return;
    var current = challengeCurrentDay();
    dotsEl.innerHTML = CHALLENGE_DAYS.map(function (d) {
      var done = !!loggedEventTypes['challenge_day_' + d.day + '_completed'];
      var isCurrent = d.day === current;
      var bg = done ? 'var(--gold)' : (isCurrent ? 'rgba(244,180,0,0.25)' : 'rgba(255,255,255,0.08)');
      var border = isCurrent ? '1.5px solid var(--gold)' : '1.5px solid transparent';
      var color = done ? '#0b1f3a' : '#fff';
      return '<div title="Day ' + d.day + ': ' + d.title + '" style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:' + color + ';background:' + bg + ';border:' + border + '">' + (done ? '✓' : d.day) + '</div>';
    }).join('');
  }

  function renderChallengeQuestionsList(questions) {
    return questions.map(function (q) {
      var revealed = !!challengeRevealed[q.id];
      return '<div style="background:rgba(11,31,58,0.4);border-radius:10px;margin-bottom:10px;padding:14px 16px">' +
        '<p style="color:#fff;font-size:14px;font-weight:600;margin-bottom:8px">' + escapeHtmlSafe(q.question) + '</p>' +
        (revealed
          ? '<p style="color:rgba(255,255,255,0.65);font-size:13px;line-height:1.6">' + escapeHtmlSafe(q.model_answer) + '</p>'
          : '<button type="button" class="btn btn--ghost" data-challenge-reveal="' + escapeHtmlSafe(q.id) + '" style="font-size:12px;padding:8px 14px">Reveal Answer</button>') +
      '</div>';
    }).join('');
  }

  function renderChallenge() {
    var card = document.getElementById('challengeCard');
    var bodyEl = document.getElementById('challengeBody');
    if (!card || !bodyEl) return;
    renderChallengeDots();

    var current = challengeCurrentDay();
    if (current === null) {
      // Growth Sprint section 10 -- Day 7 doubles as the free "mock oral"
      // premium preview: lowest-complexity option that reuses this same
      // challenge infrastructure rather than exposing free members to
      // the paid, per-call-billed AI DPE Chat (dpe-chat edge function).
      // No fabricated readiness/weak-area precision for locked members --
      // this app has never scored oral answers (studied/not-studied only,
      // same as the DPE Library everywhere else), so "strongest/weakest"
      // is only ever shown when it's the member's real, unlocked
      // readiness data (computeTrainingPlan()), never invented from the
      // 6-question preview alone.
      logEventOnce('challenge_completed', {});
      var totalCovered = CHALLENGE_DAYS.reduce(function (sum, d) { return sum + ((challengeQuestionsCache[d.day] || []).length); }, 0);
      var resultsPlan = computeTrainingPlan();
      bodyEl.innerHTML =
        '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:4px">Mock Oral Results</h3>' +
        '<p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:14px">7-Day Checkride Challenge complete.</p>' +
        '<div class="portal-grid portal-grid--3" style="margin-bottom:14px">' +
          '<div class="portal-my-training__panel"><p class="portal-my-training__label">Questions Covered</p><h3>' + totalCovered + '</h3></div>' +
          '<div class="portal-my-training__panel"><p class="portal-my-training__label">Weakest Area</p><h3>' + (resultsPlan.unlocked && resultsPlan.primaryFocus ? escapeHtmlSafe(resultsPlan.primaryFocus.label) : '—') + '</h3></div>' +
          '<div class="portal-my-training__panel"><p class="portal-my-training__label">Readiness</p><h3>' + (resultsPlan.unlocked ? resultsPlan.readinessPct + '%' : '—') + '</h3></div>' +
        '</div>' +
        (resultsPlan.unlocked ? '' :
          '<p style="color:rgba(255,255,255,0.55);font-size:13px;line-height:1.6;margin-bottom:14px">This preview covered 6 real exam areas — documents, airworthiness, weather, airspace, performance, and emergency judgment. Unlock the full 328-question bank for a true readiness score with weak-area tracking, Scenario Training, and AI Oral Practice.</p>') +
        '<button type="button" class="btn btn--primary" id="challengeUnlockBtn">' + (resultsPlan.unlocked ? 'Go to Checkride Prep →' : 'Unlock Full Checkride Prep →') + '</button>';
      var unlockBtn = document.getElementById('challengeUnlockBtn');
      if (unlockBtn) unlockBtn.addEventListener('click', function () {
        logEventOnce('challenge_upgrade_cta_clicked', {});
        if (resultsPlan.unlocked) showSection('dpe-library'); else openUnlockModal();
      });
      return;
    }

    var dayInfo = CHALLENGE_DAYS[current - 1];
    var started = !!loggedEventTypes['challenge_started'];

    if (!started && current === 1) {
      bodyEl.innerHTML =
        '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:8px">7 days, 5-10 minutes a day.</h3>' +
        '<p style="color:rgba(255,255,255,0.6);font-size:14px;line-height:1.6;margin-bottom:14px">A short daily walk through the exam areas that matter most: documents, airworthiness, weather, airspace, performance, and emergency judgment — capped off with a mixed mock-oral review.</p>' +
        '<button type="button" class="btn btn--primary" id="challengeStartBtn">Start Day 1: ' + dayInfo.title + '</button>';
      var startBtn = document.getElementById('challengeStartBtn');
      if (startBtn) startBtn.addEventListener('click', function () {
        logEventOnce('challenge_started', { start_date: getTodayStr() });
        renderChallenge();
      });
      return;
    }

    bodyEl.innerHTML = '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:4px">Day ' + current + ': ' + dayInfo.title + '</h3><p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:14px">Loading today’s questions…</p>';

    fetchChallengeDayQuestions(dayInfo).then(function (questions) {
      if (challengeCurrentDay() !== current) return;
      if (!questions.length) {
        bodyEl.innerHTML = '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:8px">Day ' + current + ': ' + dayInfo.title + '</h3><p style="color:rgba(255,255,255,0.5);font-size:13px">No questions available for this day yet — check back soon.</p>';
        return;
      }
      bodyEl.innerHTML =
        '<h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:4px">Day ' + current + ': ' + dayInfo.title + '</h3>' +
        '<p style="color:rgba(255,255,255,0.5);font-size:13px;margin-bottom:14px">' + questions.length + ' question' + (questions.length === 1 ? '' : 's') + ' — about 5-10 minutes.</p>' +
        renderChallengeQuestionsList(questions) +
        '<button type="button" class="btn btn--primary" id="challengeCompleteBtn" style="margin-top:6px">Mark Day ' + current + ' Complete →</button>';

      questions.forEach(function (q) { touchLastViewed(q.id); });

      bodyEl.querySelectorAll('[data-challenge-reveal]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          challengeRevealed[btn.dataset.challengeReveal] = true;
          renderChallenge();
        });
      });
      var completeBtn = document.getElementById('challengeCompleteBtn');
      if (completeBtn) completeBtn.addEventListener('click', function () {
        logEventOnce('challenge_day_' + current + '_completed', { category: dayInfo.category });
        renderChallenge();
        renderMyTraining();
      });
    });
  }

  // Your Week -- Retention Sprint Tier 2. Pure client-side aggregation of
  // data loadProgress() already fetched (studied/answeredCounts/lastViewed
  // from portal_question_progress + portal_scenario_progress, studyDays
  // from portal_study_activity, myAiDpeSessions) -- no new network calls.
  // "This week" = the 7 calendar days ending today, browser-local, same
  // basis computeStreaks() already uses (see that function's own note on
  // why -- consistent, not necessarily member-timezone-exact).
  // Strongest/weakest topic reuses categoryPct() (coverage-based, the
  // same signal weakestCategory()/renderWeakAreas() already use) rather
  // than introducing a second, different definition of "weak" -- and is
  // only shown for unlocked members, since CATEGORY_META is empty for a
  // free member (loadPremiumContent() is a premium-only fetch).
  function renderWeeklyProgress() {
    var emptyEl = document.getElementById('weeklyProgressEmpty');
    var statsEl = document.getElementById('weeklyProgressStats');
    if (!emptyEl || !statsEl) return;

    var weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    weekAgo.setHours(0, 0, 0, 0);

    var questionsThisWeek = Object.keys(answeredCounts).filter(function (id) {
      return answeredCounts[id] > 0 && lastViewed[id] && lastViewed[id] >= weekAgo.getTime();
    }).length;

    var trainingDaysThisWeek = Object.keys(studyDays).filter(function (dateStr) {
      return new Date(dateStr + 'T00:00:00') >= weekAgo && (studyDays[dateStr] || 0) > 0;
    }).length;

    var scenariosThisWeek = SCENARIOS.filter(function (s) {
      return studied[s.id] && lastViewed[s.id] && lastViewed[s.id] >= weekAgo.getTime();
    }).length;

    var aiDpeThisWeek = myAiDpeSessions.filter(function (s) {
      return new Date(s.started_at) >= weekAgo;
    }).length;

    var hasActivity = questionsThisWeek > 0 || trainingDaysThisWeek > 0 || scenariosThisWeek > 0 || aiDpeThisWeek > 0;

    if (!hasActivity) {
      emptyEl.style.display = 'block';
      statsEl.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';
    statsEl.style.display = 'block';
    document.getElementById('weeklyQuestions').textContent = questionsThisWeek;
    document.getElementById('weeklyDays').textContent = trainingDaysThisWeek;
    document.getElementById('weeklyScenarios').textContent = scenariosThisWeek;
    document.getElementById('weeklyAiDpe').textContent = aiDpeThisWeek;

    var topicLine = document.getElementById('weeklyTopicLine');
    var cats = Object.keys(CATEGORY_META).map(function (cat) {
      return { label: CATEGORY_META[cat].label, pct: categoryPct(cat) };
    });
    if (!cats.length) {
      topicLine.textContent = '';
    } else {
      var strongest = cats.slice().sort(function (a, b) { return b.pct - a.pct; })[0];
      var weakest = cats.slice().sort(function (a, b) { return a.pct - b.pct; })[0];
      topicLine.textContent = 'Strongest: ' + strongest.label + (weakest.pct < 1 ? ' · Focus next: ' + weakest.label : '');
    }
  }
  var weeklyProgressStartBtn = document.getElementById('weeklyProgressStartBtn');
  if (weeklyProgressStartBtn) weeklyProgressStartBtn.addEventListener('click', function () {
    var plan = computeTrainingPlan();
    var firstIncomplete = plan.tasks.filter(function (t) { return !t.done; })[0];
    if (firstIncomplete) firstIncomplete.go(); else showSection('dpe-library');
  });

  /* ── Init — waits for the real Supabase session + profile ────── */
  function initPortalData() {
    applyUnlockState();
    return loadProgress().then(function () {
      renderLessons();
      renderQuickRef();
      renderDpeLibrary();
      renderScenarios();
      renderProgress();
      renderDashboardStats();
      renderReadiness();
      renderStreak();
      renderXpRank();
      renderWeakAreas();
      renderAcsCoverage();
      computeQotdQuestion().then(renderQotd);
      renderMyTraining();
      // Growth Sprint section 12 -- loadGroundSchool() is normally lazy
      // (only triggered on Ground School section entry), but the weak-area
      // cross-sell needs real class data on the very first dashboard
      // render too. Reuses the same loader/data the Ground School section
      // itself renders from rather than a second parallel fetch.
      loadGroundSchool().then(renderMyTraining);
      renderWeeklyProgress();
      renderChallenge();
      renderAiDpeHistory();
      renderRecommendedNextStep();
      renderGroundSchoolProgress();
      renderGroundSchoolRegistrationSuccess();
      renderAchievements();
      loadAchievementRarity();
      renderStudyHeatmap();
      renderWeeklyActivityChart();
      renderMissions();
      renderPilotJourney();
      checkAchievements();
      renderAdminIfApplicable();
      enforceGuidedNotesAccess();
      enforceAskAndrewAccess();
      enforceUpgradeDeepLink();
      enforceTopicDeepLink();
      renderCheckrideCountdown();
      renderMembership();
      renderMembershipSubscription();
      renderGroundSchoolPackCard();
      renderBillingHistory();
      renderMySessions();
      ensureReferralCode();
      renderPassedBanner();
      renderSuccessWall();
      checkWeakAreaEmail();
      // Replays showSection() for whatever section the URL hash says is
      // active. The very first showSection(initial) call (script init,
      // below) always runs before authReady's .then() gets a single
      // microtask, so `member` is unconditionally unset that first time --
      // every per-section on-enter effect in showSection()/
      // runSectionEnterEffects() (data loads like loadGroundSchool(),
      // gating checks, analytics) silently no-ops on any load that lands
      // directly on a non-dashboard hash (reload, bookmark, shared link),
      // e.g. Ground School staying on "Loading sessions..." forever with
      // no retry. member and myGroundRegistrations/myScheduledEnrollments
      // (set just above by loadProgress()) are both guaranteed ready by
      // this point, so this is the real first execution, not a duplicate.
      showSection((window.location.hash || '#dashboard').replace('#', ''));
    });
  }
})();
