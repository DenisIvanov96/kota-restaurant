import { h, icon, clear } from './util.js';
import { get, post, onUnauthorized } from './api.js';
import { toast, modal, btn, loadError, reportError, setBusy } from './ui.js';
import { renderLogin } from './login.js';
import { dashboardView } from './dashboard.js';
import { eventsView, eventFormView } from './events.js';
import { dailyView } from './daily.js';
import { menuView } from './menu.js';
import { settingsView } from './settings.js';

const root = document.getElementById('app');
const session = { username: '', totpEnabled: false };
let shell = null;
let current = null; // { view, hash }
let currentHash = '';
let bypass = false;
let overlay = null;

const NAV = [
  { key: 'dashboard', label: 'Табло', icon: 'home', href: '#/' },
  { key: 'events', label: 'Събития', icon: 'calendar', href: '#/events' },
  { key: 'daily', label: 'Обедно меню', icon: 'utensils', href: '#/daily-menu' },
  { key: 'menu', label: 'Основно меню', icon: 'book-open', href: '#/menu' },
  { key: 'settings', label: 'Настройки', icon: 'settings', href: '#/settings' },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  const seg = path.split('/').filter(Boolean);
  if (seg.length === 0) return { name: 'dashboard', title: 'Табло', nav: 'dashboard', query };
  if (seg[0] === 'events') {
    if (seg[1] === 'new') return { name: 'event-form', title: 'Ново събитие', nav: 'events', params: {}, query };
    if (seg[1] && /^\d+$/.test(seg[1])) return { name: 'event-form', title: 'Редактиране на събитие', nav: 'events', params: { id: Number(seg[1]) }, query };
    return { name: 'events', title: 'Събития', nav: 'events', query };
  }
  if (seg[0] === 'daily-menu') return { name: 'daily', title: 'Обедно меню', nav: 'daily', query };
  if (seg[0] === 'menu') return { name: 'menu', title: 'Основно меню', nav: 'menu', query };
  if (seg[0] === 'settings') return { name: 'settings', title: 'Настройки', nav: 'settings', query };
  return { name: 'dashboard', title: 'Табло', nav: 'dashboard', query };
}

const VIEWS = { dashboard: dashboardView, events: eventsView, 'event-form': eventFormView, daily: dailyView, menu: menuView, settings: settingsView };

// ---------- guard ----------
/** Resolves true when it is OK to leave the current view. */
async function guardLeave() {
  const v = current && current.view;
  if (!v || !v.dirty || !v.dirty()) return true;
  const buttons = [
    { label: 'Остани', value: 'stay', focus: true },
    { label: 'Напусни без запазване', value: 'leave', variant: 'danger' },
  ];
  if (v.saveDraft) buttons.push({ label: 'Запази и продължи', value: 'save', variant: 'primary', run: async () => { const ok = await v.saveDraft(); return ok ? undefined : 'keep'; } });
  const r = await modal({ title: 'Имате незапазени промени', body: h('p', { text: 'Ако напуснете, промените ще бъдат изгубени.' }), buttons });
  return r === 'leave' || r === 'save';
}

window.addEventListener('beforeunload', (e) => {
  if (current && current.view && current.view.dirty && current.view.dirty()) { e.preventDefault(); e.returnValue = ''; }
});

async function onHashChange() {
  if (!shell) return;
  if (bypass) { bypass = false; renderRoute(); return; }
  const target = location.hash;
  if (current && current.view && current.view.dirty && current.view.dirty()) {
    history.replaceState(null, '', location.pathname + location.search + currentHash);
    if (!(await guardLeave())) return;
    bypass = true;
    location.hash = target;
    return;
  }
  renderRoute();
}
window.addEventListener('hashchange', onHashChange);

// ---------- shell ----------
function logo(small) {
  return h('span', { class: `a-logo${small ? ' a-logo--sm' : ''}`, 'aria-label': 'Kota 1' }, h('span', { class: 'a-logo__kota', text: 'KOTA' }), h('span', { class: 'a-logo__one', text: '1' }));
}

async function doLogout(button) {
  if (!(await guardLeave())) return;
  setBusy(button, true, 'Изход…');
  try { await post('/api/admin/logout'); } catch (e) { if (e.status !== 401) { setBusy(button, false); reportError(e); return; } }
  current && current.view.destroy && current.view.destroy();
  current = null;
  location.hash = '#/';
  showLogin();
}

function buildShell() {
  clear(root);
  const logoutTop = btn({ label: 'Изход', variant: 'chrome', icon: 'log-out', cls: 'a-logout-top', onClick: () => doLogout(logoutTop) });
  const logoutSide = btn({ label: 'Изход', variant: 'chrome', icon: 'log-out', cls: 'a-logout-side', onClick: () => doLogout(logoutSide) });
  const nav = h('nav', { class: 'a-nav', 'aria-label': 'Основна навигация' });
  const list = h('ul', { class: 'a-nav__list' });
  const links = {};
  for (const n of NAV) {
    const a = h('a', { href: n.href, class: 'a-nav__link' }, icon(n.icon), h('span', { text: n.label }));
    links[n.key] = a;
    list.append(h('li', null, a));
  }
  nav.append(list, logoutSide);
  const main = h('main', { id: 'main', class: 'a-main' });
  const header = h('header', { class: 'a-topbar' }, h('a', { href: '#/', class: 'a-topbar__logo', 'aria-label': 'Табло' }, logo(true)), logoutTop);
  root.append(h('a', { class: 'a-skip', href: '#main', text: 'Към съдържанието' }), header, nav, main);
  root.querySelector('.a-skip').addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
  main.tabIndex = -1;
  shell = { main, links };
}

function renderRoute() {
  if (!shell) return;
  const route = parseHash();
  if (current && current.view.destroy) current.view.destroy();
  clear(shell.main);
  for (const [k, a] of Object.entries(shell.links)) {
    if (k === route.nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  document.title = `${route.title} — Kota1 админ`;
  currentHash = location.hash || '#/';
  const ctx = { params: route.params || {}, query: route.query, session, route };
  const view = VIEWS[route.name](ctx);
  current = { view };
  shell.main.append(view.el);
  const h1 = shell.main.querySelector('h1');
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}

function startApp() {
  buildShell();
  renderRoute();
}

// ---------- login / session ----------
function showLogin() {
  shell = null;
  clear(root);
  document.title = 'Вход — Kota1 админ';
  const screen = renderLogin({ expired: false, onSuccess: (admin) => { Object.assign(session, admin); screen.destroy(); startApp(); } });
  root.append(screen);
}

function showExpired() {
  if (overlay || !shell) { if (!shell && !overlay) showLogin(); return; }
  const prev = session.username;
  const screen = renderLogin({
    expired: true,
    onSuccess: (admin) => {
      screen.destroy();
      overlay.remove(); overlay = null;
      root.removeAttribute('inert');
      if (admin.username !== prev) { location.reload(); return; }
      Object.assign(session, admin);
      toast('Влязохте отново. Повторете последното действие.');
    },
  });
  overlay = h('div', { class: 'a-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Вход' }, screen);
  document.body.append(overlay);
  document.querySelectorAll('dialog[open]').forEach((d) => { try { d.close(); } catch { /* ignore */ } });
  root.setAttribute('inert', '');
  const first = overlay.querySelector('input');
  if (first) first.focus();
}

onUnauthorized(showExpired);

async function boot() {
  try {
    const me = await get('/api/admin/me', { noSession: true });
    Object.assign(session, me.admin);
    startApp();
  } catch (e) {
    if (e.status === 401) showLogin();
    else {
      clear(root);
      root.append(h('div', { class: 'a-boot-error' }, loadError('Няма връзка със сървъра.', () => location.reload())));
    }
  }
}

boot();
