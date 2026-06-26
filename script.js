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

async function submitToFormspree(form, successEl) {
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
    } else {
      const data = await res.json();
      const msg = data.errors ? data.errors.map(e => e.message).join(', ') : 'Something went wrong. Please email info@apexaviation.com directly.';
      alert(msg);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  } catch {
    alert('Network error. Please email info@apexaviation.com directly.');
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

// Waitlist form
const waitlistForm = document.getElementById('waitlistForm');
const waitlistSuccess = document.getElementById('waitlistSuccess');
if (waitlistForm) {
  waitlistForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitToFormspree(waitlistForm, waitlistSuccess);
  });
}

// Scroll-in animations
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.program-card, .fleet-card, .instructor-card, .pricing-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});

// FAQ accordion (homepage)
document.querySelectorAll('.faq-item__question').forEach(btn => {
  btn.addEventListener('click', () => {
    const item = btn.closest('.faq-item');
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('open'));
    if (!isOpen) item.classList.add('open');
  });
});

// Exit-intent popup
(function() {
  const STORAGE_KEY = 'apex_exit_popup_dismissed';
  if (sessionStorage.getItem(STORAGE_KEY)) return;

  // Inject popup HTML
  const overlay = document.createElement('div');
  overlay.className = 'exit-popup-overlay';
  overlay.id = 'exitPopup';
  overlay.innerHTML = `
    <div class="exit-popup">
      <button class="exit-popup__close" id="exitPopupClose" aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
      </button>
      <div class="exit-popup__eyebrow">Founding Member Waitlist</div>
      <h2>Before you go — secure your spot.</h2>
      <p>24 founding member slots open January 2027. Join the waitlist for locked-in pricing and priority scheduling.</p>
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
            <label class="checkbox-item"><input type="checkbox" name="services" value="Simulator Sessions" /><span>Simulator</span></label>
          </div>
        </div>
        <button type="submit" class="btn btn--primary btn--full">Join the Waitlist</button>
        <p class="form__note" style="text-align:center;margin-top:10px">No spam. Unsubscribe anytime.</p>
      </form>
      <div class="form__success" id="exitPopupSuccess" style="display:none;text-align:center;padding:24px 0">
        <svg width="48" height="48" viewBox="0 0 56 56" fill="none" style="margin-bottom:12px"><circle cx="28" cy="28" r="28" fill="#F4B400" fill-opacity=".1"/><path d="M18 28l8 8 14-16" stroke="#F4B400" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h3 style="color:var(--navy);margin-bottom:8px">You're on the list.</h3>
        <p style="color:var(--gray)">We'll be in touch before our January 2027 launch.</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function dismiss() {
    overlay.classList.remove('active');
    sessionStorage.setItem(STORAGE_KEY, '1');
  }

  document.getElementById('exitPopupClose').addEventListener('click', dismiss);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });

  // Submit
  const epForm = document.getElementById('exitPopupForm');
  const epSuccess = document.getElementById('exitPopupSuccess');
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

  // Trigger: mouse leaves viewport toward top (desktop)
  let triggered = false;
  document.addEventListener('mouseleave', (e) => {
    if (triggered || e.clientY > 20) return;
    triggered = true;
    overlay.classList.add('active');
  });

  // Trigger: mobile — user scrolls back up significantly after engaging
  let maxScroll = 0;
  let mobileTriggered = false;
  window.addEventListener('scroll', () => {
    const cur = window.scrollY;
    if (cur > maxScroll) maxScroll = cur;
    if (!mobileTriggered && maxScroll > 600 && cur < maxScroll - 300) {
      mobileTriggered = true;
      triggered = true;
      overlay.classList.add('active');
    }
  }, { passive: true });
})();
