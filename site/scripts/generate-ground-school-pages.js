#!/usr/bin/env node
// Generates one SEO landing page per city in ground-school-locations.json,
// targeting "private pilot ground school near me" style searches.
//
// Ground School is delivered live-virtual (see apex-advantage.html /
// landing.html), so unlike the existing flight-training-<city>.html pages
// (which are legitimately Austin-area only -- flight training needs a real
// airplane), a page for a city anywhere in the US is honest: the class
// really is available there.
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
  (city, state) => `Finding a real private pilot ground school near ${city} usually means picking between a handful of local options, awkward weeknight drives, or a self-paced video course you'll never finish. Apex Advantage is a third option: a live, instructor-led class you attend from home in ${state}, on a real schedule, with an actual CFI answering your questions in real time.`,
  (city, state) => `Most ground school options fall into two camps: an in-person class that only exists if you happen to live near one, or a prerecorded video course with no instructor at all. Pilots in ${city} get a third option with Apex Advantage — live virtual classes, small cohorts, and a CFI/CFII walking through the material with you in real time, no matter where in ${state} you're logging in from.`,
  (city, state) => `Self-paced ground school courses are easy to buy and easy to abandon. Apex Advantage was built for ${city}-area students who want the structure of a real class — a set schedule, a live instructor, classmates working through the same material — without needing a ground school physically located near ${state}.`,
  (city, state) => `A lot of ground school in ${state} still means either a long drive to whichever flight school happens to run classes near ${city}, or a solo slog through a video library. Apex Advantage runs its Private Pilot ground school live and virtual, so ${city}-area students get real-time instruction and a fixed schedule without needing a local classroom.`,
  (city, state) => `If you've searched for a private pilot ground school near ${city} and mostly found stale course libraries or classes that don't fit your schedule, Apex Advantage is built differently — live, instructor-led sessions delivered virtually, so students throughout ${state} get the same real-time class as anyone in Austin, TX.`,
  (city, state) => `Ground school shouldn't come down to what happens to exist within driving distance. Apex Advantage delivers its Private Pilot ground school live and virtual, which means ${city}-area students get a real instructor, a real cohort, and a real schedule — the same class Apex runs everywhere else in ${state} and beyond.`,
];

const FAQS_BY_REGION = {
  Northeast: [
    ['Do I need to be near Austin, TX to take this ground school?', 'No. Apex Advantage Ground School is delivered live and virtual, so students throughout the Northeast join the same real-time class from home — nothing about the curriculum or schedule depends on where you live.'],
    ['Will class times work with my time zone?', 'Classes are scheduled in the evening (Central Time). Check the exact class schedule when you sign up so you know what that means for your local time before you register.'],
    ['Is this the same ground school FAA written test prep, or something different?', "It's a full live-instructor Private Pilot ground school covering the ACS areas of operation, not just written-test drilling — though it will get you ready for the knowledge test as a byproduct of covering the material properly."],
  ],
  Midwest: [
    ['Is Apex Advantage Ground School only for students near Austin, TX?', "No — it's a live virtual class, so pilots anywhere in the Midwest attend the exact same real-time sessions as students anywhere else."],
    ['What does a typical class session look like?', 'Each session runs about two hours with a live instructor: a review of the previous class, a focused lesson on that week\'s topic, a scenario-based workshop, and open Q&A.'],
    ['Can I ask questions during class, or is it a recorded lecture?', "It's live — you can ask questions in real time, the same as sitting in a physical classroom, just from wherever you are."],
  ],
  South: [
    ['Do I have to travel to Texas for ground school?', 'No. Ground School is 100% live virtual, so students throughout the South (and everywhere else) join from home on the same schedule as any other student.'],
    ['How is this different from a video-course ground school?', 'A video course has no instructor and no fixed pace. Apex Advantage runs a live, scheduled class with a real CFI/CFII, so you get real-time answers instead of a static video library.'],
    ['Is this only for Private Pilot, or does it cover other ratings too?', 'Private Pilot ground school is live now. Instrument Rating and Commercial Pilot ground school are planned as the program expands.'],
  ],
  West: [
    ['Is this ground school available to pilots on the West Coast / Mountain Time?', "Yes — it's delivered live virtual to students anywhere, though classes are currently scheduled in the evening Central Time. Check the schedule for the exact time before you register."],
    ['What makes this different from a self-paced online ground school?', 'Self-paced courses have no live instructor and no cohort. Apex Advantage runs real, scheduled classes with a CFI/CFII actually teaching and taking questions in real time.'],
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
  const title = `Private Pilot Ground School Near ${city}, ${stateAbbr} | Apex Advantage`;
  const description = `Live virtual Private Pilot ground school for ${city}, ${state} students. Real instructor, real schedule, no local classroom required. Taught by CFI/CFII Andrew Serrazina.`;
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
  "@type": ["EducationalOrganization", "Course"],
  "@id": "https://apexaviationtx.com/#organization",
  "name": "Apex Advantage Ground School",
  "description": "Live virtual Private Pilot ground school available to students nationwide, including ${city}, ${state}.",
  "url": "${canonical}",
  "email": "info@apexaviationtx.com",
  "provider": {
    "@type": "Organization",
    "name": "Apex Aviation",
    "sameAs": "https://apexaviationtx.com"
  },
  "areaServed": { "@type": "City", "name": "${city}, ${stateAbbr}" },
  "courseMode": "online"
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
      <a href="apex-advantage.html">Apex Advantage Ground School</a>
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
      <div class="section__eyebrow">Live Virtual Ground School</div>
      <h1 class="page-hero__title">Private Pilot Ground School for ${city}, ${stateAbbr} Pilots</h1>
      <p class="page-hero__sub">Apex Advantage runs live, instructor-led Private Pilot ground school for students anywhere in ${state} — no local classroom required, taught by CFI/CFII Andrew Serrazina in the evening (Central Time, ${timezone} students welcome).</p>
    </div>
  </section>

  <section class="section section--light">
    <div class="container">
      <div style="max-width:800px;margin:0 auto;color:rgba(255,255,255,0.65);line-height:1.9;font-size:16px">

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">Ground School for ${city} Pilots, Without the Local Classroom</h2>
        <p style="margin-bottom:32px">${copy}</p>

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">What's Covered</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:20px;margin:24px 0 40px">
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Airspace &amp; Regulations</p>
            <p style="margin:0;font-size:14px;opacity:.85">FARs simplified, airspace mastery, and airport operations covered the way examiners actually test them.</p>
          </div>
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Navigation &amp; Weather</p>
            <p style="margin:0;font-size:14px;opacity:.85">Sectional charts, pilotage, and weather decision-making, built around real scenario-based training.</p>
          </div>
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Performance &amp; Planning</p>
            <p style="margin:0;font-size:14px;opacity:.85">Weight and balance, aircraft performance, and cross-country planning that ties directly into checkride prep.</p>
          </div>
          <div style="background:var(--navy);color:white;padding:24px;border-radius:8px">
            <p style="font-weight:700;margin:0 0 8px;font-size:15px">Checkride Success</p>
            <p style="margin:0;font-size:14px;opacity:.85">ACS mastery and a mock oral exam module built specifically to get you ready for checkride day.</p>
          </div>
        </div>

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">Already Have the Free Guide? Go Further with Checkride Prep</h2>
        <p style="margin-bottom:20px">Every free Apex Advantage portal account includes the "10 Questions DPEs Love to Ask" guide. The full Checkride Prep System adds a 256-question DPE-style bank, scenario training, and progress tracking — built for students anywhere, not just ${city}.</p>
        <div style="margin-bottom:40px">
          <a href="checkride-prep.html" class="btn btn--outline">Explore Checkride Prep Resources &rarr;</a>
        </div>

        <h2 style="color:var(--white);font-size:26px;font-weight:800;margin:0 0 16px">Common Questions from ${city}-Area Students</h2>
${faqHtml(region)}

        <div style="margin:48px 0;text-align:center">
          <h3 style="color:var(--white);font-size:22px;font-weight:800;margin:0 0 20px">Ready to Get Started?</h3>
          <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap">
            <a href="portal-login.html?view=signup" class="btn btn--primary">Create Your Free Portal Account</a>
            <a href="home.html?interest=ground-school#waitlist" class="btn btn--outline">Join the Ground School Waitlist</a>
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
        <p>Train Beyond the Checkride. Live virtual ground school available nationwide, based in Austin, Texas.</p>
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
          <a href="apex-advantage.html">Virtual Ground School</a>
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

console.log(`Generated ${written} ground school city pages.`);
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
  <title>Private Pilot Ground School by City &amp; State | Apex Advantage</title>
  <meta name="description" content="Apex Advantage Ground School is live virtual and available nationwide. Find your city or state to see what live Private Pilot ground school looks like near you." />
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
      <a href="apex-advantage.html">Apex Advantage Ground School</a>
      <a href="portal-login.html">Login</a>
      <a href="contact.html">Book a Session</a>
    </div>
  </header>

  <section class="page-hero">
    <div class="container page-hero__inner">
      <div class="section__eyebrow">Live Virtual, Available Nationwide</div>
      <h1 class="page-hero__title">Private Pilot Ground School Near You</h1>
      <p class="page-hero__sub">Apex Advantage Ground School is live and virtual, so it's available to students everywhere in the US. Find your state below.</p>
    </div>
  </section>

  <section class="section section--light">
    <div class="container">
      <div style="max-width:900px;margin:0 auto">
        ${stateBlocks}
        <div style="margin:48px 0;text-align:center">
          <a href="portal-login.html?view=signup" class="btn btn--primary">Create Your Free Portal Account</a>
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
        <p>Train Beyond the Checkride. Live virtual ground school available nationwide, based in Austin, Texas.</p>
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
