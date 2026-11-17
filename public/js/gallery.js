// Gallery page: grid of photos/videos from /api/public/gallery, opened in the lightbox.
import { el, icon, getJSON, stateBox } from './dom.js';
import { loadSite, initNav, applyTopBar, applyInstagram, initYear } from './common.js';
import { initI18n, onLangChange, t, apiUrl, localizeLinks } from './i18n.js';
import { openLightbox } from './lightbox.js';

initI18n();
initNav();
initYear();

const box = document.getElementById('gallery-content');
let gen = 0;

function skeleton() {
  const wrap = el('div');
  wrap.setAttribute('role', 'status');
  wrap.append(el('span', 'visually-hidden', t('gallery.loading')));
  const ul = el('ul', 'gallery-grid');
  ul.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 6; i++) { const li = el('li', 'g-item'); li.append(el('div', 'skeleton g-skel')); ul.append(li); }
  wrap.append(ul);
  return wrap;
}

function render(items) {
  const m = items.length;
  const gallery = items.map((it, i) => {
    const label = it.caption || t(it.kind === 'video' ? 'gallery.videoN' : 'gallery.photoN', { n: i + 1, m });
    return { src: it.url, alt: label, kind: it.kind, caption: it.caption || '', mime: it.mime };
  });
  const ul = el('ul', 'gallery-grid');
  items.forEach((it, i) => {
    const li = el('li', 'g-item');
    const btn = el('button', 'g-tile');
    btn.type = 'button';
    btn.setAttribute('aria-label', gallery[i].alt);
    if (it.kind === 'video') {
      const v = el('video');
      v.muted = true; v.defaultMuted = true; v.playsInline = true; v.preload = 'metadata';
      v.tabIndex = -1;
      v.setAttribute('aria-hidden', 'true');
      v.src = it.url + '#t=0.001';
      const badge = el('span', 'g-play');
      badge.append(icon('play'));
      btn.append(v, badge, el('span', 'g-chip', t('gallery.video')));
    } else {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = it.url;
      btn.append(img);
    }
    btn.addEventListener('click', () => openLightbox(null, null, btn, { items: gallery, index: i }));
    li.append(btn);
    if (it.caption) li.append(el('p', 'g-cap', it.caption));
    ul.append(li);
  });
  return ul;
}

async function loadGallery() {
  const mine = ++gen;
  box.replaceChildren(skeleton());
  let data;
  try {
    data = await getJSON(apiUrl('/api/public/gallery'));
  } catch {
    if (mine !== gen) return;
    box.replaceChildren(stateBox({
      title: t('gallery.error'), role: 'alert', isError: true, body: t('err.body'),
      actions: [{ label: t('retry'), onClick: loadGallery }],
    }));
    return;
  }
  if (mine !== gen) return;
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) {
    box.replaceChildren(stateBox({ title: t('gallery.empty'), role: 'status', actions: [{ label: t('gallery.home'), href: '/' }] }));
  } else {
    box.replaceChildren(render(items));
  }
  localizeLinks();
}

function loadInfo() {
  loadSite().then((site) => { applyTopBar(site); applyInstagram(site); localizeLinks(); });
}

loadInfo();
loadGallery();
onLangChange(() => { loadInfo(); loadGallery(); });
