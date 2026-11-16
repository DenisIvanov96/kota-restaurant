// Shared by all public pages: skip link target, nav, top bar, site info.
import { getJSON } from './dom.js';
import { telHref } from './format.js';
import { getLang, apiUrl } from './i18n.js';

const sitePromises = {};
/** Resolves to the /api/public/site object in the current language, or null when it cannot be loaded. */
export function loadSite() {
  const lang = getLang();
  if (!sitePromises[lang]) sitePromises[lang] = getJSON(apiUrl('/api/public/site')).catch(() => { delete sitePromises[lang]; return null; });
  return sitePromises[lang];
}

export function initNav() {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  const setOpen = (open, refocus) => {
    nav.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (!open && refocus) toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('nav-open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('nav-open')) setOpen(false, true);
  });
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('nav-open') && !nav.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
}

/** Top bar phone: shown only when a phone is set, otherwise removed from the DOM. */
export function applyTopBar(site) {
  const bar = document.getElementById('top-bar');
  if (!bar) return;
  const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
  if (!phone) { bar.remove(); return; }
  const a = document.getElementById('top-phone');
  a.href = telHref(phone);
  a.textContent = phone;
  bar.hidden = false;
}

export function initYear() {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
}

/** After late DOM changes, bring the hash target back into view (layout shift safety). */
export function realignHash() {
  if (!location.hash || location.hash.length < 2) return;
  try {
    const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t) t.scrollIntoView();
  } catch { /* ignore */ }
}
