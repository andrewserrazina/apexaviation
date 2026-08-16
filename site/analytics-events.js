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
// EVENT_ALLOWLIST mirrors the funnel event list defined for this project.
// Not every event is wired up yet -- only the ones with a real trigger in
// the product today (see the implementation summary for what's deferred:
// readiness_assessment_*, walkthrough_video_*, onboarding_completed,
// quiz_completed, refund_requested -- those features don't exist yet).
(function () {
  var EVENT_ALLOWLIST = [
    'landing_page_viewed', 'pricing_viewed', 'readiness_assessment_started', 'readiness_assessment_completed',
    'registration_started', 'registration_completed', 'product_preview_viewed',
    'walkthrough_video_started', 'walkthrough_video_completed', 'checkout_started', 'checkout_abandoned',
    'purchase_completed', 'portal_first_login', 'onboarding_completed', 'first_lesson_started',
    'first_lesson_completed', 'quiz_completed', 'seven_day_active_user', 'upgrade_prompt_viewed',
    'upgrade_prompt_clicked', 'refund_requested',
    // Acquisition/conversion-system additions (see the Recommended Next
    // Step dashboard card + conversion-state work) -- real triggers only,
    // wired up alongside this allowlist addition, not speculative.
    'ai_dpe_started', 'ground_school_calendar_viewed', 'ground_school_class_viewed',
    'ground_school_class_purchased', 'ground_school_full_pack_viewed', 'checkride_prep_viewed',
    // Checkride Prep retargeting campaign (Aug 2026 Early Access push) --
    // real trigger in site/checkride-prep.html's CTA click handler.
    'early_access_cta_click'
  ];

  function anonId() {
    try {
      var id = localStorage.getItem('apex_anon_id');
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem('apex_anon_id', id);
      }
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

  // Captures utm_source/medium/campaign/content/term on every landing and
  // remembers them in localStorage under two separate sets of keys:
  //   apex_<utm_key>        -- latest touch, overwritten every time a new
  //                             UTM param shows up in the URL. Used for
  //                             "which campaign generated this purchase"
  //                             (attached to checkout attempts).
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
      UTM_KEYS.forEach(function (k) {
        if (params.has(k)) {
          var val = params.get(k);
          localStorage.setItem('apex_' + k, val);
          if (!localStorage.getItem('apex_' + k + '_first')) {
            localStorage.setItem('apex_' + k + '_first', val);
          }
        }
      });
      out.traffic_source = localStorage.getItem('apex_utm_source') || null;
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
})();
