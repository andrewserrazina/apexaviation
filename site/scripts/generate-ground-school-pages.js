#!/usr/bin/env node
// Generates one SEO landing page per city in ground-school-locations.json,
// targeting "private pilot ground school near me" / "flight instructor
// near me" style searches.
//
// Originally built for the live-virtual group Ground School product
// ($25/class). That product is discontinued; these pages now advertise
// Apex Advantage Private Instruction instead -- flat $55/hour, 1-on-1,
// every certificate level, flexible (ground school content, checkride
// prep, oral prep, whatever the student needs that hour). Delivered live
// virtual exactly like the old product was, so a page for a city anywhere
// in the US is still honest: the instructor really is available there.
//
// ground-school-locations.json, slugify(), and every generated filename/
// canonical URL are unchanged from the original group-class version --
// only the copy changed, so these pages keep their existing SEO equity
// rather than starting over at new URLs.
//
// To avoid Google's "doorway pages" penalty (many near-identical pages
// differing only by city name), each page varies by:
//   - a rotating pool of intro copy (COPY_VARIANTS, assigned by index)
//   - a region-specific FAQ block (FAQS_BY_REGION, Northeast/Midwest/South/West)
// No fabricated facts (invented airport codes, FSDO offices, testimonials
// attributed to fake people) -- only real, verifiable things: city name,
// state name, and time zone.
//
// Usage: node generate-ground-school-pages.js
// Re-run any time after editing ground-school-locations.json to add more
// cities or regenerate all pages with template changes.

const fs = require('fs');
const path = require('path');

const SITE_DIR = path.join(__dirname, '..');
const locations = JSON.parse(fs.readFileSync(path.join(__dirname, 'ground-school-locations.json'), 'utf8'));

function slugify(city, stateAbbr) {
  return city.toLowerCase().replace(/\./g, '').replace(/'/g, '').replace(/\s+/g, '-') + '-' + stateAbbr.toLowerCase();
}

const COPY_VARIANTS = [
  (city, state) => `Finding real 1-on-1 flight training help near ${city} usually means picking between a handful of local CFIs' open slots, awkward in-person scheduling, or a self-paced video course with no instructor to ask. Apex Advantage Private Instruction is a third option: live, 1-on-1 time with a real CFI you book from home in ${state}, on whatever topic you actually need that hour.`,
  (city, state) => `Most flight-training help falls into two camps: an in-person instructor who only exists if you happen to live near one, or a prerecorded video course with no instructor at all. Pilots in ${city} get a third option with Apex Advantage Private Instruction — live, 1-on-1 sessions with Andrew, Apex Aviation's founder and Chief Flight Instructor, no matter where in ${state} you're logging in from.`,
  (city, state) => `Self-paced study is easy to buy and easy to abandon when you hit something you can't work through alone. Apex Advantage Private Instruction was built for ${city}-area students who want a real CFI's attention on exactly what's holding them back — booked by the hour, with no package or bundle required.`,
  (city, state) => `A lot of 1-on-1 instructor time in ${state} still means a long drive to whichever CFI happens to have an opening near ${city}. Apex Advantage Private Instruction is live and virtual, so ${city}-area students get real-time, 1-on-1 instruction on ground school content, checkride prep, or anything else, without needing to find a local instructor's open slot.`,
  (city, state) => `If you've searched for flight-training help near ${city} and mostly found stale course libraries or instructors with no openings, Apex Advantage Private Instruction is built differently — live, 1-on-1 sessions delivered virtually, so students throughout ${state} get the same real-time instructor time as anyone in Austin, TX.`,
  (city, state) => `Getting unstuck shouldn't come down to what happens to exist within driving distance. Apex Advantage Private Instruction is delivered live and virtual, which means ${city}-area students get real 1-on-1 time with a CFI on whatever they're working on — the same hourly sessions Apex offers everywhere else in ${state} and beyond.`,
];

const FAQS_BY_REGION = {
  Northeast: [
    ['Do I need to be near Austin, TX to book Private Instruction?', 'No. Apex Advantage Private Instruction is delivered live and virtual, so students throughout the Northeast book the same real-time, 1-on-1 sessions from home — nothing about it depends on where you live.'],
    ['Will session times work with my time zone?', 'Available hours are shown in your own local time zone when you book, so you can see exactly what works for you before you pay.'],
    ['Is this the same as FAA written test prep, or something different?', "It's flexible 1-on-1 time with a CFI — ground school content, checkride oral prep, a specific weak area, whatever you bring to the session. It isn't a fixed knowledge-test drilling course, though it can absolutely be used to get ready for one."],
  ],
  Midwest: [
    ['Is Apex Advantage Private Instruction only for students near Austin, TX?', "No — it's live and virtual, so pilots anywhere in the Midwest book the exact same real-time, 1-on-1 sessions as students anywhere else."],
    ['What does a typical session look like?', 'Each session is a full hour, 1-on-1 with your instructor, focused entirely on whatever you came in to work on — there\'s no fixed lesson plan to get through.'],
    ['Can I ask questions during the session, or is it a recorded lecture?', "It's live and 1-on-1 — you can ask anything in real time, the same as sitting across from an instructor in person, just from wherever you are."],
  ],
  South: [
    ['Do I have to travel to Texas for Private Instruction?', 'No. Sessions are 100% live virtual, so students throughout the South (and everywhere else) book from home on their own schedule.'],
    ['How is this different from a video-course or self-paced program?', 'A video course has no instructor and can\'t answer a follow-up question. Private Instruction is a real, live, 1-on-1 hour with a CFI, so you get real-time answers instead of a static video library.'],
    ['Is this only for Private Pilot, or does it cover other certificates too?', 'Private Instruction is open to every certificate level — Private, Instrument, and Commercial.'],
  ],
  West: [
    ['Is Private Instruction available to pilots on the West Coast / Mountain Time?', "Yes — it's delivered live virtual to students anywhere, with available hours shown in your own local time zone when you book."],
    ['What makes this different from a self-paced online course?', 'Self-paced courses have no live instructor and can\'t adapt to what you specifically need. Private Instruction is a real, scheduled hour with a CFI focused entirely on your topic.'],
    ['Do I need any equipment beyond a computer?', 'Just a reliable internet connection and a way to join a video call — no special software or hardware required.'],
  ],
};

function faqHtml(region) {
  const faqs = FAQS_BY_REGION[region] || FAQS_BY_REGION.South;
  return faqs.map(([q, a]) => `
        <div style="margin-bottom:24px">
          <h3 style="color:var(--white);font-size:17px;font-weight:700;margin:0 0 8px">${q}</h3>
          <p style="margin:0;color:rgba(255,255,255,0.65)">${a}</p>
        </div>`).join('\n');
}

function pageHtml(loc, index) {
  const { city, state, stateAbbr, timezone, region } = loc;
  const copy = COPY_VARIANTS[index % COPY_VARIANTS.length](city, state);
  const title = `Private Instruction Near ${city}, ${stateAbbr} | Apex Advantage`;
  const description = `Live, 1-on-1 Private Instruction for ${city}, ${state} pilots — $55/hour, every certificate level. Ground school content, checkride prep, oral prep, or whatever you need. Taught by CFI/CFII Andrew Serrazina.`;
  const canonical = `https://apexaviationtx.com/ground-school-${slugify(city, stateAbbr)}.html`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${canonical}" />
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Playfair+Display:ital@0;1&display=swap" rel="stylesheet" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="https://apexaviationtx.com/apexwhite.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="https://apexaviationtx.com/apexwhite.png" />
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="pages.css" />
  <script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "Apex Advantage Private Instruction",
  "description": "Live, 1-on-1 flight-training instruction available to students nationwide, including ${city}, ${state} -- ground school content, checkride prep, oral prep, or whatever the student needs that hour.",
  "provider": {
    "@type": "Organization",
    "name": "Apex Aviation",
    "sameAs": "https://apexaviationtx.com"
  },
  "areaServed": { "@type": "City", "name": "${city}, ${stateAbbr}" },
  "offers": {
    "@type": "Offer",
    "price": "55",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock"
  },
  "url": "${canonical}"
}
</script>
  <!-- Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-JFPBCF2GXE"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-JFPBCF2GXE');
  </script>

  <!-- Microsoft Clarity -->
  <script>
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window,document,'clarity','script','x95g0qe0g6');
  </script>
</head>
<body>

  <header class="nav" id="nav">
    <div class="container nav__inner">
      <a href="home.html" class="nav__logo">
        <img src="apexwhite.png" alt="Apex Aviation" height="40" style="display:block;width:auto" />
      </a>
      <nav class="nav__links">
        <a href="programs.html">Services</a>
        <div class="nav__dropdown" id="trainingDropdown">
          <button class="nav__dropdown-toggle" aria-expanded="false" aria-haspopup="true">
            Training
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="nav__dropdown-menu">
            <a href="private-pilot-training.html">Private Pilot</a>
            <a href="instrument-rating-training.html">Instrument Rating</a>
            <a href="commercial-pilot-training.html">Commercial Pilot</a>
            <a href="apex-advantage.html">Apex Advantage</a>
          </div>
        </div>
        <a href="fleet.html">Facility</a>
        <a href="about.html">About</a>
        <a href="instructors.html">Team</a>
        <a href="pricing.html">Pricing</a>
        <a href="apex-advantage.html" class="btn btn--nav-outline">Apex Advantage</a>
        <a href="portal-login.html" class="btn btn--nav-ghost">Login</a>
        <a href="contact.html" class="btn btn--nav">Book a Session</a>
      </nav>
      <button class="nav__hamburger" id="hamburger" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
    <div class="nav__mobile" id="mobileMenu">
      <a href="programs.html">Services</a>
      <a href="private-pilot-training.html">Private Pilot Training</a>
      <a href="instrument-rating-training.html">Instrument Rating</a>
      <a href="commercial-pilot-training.html">Commercial Pilot</a>
      <a href="apex-advantage-private-instruction.html">Private Instruction</a>
      <a href="fleet.html">Facility</a>
      <a href="about.html">About</a>
      <a href="instructors.html">Team</a>
      <a href="pricing.html">Pricing</a>
      <a href="portal-login.html">Login</a>
      <a href="contact.html">Book a Session</a>
    </div>
  </header>

  <section class="page-hero">
    <div class="page-hero__bg-text">${city.toUpperCase()}</div>
    <div class="container page-hero__inner">
      <div class="section__eyebrow">Live, 1-on-1, $55/Hour</div>
      <h1 class="page-hero__title">Private Instruction for ${city}, ${stateAbbr} Pilots</h1>
      <p class="page-hero__sub">Apex Advantage runs live, 1-on-1 Private Instruction for students anywhere in ${state} — no local instructor required, taught by CFI/CFII Andrew Serrazina, with available hours shown in your own time zone (${timezone} students welcome).</p>
    </div>
  </section>

  <section class="section section--light">
    <div class="container">
      <div style="max-width:800px;margin:0 auto;color:rgba(255,255,255,0.65);line-height:1.9;font-size:16px">

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">1-on-1 Instruction for ${city} Pilots, Without the Local Search</h2>
        <p style="margin-bottom:32px">${copy}</p>

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">What You Can Work On</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:20px;margin:24px 0 40px">
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Ground School Content</p>
            <p style="margin:0;font-size:14px;opacity:.85">Stuck on airspace, regs, weather, or performance? Work through it 1-on-1 instead of alone.</p>
          </div>
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Checkride Oral Prep</p>
            <p style="margin:0;font-size:14px;opacity:.85">Realistic DPE-style questioning on exactly the areas you're unsure about.</p>
          </div>
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Cross-Country &amp; Planning</p>
            <p style="margin:0;font-size:14px;opacity:.85">Walk through a real flight plan, weight and balance, or performance calculations together.</p>
          </div>
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Whatever You Need</p>
            <p style="margin:0;font-size:14px;opacity:.85">No fixed curriculum — you set the agenda, and the hour is built around it.</p>
          </div>
        </div>

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">Already Have the Free Guide? Go Further with Checkride Prep</h2>
        <p style="margin-bottom:20px">Every free Apex Advantage portal account includes the "10 Questions DPEs Love to Ask" guide. The full Checkride Prep System adds a 300+ question DPE-style bank, scenario training, and progress tracking — built for students anywhere, not just ${city}.</p>
        <div style="margin-bottom:40px">
          <a href="checkride-prep.html" class="btn btn--outline">Explore Checkride Prep Resources &rarr;</a>
        </div>

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">Common Questions from ${city}-Area Students</h2>
${faqHtml(region)}

        <div style="margin:48px 0;text-align:center">
          <h3 style="color:var(--white);font-size:22px;font-weight:800;margin:0 0 20px">Ready to Get Started?</h3>
          <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
            <a href="apex-advantage-private-instruction.html" class="btn btn--primary">View Available Times — $55/hr</a>
            <a href="portal-login.html?view=signup" class="btn btn--outline">Create Your Free Portal Account</a>
          </div>
        </div>

      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="container footer__inner">
      <div class="footer__brand">
        <a href="home.html" class="nav__logo">
        <img src="apexwhite.png" alt="Apex Aviation" height="40" style="display:block;width:auto" />
        </a>
        <p>Train Beyond the Checkride. Live virtual Private Instruction available nationwide, based in Austin, Texas.</p>
        <div class="footer__social">
          <a href="https://www.facebook.com/profile.php?id=61590455400224" target="_blank" rel="noopener" aria-label="Facebook"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 00-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 011-1h3z"/></svg></a>
          <a href="https://www.instagram.com/apexaviationtx" target="_blank" rel="noopener" aria-label="Instagram"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="2" width="20" height="20" rx="5" ry="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.5"/></svg></a>
          <a href="https://www.youtube.com/@apexaviationtx" target="_blank" rel="noopener" aria-label="YouTube"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22.54 6.42a2.78 2.78 0 00-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 00-1.95 1.96A29 29 0 001 12a29 29 0 00.46 5.58a2.78 2.78 0 001.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 001.95-1.96A29 29 0 0023 12a29 29 0 00-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="white"/></svg></a>
          <a href="https://www.tiktok.com/@apexaviationtx" target="_blank" rel="noopener" aria-label="TikTok"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.75a4.85 4.85 0 01-1.01-.06z"/></svg></a>
          <a href="https://www.linkedin.com/company/apex-aviation-tx" target="_blank" rel="noopener" aria-label="LinkedIn"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z"/><circle cx="4" cy="4" r="2"/></svg></a>
        </div>
      </div>
      <div class="footer__links">
        <div>
          <h4>Training</h4>
          <a href="apex-advantage.html">Apex Advantage</a>
          <a href="apex-advantage-private-instruction.html">Private Instruction</a>
          <a href="checkride-prep.html">Checkride Prep</a>
          <a href="programs.html#recurrent">IPC &amp; Instrument</a>
          <a href="programs.html#recurrent">Flight Reviews</a>
        </div>
        <div>
          <h4>Company</h4>
          <a href="about.html">About Apex</a>
          <a href="instructors.html">Our Instructors</a>
          <a href="fleet.html">The Simulator</a>
          <a href="about.html#founder">Andrew Serrazina</a>
          <a href="home.html#waitlist">Founding Members</a>
        </div>
        <div>
          <h4>Contact</h4>
          <a href="mailto:info@apexaviationtx.com">info@apexaviationtx.com</a>
          <a href="contact.html">Book a Session</a>
          <span style="color:var(--gray-2);font-size:14px">Austin, Texas</span>
        </div>
      </div>
    </div>
    <div class="footer__bottom">
      <div class="container">
        <p>&copy; 2026 Apex Aviation. All rights reserved. · <a href="privacy.html" style="color:var(--gray-2)">Privacy Policy</a></p>
        <p>Train Beyond the Checkride. · Austin, Texas</p>
      </div>
    </div>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`;
}

let written = 0;
const generatedFiles = [];
for (let i = 0; i < locations.length; i++) {
  const loc = locations[i];
  const filename = `ground-school-${slugify(loc.city, loc.stateAbbr)}.html`;
  fs.writeFileSync(path.join(SITE_DIR, filename), pageHtml(loc, i));
  generatedFiles.push({ filename, ...loc });
  written++;
}

console.log(`Generated ${written} Private Instruction city pages.`);
fs.writeFileSync(path.join(__dirname, 'generated-files.json'), JSON.stringify(generatedFiles, null, 2));

// ── Hub page: one discoverable page linking to every city page,
// grouped by state, so search engines (and real visitors) can reach
// them via internal links rather than the sitemap alone. ──
function hubHtml(files) {
  const byState = {};
  for (const f of files) {
    byState[f.state] = byState[f.state] || [];
    byState[f.state].push(f);
  }
  const states = Object.keys(byState).sort();
  const stateBlocks = states.map(state => `
        <div style="margin-bottom:28px">
          <h3 style="color:var(--white);font-size:16px;font-weight:700;margin:0 0 10px">${state}</h3>
          <div style="display:flex;flex-wrap:wrap;gap:10px">
            ${byState[state].map(f => `<a href="${f.filename}" style="color:rgba(255,255,255,0.65);font-size:14px;border:1px solid rgba(255,255,255,0.12);border-radius:100px;padding:6px 14px;text-decoration:none">${f.city}</a>`).join('\n            ')}
          </div>
        </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Private Instruction by City &amp; State | Apex Advantage</title>
  <meta name="description" content="Apex Advantage Private Instruction is live virtual and available nationwide. Find your city or state to see what 1-on-1 Private Instruction looks like near you." />
  <link rel="canonical" href="https://apexaviationtx.com/ground-school-locations.html" />
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="stylesheet" href="styles.css" />
  <link rel="stylesheet" href="pages.css" />
  <!-- Google Analytics 4 -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-JFPBCF2GXE"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-JFPBCF2GXE');
  </script>
</head>
<body>

  <header class="nav" id="nav">
    <div class="container nav__inner">
      <a href="home.html" class="nav__logo">
        <img src="apexwhite.png" alt="Apex Aviation" height="40" style="display:block;width:auto" />
      </a>
      <nav class="nav__links">
        <a href="programs.html">Services</a>
        <a href="apex-advantage.html" class="btn btn--nav-outline">Apex Advantage</a>
        <a href="portal-login.html" class="btn btn--nav-ghost">Login</a>
        <a href="contact.html" class="btn btn--nav">Book a Session</a>
      </nav>
      <button class="nav__hamburger" id="hamburger" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
    <div class="nav__mobile" id="mobileMenu">
      <a href="programs.html">Services</a>
      <a href="apex-advantage-private-instruction.html">Private Instruction</a>
      <a href="portal-login.html">Login</a>
      <a href="contact.html">Book a Session</a>
    </div>
  </header>

  <section class="page-hero">
    <div class="container page-hero__inner">
      <div class="section__eyebrow">Live Virtual, Available Nationwide</div>
      <h1 class="page-hero__title">Private Instruction Near You</h1>
      <p class="page-hero__sub">Apex Advantage Private Instruction is live and virtual — 1-on-1, $55/hour, every certificate level — so it's available to students everywhere in the US. Find your state below.</p>
    </div>
  </section>

  <section class="section section--light">
    <div class="container">
      <div style="max-width:900px;margin:0 auto">
        ${stateBlocks}
        <div style="margin:48px 0;text-align:center">
          <a href="apex-advantage-private-instruction.html" class="btn btn--primary">View Available Times</a>
        </div>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="container footer__inner">
      <div class="footer__brand">
        <a href="home.html" class="nav__logo">
        <img src="apexwhite.png" alt="Apex Aviation" height="40" style="display:block;width:auto" />
        </a>
        <p>Train Beyond the Checkride. Live virtual Private Instruction available nationwide, based in Austin, Texas.</p>
      </div>
    </div>
    <div class="footer__bottom">
      <div class="container">
        <p>&copy; 2026 Apex Aviation. All rights reserved. · <a href="privacy.html" style="color:var(--gray-2)">Privacy Policy</a></p>
      </div>
    </div>
  </footer>

  <script src="script.js"></script>
</body>
</html>
`;
}

fs.writeFileSync(path.join(SITE_DIR, 'ground-school-locations.html'), hubHtml(generatedFiles));
console.log('Generated hub page: ground-school-locations.html');

// ── Sitemap: append every generated page (idempotent -- strips any
// entries from a previous run before re-adding, so re-running this
// script after adding cities doesn't create duplicate <url> blocks). ──
const sitemapPath = path.join(SITE_DIR, 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapPath, 'utf8');
sitemap = sitemap.replace(/\s*<url>\s*<loc>https:\/\/apexaviationtx\.com\/ground-school-[^<]*<\/loc>[\s\S]*?<\/url>/g, '');
const today = new Date().toISOString().slice(0, 10);
const newUrls = [...generatedFiles.map(f => f.filename), 'ground-school-locations.html']
  .map(filename => `  <url>\n    <loc>https://apexaviationtx.com/${filename}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`)
  .join('\n');
sitemap = sitemap.replace('</urlset>', newUrls + '\n</urlset>');
fs.writeFileSync(sitemapPath, sitemap);
console.log(`Added ${generatedFiles.length + 1} URLs to sitemap.xml.`);
