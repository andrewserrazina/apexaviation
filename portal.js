(function () {
  'use strict';

  /* ── Auth guard ─────────────────────────────────────────────── */
  var raw = localStorage.getItem('apex_portal_member');
  if (!raw) {
    window.location.href = 'portal-login.html';
    return;
  }
  var member;
  try { member = JSON.parse(raw); } catch (e) { member = null; }
  if (!member || !member.name) {
    window.location.href = 'portal-login.html';
    return;
  }

  var CERT_LABELS = { private: 'Private Pilot', instrument: 'Instrument Rating', commercial: 'Commercial Pilot' };

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
    document.getElementById('accFullName').value = member.name;
    document.getElementById('accEmail').value = member.email;
    document.getElementById('accCertGoal').value = member.certGoal || 'private';
    var since = member.memberSince ? new Date(member.memberSince) : new Date();
    document.getElementById('memberSince').textContent = since.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }
  populateMember();

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

  function showSection(id) {
    if (!document.getElementById('section-' + id)) id = 'dashboard';
    sections.forEach(function (s) { s.classList.toggle('active', s.id === 'section-' + id); });
    navItems.forEach(function (b) { b.classList.toggle('active', b.dataset.section === id); });
    window.scrollTo(0, 0);
    if (history.replaceState) history.replaceState(null, '', '#' + id);
    closeSidebar();
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
    localStorage.removeItem('apex_portal_member');
    window.location.href = 'portal-login.html';
  }
  document.getElementById('signOutBtn').addEventListener('click', signOut);
  var signOutBtn2 = document.getElementById('signOutBtn2');
  if (signOutBtn2) signOutBtn2.addEventListener('click', signOut);

  /* ── Account form ───────────────────────────────────────────── */
  document.getElementById('accountForm').addEventListener('submit', function (e) {
    e.preventDefault();
    member.name = document.getElementById('accFullName').value.trim() || member.name;
    member.email = document.getElementById('accEmail').value.trim() || member.email;
    member.certGoal = document.getElementById('accCertGoal').value;
    localStorage.setItem('apex_portal_member', JSON.stringify(member));
    populateMember();
    toast('Profile updated.');
  });

  /* ══════════════════════════════════════════════════════════════
     DPE QUESTIONS LIBRARY
     ══════════════════════════════════════════════════════════════ */
  var DPE_DATA = [
    { cat: 'regulations', q: 'What are the requirements for a private pilot to act as PIC under VFR at night?', a: 'You need a valid pilot certificate with the appropriate category/class rating, a current flight review within the last 24 calendar months, and — if carrying passengers at night — 3 takeoffs and 3 landings to a full stop within the preceding 90 days, done at night, per 14 CFR 61.57(b). You must also hold a current medical or qualify under BasicMed.' },
    { cat: 'regulations', q: 'What documents are required to be aboard the aircraft?', a: 'Remember "ARROW": Airworthiness certificate, Registration, Radio station license (only for international flights), Operating limitations (POH/AFM), and Weight and balance data.' },
    { cat: 'regulations', q: 'What are the currency requirements to carry passengers during the day?', a: 'Per 14 CFR 61.57(a), you need 3 takeoffs and 3 landings in the preceding 90 days in an aircraft of the same category, class, and if a type rating is required, the same type.' },
    { cat: 'regulations', q: 'When is a flight review required and what does it consist of?', a: 'Every 24 calendar months per 14 CFR 61.56, consisting of a minimum of 1 hour of flight training and 1 hour of ground training, covering a review of current general operating and flight rules and maneuvers the instructor determines necessary.' },
    { cat: 'regulations', q: 'What are the VFR fuel requirements?', a: 'Day VFR: enough fuel to fly to the first point of intended landing plus 30 minutes at normal cruise. Night VFR: same, but 45 minutes reserve, per 14 CFR 91.151.' },
    { cat: 'weather', q: 'Explain the stability of an air mass and how it affects cloud formation.', a: 'A stable air mass resists vertical movement, producing stratiform clouds, smooth air, and poor visibility in haze or fog. An unstable air mass allows air to rise freely, producing cumuliform clouds, turbulence, and showery precipitation.' },
    { cat: 'weather', q: 'What is a METAR and how do you decode the wind and visibility groups?', a: 'A METAR is a routine aviation weather report issued hourly. Wind is reported as a 3-digit true direction plus 2-3 digit speed in knots (e.g. 18010KT = 180° at 10 knots), with "G" indicating gusts. Visibility follows in statute miles.' },
    { cat: 'weather', q: 'What hazards are associated with a frontal passage?', a: 'Cold fronts bring fast-moving, often severe weather — thunderstorms, gusty winds, and a sharp wind shift. Warm fronts bring widespread stratiform clouds, extended precipitation, and low ceilings/visibility, often with the risk of icing in winter.' },
    { cat: 'weather', q: 'How do you obtain a preflight weather briefing and what should it include?', a: 'Through 1800wxbrief.com, ForeFlight, or Flight Service (1-800-WX-BRIEF). A standard briefing includes adverse conditions, a synopsis, current conditions, en route and destination forecasts, winds aloft, NOTAMs, and ATC delays.' },
    { cat: 'weather', q: 'What conditions are favorable for structural icing?', a: 'Visible moisture (clouds, rain, or fog) combined with temperatures at or below freezing, most commonly between 0°C and -20°C. Freezing rain and freezing drizzle are especially hazardous because they can deposit ice rapidly.' },
    { cat: 'airspace', q: 'What are the requirements to operate in Class C airspace?', a: 'Two-way radio communication established with ATC prior to entry, and an operable transponder with Mode C (altitude reporting) and ADS-B Out if required. No specific pilot certificate or equipment beyond that is required for VFR operations.' },
    { cat: 'airspace', q: 'Describe the dimensions and requirements of Class B airspace.', a: 'Class B typically extends from the surface to 10,000 ft MSL around the nation\'s busiest airports, shaped like an inverted wedding cake. An explicit ATC clearance is required to enter, along with a Mode C transponder, ADS-B Out, and (for student pilots) specific endorsements.' },
    { cat: 'airspace', q: 'What are the VFR cloud clearance and visibility requirements in Class E airspace below 10,000 ft MSL?', a: '3 statute miles visibility, 500 ft below, 1,000 ft above, and 2,000 ft horizontal from clouds.' },
    { cat: 'airspace', q: 'How do you identify Special Use Airspace on a sectional chart, and what does each type mean?', a: 'Restricted, Prohibited, Warning, Alert, and MOAs are shown with distinct border patterns and area numbers. Restricted areas may contain hazards like artillery firing; Prohibited areas are barred to all aircraft; MOAs indicate military training activity where VFR traffic should exercise caution.' },
    { cat: 'airspace', q: 'What is the difference between Class G and Class E airspace at low altitude?', a: 'Class G is uncontrolled airspace, generally from the surface up to the base of the overlying Class E (often 700 or 1,200 ft AGL), with reduced VFR weather minimums. Class E is controlled airspace where ATC provides separation services to IFR traffic.' },
    { cat: 'aerodynamics', q: 'Explain the four forces acting on an aircraft in flight.', a: 'Lift (generated by the wings, acting perpendicular to the relative wind), weight (gravity, acting toward the center of the earth), thrust (produced by the engine/propeller), and drag (resistance opposing motion through the air). In steady, unaccelerated flight, these forces are in equilibrium.' },
    { cat: 'aerodynamics', q: 'What causes a stall, and how is it recovered?', a: 'A stall occurs when the critical angle of attack is exceeded, regardless of airspeed or attitude, causing airflow separation over the wing and a loss of lift. Recovery requires reducing the angle of attack (relaxing back pressure), applying full power in most training aircraft, and leveling the wings before returning to a climb.' },
    { cat: 'aerodynamics', q: 'Describe the relationship between angle of attack and coefficient of lift.', a: 'Lift coefficient increases roughly linearly with angle of attack up to the critical angle of attack, at which point airflow separates from the wing\'s upper surface and lift drops sharply — this is the stall.' },
    { cat: 'aerodynamics', q: 'How does the fuel system on your training aircraft work?', a: 'This answer is aircraft-specific — describe your tanks, fuel selector positions, fuel pump(s), and how fuel flows from tank to engine, including any placards or limitations (e.g., "both" required for takeoff/landing).' },
    { cat: 'aerodynamics', q: 'What is load factor and how does it relate to stall speed?', a: 'Load factor is the ratio of the load supported by the wings to the actual weight of the aircraft, expressed in G units. As load factor increases (in a bank or pull-up), stall speed increases by the square root of the load factor.' },
    { cat: 'navigation', q: 'How do you calculate true airspeed from indicated airspeed?', a: 'Correct indicated airspeed for instrument and position error to get calibrated airspeed, then adjust for pressure altitude and non-standard temperature using an E6B or electronic flight computer (or a rule of thumb of roughly 2% per 1,000 ft of density altitude) to get true airspeed.' },
    { cat: 'navigation', q: 'Walk me through how you planned this cross-country flight.', a: 'Discuss route selection considering airspace and terrain, checkpoints, magnetic course and heading corrected for wind, groundspeed and time/fuel calculations, fuel reserves, alternate airports, and weather/NOTAM review.' },
    { cat: 'navigation', q: 'What is density altitude and why does it matter for performance planning?', a: 'Density altitude is pressure altitude corrected for non-standard temperature — it represents the altitude the aircraft "feels" it\'s performing at. High density altitude (hot, high, humid) reduces engine power, propeller efficiency, and lift, lengthening takeoff/landing distances and reducing climb performance.' },
    { cat: 'navigation', q: 'How would you divert to an alternate airport in flight?', a: 'Identify the nearest suitable airport, determine a heading using the compass/chart or GPS, estimate time and fuel required, notify ATC if applicable, and continually reassess weather and fuel as you proceed.' },
    { cat: 'emergencies', q: 'What is your immediate action for an engine failure after takeoff?', a: 'Pitch for best glide speed immediately, select a landing spot generally within 30° of your nose, run the appropriate emergency checklist if time and altitude permit, and communicate/squawk 7700 if able. Land straight ahead or with minimal turn unless a return to the runway has been briefed and is safely achievable.' },
    { cat: 'emergencies', q: 'What would you do if you experienced a partial electrical failure in IMC?', a: 'Prioritize aircraft control using available instruments, isolate the failure (check circuit breakers, alternator/master switches), reduce electrical load by shedding non-essential equipment, and consider requesting a lower workload environment (e.g., vectors to the nearest suitable airport) from ATC.' },
    { cat: 'emergencies', q: 'How do you handle an inadvertent encounter with IMC as a VFR-only pilot?', a: 'Maintain aircraft control using the attitude indicator and other primary instruments, avoid abrupt control inputs, consider a standard-rate 180° turn back toward known VMC, and communicate with ATC for assistance and vectors as needed.' },
    { cat: 'emergencies', q: 'What are the signs of carbon monoxide poisoning in flight, and what is your response?', a: 'Symptoms include headache, dizziness, drowsiness, and impaired judgment. Immediately turn off the cabin heat, open fresh-air vents/windows if possible, and land as soon as practical.' }
  ];

  var dpeLibraryEl = document.getElementById('dpeLibrary');
  var dpeSearch = document.getElementById('dpeSearch');
  var dpeTabs = document.getElementById('dpeTabs');
  var dpeEmpty = document.getElementById('dpeEmpty');
  var dpeActiveCat = 'all';

  var CAT_LABELS = {
    regulations: 'Regulations',
    weather: 'Weather',
    airspace: 'Airspace',
    aerodynamics: 'Aerodynamics & Systems',
    navigation: 'Navigation & Flight Planning',
    emergencies: 'Emergencies'
  };

  function renderDpeLibrary() {
    var term = dpeSearch.value.trim().toLowerCase();
    var byCat = {};
    var totalShown = 0;

    DPE_DATA.forEach(function (item, idx) {
      if (dpeActiveCat !== 'all' && item.cat !== dpeActiveCat) return;
      var matches = !term || item.q.toLowerCase().indexOf(term) !== -1 || item.a.toLowerCase().indexOf(term) !== -1;
      if (!matches) return;
      if (!byCat[item.cat]) byCat[item.cat] = [];
      byCat[item.cat].push({ item: item, idx: idx });
      totalShown++;
    });

    dpeLibraryEl.innerHTML = '';
    Object.keys(CAT_LABELS).forEach(function (cat) {
      if (!byCat[cat]) return;
      var group = document.createElement('div');
      group.className = 'portal-qgroup';
      var title = document.createElement('div');
      title.className = 'portal-qgroup__title';
      title.innerHTML = CAT_LABELS[cat] + ' <span class="count">' + byCat[cat].length + '</span>';
      group.appendChild(title);

      var list = document.createElement('div');
      list.className = 'portal-qlist';
      byCat[cat].forEach(function (entry) {
        var qitem = document.createElement('div');
        qitem.className = 'portal-qitem';
        qitem.innerHTML =
          '<button class="portal-qitem__q" type="button">' +
            '<span>' + entry.item.q + '</span>' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          '</button>' +
          '<div class="portal-qitem__a"><p>' + entry.item.a + '</p></div>';
        qitem.querySelector('.portal-qitem__q').addEventListener('click', function () {
          qitem.classList.toggle('open');
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
    tab.addEventListener('click', function () {
      dpeTabs.querySelectorAll('.portal-tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      dpeActiveCat = tab.dataset.cat;
      renderDpeLibrary();
    });
  });
  renderDpeLibrary();

  /* ══════════════════════════════════════════════════════════════
     SCENARIO TRAINING CENTER
     ══════════════════════════════════════════════════════════════ */
  var SCENARIOS = [
    {
      tag: 'Cross-Country', time: '10-15 min', title: 'Weather deteriorates en route on a VFR cross-country',
      brief: 'You\'re 40 minutes into a 2-hour VFR cross-country when you notice the ceiling ahead has dropped and visibility is worsening faster than forecast.',
      decisions: ['Reassess current position, fuel, and nearest suitable airports', 'Check current weather via ATC, ADS-B, or Flight Service', 'Decide: continue, divert, or turn back — before conditions force the decision', 'Communicate intentions to ATC or Flight Following if applicable'],
      debrief: ['What cues should have triggered the decision earlier?', 'How does personal minimums differ from legal VFR minimums?', 'What resources are available in the cockpit to verify conditions ahead?']
    },
    {
      tag: 'Emergency', time: '10-15 min', title: 'Engine roughness at cruise over unfavorable terrain',
      brief: 'Cruising at 5,500 ft, you notice a slight engine roughness and a drop in RPM. There is no suitable landing area directly below.',
      decisions: ['Establish best glide / maintain aircraft control first', 'Run the engine roughness checklist (carb heat, mixture, fuel selector, mags)', 'Identify the nearest suitable landing site while troubleshooting', 'Declare an emergency if conditions warrant'],
      debrief: ['Why is troubleshooting sequenced after securing a landing option?', 'What is the difference between carburetor icing and other causes of roughness?', 'When should you declare an emergency versus just requesting priority handling?']
    },
    {
      tag: 'Airspace', time: '8-12 min', title: 'Unplanned Class B transition on a busy Saturday',
      brief: 'Your planned route skirts the edge of Class B airspace, but a stronger-than-forecast tailwind has you approaching the boundary faster than planned, with towering cumulus building nearby.',
      decisions: ['Recheck position relative to the Class B shelf using chart and GPS', 'Determine whether to request clearance, alter course, or descend below the shelf', 'Communicate with ATC early rather than reactively', 'Account for the weather buildup in the course change'],
      debrief: ['What are the consequences of an inadvertent Class B incursion?', 'How would you request a clearance if you decided to transition?', 'How does workload management change when weather and airspace pressure occur together?']
    },
    {
      tag: 'IFR', time: '12-18 min', title: 'Approach into deteriorating weather at destination',
      brief: 'On an IFR flight plan, the latest ATIS at your destination now reports ceiling and visibility right at your approach minimums, with a light and variable wind.',
      decisions: ['Verify current approach minimums and required visibility for your aircraft/pilot category', 'Review the missed approach procedure before beginning the approach', 'Brief an alternate airport and required fuel to divert', 'Decide whether to attempt the approach, hold, or divert immediately'],
      debrief: ['What regulatory requirements govern filing an alternate?', 'How do you weigh currency and personal comfort against legal minimums?', 'At what point during the approach do you commit to the missed approach?']
    },
    {
      tag: 'Systems', time: '8-10 min', title: 'Alternator failure mid-flight in day VFR',
      brief: 'The ammeter shows a discharge and the alternator warning light illuminates 30 minutes from your destination in clear VFR conditions.',
      decisions: ['Verify the failure (check circuit breakers, try resetting per POH)', 'Reduce electrical load — turn off non-essential avionics and lighting', 'Estimate remaining battery endurance for essential equipment', 'Decide whether to continue to destination or land sooner at a suitable airport'],
      debrief: ['What is the difference between an alternator failure and a full electrical failure?', 'Which equipment would you shed first, and why?', 'How does daylight VFR change your risk calculus compared to night or IMC?']
    },
    {
      tag: 'Decision Making', time: '10-15 min', title: 'Passenger pressure to fly in marginal conditions',
      brief: 'Your passengers have a tight schedule and are encouraging you to depart despite a forecast for marginal VFR conditions with isolated thunderstorms along your route.',
      decisions: ['Separate the desire to please passengers from an objective risk assessment', 'Use a personal minimums checklist or FAA risk assessment tool (e.g., PAVE, IMSAFE)', 'Communicate your decision clearly and confidently to passengers', 'Identify alternatives — delayed departure, different route, or commercial travel'],
      debrief: ['What is "get-there-itis" and how does it factor into accident statistics?', 'How do you communicate a scrub decision to passengers without conflict?', 'What tools exist to make this decision more objective and less emotional?']
    }
  ];

  var scenarioGrid = document.getElementById('scenarioGrid');
  SCENARIOS.forEach(function (s) {
    var card = document.createElement('div');
    card.className = 'portal-card portal-scenario-card';
    card.innerHTML =
      '<span class="portal-scenario-card__tag">' + s.tag + '</span>' +
      '<h3>' + s.title + '</h3>' +
      '<p>' + s.brief + '</p>' +
      '<div class="portal-scenario-card__meta"><span>⏱ ' + s.time + '</span></div>' +
      '<button class="portal-scenario-card__toggle" type="button">Start scenario ' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '</button>' +
      '<div class="portal-scenario-detail">' +
        '<h4>Key decision points</h4>' +
        '<ul>' + s.decisions.map(function (d) { return '<li>' + d + '</li>'; }).join('') + '</ul>' +
        '<h4>Debrief questions</h4>' +
        '<ul>' + s.debrief.map(function (d) { return '<li>' + d + '</li>'; }).join('') + '</ul>' +
      '</div>';
    card.querySelector('.portal-scenario-card__toggle').addEventListener('click', function (e) {
      var expanded = card.classList.toggle('expanded');
      e.currentTarget.firstChild.textContent = expanded ? 'Hide scenario ' : 'Start scenario ';
    });
    scenarioGrid.appendChild(card);
  });

  /* ══════════════════════════════════════════════════════════════
     PROGRESS TRACKING
     ══════════════════════════════════════════════════════════════ */
  var TRACKS = [
    {
      id: 'private', title: 'Private Pilot Track',
      items: [
        'Complete Apex Advantage Private Pilot ground school modules',
        'Review Checkride Prep Pack — Regulations & Airspace',
        'Review Checkride Prep Pack — Weather & Performance',
        'Practice all Private Pilot DPE questions in the library',
        'Complete Cross-Country scenario training',
        'Complete Emergency scenario training',
        'Schedule and pass the FAA knowledge test',
        'Complete pre-checkride stage check with an instructor'
      ]
    },
    {
      id: 'instrument', title: 'Instrument Rating Track',
      items: [
        'Complete Apex Advantage Instrument Rating ground school modules',
        'Review IFR regulations and approach procedures',
        'Practice all IFR-related DPE questions in the library',
        'Complete IFR Approach scenario training',
        'Log required instrument time and approaches',
        'Schedule and pass the FAA knowledge test'
      ]
    },
    {
      id: 'commercial', title: 'Commercial Pilot Track',
      items: [
        'Complete Apex Advantage Commercial Pilot ground school modules',
        'Review complex aircraft systems and performance planning',
        'Practice all Commercial-level DPE questions in the library',
        'Complete Systems Failure scenario training',
        'Log required commercial pilot flight time',
        'Schedule and pass the FAA knowledge test'
      ]
    }
  ];

  var PROGRESS_KEY = 'apex_portal_progress';
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveProgress(data) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  }
  var progressData = loadProgress();

  var progressTracksEl = document.getElementById('progressTracks');
  var statOverallPct = document.getElementById('statOverallPct');

  function computeTrackPct(track) {
    var done = 0;
    track.items.forEach(function (_, i) {
      if (progressData[track.id] && progressData[track.id][i]) done++;
    });
    return Math.round((done / track.items.length) * 100);
  }

  function computeOverallPct() {
    var totalItems = 0, totalDone = 0;
    TRACKS.forEach(function (track) {
      totalItems += track.items.length;
      track.items.forEach(function (_, i) {
        if (progressData[track.id] && progressData[track.id][i]) totalDone++;
      });
    });
    return totalItems ? Math.round((totalDone / totalItems) * 100) : 0;
  }

  function renderProgress() {
    progressTracksEl.innerHTML = '';
    TRACKS.forEach(function (track) {
      if (!progressData[track.id]) progressData[track.id] = {};
      var pct = computeTrackPct(track);

      var wrap = document.createElement('div');
      wrap.className = 'portal-card portal-track';
      wrap.innerHTML =
        '<div class="portal-track__head"><h3>' + track.title + '</h3><span class="portal-track__pct">' + pct + '% complete</span></div>' +
        '<div class="portal-progress-bar"><div class="portal-progress-bar__fill" style="width:' + pct + '%"></div></div>' +
        '<div class="portal-checklist"></div>';

      var checklist = wrap.querySelector('.portal-checklist');
      track.items.forEach(function (label, i) {
        var row = document.createElement('label');
        row.className = 'portal-checkitem';
        var checked = !!progressData[track.id][i];
        row.innerHTML = '<input type="checkbox" ' + (checked ? 'checked' : '') + ' /><span>' + label + '</span>';
        row.querySelector('input').addEventListener('change', function (e) {
          progressData[track.id][i] = e.target.checked;
          saveProgress(progressData);
          renderProgress();
        });
        checklist.appendChild(row);
      });

      progressTracksEl.appendChild(wrap);
    });

    statOverallPct.textContent = computeOverallPct() + '%';
  }

  renderProgress();
})();
