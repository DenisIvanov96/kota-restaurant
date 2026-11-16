// Renders PUBLIC-site markup (class names from docs/DESIGN.md Part A/D) for the admin previews.
import { h, formatDateTime, formatPrice } from './util.js';

export function renderEventCard({ title, description, imageUrl, eventAt }) {
  const card = h('article', { class: `event-card${imageUrl ? '' : ' no-image'}` });
  if (imageUrl) {
    card.append(h('div', { class: 'event-media' }, h('span', { class: 'zoom-btn' }, h('img', { src: imageUrl, alt: title || 'Снимка на събитието' }))));
  }
  const body = h('div', { class: 'event-body' }, h('span', { class: 'event-tag', text: 'Събитие' }));
  body.append(h('h3', { class: `event-title${title ? '' : ' is-placeholder'}`, text: title || 'Заглавие на събитието' }));
  if (eventAt) {
    body.append(h('p', { class: 'event-date' }, h('time', { datetime: eventAt, text: formatDateTime(eventAt) })));
  }
  if (description && description.trim()) body.append(h('p', { class: 'event-desc', text: description }));
  card.append(body);
  return card;
}

export function renderMenuPreview(categories, symbol) {
  const root = h('div', { class: 'menu-preview' });
  if (!categories.length) {
    root.append(h('div', { class: 'state-box' }, h('p', { text: 'Менюто е празно.' })));
    return root;
  }
  if (categories.length >= 2) {
    const nav = h('nav', { class: 'cat-nav', 'aria-label': 'Категории' });
    categories.forEach((c, i) => nav.append(h('span', { class: 'cat-chip', text: c.name || 'Без име', 'aria-current': i === 0 ? 'true' : null })));
    root.append(nav);
  }
  for (const c of categories) {
    const list = h('ul', { class: 'dish-list' });
    for (const it of c.items) {
      const price = formatPrice(it.priceCents, symbol);
      const li = h('li', { class: `dish${it.available ? '' : ' is-unavailable'}` });
      const top = h('div', { class: 'dish-top' }, h('span', { class: 'dish-name', text: it.name || 'Без име' }));
      if (!it.available) top.append(h('span', { class: 'tag-unavail', text: 'Няма в наличност' }));
      top.append(h('span', { class: 'dish-leader', 'aria-hidden': 'true' }));
      if (price) top.append(h('span', { class: 'dish-price', text: price }));
      li.append(top);
      if (it.description && it.description.trim()) li.append(h('p', { class: 'dish-desc', text: it.description }));
      list.append(li);
    }
    root.append(h('section', { class: 'menu-cat' }, h('h3', { class: 'cat-title', text: c.name || 'Без име' }), list));
  }
  return root;
}
