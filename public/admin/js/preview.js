// Admin previews reuse the PUBLIC renderers (/js/render.js) so markup/classes always match the site.
import { h } from './util.js';
import { renderEventCard as publicEventCard, renderStructuredMenu } from '/js/render.js';

export function previewScroller(frame) {
  const s = h('div', { class: 'preview-scroll', role: 'region', 'aria-label': 'Преглед (може да се превърта хоризонтално)', tabindex: '0' });
  s.append(frame);
  return s;
}

export function renderEventCard({ title, description, imageUrl, eventAt }, lang = 'bg') {
  const card = publicEventCard({ title: title || (lang === 'en' ? 'Event title' : 'Заглавие на събитието'), description, imageUrl, eventAt }, lang);
  if (!title) card.classList.add('is-placeholder');
  return card;
}

export function renderMenuPreview(categories, symbol, lang = 'bg') {
  const root = h('div', { class: 'menu-preview' });
  if (!categories.length) {
    root.append(h('div', { class: 'state-box' }, h('p', { text: 'Менюто е празно.' })));
    return root;
  }
  const structured = {
    categories: categories.map((c, i) => ({
      id: `p${i}`, name: c.name || 'Без име',
      items: c.items.map((it) => ({ ...it, name: it.name || 'Без име' })),
    })),
  };
  const { nav, cats } = renderStructuredMenu(structured, symbol, 'adm-prev-', lang);
  if (nav) root.append(nav);
  root.append(cats);
  return root;
}

// "БГ | EN" toggle for previews. onChange(lang) is called with 'bg' or 'en'.
export function langToggle(onChange) {
  const seg = h('div', { class: 'a-seg', role: 'group', 'aria-label': 'Език на прегледа' });
  for (const [lang, label, aria] of [['bg', 'БГ', 'Преглед на български'], ['en', 'EN', 'Преглед на английски']]) {
    seg.append(h('button', { type: 'button', class: 'a-seg__btn', lang, 'aria-pressed': String(lang === 'bg'), 'aria-label': aria, text: label, onclick: (e) => {
      seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      onChange(lang);
    } }));
  }
  seg.setLang = (lang) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.lang === lang)));
  return seg;
}
