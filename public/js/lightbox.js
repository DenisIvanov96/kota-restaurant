import { el, icon } from './dom.js';
import { t } from './i18n.js';

let dlg, scroll, img, zoomBtn, closeBtn, closeText, lastTrigger, prevBtn, nextBtn, posEl;
let gallery = null; // { items:[{src,alt}], index }

function build() {
  dlg = el('dialog', 'lightbox');

  const bar = el('div', 'lb-bar');
  zoomBtn = el('button', 'lb-btn');
  zoomBtn.type = 'button';
  zoomBtn.setAttribute('aria-pressed', 'false');
  const close = closeBtn = el('button', 'lb-btn');
  close.type = 'button';

  close.append(icon('x'));
  closeText = el('span', 'visually-hidden');
  close.append(closeText);
  prevBtn = el('button', 'lb-btn lb-prev');
  prevBtn.type = 'button';
  prevBtn.append(icon('arrow-left'));
  nextBtn = el('button', 'lb-btn lb-next');
  nextBtn.type = 'button';
  nextBtn.append(icon('arrow-right'));
  posEl = el('span', 'lb-pos');
  posEl.setAttribute('role', 'status');
  posEl.setAttribute('aria-live', 'polite');
  bar.append(prevBtn, posEl, nextBtn, zoomBtn, close);
  scroll = el('div', 'lb-scroll');
  img = el('img', 'lb-img');
  scroll.append(img);
  dlg.append(bar, scroll);
  document.body.append(dlg);

  zoomBtn.addEventListener('click', () => {
    const zoomed = scroll.classList.toggle('is-zoomed');
    zoomBtn.textContent = zoomed ? t('lb.zoomOut') : t('lb.zoomIn');
    zoomBtn.setAttribute('aria-pressed', String(zoomed));
  });
  close.addEventListener('click', () => dlg.close());
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  dlg.addEventListener('keydown', (e) => {
    if (!gallery) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  let sx = null, sy = 0;
  scroll.addEventListener('touchstart', (e) => {
    sx = e.touches.length === 1 && !scroll.classList.contains('is-zoomed') ? e.touches[0].clientX : null;
    sy = e.touches[0].clientY;
  }, { passive: true });
  scroll.addEventListener('touchend', (e) => {
    if (sx === null || !gallery) return;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  // Tap on the dark backdrop / empty scroll area closes
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target === scroll) dlg.close(); });
  dlg.addEventListener('close', () => {
    img.removeAttribute('src');
    gallery = null;
    if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus();
  });
}

function show() {
  const multi = gallery && gallery.items.length > 1;
  const it = gallery ? gallery.items[gallery.index] : null;
  if (it) { img.alt = it.alt || ''; img.src = it.src; }
  prevBtn.hidden = nextBtn.hidden = posEl.hidden = !multi;
  if (multi) {
    prevBtn.disabled = gallery.index === 0;
    nextBtn.disabled = gallery.index === gallery.items.length - 1;
    posEl.textContent = t('page.of', { n: it.n || gallery.index + 1, m: it.m || gallery.items.length });
  }
  scroll.classList.remove('is-zoomed');
  zoomBtn.textContent = t('lb.zoomIn');
  zoomBtn.setAttribute('aria-pressed', 'false');
  scroll.scrollTo(0, 0);
}

function step(d) {
  if (!gallery) return;
  const i = gallery.index + d;
  if (i < 0 || i >= gallery.items.length) return;
  gallery.index = i;
  show();
}

/** openLightbox(src, alt, trigger) or openLightbox(null, null, trigger, { items:[{src,alt}], index }) */
export function openLightbox(src, alt, trigger, gal) {
  if (!dlg) build();
  lastTrigger = trigger || document.activeElement;
  gallery = gal && gal.items && gal.items.length ? { items: gal.items, index: gal.index || 0 } : { items: [{ src, alt }], index: 0 };
  dlg.setAttribute('aria-label', t('lb.aria'));
  closeBtn.setAttribute('aria-label', t('lb.close'));
  closeText.textContent = t('lb.close');
  prevBtn.setAttribute('aria-label', t('lb.prev'));
  nextBtn.setAttribute('aria-label', t('lb.next'));
  show();
  dlg.showModal();
  scroll.scrollTo(0, 0);
}
