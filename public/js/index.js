import { el, getJSON, stateBox, icon } from './dom.js';
import { loadSite, initNav, applyTopBar, initYear, realignHash } from './common.js';
import { renderEventCard, renderStructuredMenu, observeCategories, renderFileViewer } from './render.js';
import { telHref } from './format.js';
import { initI18n, onLangChange, t, apiUrl, localizeLinks } from './i18n.js';

initI18n();
initNav();
initYear();

/* Stale-response guard: bumped on every (re)load; only the newest generation may render. */
let gen = 0;

/* ---------- Site info: top bar + contact ---------- */
function renderContact(site) {
  const section = document.getElementById('contact');
  if (!section) return;
  const navItem = document.getElementById('nav-contact');
  const bookBtn = document.getElementById('hero-book');
  const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
  const address = site && site.address ? site.address.trim() : '';
  const hours = site && site.openingHours ? site.openingHours.trim() : '';
  if (!phone && !address && !hours) {
    section.remove();
    if (navItem) navItem.remove();
    if (bookBtn) bookBtn.remove();
    return;
  }
  const dl = document.getElementById('contact-list');
  dl.replaceChildren();
  const item = (label, build) => {
    const div = el('div', 'contact-item');
    div.append(el('dt', '', label));
    const dd = el('dd');
    build(dd);
    div.append(dd);
    dl.append(div);
  };
  if (phone) item(t('contact.phone'), (dd) => { const a = el('a', '', phone); a.href = telHref(phone); dd.append(a); });
  if (address) item(t('contact.address'), (dd) => {
    dd.append(el('span', 'address-text', address));
    const map = el('a', 'map-link');
    map.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);
    map.target = '_blank';
    map.rel = 'noopener noreferrer';
    map.append(el('span', '', t('map.link')), icon('external', 'map-icon'), el('span', 'visually-hidden', ' ' + t('map.newtab')));
    dd.append(map);
  });
  if (hours) item(t('contact.hours'), (dd) => { dd.className = 'hours'; dd.textContent = hours; });
  if (phone) {
    const call = document.getElementById('contact-call');
    call.href = telHref(phone);
    call.hidden = false;
  }
  section.hidden = false;
}

function loadSiteInfo(mine) {
  return loadSite().then((site) => {
    if (mine !== gen) return;
    applyTopBar(site);
    renderContact(site);
    realignHash();
  });
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
  const list = el('div', 'event-list');
  for (const ev of events) list.append(renderEventCard(ev));
  inner.append(h2, list);
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
    const viewer = renderFileViewer(data.file, {
      frameClass: 'menu-file',
      imageAlt: t('menu.alt'),
      zoomLabel: t('daily.zoom'),
      pdf: { open: t('pdf.openMenu'), openShort: t('pdf.openMenu'), download: t('file.download') },
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
