// Admin previews reuse the PUBLIC renderers (/js/render.js) so markup/classes always match the site.
import { h } from './util.js';
import { renderEventCard as publicEventCard, renderStructuredMenu } from '/js/render.js';

export function previewScroller(frame) {
  const s = h('div', { class: 'preview-scroll', role: 'region', 'aria-label': 'Преглед (може да се превърта хоризонтално)', tabindex: '0' });
  s.append(frame);
  return s;
}

export function renderEventCard({ title, description, imageUrl, eventAt }) {
  const card = publicEventCard({ title: title || 'Заглавие на събитието', description, imageUrl, eventAt });
  if (!title) card.classList.add('is-placeholder');
  return card;
}

export function renderMenuPreview(categories, symbol) {
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
  const { nav, cats } = renderStructuredMenu(structured, symbol, 'adm-prev-');
  if (nav) root.append(nav);
  root.append(cats);
  return root;
}
