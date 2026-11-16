import { el, getJSON, bilingual, stateBox } from './dom.js';
import { loadSite, initNav, applyTopBar, initYear, realignHash } from './common.js';
import { renderEventCard, renderStructuredMenu, observeCategories, renderFileViewer } from './render.js';
import { telHref } from './format.js';

initNav();
initYear();

/* ---------- Site info: top bar + contact ---------- */
function renderContact(site) {
  const section = document.getElementById('contact');
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
  const item = (label, build) => {
    const div = el('div', 'contact-item');
    div.append(el('dt', '', label));
    const dd = el('dd');
    build(dd);
    div.append(dd);
    dl.append(div);
  };
  if (phone) item('Телефон', (dd) => { const a = el('a', '', phone); a.href = telHref(phone); dd.append(a); });
  if (address) item('Адрес', (dd) => { dd.textContent = address; });
  if (hours) item('Работно време', (dd) => { dd.className = 'hours'; dd.textContent = hours; });
  if (phone) {
    const call = document.getElementById('contact-call');
    call.href = telHref(phone);
    call.hidden = false;
  }
  section.hidden = false;
}

loadSite().then((site) => {
  applyTopBar(site);
  renderContact(site);
  realignHash();
});

/* ---------- Events ---------- */
async function loadEvents() {
  let events;
  try {
    events = (await getJSON('/api/public/events')).events;
  } catch { return; }
  if (!Array.isArray(events) || !events.length) return;

  const section = el('section', 'section event-section');
  section.id = 'event';
  section.setAttribute('aria-labelledby', 'event-heading');
  const inner = el('div', 'event-section-inner');
  const h2 = el('h2');
  h2.id = 'event-heading';
  if (events.length === 1) bilingual(h2, 'Събитие', '/ Event'); else bilingual(h2, 'Събития', '/ Events');
  const list = el('div', 'event-list');
  for (const ev of events) list.append(renderEventCard(ev));
  inner.append(h2, list);
  section.append(inner);
  document.getElementById('menu').before(section);

  const li = document.getElementById('nav-event');
  li.hidden = false;
  realignHash();
}

/* ---------- Regular menu ---------- */
const menuBox = document.getElementById('menu-content');

function showMenuState(node) { menuBox.replaceChildren(node); }

function menuEmpty() {
  showMenuState(stateBox({
    title: 'Менюто скоро ще бъде публикувано.', en: 'Menu coming soon.', role: 'status',
    actions: [{ label: 'Вижте обедното меню', href: '/daily-menu' }],
  }));
}

async function loadMenu() {
  let data;
  try {
    data = await getJSON('/api/public/menu');
  } catch {
    showMenuState(stateBox({
      title: 'Менюто не може да се зареди.', en: 'The menu could not be loaded.', role: 'alert', isError: true,
      body: 'Проверете връзката и опитайте отново.',
      actions: [{ label: 'Опитай отново', onClick: () => { menuBox.replaceChildren(skeleton()); loadMenu(); } }],
    }));
    return;
  }
  if (data.mode === 'file') {
    if (!data.file) return menuEmpty();
    const viewer = renderFileViewer(data.file, {
      frameClass: 'menu-file',
      imageAlt: 'Основно меню',
      zoomLabel: 'Увеличи менюто',
      pdf: { open: 'Отвори меню (PDF)', openShort: 'Отвори меню (PDF)', download: 'Изтегли' },
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
  wrap.append(el('span', 'visually-hidden', 'Зареждане на менюто…'));
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

menuBox.replaceChildren(skeleton());
loadEvents();
loadMenu();
