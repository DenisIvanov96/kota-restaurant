import { el, getJSON, stateBox } from './dom.js';
import { loadSite, initNav, applyTopBar, applyInstagram, initYear } from './common.js';
import { renderFileViewer } from './render.js';
import { formatDateLongCap, formatDateLong, telHref } from './format.js';
import { initI18n, onLangChange, t, apiUrl, localizeLinks } from './i18n.js';

initI18n();
initNav();
initYear();

const dateEl = document.getElementById('daily-date');
const tagEl = document.getElementById('daily-tag');
const view = document.getElementById('daily-view');

loadSite().then((s) => { applyTopBar(s); applyInstagram(s); localizeLinks(); });

function loading() {
  dateEl.replaceChildren(el('span', 'skeleton sk-date'));
  tagEl.hidden = true;
  const paper = el('div', 'paper');
  paper.setAttribute('role', 'status');
  paper.append(el('span', 'visually-hidden', t('loading')));
  paper.append(el('div', 'skeleton sk-block'));
  view.replaceChildren(paper);
}

let seq = 0;
async function load() {
  const mine = ++seq;
  loading();
  let data;
  try {
    data = await getJSON(apiUrl('/api/public/daily-menu'));
  } catch {
    if (mine !== seq) return;
    dateEl.replaceChildren();
    view.replaceChildren(stateBox({
      title: t('err.menu'), role: 'alert', isError: true,
      body: t('err.body'),
      actions: [{ label: t('retry'), onClick: load }],
    }));
    return;
  }
  if (mine !== seq) return;
  const menu = data.menu;
  const dateStr = menu ? menu.date : data.today;
  dateEl.textContent = formatDateLongCap(dateStr);

  if (!menu) {
    tagEl.hidden = true;
    const site = await loadSite();
    if (mine !== seq) return;
    const actions = [{ label: t('toMenu'), href: '/#menu' }];
    const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
    if (phone) actions.push({ label: t('call'), href: telHref(phone), className: 'btn btn-ghost-dark' });
    view.replaceChildren(stateBox({
      title: t('daily.empty'), role: 'status',
      body: t('daily.emptyBody'),
      actions,
    }));
    localizeLinks(view);
    return;
  }
  tagEl.hidden = false;
  const longDate = formatDateLong(menu.date);
  view.replaceChildren(renderFileViewer({ fileUrl: menu.fileUrl, kind: menu.kind }, {
    frameClass: 'paper',
    imageAlt: t('daily.alt', { date: longDate }),
    zoomLabel: t('daily.zoom'),
    pdf: { open: t('pdf.open'), openShort: t('pdf.open'), download: t('pdf.download') },
  }));
}

onLangChange(() => { load(); loadSite().then((s) => { applyTopBar(s); applyInstagram(s); localizeLinks(); }); });
load();
