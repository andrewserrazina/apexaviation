// Nav scroll effect
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
});

// Mobile hamburger
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
hamburger.addEventListener('click', () => {
  mobileMenu.classList.toggle('open');
});
mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

// Training dropdown
const trainingDropdown = document.getElementById('trainingDropdown');
if (trainingDropdown) {
  const toggle = trainingDropdown.querySelector('.nav__dropdown-toggle');
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = trainingDropdown.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', () => {
    trainingDropdown.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  });
}

async function submitToFormspree(form, successEl, onSuccess) {
  const btn = form.querySelector('[type="submit"]');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch('https://formspree.io/f/xzdqylpz', {
      method: 'POST',
      headers: { 'Accept': 'application/json' },
      body: new FormData(form),
    });
    if (res.ok) {
      form.style.display = 'none';
      successEl.classList.add('visible');
      if (typeof onSuccess === 'function') onSuccess();
      // Track successful submissions, never just clicks or invalid forms.
      if ((form.id === 'waitlistForm' || form.id === 'huttoTaylorForm') && typeof window.gtag === 'function') {
        window.gtag('event', 'flight_training_interest_submitted', {
          form_id: form.id,
          page_path: window.location.pathname
        });
      }
      if (form.id === 'contactForm' && typeof window.gtag === 'function') {
        window.gtag('event', 'contact_form_submitted', { page_path: window.location.pathname });
      }
    } else {
      const data = await res.json();
      const msg = data.errors ? data.errors.map(e => e.message).join(', ') : 'Something went wrong. Please email info@apexaviationtx.com directly.';
      alert(msg);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch {
    alert('Network error. Please email info@apexaviationtx.com directly.');
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// Contact form
const form = document.getElementById('contactForm');
const successMsg = document.getElementById('formSuccess');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitToFormspree(form, successMsg);
  });
}

// Waitlist form -- also lands the lead in the CRM (leads table), in
// parallel with the Formspree submission above. Fire-and-forget: if
// this fails, the visitor still sees the normal Formspree success
// state, since Formspree remains the primary, user-visible path.
//
// Shared by every waitlist-style form on the site, not just the
// homepage's -- a form identifies itself via an optional hidden
// `sourceLabel` field (falls back to the original homepage label when
// absent, so that page needs no changes) and may optionally include
// trainingGoal/targetStartMonth/ratesWork/lessonWindow1/lessonWindow2
// fields (added for the Hutto/Taylor landing page's more detailed
// waitlist ask); capture-waitlist-lead appends whichever of those are
// present to the lead's notes, same pattern as zip/services already did.
function captureWaitlistLead(form) {
  const data = new FormData(form);
  return fetch('https://wqzfhcjsfzwrimvsudxy.supabase.co/functions/v1/capture-waitlist-lead', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': 'sb_publishable_8mFbiW9M0dkIv9K2fcwDxQ_oRJnlBUo',
      'Authorization': 'Bearer sb_publishable_8mFbiW9M0dkIv9K2fcwDxQ_oRJnlBUo',
    },
    body: JSON.stringify({
      firstName: data.get('firstName') || '',
      lastName: data.get('lastName') || '',
      email: data.get('email') || '',
      zip: data.get('zip') || '',
      services: data.getAll('services'),
      source: data.get('sourceLabel') || 'Website Waitlist (homepage)',
      trainingGoal: data.get('trainingGoal') || '',
      targetStartMonth: data.get('targetStartMonth') || '',
      ratesWork: data.get('ratesWork') || '',
      lessonWindow1: data.get('lessonWindow1') || '',
      lessonWindow2: data.get('lessonWindow2') || '',
    }),
  }).then(response => {
    if (!response.ok) console.warn('CRM lead capture returned an error; primary Formspree record was preserved.');
    return response.ok;
  }).catch(() => {
    console.warn('CRM lead capture failed; primary Formspree record was preserved.');
    return false;
  });
}

const waitlistForm = document.getElementById('waitlistForm');
const waitlistSuccess = document.getElementById('waitlistSuccess');
const waitlistServiceError = document.getElementById('waitlistServiceError');
const waitlistSuccessMsg = document.getElementById('waitlistSuccessMsg');
if (waitlistForm) {
  waitlistForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const checkedServices = [...waitlistForm.querySelectorAll('[name="services"]:checked')];
    if (!checkedServices.length) {
      if (waitlistServiceError) waitlistServiceError.hidden = false;
      return;
    }
    if (waitlistServiceError) waitlistServiceError.hidden = true;

    // Tailor the confirmation copy to what they actually checked --
    // in-person-only, virtual-only, or both -- same segment distinction
    // capture-waitlist-lead computes server-side for the CRM, kept here
    // purely for a friendlier success message (not sent to the server;
    // the function re-derives it from the service labels themselves).
    if (waitlistSuccessMsg) {
      const segments = new Set(checkedServices.map((el) => el.dataset.segment));
      const wantsInPerson = segments.has('in_person');
      const wantsVirtual = segments.has('virtual');
      if (wantsInPerson && !wantsVirtual) {
        waitlistSuccessMsg.textContent = "Welcome to Apex Aviation. We'll be in touch before our targeted March 2027 Austin launch with priority access details.";
      } else if (wantsVirtual && !wantsInPerson) {
        waitlistSuccessMsg.textContent = "Welcome to Apex Aviation. Our virtual services are live today -- keep an eye on your inbox, we'll follow up shortly.";
      } else {
        waitlistSuccessMsg.textContent = "Welcome to Apex Aviation. We'll follow up about getting started virtually now, plus priority access before our targeted March 2027 Austin launch.";
      }
    }

    submitToFormspree(waitlistForm, waitlistSuccess, () => {
      captureWaitlistLead(waitlistForm);
    });
  });
}

// Scroll-in animations
const revealTargets = document.querySelectorAll('.program-card, .fleet-card, .instructor-card, .pricing-card');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (revealTargets.length && !prefersReducedMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  revealTargets.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    observer.observe(el);
  });

  // Safety net: an anchor-jump straight to a section (e.g. the hero's own
  // CTAs), a very fast scroll, or a render pipeline that doesn't simulate
  // real scrolling at all (crawlers, link-preview bots, full-page
  // screenshot tools) can land on this content before the observer ever
  // fires. Force everything visible after a short delay so nothing stays
  // invisible longer than a brief fade-in, regardless of how it was reached.
  setTimeout(() => {
    revealTargets.forEach(el => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
    observer.disconnect();
  }, 800);
}

// FAQ accordion (sitewide)
document.querySelectorAll('.faq-item__question').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => {
      i.classList.remove('open');
      i.querySelector('.faq-item__question').setAttribute('aria-expanded', 'false');
    });
    if (!isOpen) {
      item.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
    }
  });
});

// Exit-intent popup
(function() {
  const STORAGE_KEY = 'apex_exit_popup_dismissed';
  if (sessionStorage.getItem(STORAGE_KEY)) return;

  // Pages can override the popup with window.APEX_EXIT_POPUP before script.js loads,
  // e.g. { mode: 'cta', eyebrow, heading, body, ctaText, ctaHref } to point the
  // exit save at whatever that page is actually selling (live portal, free guide, etc.)
  // instead of the default Austin-facility waitlist pitch.
  const cfg = Object.assign({ mode: 'form' }, window.APEX_EXIT_POPUP || {});

  // Inject popup HTML
  const overlay = document.createElement('div');
  overlay.className = 'exit-popup-overlay';
  overlay.id = 'exitPopup';

  const formModeHtml = `
      <form class="contact__form" id="exitPopupForm">
        <input type="hidden" name="_source" value="exit-intent-popup" />
        <div class="form-row">
          <div class="form-group">
            <label for="epEmail">Email</label>
            <input type="email" id="epEmail" name="email" placeholder="your@email.com" required autocomplete="email" />
          </div>
          <div class="form-group">
            <label for="epZip">Zip Code</label>
            <input type="text" id="epZip" name="zip" placeholder="78666" maxlength="10" autocomplete="postal-code" />
          </div>
        </div>
        <div class="form-group">
          <label>I'm interested in</label>
          <div class="checkbox-grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
            <label class="checkbox-item"><input type="checkbox" name="services" value="Private Pilot Training" /><span>Private Pilot</span></label>
            <label class="checkbox-item"><input type="checkbox" name="services" value="Instrument Rating" /><span>Instrument Rating</span></label>
            <label class="checkbox-item"><input type="checkbox" name="services" value="Commercial Pilot" /><span>Commercial Pilot</span></label>
            <label class="checkbox-item"><input type="checkbox" name="services" value="Apex Advantage Ground" /><span>Apex Advantage</span></label>
            <label class="checkbox-item"><input type="checkbox" name="services" value="IPC / BFR / Currency" /><span>IPC / BFR</span></label>
            <label class="checkbox-item"><input type="checkbox" name="services" value="Mock Oral Exam" /><span>Mock Oral</span></label>
          </div>
        </div>
        <button type="submit" class="btn btn--primary btn--full">Join the Waitlist</button>
        <p class="form__note" style="text-align:center;margin-top:10px">No spam. Unsubscribe anytime.</p>
      </form>`;

  const ctaModeHtml = `
      <a href="${cfg.ctaHref || 'portal-login.html?view=signup'}" class="btn btn--primary btn--full" style="text-align:center">${cfg.ctaText || 'Create Your Free Account'}</a>
      <p class="form__note" style="text-align:center;margin-top:10px">${cfg.ctaNote || 'Free forever. No credit card required.'}</p>`;

  overlay.innerHTML = `
    <div class="exit-popup" role="dialog" aria-modal="true" aria-labelledby="exitPopupHeading">
      <button class="exit-popup__close" id="exitPopupClose" aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button>
      <div class="exit-popup__eyebrow">${cfg.eyebrow || 'Founding Member Waitlist'}</div>
      <h2 id="exitPopupHeading">${cfg.heading || 'Before you go — secure your spot.'}</h2>
      <p>${cfg.body || 'Limited founding member slots for our Austin flight training, targeting March 2027. Join the waitlist for locked-in pricing and priority scheduling.'}</p>
      ${cfg.mode === 'cta' ? ctaModeHtml : `${formModeHtml}
      <div class="form__success" id="exitPopupSuccess" style="display:none;text-align:center;padding:24px 0">
        <svg width="48" height="48" viewBox="0 0 56 56" fill="none" style="margin-bottom:12px"><circle cx="28" cy="28" r="28" fill="#F4B400" fill-opacity=".1"/><path d="M18 28l8 8 14-16" stroke="#F4B400" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h3 style="color:var(--navy);margin-bottom:8px">You're on the list.</h3>
        <p style="color:var(--gray)">We'll be in touch before our targeted March 2027 Austin launch.</p>
      </div>`}
    </div>`;
  document.body.appendChild(overlay);

  let lastFocused = null;
  function openPopup() {
    lastFocused = document.activeElement;
    overlay.classList.add('active');
    const closeBtn = document.getElementById('exitPopupClose');
    if (closeBtn) closeBtn.focus();
  }

  function dismiss() {
    overlay.classList.remove('active');
    sessionStorage.setItem(STORAGE_KEY, '1');
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  }

  document.getElementById('exitPopupClose').addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });

  // Submit (form mode only)
  const epForm = document.getElementById('exitPopupForm');
  const epSuccess = document.getElementById('exitPopupSuccess');
  if (epForm) {
    epForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = epForm.querySelector('[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const res = await fetch('https://formspree.io/f/xzdqylpz', {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: new FormData(epForm),
        });
        if (res.ok) {
          epForm.style.display = 'none';
          epSuccess.style.display = 'block';
          setTimeout(dismiss, 2800);
        } else {
          btn.disabled = false;
          btn.textContent = 'Join the Waitlist';
        }
      } catch {
        btn.disabled = false;
        btn.textContent = 'Join the Waitlist';
      }
    });
  }
  if (cfg.mode === 'cta') {
    const ctaLink = overlay.querySelector('.exit-popup a.btn');
    if (ctaLink) ctaLink.addEventListener('click', dismiss);
  }

  // Trigger: mouse leaves viewport toward top (desktop)
  let triggered = false;
  document.addEventListener('mouseleave', (e) => {
    if (triggered || e.clientY > 20) return;
    triggered = true;
    openPopup();
  });

  // Trigger: mobile — user scrolls back up to the very top after engaging
  // deeply with the page. Previously fired on ANY 300px scroll-up after
  // passing 600px down (cur < maxScroll - 300) -- on any page long enough
  // to pass 600px in one swipe (most of them), that's indistinguishable
  // from someone just scrolling up to re-read something, so it was
  // ambushing normal readers with a full-screen modal, not catching real
  // exit intent. Requiring a real return to near the top is the standard
  // mobile proxy for "about to leave" (reaching for the tab bar / back
  // button), not "scrolled up a bit."
  let maxScroll = 0;
  let mobileTriggered = false;
  window.addEventListener('scroll', () => {
    const cur = window.scrollY;
    if (cur > maxScroll) maxScroll = cur;
    if (!mobileTriggered && maxScroll > 800 && cur < 150) {
      mobileTriggered = true;
      triggered = true;
      openPopup();
    }
  }, { passive: true });
})();
