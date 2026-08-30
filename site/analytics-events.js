// Shared conversion-funnel event tracker for the Apex Advantage funnel:
// marketing site -> portal-login.html -> member portal.
//
// Before this file, gtag()/fbq() calls were scattered ad hoc across pages
// under inconsistent, page-specific names (e.g. "checkride_prep_cta_click"
// only on checkride-prep.html), and there was no way to query the funnel
// without pulling reports from GA4/Meta's own dashboards. apexTrack(name,
// props) fires the SAME named event to GA4 + Meta Pixel (when present)
// AND logs a row to the first-party `analytics_events` table (see
// supabase-portal-schema-v39.sql), so a simple SQL funnel report works
// without a GA4/Meta reporting-API integration. Requires portal-supabase.js
// to be loaded first for the DB write; gtag/fbq firing works without it.
//
// EVENT_ALLOWLIST documents every event name apexTrack() is actually
// called with somewhere in this codebase -- reconciled against a full
// grep of every apexTrack( call site (site/*.html, portal-stable.js) as
// of the analytics reliability pass, not carried forward from an older
// list. An unlisted name still fires (this is a console.warn, not a hard
// block -- see track() below), so this array is a data-quality/developer
// aid, not an enforcement gate: its only job is to stay an accurate map
// of what's real.
//
// Previously stale in two directions: this comment used to claim
// readiness_assessment_started/_completed had no real trigger yet ("those
// features don't exist yet") when readiness-assessment.html has fired
// both since the Readiness Assessment shipped; and the array itself was
// missing twelve event names already live in production (the whole
// readiness sub-funnel past _started/_completed, the Ground School
// schedule/class-select/reserve-form steps, the portal-activation-CTA
// pair, and content_deeplink_topic_matched). Also removed: six names with
// no apexTrack call anywhere in the repo (walkthrough_video_started/
// _completed, onboarding_completed, quiz_completed, refund_requested,
// ai_dpe_started, ground_school_calendar_viewed, ground_school_class_
// viewed, ground_school_full_pack_viewed, checkride_prep_viewed) --
// aspirational names for features that were never built this way, not
// real gaps.
//
// Scope: this list is specifically the custom funnel events apexTrack()
// sends to GA4 + Meta + analytics_events. It deliberately does NOT
// include: Meta's own standard events (apexTrackStandard() -- ViewContent,
// InitiateCheckout, Lead, CompleteRegistration -- go to Meta only, by
// design, see trackStandard() below); legacy page-specific gtag() calls
// that bypass apexTrack entirely (checkride_prep_page_view/_cta_click/
// _checkout_start/_secondary_cta_click, dpe_questions_page_view/
// _cta_click, lead_gen_download_page_view, ground_school_cta_click, the
// GA4-standard sign_up event -- all in site/checkride-prep.html,
// site/dpe-questions.html, site/checkride-guide-download.html,
// site/apex-advantage-private-pilot.html, site/portal-login.html); or
// GA4's own automatic events (page_view, scroll, session_start) or
// Enhanced Ecommerce purchase, none of which go through apexTrack.
// checkout_abandoned/seven_day_active_user/activation_email_N_sent are
// logged server-side directly to analytics_events (send-lifecycle-emails,
// create-free-account) with no client-side apexTrack call at all, so they
// stay out of this client-side list too -- see docs/
// ANALYTICS_EVENT_DICTIONARY.md for the complete picture across all of
// the above, client and server.
(function () {
  var EVENT_ALLOWLIST = [
    // Marketing site / acquisition
    'landing_page_viewed', 'pricing_viewed', 'registration_started', 'registration_completed',
    'product_preview_viewed', 'checkout_started', 'purchase_completed',
    'early_access_cta_click',
    // Ground School funnel
    'ground_school_schedule_viewed', 'ground_school_class_selected', 'ground_school_reserve_form_opened',
    'ground_school_class_purchased',
    // Ground School conversion-redesign pass (site/apex-advantage-private-
    // pilot.html) -- IntersectionObservers on the new above-the-fold value
    // section and the full-course Checkride Prep bonus callout. CTA clicks
    // on this page already fire via the existing data-apx-cta/gtag()
    // click-tracking mechanism, so no new "*_cta_clicked" events were added.
    'ground_school_value_section_viewed', 'ground_school_checkride_bonus_viewed',
    // Curriculum booking UX pass (same file) -- fires when a visitor
    // actually opens a module's "See Available Dates" panel. Selecting a
    // session from that panel reuses the existing ground_school_class_
    // selected/ground_school_reserve_form_opened events verbatim (same
    // user action as the class grid), so only this one new event was
    // needed to complete the funnel.
    'ground_school_available_dates_opened',
    // Readiness Assessment funnel (site/readiness-assessment.html)
    'readiness_assessment_viewed', 'readiness_assessment_started', 'readiness_question_answered',
    'readiness_assessment_completed', 'readiness_score_viewed', 'readiness_signup_started',
    'readiness_signup_completed', 'readiness_checkride_prep_clicked',
    // Post-purchase activation (portal-login.html)
    'portal_activation_cta_viewed', 'portal_activation_cta_clicked',
    // Member-upgrade deep link (?upgrade=checkride-prep) -- real triggers
    // in site/portal-stable.js's enforceUpgradeDeepLink().
    'checkride_prep_upgrade_deeplink_viewed', 'checkride_prep_upgrade_modal_opened',
    // Deep-linked content matching (site/portal-stable.js)
    'content_deeplink_topic_matched',
    // Portal activation + onboarding (site/portal-stable.js). onboarding_
    // viewed/completed and first_action_presented/completed +
    // activation_completed were added in the activation-optimization
    // pass -- onboarding_training_goal_saved/onboarding_focus_area_saved/
    // onboarding_first_training_started already covered training_stage_
    // selected/focus_area_selected/first_action_started, so those weren't
    // duplicated under new names (see ANALYTICS_EVENT_DICTIONARY.md).
    'portal_first_login', 'first_lesson_started', 'first_lesson_completed',
    'onboarding_viewed', 'onboarding_training_goal_saved', 'onboarding_focus_area_saved', 'onboarding_completed',
    'onboarding_first_training_started', 'first_action_presented', 'first_action_completed', 'activation_completed',
    // Ground School Module Workbook (site/portal-stable.js) -- scored
    // Knowledge Check quiz, per-module (get-module-companion-content /
    // module_quiz_attempts, supabase-portal-schema-v88.sql).
    'module_quiz_completed',
    // Free/paid conversion widgets (site/portal-stable.js)
    'upgrade_prompt_viewed', 'upgrade_prompt_clicked',
    // New Member Activation sequence -- real trigger in
    // site/portal-stable.js's activation-email click-tracking IIFE.
    // The _sent half of this funnel is logged server-side directly to
    // analytics_events (create-free-account/index.ts and
    // send-lifecycle-emails/index.ts's processNewMemberActivation), so
    // it deliberately isn't in this client-side allowlist.
    'activation_email_1_clicked', 'activation_email_2_clicked', 'activation_email_3_clicked', 'activation_email_4_clicked'
  ];

  // readiness-assessment.html/checkride-prep.html/apex-advantage.html etc.
  // are canonically served from apexaviationtx.com; the member portal
  // (portal.html/portal-login.html) is on advantage.apexaviationtx.com --
  // a DIFFERENT origin as far as localStorage is concerned. An anon_id
  // written on one was never readable on the other, so every visitor
  // whose journey crossed that boundary (readiness assessment -> signup
  // -> portal is the common case) silently got a brand-new, unrelated
  // anon_id the moment they landed on the portal subdomain -- funnel RPCs
  // saw two disconnected anonymous visitors instead of one real person.
  // A cookie scoped to the shared parent domain (.apexaviationtx.com) is
  // visible from both; localStorage is kept only as a same-origin cache
  // (avoids a cookie round-trip on repeat reads) and a fallback if
  // cookies are ever blocked.
  function cookieDomain() {
    return /(^|\.)apexaviationtx\.com$/.test(location.hostname) ? '.apexaviationtx.com' : null;
  }
  function getCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function setCookie(name, value, days) {
    try {
      var domain = cookieDomain();
      var expires = new Date(Date.now() + days * 86400000).toUTCString();
      document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + expires + ';path=/' + (domain ? ';domain=' + domain : '') + ';SameSite=Lax';
    } catch (e) { /* cookie write failed -- localStorage/in-memory fallback below still works for this page load */ }
  }
  function anonId() {
    try {
      // Cookie first (cross-subdomain source of truth); localStorage as a
      // same-origin cache AND as the migration path for a visitor whose
      // only existing anon_id predates this fix (promotes it to a cookie
      // instead of silently minting a new, unrelated id for them).
      var id = getCookie('apex_anon_id') || localStorage.getItem('apex_anon_id');
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
      }
      localStorage.setItem('apex_anon_id', id);
      setCookie('apex_anon_id', id, 395); // ~13 months -- matches GA4's own default _ga cookie lifetime convention
      return id;
    } catch (e) { return null; }
  }

  function deviceType() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1024;
    if (w < 640) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  // True only for the exact page load where a fresh utm_ param was seen
  // in the URL -- distinguishes "this visit is a new tagged touch" from
  // every other call to utmProps() that's just reading back whatever's
  // already in localStorage from an earlier visit. syncLastTouchIfFresh()
  // below uses this so an internal in-app navigation (portal section
  // switch, plain link click with no tracking params) never gets
  // mistaken for a new acquisition touch.
  var freshUtmSeenThisLoad = false;

  // Captures utm_source/medium/campaign/content/term (+ landing page +
  // timestamp) on every landing and remembers them in localStorage under
  // two separate sets of keys:
  //   apex_<utm_key>        -- latest touch, overwritten every time a new
  //                             UTM param shows up in the URL. Used for
  //                             "which campaign generated this purchase"
  //                             (attached to checkout attempts) and to
  //                             keep profiles.last_touch_* current for
  //                             members who return via a new tagged link
  //                             after signing up.
  //   apex_<utm_key>_first  -- first touch, written once and never
  //                             overwritten again. Used for "which ad
  //                             generated this member" (attached to
  //                             profiles at signup).
  // Both survive across pages/visits on the same origin via localStorage,
  // which is how a registration or checkout on a later page/visit still
  // carries the original traffic source instead of losing it after the
  // first hop.
  function utmProps() {
    var out = {};
    try {
      var params = new URLSearchParams(window.location.search);
      var sawFreshUtm = UTM_KEYS.some(function (k) { return params.has(k); });
      if (sawFreshUtm) {
        freshUtmSeenThisLoad = true;
        UTM_KEYS.forEach(function (k) {
          var val = params.get(k) || '';
          localStorage.setItem('apex_' + k, val);
          if (!localStorage.getItem('apex_' + k + '_first')) localStorage.setItem('apex_' + k + '_first', val);
        });
        localStorage.setItem('apex_landing_page', window.location.href);
        localStorage.setItem('apex_last_touch_at', new Date().toISOString());
        if (!localStorage.getItem('apex_landing_page_first')) localStorage.setItem('apex_landing_page_first', window.location.href);
        if (!localStorage.getItem('apex_first_touch_at')) localStorage.setItem('apex_first_touch_at', new Date().toISOString());
      }
      out.traffic_source = localStorage.getItem('apex_utm_source') || null;
      out.traffic_medium = localStorage.getItem('apex_utm_medium') || null;
      out.campaign = localStorage.getItem('apex_utm_campaign') || null;
    } catch (e) { /* localStorage unavailable (private mode, etc.) -- fine, just omit */ }
    return out;
  }

  // Latest-touch UTM snapshot, for passing along to create-checkout-session
  // (persisted per-purchase on checkout_session_attempts -- see
  // supabase-portal-schema-v58.sql).
  function getUtm() {
    var out = {};
    try {
      UTM_KEYS.forEach(function (k) {
        out[k.replace('utm_', '')] = localStorage.getItem('apex_' + k) || null;
      });
    } catch (e) { /* localStorage unavailable -- omit */ }
    return out;
  }

  // If (and only if) THIS page load's URL carried a fresh utm_ param,
  // push the current latest-touch snapshot to the signed-in member's
  // profile (last_touch_* columns, supabase-portal-schema-v83.sql) so a
  // member who returns via a new tagged link well after signup doesn't
  // have that touch stranded in localStorage forever -- profiles.
  // signup_utm_* stays frozen at first touch on purpose; this is the
  // separate, updatable "most recent tagged visit" record. No-ops
  // silently if the visitor isn't signed in yet (pre-signup UTM already
  // rides along at signup time via getFirstTouchUtm(), below) or if
  // apexSupabase isn't loaded on this page.
  function syncLastTouchIfFresh() {
    try {
      if (!freshUtmSeenThisLoad || !window.apexSupabase) return;
      window.apexSupabase.auth.getSession().then(function (res) {
        var session = res && res.data && res.data.session;
        if (!session) return;
        var utm = getUtm();
        window.apexSupabase.rpc('update_last_touch_attribution', {
          p_source: utm.source, p_medium: utm.medium, p_campaign: utm.campaign,
          p_content: utm.content, p_term: utm.term,
          p_landing_page: localStorage.getItem('apex_landing_page') || window.location.href,
        }).catch(function () { /* best-effort -- a failed attribution sync must never block the page */ });
      }).catch(function () { /* no session -- fine, nothing to sync yet */ });
    } catch (e) { /* localStorage/apexSupabase unavailable -- fine, just skip */ }
  }

  // First-touch UTM snapshot, for passing along to create-free-account /
  // signup-and-unlock-* (persisted once on profiles.signup_utm_* -- see
  // supabase-portal-schema-v58.sql). Falls back to latest-touch if this
  // visitor's first-touch keys were never set (e.g. localStorage was
  // cleared between their first visit and signing up) -- a slightly
  // stale attribution is still more useful than none.
  function getFirstTouchUtm() {
    var out = {};
    try {
      UTM_KEYS.forEach(function (k) {
        out[k.replace('utm_', '')] = localStorage.getItem('apex_' + k + '_first') || localStorage.getItem('apex_' + k) || null;
      });
    } catch (e) { /* localStorage unavailable -- omit */ }
    return out;
  }

  // ── Referral (?ref=<code>) capture ──
  // The portal's "Refer a Friend" panel (site/portal-stable.js) already
  // generates shareable links like contact.html?ref=<CODE>, but nothing
  // in the codebase ever read that param -- referral attribution was
  // silently dead on arrival, for every referral ever shared, since the
  // feature shipped. Captured unconditionally the moment this script
  // loads (not tucked inside track(), unlike the UTM capture above,
  // which only runs as a side effect of an apexTrack() call happening to
  // fire on this exact page -- contact.html, where referral links
  // currently point, has no such call and would otherwise still lose it)
  // so it survives via localStorage to whatever page the visitor
  // eventually signs up on, same first-touch/never-overwritten pattern
  // as the UTM keys. Forwarded by portal-login.html's signup handler
  // into create-free-account, which calls record_referral_signup() --
  // see supabase-portal-schema-v73.sql.
  (function captureRef() {
    try {
      var ref = new URLSearchParams(window.location.search).get('ref');
      if (ref && /^[A-Za-z0-9_-]{1,40}$/.test(ref) && !localStorage.getItem('apex_ref_first')) {
        localStorage.setItem('apex_ref_first', ref);
      }
    } catch (e) { /* localStorage unavailable -- omit */ }
  })();

  function getFirstTouchRef() {
    try { return localStorage.getItem('apex_ref_first') || null; } catch (e) { return null; }
  }

  // First-touch landing page + timestamp, for create-free-account (see
  // getFirstTouchUtm() above for the matching source/medium/campaign/
  // content/term -- kept as a separate getter since it's new as of this
  // release and profiles.signup_utm_* predates it).
  function getFirstTouchLanding() {
    try {
      return {
        landing_page: localStorage.getItem('apex_landing_page_first') || null,
        at: localStorage.getItem('apex_first_touch_at') || null,
      };
    } catch (e) { return { landing_page: null, at: null }; }
  }

  // Runs unconditionally at script load (same reasoning as captureRef()
  // above: a page that never happens to call apexTrack() this session --
  // e.g. a member landing straight on a portal section with no funnel
  // event firing yet -- must still capture a fresh utm_ param and sync it
  // to the profile rather than losing it).
  utmProps();
  syncLastTouchIfFresh();

  // apexTrack() is called inline in the middle of real signup/checkout
  // handlers (see portal-login.html) -- an uncaught throw here (a stray
  // mock without .from() in a test, a network hiccup, anything) would
  // abort the rest of that synchronous handler too, silently breaking
  // the actual redirect/success-view code that runs after the tracking
  // call. Tracking must never be able to take the product down with it,
  // so every bit of work below is wrapped defensively.
  function track(eventName, properties) {
    try {
      if (EVENT_ALLOWLIST.indexOf(eventName) === -1) {
        console.warn('apexTrack: "' + eventName + '" is not in the funnel EVENT_ALLOWLIST — add it to site/analytics-events.js if this is a real new funnel step.');
      }

      var props = utmProps();
      props.device_type = deviceType();
      if (properties) {
        for (var k in properties) if (properties.hasOwnProperty(k)) props[k] = properties[k];
      }

      if (window.gtag) gtag('event', eventName, props);
      if (window.fbq) fbq('trackCustom', eventName, props);

      if (window.apexSupabase && typeof window.apexSupabase.from === 'function') {
        window.apexSupabase.from('analytics_events').insert({
          event_name: eventName,
          anon_id: anonId(),
          profile_id: props.profile_id || null,
          properties: props,
        }).then(function (res) {
          if (res && res.error) console.error('apexTrack: analytics_events insert failed', res.error);
        }).catch(function (e) { console.error('apexTrack: analytics_events insert threw', e); });
      }
    } catch (e) {
      console.error('apexTrack: tracking "' + eventName + '" failed, continuing anyway', e);
    }
  }

  // Fires a standard Meta Pixel event (ViewContent, Lead,
  // CompleteRegistration, InitiateCheckout) via fbq('track', ...) --
  // deliberately separate from apexTrack/trackCustom above. Meta's own
  // ad-optimization and reporting treat "standard" events specially
  // (they're what Ads Manager's built-in conversion picker expects), so
  // these fire under their real Meta name rather than being folded into
  // the custom funnel-event system. No analytics_events DB write here on
  // purpose -- apexTrack already logs the equivalent funnel-shaped event
  // (registration_started/registration_completed/checkout_started etc.)
  // for first-party reporting; this is purely the Meta-side signal.
  // Purchase itself is NOT included here -- it already has its own
  // dedup-by-session_id handling inline in portal-stable.js/
  // portal-login.html and must stay that way to avoid double-counting
  // revenue.
  function trackStandard(eventName, properties) {
    try {
      if (window.fbq) fbq('track', eventName, properties || {});
    } catch (e) {
      console.error('apexTrackStandard: tracking "' + eventName + '" failed, continuing anyway', e);
    }
  }

  window.apexTrack = track;
  window.apexTrackStandard = trackStandard;
  window.apexGetUtm = getUtm;
  window.apexGetFirstTouchUtm = getFirstTouchUtm;
  window.apexGetFirstTouchRef = getFirstTouchRef;
  window.apexGetFirstTouchLanding = getFirstTouchLanding;
  window.apexSyncLastTouchIfFresh = syncLastTouchIfFresh;
  window.apexGetAnonId = anonId;
})();
