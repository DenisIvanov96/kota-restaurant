import { el, icon } from './dom.js';
import { t } from './i18n.js';

let dlg, scroll, img, zoomBtn, closeBtn, closeText, lastTrigger;

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
  bar.append(zoomBtn, close);
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
  // Tap on the dark backdrop / empty scroll area closes
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target === scroll) dlg.close(); });
  dlg.addEventListener('close', () => {
    img.removeAttribute('src');
    if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus();
  });
}

export function openLightbox(src, alt, trigger) {
  if (!dlg) build();
  lastTrigger = trigger || document.activeElement;
  scroll.classList.remove('is-zoomed');
  zoomBtn.textContent = t('lb.zoomIn');
  dlg.setAttribute('aria-label', t('lb.aria'));
  closeBtn.setAttribute('aria-label', t('lb.close'));
  closeText.textContent = t('lb.close');
  zoomBtn.setAttribute('aria-pressed', 'false');
  img.alt = alt || '';
  img.src = src;
  dlg.showModal();
  scroll.scrollTo(0, 0);
}
