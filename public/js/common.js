// Shared by all public pages: skip link target, nav, top bar, site info.
import { getJSON, el, icon } from './dom.js';
import { telHref } from './format.js';
import { getLang, apiUrl, t, langHref } from './i18n.js';

// Fixed Google Maps pin for the restaurant (D-55); does not depend on the address text.
const MAP_URL = 'https://maps.app.goo.gl/EQuhsMqma6TcmRqs9';

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

/** Top bar: always present. With a phone: "For reservations: <tel link>"; without: a "Reservations" link to /reservation. */
export function applyTopBar(site) {
  const a = document.getElementById('top-phone');
  const label = document.getElementById('top-label');
  if (!a || !label) return;
  const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
  if (phone) {
    label.hidden = false;
    a.removeAttribute('data-i18n');
    a.dataset.href0 = '';
    a.href = telHref(phone);
    a.textContent = phone;
  } else {
    label.hidden = true;
    a.dataset.i18n = 'topbar.res';
    a.dataset.href0 = '/reservation';
    a.href = langHref('/reservation');
    a.textContent = t('topbar.res');
  }
}

/** Instagram icon links: the configured profile, or the placeholder https://www.instagram.com/ when empty or not an instagram.com URL. */
export function applyInstagram(site) {
  let url = 'https://www.instagram.com/';
  const raw = site && typeof site.instagramUrl === 'string' ? site.instagramUrl.trim() : '';
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' && (u.hostname === 'instagram.com' || u.hostname === 'www.instagram.com')) url = u.href;
    } catch { /* keep placeholder */ }
  }
  document.querySelectorAll('a.ig-link').forEach((a) => { a.href = url; });
}

/** Location block (address + map link, opening hours when set) into a <dl>. Address falls back to the default. */
export function renderLocation(dl, site) {
  if (!dl) return;
  const address = (site && site.address ? site.address.trim() : '') || t('loc.defaultAddress');
  const hours = site && site.openingHours ? site.openingHours.trim() : '';
  dl.replaceChildren();
  const item = (label, build) => {
    const div = el('div', 'contact-item');
    div.append(el('dt', '', label));
    const dd = el('dd');
    build(dd);
    div.append(dd);
    dl.append(div);
  };
  item(t('contact.address'), (dd) => {
    dd.append(el('span', 'address-text', address));
    const map = el('a', 'map-link');
    map.href = MAP_URL;
    map.target = '_blank';
    map.rel = 'noopener noreferrer';
    map.append(el('span', '', t('map.link')), icon('external', 'map-icon'), el('span', 'visually-hidden', ' ' + t('map.newtab')));
    dd.append(map);
  });
  if (hours) item(t('contact.hours'), (dd) => { dd.className = 'hours'; dd.textContent = hours; });
}

export function initYear() {
  const y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();
}

/** After late DOM changes, bring the hash target back into view (layout shift safety). */
/** Lets the last in-page anchor targets (#location, #contact) scroll all the way to the sticky-bar offset
 *  even when the content below them is shorter than the viewport (BUG-19): adds bottom padding to <main> as needed. */
export function ensureScrollRoom() {
  const main = document.getElementById('main');
  if (!main) return;
  const cur = parseFloat(main.style.paddingBottom) || 0; // measured without resetting it (a reset would clamp the scroll position)
  const offset = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0);
  const doc = document.documentElement;
  let need = 0;
  for (const id of ['location', 'contact']) {
    const t = document.getElementById(id);
    if (!t) continue;
    const top = t.getBoundingClientRect().top + window.scrollY;
    need = Math.max(need, top - offset + window.innerHeight - (doc.scrollHeight - cur));
  }
  const next = need > 0 ? Math.ceil(need) : 0;
  if (next !== cur) main.style.paddingBottom = next ? next + 'px' : '';
}
window.addEventListener('resize', () => ensureScrollRoom());
window.addEventListener('load', () => ensureScrollRoom());
// Content above the anchors changes after load (menu, events, images): keep the room in sync.
if (typeof ResizeObserver === 'function') {
  let raf = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { ensureScrollRoom(); if (holdHash) jumpToHash(); }); });
  addEventListener('DOMContentLoaded', () => { document.querySelectorAll('main > section').forEach((n) => ro.observe(n)); });
}

// While the page is still settling after load, keep the hash target in place (instant jumps) until the user scrolls/clicks.
let holdHash = !!(location.hash && location.hash.length > 1);
if (holdHash) {
  const stop = () => { holdHash = false; };
  for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(ev, stop, { once: true, passive: true });
  setTimeout(stop, 4000);
}
export function realignHash() {
  ensureScrollRoom();
  jumpToHash();
}
function jumpToHash() {
  if (!location.hash || location.hash.length < 2) return;
  try {
    const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (t) {
      // One instant jump (never smooth): a smooth scroll in flight while the room/layout changes overshoots (BUG-19/21).
      const root = document.documentElement;
      const prev = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      t.scrollIntoView({ behavior: 'instant', block: 'start' });
      root.style.scrollBehavior = prev;
    }
  } catch { /* ignore */ }
}
