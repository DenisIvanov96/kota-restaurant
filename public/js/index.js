import { el, icon, getJSON, stateBox } from './dom.js';
import { loadSite, initNav, applyTopBar, applyInstagram, renderLocation, initYear, realignHash } from './common.js';
import { renderEventCard, renderStructuredMenu, observeCategories, renderMenuPages } from './render.js';
import { telHref } from './format.js';
import { initI18n, onLangChange, t, apiUrl, localizeLinks } from './i18n.js';

initI18n();
initNav();
initYear();

/* Stale-response guard: bumped on every (re)load; only the newest generation may render. */
let gen = 0;

/* ---------- Site info: top bar, location, contact ---------- */
function renderContact(site) {
  const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
  renderLocation(document.getElementById('location-list'), site);
  const dl = document.getElementById('contact-list');
  const old = document.getElementById('contact-phone-item');
  if (old) old.remove();
  if (phone) {
    const div = el('div', 'contact-item');
    div.id = 'contact-phone-item';
    div.append(el('dt', '', t('contact.phone')));
    const dd = el('dd');
    const a = el('a', '', phone);
    a.href = telHref(phone);
    dd.append(a);
    div.append(dd);
    dl.prepend(div);
  }
  const oldEmail = document.getElementById('contact-email-item');
  if (oldEmail) oldEmail.remove();
  const email = site && typeof site.email === 'string' ? site.email.trim() : '';
  if (email) {
    const div = el('div', 'contact-item');
    div.id = 'contact-email-item';
    div.append(el('dt', '', t('contact.email')));
    const dd = el('dd');
    const a = el('a', '', email);
    a.href = 'mailto:' + email;
    dd.append(a);
    div.append(dd);
    dl.insertBefore(div, document.getElementById('contact-social'));
  }
}

/* About text: owner-written (plain text, paragraphs split on blank lines) or the built-in default when not set. */
function renderAbout(site) {
  const body = document.getElementById('about-body');
  if (!body) return;
  const raw = site && typeof site.about === 'string' ? site.about.replace(/\r\n?/g, '\n').trim() : '';
  const paras = raw ? raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean) : [];
  if (!paras.length) paras.push(t('about.text'));
  body.replaceChildren(...paras.map((p) => el('p', '', p)));
}

function loadSiteInfo(mine) {
  return loadSite().then((site) => {
    if (mine !== gen) return;
    applyTopBar(site);
    applyInstagram(site);
    renderContact(site);
    renderAbout(site);
    realignHash();
  });
}

/* Several events: one card at a time, prev/next arrows + counter (D-64; same pattern as the D-63 menu slider).
   All cards share one grid cell and only the current one is visible, so the frame is as tall as the tallest card. */
function renderEventSlider(events) {
  const total = events.length;
  const wrap = el('div', 'menu-slider event-slider');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-roledescription', 'carousel');
  wrap.setAttribute('aria-labelledby', 'event-heading');
  const stage = el('div', 'menu-slide-stage event-stage');
  const cards = events.map((ev) => { const c = renderEventCard(ev); c.classList.add('event-slide'); stage.append(c); return c; });
  const counter = el('p', 'menu-slider-count');
  counter.setAttribute('aria-live', 'polite');
  const mkBtn = (cls, label, name) => {
    const b = el('button', 'slider-btn ' + cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.append(icon(name));
    return b;
  };
  const prev = mkBtn('slider-prev', t('event.prev'), 'arrow-left');
  const next = mkBtn('slider-next', t('event.next'), 'arrow-right');
  let cur = 0;
  function draw() {
    cards.forEach((c, i) => { c.classList.toggle('is-current', i === cur); });
    counter.textContent = t('event.of', { n: cur + 1, m: total });
    prev.disabled = cur === 0;
    next.disabled = cur === total - 1;
    const ae = document.activeElement;
    if (ae && ae.disabled && (ae === prev || ae === next)) (ae === next ? prev : next).focus();
  }
  function go(d) {
    const i = cur + d;
    if (i < 0 || i >= total) return;
    cur = i; draw();
  }
  const row = el('div', 'menu-slider-row');
  row.append(prev, stage, next);
  wrap.append(row, counter);
  draw();
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  wrap.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('a')) return;
    if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
  });
  let x0 = null, y0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });
  return wrap;
}

/* ---------- Events ---------- */
async function loadEvents(mine) {
  let events;
  try {
    events = (await getJSON(apiUrl('/api/public/events'))).events;
  } catch { events = null; }
  if (mine !== gen) return;
  const old = document.getElementById('event');
  if (old) old.remove();
  const li = document.getElementById('nav-event');
  if (!Array.isArray(events) || !events.length) { if (li) li.hidden = true; return; }

  const section = el('section', 'section event-section');
  section.id = 'event';
  section.setAttribute('aria-labelledby', 'event-heading');
  const inner = el('div', 'event-section-inner');
  const h2 = el('h2', '', events.length === 1 ? t('event.one') : t('event.many'));
  h2.id = 'event-heading';
  inner.append(h2, events.length === 1 ? renderEventCard(events[0]) : renderEventSlider(events));
  section.append(inner);
  document.getElementById('menu').before(section);

  if (li) li.hidden = false;
  realignHash();
}

/* ---------- Regular menu ---------- */
const menuBox = document.getElementById('menu-content');

function showMenuState(node) { menuBox.replaceChildren(node); }

function menuEmpty() {
  showMenuState(stateBox({
    title: t('menu.empty'), role: 'status',
    actions: [{ label: t('menu.seeDaily'), href: '/daily-menu' }],
  }));
}

async function loadMenu(mine) {
  let data;
  try {
    data = await getJSON(apiUrl('/api/public/menu'));
  } catch {
    if (mine !== gen) return;
    showMenuState(stateBox({
      title: t('err.menu'), role: 'alert', isError: true,
      body: t('err.body'),
      actions: [{ label: t('retry'), onClick: () => { menuBox.replaceChildren(skeleton()); loadMenu(gen); } }],
    }));
    return;
  }
  if (mine !== gen) return;
  if (data.mode === 'file') {
    if (!data.file) return menuEmpty();
    const viewer = renderMenuPages(data.file, {
      pdf: { open: t('pdf.openMenu') },
    });
    showMenuState(viewer);
    return;
  }
  const s = data.structured;
  if (!s || !s.categories || !s.categories.length) return menuEmpty();
  const { nav, cats } = renderStructuredMenu(s, data.currencySymbol || '€');
  const frag = document.createDocumentFragment();
  if (nav) frag.append(nav);
  frag.append(cats);
  menuBox.replaceChildren(frag);
  observeCategories(nav, cats);
  realignHash();
}

function skeleton() {
  const wrap = el('div');
  wrap.setAttribute('role', 'status');
  wrap.append(el('span', 'visually-hidden', t('loading')));
  for (let i = 0; i < 3; i++) {
    wrap.append(el('div', 'skeleton sk-head'));
    for (let j = 0; j < 4; j++) {
      const row = el('div', 'sk-row');
      row.append(el('div', 'skeleton sk-line'), el('div', 'skeleton sk-line'));
      wrap.append(row);
    }
  }
  return wrap;
}

function loadAll() {
  menuBox.replaceChildren(skeleton());
  const mine = ++gen;
  loadSiteInfo(mine);
  loadEvents(mine).then(() => localizeLinks());
  loadMenu(mine).then(() => localizeLinks());
}

onLangChange(loadAll);
loadAll();
