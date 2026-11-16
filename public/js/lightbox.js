import { el, icon } from './dom.js';

let dlg, scroll, img, zoomBtn, lastTrigger;

function build() {
  dlg = el('dialog', 'lightbox');
  dlg.setAttribute('aria-label', 'Увеличена снимка');
  const bar = el('div', 'lb-bar');
  zoomBtn = el('button', 'lb-btn', 'Увеличи');
  zoomBtn.type = 'button';
  zoomBtn.setAttribute('aria-pressed', 'false');
  const close = el('button', 'lb-btn');
  close.type = 'button';
  close.setAttribute('aria-label', 'Затвори');
  close.append(icon('x'));
  close.append(el('span', 'visually-hidden', 'Затвори'));
  bar.append(zoomBtn, close);
  scroll = el('div', 'lb-scroll');
  img = el('img', 'lb-img');
  scroll.append(img);
  dlg.append(bar, scroll);
  document.body.append(dlg);

  zoomBtn.addEventListener('click', () => {
    const zoomed = scroll.classList.toggle('is-zoomed');
    zoomBtn.textContent = zoomed ? 'Намали' : 'Увеличи';
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
  zoomBtn.textContent = 'Увеличи';
  zoomBtn.setAttribute('aria-pressed', 'false');
  img.alt = alt || '';
  img.src = src;
  dlg.showModal();
  scroll.scrollTo(0, 0);
}
