// Static pages (privacy, 404): same header/footer/language switch, plus contact details on /privacy.
import { el } from './dom.js';
import { loadSite, initNav, applyTopBar, applyInstagram, renderLocation, initYear } from './common.js';
import { telHref } from './format.js';
import { initI18n, onLangChange, t, localizeLinks } from './i18n.js';

initI18n();
initNav();
initYear();

function renderPrivacyContact(site) {
  const box = document.getElementById('privacy-contact');
  if (!box) return;
  const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
  const address = site && site.address ? site.address.trim() : '';
  box.replaceChildren();
  const email = site && typeof site.email === 'string' ? site.email.trim() : '';
  if (!phone && !address && !email) { box.textContent = t('privacy.contact.none'); return; }
  if (phone) { const a = el('a', '', phone); a.href = telHref(phone); box.append(`${t('contact.phone')}: `, a); }
  if (phone && email) box.append(el('br'));
  if (email) { const a = el('a', '', email); a.href = 'mailto:' + email; box.append(`${t('contact.email')}: `, a); }
  if ((phone || email) && address) box.append(el('br'));
  if (address) box.append(`${t('contact.address')}: ${address}`);
}

const PLAN_TABLES = [
  ['long', 102], ['long', 103], ['long', 104], ['long', 105], ['long', 106], ['long', 107], ['long', 108],
  ['long', 109], ['long', 110], ['long', 111], ['long', 112], ['square', 113], ['square', 114], ['square', 115],
];

/** Reservation page: phone call button, location, text alternative list of the floor plan tables. */
function renderReservation(site) {
  const list = document.getElementById('plan-tables');
  if (!list) return;
  list.replaceChildren(...PLAN_TABLES.map(([shape, n]) => el('li', '', t('res.tbl.' + shape, { n }))));
  const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
  const call = document.getElementById('res-call');
  call.hidden = !phone;
  document.getElementById('res-nophone').hidden = !!phone;
  if (phone) { call.href = telHref(phone); document.getElementById('res-call-number').textContent = phone; }
  renderLocation(document.getElementById('location-list'), site);
}

function load() {
  loadSite().then((site) => {
    applyTopBar(site);
    applyInstagram(site);
    renderPrivacyContact(site);
    renderReservation(site);
    localizeLinks();
  });
}
load();
onLangChange(load);
