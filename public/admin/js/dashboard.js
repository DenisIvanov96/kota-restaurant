import { h, icon, formatDateLong, formatStamp, addDays, capitalize } from './util.js';
import { get, patch } from './api.js';
import { badge, alertBox, btn, skeleton, loadError, reportError, withBusy, toast } from './ui.js';

const linkBtn = (href, label, variant = 'secondary', ic) =>
  h('a', { href, class: `a-btn a-btn--${variant}` }, ic && icon(ic), h('span', { text: label }));

export function dashboardView(ctx) {
  const el = h('div');
  const body = h('div', { 'aria-live': 'polite' });
  el.append(h('h1', { class: 'a-h1', text: 'Табло' }), h('p', { class: 'a-muted', text: `Здравейте, ${ctx.session.username}` }), body);
  let dead = false;

  async function load() {
    body.replaceChildren(skeleton(4));
    try {
      const d = await get('/api/admin/dashboard');
      if (!dead) body.replaceChildren(render(d));
    } catch (e) {
      if (dead) return;
      body.replaceChildren(loadError(null, load));
      reportError(e);
    }
  }

  function dailyCard(label, rel, dateStr, entry) {
    const card = h('section', { class: 'a-card a-dash-card' }, h('h2', { text: `Обедно меню — ${label}` }), h('p', { class: 'a-muted', text: capitalize(formatDateLong(dateStr)) }));
    const actions = h('div', { class: 'a-actions' });
    if (!entry) {
      card.append(h('p', null, badge('Няма меню', 'warn')),
        h('p', null, `За ${label} няма качено меню.`, rel === 'today' ? [' ', h('strong', { text: 'Клиентите виждат „Няма обедно меню“.' })] : ''));
      actions.append(linkBtn('#/daily-menu?step=1', 'Качи меню', rel === 'today' ? 'primary' : 'secondary'));
    } else if (!entry.published) {
      card.append(h('p', null, badge('Качено, но не е публикувано', 'warn')), h('p', { text: 'Клиентите не го виждат.' }));
      const pub = btn({ label: 'Публикувай', variant: 'primary', onClick: async () => {
        const r = await withBusy(pub, () => patch(`/api/admin/daily-menus/${entry.id}/published`, { published: true }), 'Публикуване…');
        if (r) { toast('Менюто е публикувано.'); load(); }
      } });
      actions.append(pub, linkBtn('#/daily-menu', 'Виж'));
    } else {
      card.append(h('p', null, rel === 'today' ? badge('На живо днес', 'solid') : badge('Публикувано', 'ok')),
        h('p', { text: rel === 'today' ? 'Клиентите го виждат.' : 'Ще се покаже утре.' }));
      actions.append(linkBtn('#/daily-menu', 'Управление'));
    }
    card.append(actions);
    return card;
  }

  function render(d) {
    const frag = h('div');
    const quick = h('div', { class: 'a-quick' },
      h('a', { href: '#/daily-menu?step=1', class: 'a-tile' }, icon('upload'), h('span', { text: 'Качи меню за днес' })),
      h('a', { href: '#/events/new', class: 'a-tile' }, icon('plus'), h('span', { text: 'Ново събитие' })),
      h('a', { href: '#/menu', class: 'a-tile' }, icon('pencil'), h('span', { text: 'Редактирай меню' })),
      h('a', { href: '/', class: 'a-tile', target: '_blank', rel: 'noopener' }, icon('external'), h('span', { text: 'Виж сайта' }), h('span', { class: 'a-vh', text: '(отваря се в нов раздел)' })));
    frag.append(quick);
    const grid = h('div', { class: 'a-grid' });

    // events
    const ev = d.events;
    const evCard = h('section', { class: 'a-card a-dash-card' }, h('h2', { text: 'Събитие' }));
    if (ev.active > 0) {
      evCard.append(h('p', null, badge('Активно', 'ok')));
      const ul = h('ul', { class: 'a-titles' });
      (ev.activeTitles || []).slice(0, 3).forEach((t) => ul.append(h('li', { text: t })));
      if (ev.activeTitles.length > 3) ul.append(h('li', { class: 'a-muted', text: `+ още ${ev.activeTitles.length - 3}` }));
      evCard.append(ul);
    } else evCard.append(h('p', null, badge('Няма активно събитие', 'neutral')));
    const parts = [];
    if (ev.scheduled) parts.push(`Предстоящи: ${ev.scheduled}`);
    if (ev.disabled) parts.push(`Изключени: ${ev.disabled}`);
    if (ev.expired) parts.push(`Изтекли: ${ev.expired}`);
    const total = ev.active + ev.scheduled + ev.disabled + ev.expired;
    evCard.append(h('p', { class: 'a-help', text: total ? parts.join(' · ') : 'Още няма събития.' }));
    evCard.append(h('div', { class: 'a-actions' }, total ? linkBtn('#/events', 'Управление на събития') : linkBtn('#/events/new', 'Ново събитие', 'primary', 'plus')));
    grid.append(evCard);

    grid.append(dailyCard('днес', 'today', d.today, d.dailyMenu.today));
    grid.append(dailyCard('утре', 'tomorrow', addDays(d.today, 1), d.dailyMenu.tomorrow));

    // menu
    const m = d.menu;
    const mc = h('section', { class: 'a-card a-dash-card' }, h('h2', { text: 'Основно меню' }),
      h('p', null, 'Клиентите виждат: ', h('strong', { text: m.mode === 'structured' ? 'Структурирано меню' : 'Файл' })));
    if (m.mode === 'structured') {
      if (m.structuredPublishedAt) mc.append(h('p', { class: 'a-help', text: `Последно публикувано: ${formatStamp(m.structuredPublishedAt)}` }));
      else mc.append(alertBox('warning', 'Още не е публикувано.'));
    } else if (m.pages) {
      const ul = h('ul', { class: 'a-titles' });
      let any = false;
      for (const [l, name] of [['bg', 'Български'], ['en', 'English']]) {
        const pg = m.pages[l] || { published: false, count: 0 };
        const n = pg.count != null ? pg.count : (pg.items ? pg.items.length : 0);
        if (pg.published && n) any = true;
        ul.append(h('li', null, `${name}: `, pg.published ? badge('Публикувано', 'ok') : badge('Не е публикувано', 'neutral', 'ring'), ` ${n} ${n === 1 ? 'страница' : 'страници'}`));
      }
      mc.append(ul);
      if (!any) mc.append(alertBox('warning', 'Няма публикувани страници.'));
    } else if (m.publishedFile) mc.append(h('p', { class: 'a-help', text: `Публикуван файл: ${m.publishedFile.originalName}` }));
    else mc.append(alertBox('warning', 'Няма публикуван файл.'));
    if (m.hasUnpublishedChanges) {
      mc.append(alertBox('warning', 'Има непубликувани промени. Клиентите виждат старата версия.'));
      mc.append(h('div', { class: 'a-actions' }, linkBtn('#/menu', 'Прегледай и публикувай', 'primary')));
    } else mc.append(h('div', { class: 'a-actions' }, linkBtn('#/menu', 'Редактирай меню')));
    grid.append(mc);
    if (d.gallery) {
      const g = d.gallery;
      grid.append(h('section', { class: 'a-card a-dash-card' }, h('h2', { text: 'Галерия' }),
        h('p', { class: 'a-help', text: `Галерия: ${g.count} / 25, видими: ${g.visible}` }),
        h('div', { class: 'a-actions' }, linkBtn('#/gallery', 'Управление на галерията'))));
    }
    frag.append(grid);
    return frag;
  }

  load();
  return { el, destroy() { dead = true; } };
}
