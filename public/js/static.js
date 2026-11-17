// Static pages (privacy, 404): same header/footer/language switch, plus contact details on /privacy.
import { el } from './dom.js';
import { loadSite, initNav, applyTopBar, initYear } from './common.js';
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
  if (!phone && !address) { box.textContent = t('privacy.contact.none'); return; }
  if (phone) { const a = el('a', '', phone); a.href = telHref(phone); box.append(`${t('contact.phone')}: `, a); }
  if (phone && address) box.append(el('br'));
  if (address) box.append(`${t('contact.address')}: ${address}`);
}

function load() {
  loadSite().then((site) => {
    applyTopBar(site);
    const nav = document.getElementById('nav-contact');
    if (nav && !(site && (site.reservationPhone || site.address || site.openingHours))) nav.remove();
    renderPrivacyContact(site);
    localizeLinks();
  });
}
load();
onLangChange(load);
