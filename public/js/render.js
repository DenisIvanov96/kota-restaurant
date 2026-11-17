// Pure DOM builders shared by the public pages (and importable by the admin previews).
// All API text is set via textContent; line breaks are preserved by CSS (white-space: pre-line).
import { el, icon } from './dom.js';
import { t as tr, getLang } from './i18n.js';
import { formatDateTime, formatPrice } from './format.js';
import { openLightbox } from './lightbox.js';

/** Event card (DESIGN A4). ev: { title, description, imageUrl, eventAt }. lang defaults to the page language. */
export function renderEventCard(ev, lang = getLang()) {
  const t = (k, v) => tr(k, v, lang);
  const card = el('article', 'event-card' + (ev.imageUrl ? ' has-image' : ''));
  if (ev.imageUrl) {
    const media = el('div', 'event-media');
    const btn = el('button', 'zoom-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', t('event.zoom', { title: ev.title }));
    const img = el('img');
    img.src = ev.imageUrl;
    img.alt = ev.title;
    img.loading = 'lazy';
    btn.append(img);
    btn.addEventListener('click', () => openLightbox(ev.imageUrl, ev.title, btn));
    media.append(btn);
    card.append(media);
  }
  const body = el('div', 'event-body');
  body.append(el('span', 'event-tag', t('event.tag')));
  body.append(el('h3', 'event-title', ev.title));
  const when = ev.eventAt ? formatDateTime(ev.eventAt, lang) : '';
  if (when) {
    const p = el('p', 'event-date');
    const tm = el('time', '', when);
    tm.dateTime = ev.eventAt;
    p.append(tm);
    body.append(p);
  }
  if (ev.description && ev.description.trim()) body.append(el('p', 'event-desc', ev.description));
  card.append(body);
  return card;
}

/** Dish list item (DESIGN A6) */
export function renderDish(item, symbol, lang = getLang()) {
  const t = (k, v) => tr(k, v, lang);
  const li = el('li', 'dish' + (item.available ? '' : ' is-unavail'));
  const top = el('div', 'dish-top');
  top.append(el('span', 'dish-name', item.name));
  if (!item.available) top.append(el('span', 'tag-unavail', t('menu.unavail')));
  const price = formatPrice(item.priceCents, symbol, lang);
  if (price) {
    top.append(el('span', 'dish-leader'));
    top.append(el('span', 'dish-price', price));
  }
  li.append(top);
  if (item.description && item.description.trim()) li.append(el('p', 'dish-desc', item.description));
  return li;
}

/** Structured menu: returns { nav (or null), cats }. Category ids are prefixed with idPrefix. */
export function renderStructuredMenu(structured, symbol, idPrefix = 'cat-', lang = getLang()) {
  const cats = el('div', 'menu-cats');
  const categories = structured.categories || [];
  for (const c of categories) {
    const sec = el('section', 'cat');
    sec.id = idPrefix + c.id;
    const h = el('h3', 'cat-title', c.name);
    h.id = idPrefix + c.id + '-h';
    sec.setAttribute('aria-labelledby', h.id);
    sec.append(h);
    const ul = el('ul', 'dish-list');
    for (const it of c.items || []) ul.append(renderDish(it, symbol, lang));
    sec.append(ul);
    cats.append(sec);
  }
  let nav = null;
  if (categories.length >= 2) {
    nav = el('nav', 'cat-nav');
    nav.setAttribute('aria-label', tr('menu.categories', undefined, lang));
    for (const c of categories) {
      const a = el('a', '', c.name);
      a.href = '#' + idPrefix + c.id;
      nav.append(a);
    }
  }
  return { nav, cats };
}

/** Marks the chip of the category currently in view (aria-current="true"). */
export function observeCategories(nav, cats) {
  if (!nav || !('IntersectionObserver' in window)) return;
  const links = new Map();
  nav.querySelectorAll('a').forEach((a) => links.set(a.getAttribute('href').slice(1), a));
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id));
    const first = [...cats.querySelectorAll('.cat')].find((s) => visible.has(s.id));
    links.forEach((a, id) => {
      if (first && first.id === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }, { rootMargin: '-64px 0px -60% 0px' });
  cats.querySelectorAll('.cat').forEach((s) => io.observe(s));
}

/**
 * File viewer for the daily menu and file-mode regular menu (DESIGN A5.2 / A6).
 * file: { fileUrl, kind: 'image'|'pdf' }
 * opts: { frameClass: 'paper'|'menu-file', imageAlt, zoomLabel, pdf: { open, openShort } }
 */
export function renderFileViewer(file, opts) {
  const t = (k, v) => tr(k, v);
  const isPdf = file.kind === 'pdf';
  const wrap = el('div', 'viewer ' + (isPdf ? 'viewer-pdf' : 'viewer-image'));
  const frame = el('div', 'viewer-frame ' + opts.frameClass);
  const actions = el('div', 'viewer-actions');

  if (isPdf) {
    const card = () => {
      const c = el('div', 'pdf-card');
      c.append(icon('file-pdf'));
      c.append(el('p', '', t('pdf.card')));
      c.append(el('p', 'pdf-sub', t('pdf.cardBody', { open: opts.pdf.openShort })));
      return c;
    };
    const canEmbed = navigator.pdfViewerEnabled === true && window.matchMedia('(min-width: 768px)').matches;
    if (canEmbed) {
      const obj = el('object', 'pdf-embed');
      obj.type = 'application/pdf';
      obj.data = file.fileUrl;
      obj.setAttribute('aria-label', opts.pdf.openShort);
      obj.append(card());
      frame.append(obj);
    } else {
      frame.append(card());
    }
    const open = el('a', 'btn');
    open.href = file.fileUrl; open.target = '_blank'; open.rel = 'noopener';
    open.textContent = opts.pdf.open;
    actions.append(open);
  } else {
    const btn = el('button', 'zoom-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', opts.zoomLabel);
    const img = el('img');
    img.src = file.fileUrl;
    img.alt = opts.imageAlt;
    btn.append(img, el('span', 'zoom-hint', t('zoom.hint')));
    btn.addEventListener('click', () => openLightbox(file.fileUrl, opts.imageAlt, btn));
    frame.append(btn);
    const open = el('a', 'btn btn-ghost-dark', t('file.openTab'));
    open.href = file.fileUrl; open.target = '_blank'; open.rel = 'noopener';
    actions.append(open);
  }
  wrap.append(frame, actions);
  return wrap;
}

/**
 * Multi-page file menu (D-46). file: { pages:[{fileUrl,mimeType,kind,width?,height?}] } or the old
 * single shape { fileUrl, kind } (treated as one page). Images stack full width with a shared lightbox
 * gallery; PDFs become cards with an open link.
 * opts: { pdf: { open } }
 */
export function renderMenuPages(file, opts = {}) {
  const t = (k, v) => tr(k, v);
  const pages = Array.isArray(file.pages) ? file.pages : [{ fileUrl: file.fileUrl, mimeType: file.mimeType, kind: file.kind }];
  const total = pages.length;
  const wrap = el('div', 'menu-pages');
  const gallery = [];
  const galleryIdx = new Map();
  pages.forEach((p, i) => {
    if (p.kind !== 'pdf') { galleryIdx.set(i, gallery.length); gallery.push({ src: p.fileUrl, alt: t('menu.pageAlt', { n: i + 1 }), n: i + 1, m: total }); }
  });
  pages.forEach((p, i) => {
    const n = i + 1;
    const fig = el('figure', 'menu-page ' + (p.kind === 'pdf' ? 'menu-page-pdf' : 'menu-page-image'));
    if (p.kind === 'pdf') {
      const card = el('div', 'pdf-card');
      card.append(icon('file-pdf'));
      card.append(el('p', '', t('menu.pdfPage', { n })));
      const actions = el('div', 'viewer-actions');
      const open = el('a', 'btn', (opts.pdf && opts.pdf.open) || t('pdf.openMenu'));
      open.href = p.fileUrl; open.target = '_blank'; open.rel = 'noopener';
      actions.append(open);
      card.append(actions);
      fig.append(card);
    } else {
      const btn = el('button', 'zoom-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', t('menu.pageZoom', { n, m: total }));
      const img = el('img');
      img.src = p.fileUrl;
      img.alt = t('menu.pageAlt', { n });
      img.loading = 'lazy';
      img.decoding = 'async';
      if (p.width > 0 && p.height > 0) { img.width = p.width; img.height = p.height; }
      btn.append(img);
      btn.addEventListener('click', () => openLightbox(null, null, btn, { items: gallery, index: galleryIdx.get(i) }));
      fig.append(btn);
    }
    const cap = el('figcaption', 'menu-page-cap');
    if (total > 1) cap.append(document.createTextNode(t('page.of', { n, m: total })));
    if (cap.childNodes.length) fig.append(cap);
    wrap.append(fig);
  });
  return wrap;
}
