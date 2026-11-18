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
 * opts: { frameClass: 'paper'|'menu-file', imageAlt, zoomLabel, pdf: { open, openShort }, gallery?: { items, index } }
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
    btn.addEventListener('click', () => (opts.gallery
      ? openLightbox(null, null, btn, { items: opts.gallery.items, index: opts.gallery.index })
      : openLightbox(file.fileUrl, opts.imageAlt, btn)));
    frame.append(btn);
    const open = el('a', 'btn btn-ghost-dark', t('file.openTab'));
    open.href = file.fileUrl; open.target = '_blank'; open.rel = 'noopener';
    actions.append(open);
  }
  wrap.append(frame, actions);
  return wrap;
}

/**
 * Multi-page file menu as a slider (D-46, D-63). file: { pages:[{fileUrl,mimeType,kind,width?,height?}] } or the old
 * single shape { fileUrl, kind } (one page). One page at a time in a fixed-ratio frame; prev/next buttons (disabled at
 * the ends), counter, arrow keys, swipe; click opens the lightbox on that page. Neighbours are preloaded, the rest lazy.
 * opts: { pdf: { open } }
 */
export function renderMenuPages(file, opts = {}) {
  const t = (k, v) => tr(k, v);
  const pages = Array.isArray(file.pages) ? file.pages : [{ fileUrl: file.fileUrl, mimeType: file.mimeType, kind: file.kind }];
  const total = pages.length;
  const wrap = el('div', 'menu-slider');
  const gallery = [];
  const galleryIdx = new Map();
  pages.forEach((p, i) => {
    if (p.kind !== 'pdf') { galleryIdx.set(i, gallery.length); gallery.push({ src: p.fileUrl, alt: t('menu.pageAlt', { n: i + 1 }), n: i + 1, m: total }); }
  });
  const stage = el('div', 'menu-slide-stage');
  const slide = el('figure', 'menu-slide');
  stage.append(slide);
  let cur = 0;
  const preloaded = new Set();
  const preload = (i) => {
    const p = pages[i];
    if (!p || p.kind === 'pdf' || preloaded.has(i)) return;
    preloaded.add(i);
    const im = new Image(); im.decoding = 'async'; im.src = p.fileUrl;
  };
  const counter = el('p', 'menu-slider-count');
  counter.setAttribute('aria-live', 'polite');
  const mkBtn = (cls, label, name) => {
    const b = el('button', 'slider-btn ' + cls);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.append(icon(name));
    return b;
  };
  const prev = mkBtn('slider-prev', t('lb.prev'), 'arrow-left');
  const next = mkBtn('slider-next', t('lb.next'), 'arrow-right');

  function draw() {
    const p = pages[cur];
    const n = cur + 1;
    slide.replaceChildren();
    if (p.kind === 'pdf') {
      const card = el('div', 'pdf-card');
      card.append(icon('file-pdf'));
      card.append(el('p', '', t('menu.pdfPage', { n })));
      const actions = el('div', 'viewer-actions');
      const open = el('a', 'btn', (opts.pdf && opts.pdf.open) || t('pdf.openMenu'));
      open.href = p.fileUrl; open.target = '_blank'; open.rel = 'noopener';
      actions.append(open);
      card.append(actions);
      slide.append(card);
    } else {
      const btn = el('button', 'zoom-btn');
      btn.type = 'button';
      btn.setAttribute('aria-label', t('menu.pageZoom', { n, m: total }));
      const img = el('img');
      img.src = p.fileUrl;
      img.alt = t('menu.pageAlt', { n });
      img.decoding = 'async';
      btn.append(img);
      btn.addEventListener('click', () => openLightbox(null, null, btn, { items: gallery, index: galleryIdx.get(cur) }));
      slide.append(btn);
    }
    preloaded.add(cur);
    preload(cur - 1); preload(cur + 1);
    if (total > 1) {
      counter.textContent = t('page.of', { n, m: total });
      prev.disabled = cur === 0;
      next.disabled = cur === total - 1;
      // a focused button that just became disabled drops focus to BODY; keep it in the slider
      const ae = document.activeElement;
      if (ae && ae.disabled && (ae === prev || ae === next)) (ae === next ? prev : next).focus();
    }
  }
  function go(d) {
    const i = cur + d;
    if (i < 0 || i >= total) return;
    cur = i; draw();
  }
  draw();
  if (total === 1) { wrap.append(stage); return wrap; }

  const row = el('div', 'menu-slider-row');
  row.append(prev, stage, next);
  wrap.append(row, counter);
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-roledescription', 'carousel');
  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  wrap.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('a')) return;
    if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); } else if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
  });
  let x0 = null, y0 = null;
  stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  }, { passive: true });
  return wrap;
}
