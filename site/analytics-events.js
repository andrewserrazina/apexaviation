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
    'upgrade_prompt_clicked', 'refund_requested'
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

  // Captures utm_source/medium/campaign on first landing and remembers
  // them in localStorage so later events in the same funnel (registration,
  // checkout, purchase -- often on a different page/visit) still carry the
  // original traffic source instead of losing it after the first hop.
  function utmProps() {
    var out = {};
    try {
      var params = new URLSearchParams(window.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
        if (params.has(k)) {
          localStorage.setItem('apex_' + k, params.get(k));
        }
      });
      out.traffic_source = localStorage.getItem('apex_utm_source') || null;
      out.campaign = localStorage.getItem('apex_utm_campaign') || null;
    } catch (e) { /* localStorage unavailable (private mode, etc.) -- fine, just omit */ }
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

  window.apexTrack = track;
})();
