import { el, getJSON, stateBox } from './dom.js';
import { loadSite, initNav, applyTopBar, initYear } from './common.js';
import { renderFileViewer } from './render.js';
import { formatDateLongCap, formatDateLong, telHref } from './format.js';

initNav();
initYear();

const dateEl = document.getElementById('daily-date');
const tagEl = document.getElementById('daily-tag');
const view = document.getElementById('daily-view');

let site = null;
loadSite().then((s) => {
  site = s;
  applyTopBar(s);
  const nav = document.getElementById('nav-contact');
  const has = s && (s.reservationPhone || s.address || s.openingHours);
  if (nav && !has) nav.remove();
});

function loading() {
  dateEl.replaceChildren(el('span', 'skeleton sk-date'));
  tagEl.hidden = true;
  const paper = el('div', 'paper');
  paper.setAttribute('role', 'status');
  paper.append(el('span', 'visually-hidden', 'Зареждане на менюто…'));
  paper.append(el('div', 'skeleton sk-block'));
  view.replaceChildren(paper);
}

async function load() {
  loading();
  let data;
  try {
    data = await getJSON('/api/public/daily-menu');
  } catch {
    dateEl.replaceChildren();
    view.replaceChildren(stateBox({
      title: 'Менюто не може да се зареди.', en: 'The menu could not be loaded.', role: 'alert', isError: true,
      body: 'Проверете връзката и опитайте отново.',
      actions: [{ label: 'Опитай отново', onClick: load }],
    }));
    return;
  }
  const menu = data.menu;
  const dateStr = menu ? menu.date : data.today;
  dateEl.textContent = formatDateLongCap(dateStr);

  if (!menu) {
    tagEl.hidden = true;
    site = await loadSite();
    const actions = [{ label: 'Към основното меню', href: '/#menu' }];
    const phone = site && site.reservationPhone ? site.reservationPhone.trim() : '';
    if (phone) actions.push({ label: 'Обади се', href: telHref(phone), className: 'btn btn-ghost-dark' });
    view.replaceChildren(stateBox({
      title: 'Няма обедно меню за днес.', en: 'No daily menu for today.', role: 'status',
      body: 'Заглеждайте пак по-късно или вижте основното ни меню.',
      actions,
    }));
    return;
  }
  tagEl.hidden = false;
  const longDate = formatDateLong(menu.date);
  view.replaceChildren(renderFileViewer({ fileUrl: menu.fileUrl, kind: menu.kind }, {
    frameClass: 'paper',
    imageAlt: 'Обедно меню за ' + longDate,
    zoomLabel: 'Увеличи менюто',
    pdf: { open: 'Отвори PDF', openEn: 'Open PDF', openShort: 'Отвори PDF', download: 'Изтегли PDF' },
  }));
}

load();
