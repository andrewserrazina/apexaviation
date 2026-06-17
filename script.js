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
