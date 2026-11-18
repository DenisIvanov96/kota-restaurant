// Gallery manager (#/gallery): sequential uploads with progress, captions, visibility, order, delete.
import { h, icon, formatSize } from './util.js';
import { get, put, patch, del, upload } from './api.js';
import { badge, alertBox, btn, iconBtn, skeleton, loadError, reportError, toast, confirmDialog, makeSwitch } from './ui.js';

const MAX_MB = 50;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const EXTS = ['jpg', 'jpeg', 'png', 'webp', 'mp4', 'm4v', 'mov', 'webm'];
const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,.jpg,.jpeg,.png,.webp,.mp4,.m4v,.mov,.webm';
const extOf = (n) => (/\.([a-z0-9]+)$/i.exec(n || '') || [])[1]?.toLowerCase() || '';

export function galleryView() {
  const el = h('div');
  el.append(h('h1', { class: 'a-h1', text: 'Галерия' }));
  const top = h('div');
  const listHost = h('div');
  const live = h('p', { class: 'a-vh', role: 'status', 'aria-live': 'polite' });
  el.append(top, listHost, live);

  let dead = false;
  let items = [];
  let max = 50;
  let queue = []; // { id, file, status: queued|uploading|done|error, pct, error, retryable, abort }
  let qid = 0;
  let running = false;
  let notices = []; // inline alerts: { type, text }
  let uploadBtn = null;

  const used = () => items.length;
  const pending = () => queue.filter((q) => q.status === 'queued' || q.status === 'uploading').length;

  async function load() {
    top.replaceChildren(skeleton(2));
    try {
      const d = await get('/api/admin/gallery');
      if (dead) return;
      items = d.items; max = d.max || 50;
      renderAll();
    } catch (e) { if (!dead) { top.replaceChildren(loadError('Галерията не може да се зареди.', load)); reportError(e); } }
  }

  function renderAll() { renderTop(); renderList(); }

  // ---------- top: counter, upload, queue ----------
  function renderTop() {
    const free = Math.max(0, max - used());
    const full = free === 0;
    const frag = [];
    frag.push(h('p', { class: 'a-count', 'aria-live': 'polite' }, h('strong', { class: 'a-count__n', text: `${used()} / ${max}` }), h('span', { class: 'a-muted', text: ' снимки и видео' })));
    if (full) frag.push(alertBox('warning', `Достигнахте максимума от ${max}. Изтрийте нещо, за да качите ново.`, { role: 'status' }));

    const input = h('input', { type: 'file', class: 'a-vh', tabindex: '-1', 'aria-hidden': 'true', multiple: true, accept: ACCEPT });
    input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
    uploadBtn = btn({ label: 'Избери снимки или видео', variant: 'primary', icon: 'upload', onClick: () => input.click() });
    uploadBtn.disabled = full;
    const dz = h('div', { class: 'a-upload' }, input, h('div', { class: 'a-upload__idle' }, uploadBtn,
      h('p', { class: 'a-help', text: `JPG, PNG, WebP, MP4, MOV, WebM. До ${MAX_MB} MB на файл. Можете да изберете няколко.` })));
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-drag'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('is-drag'));
    dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('is-drag'); if (!uploadBtn.disabled) addFiles(e.dataTransfer.files); });
    frag.push(dz);

    if (notices.length) {
      const box = h('div', { class: 'a-gal-notices', role: 'alert' });
      for (const n of notices) box.append(alertBox(n.type, n.text));
      box.append(btn({ label: 'Затвори', variant: 'ghost', onClick: () => { notices = []; renderTop(); } }));
      frag.push(box);
    }

    if (queue.length) {
      const ql = h('ul', { class: 'a-queue', 'aria-label': 'Качване' });
      for (const q of queue) ql.append(queueRow(q));
      frag.push(ql);
      if (pending()) frag.push(btn({ label: 'Откажи', variant: 'ghost', aria: 'Откажи всички качвания', onClick: cancelAll }));
    }
    top.replaceChildren(...frag);
  }

  function queueRow(q) {
    const li = h('li', { class: `a-qrow is-${q.status}` });
    const head = h('div', { class: 'a-qrow__head' }, h('span', { class: 'a-trunc a-qrow__name', title: q.file.name, text: q.file.name }), h('span', { class: 'a-help', text: formatSize(q.file.size) }));
    li.append(head);
    const txt = h('span', { class: 'a-help a-qrow__txt' });
    q.txt = txt;
    if (q.status === 'queued') { txt.textContent = 'Чака за качване…'; li.append(txt); }
    else if (q.status === 'uploading') {
      const bar = h('progress', { max: '100', value: String(q.pct), 'aria-label': `Качване: ${q.file.name}` });
      q.bar = bar;
      if (q.pct >= 100) bar.removeAttribute('value');
      txt.textContent = q.pct >= 100 ? 'Обработване…' : `Качване… ${q.pct}%`;
      li.append(bar, txt);
    } else if (q.status === 'done') li.append(h('p', { class: 'a-ok-text' }, icon('check'), h('span', { text: 'Готово' })));
    else if (q.status === 'error') {
      li.append(h('p', { class: 'a-error' }, icon('alert'), h('span', { text: `Грешка: ${q.error}` })));
      const acts = h('div', { class: 'a-actions' });
      if (q.retryable) acts.append(btn({ label: 'Опитай отново', variant: 'secondary', onClick: () => { q.status = 'queued'; q.error = ''; q.pct = 0; renderTop(); run(); } }));
      acts.append(btn({ label: 'Затвори', variant: 'ghost', aria: `Затвори съобщението за ${q.file.name}`, onClick: () => { queue = queue.filter((x) => x !== q); renderTop(); } }));
      li.append(acts);
    }
    return li;
  }

  function updateQ(q) {
    if (q.bar && q.bar.isConnected) { if (q.pct >= 100) q.bar.removeAttribute('value'); else q.bar.value = q.pct; }
    if (q.txt && q.txt.isConnected) q.txt.textContent = q.pct >= 100 ? 'Обработване…' : `Качване… ${q.pct}%`;
  }

  function cancelAll() {
    for (const q of queue) if (q.status === 'queued') q.status = 'cancelled';
    queue = queue.filter((q) => q.status !== 'cancelled');
    const cur = queue.find((q) => q.status === 'uploading');
    if (cur && cur.abort) cur.abort();
    renderTop();
  }

  function addFiles(list) {
    const files = Array.from(list || []);
    if (!files.length) return;
    const free = Math.max(0, max - used() - pending());
    notices = [];
    const bad = [];
    const good = [];
    for (const f of files) {
      if (!EXTS.includes(extOf(f.name))) bad.push(`„${f.name}“: този тип файл не се поддържа.`);
      else if (f.size > MAX_BYTES) bad.push(`„${f.name}“: файлът е твърде голям (${(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB). Максимум ${MAX_MB} MB.`);
      else good.push(f);
    }
    if (bad.length) notices.push({ type: 'error', text: h('ul', { class: 'a-gal-errs' }, ...bad.map((b) => h('li', { text: b }))) });
    const take = good.slice(0, free);
    if (good.length > take.length) notices.push({ type: 'warning', text: `Качени са само ${take.length} от ${good.length} файла — достигнат е максимумът от ${max}.` });
    for (const f of take) queue.push({ id: ++qid, file: f, status: 'queued', pct: 0, error: '' });
    renderTop();
    run();
  }

  async function run() {
    if (running) return;
    running = true;
    let uploaded = 0;
    try {
      for (;;) {
        if (dead) return;
        const q = queue.find((x) => x.status === 'queued');
        if (!q) break;
        q.status = 'uploading'; q.pct = 0;
        renderTop();
        const fd = new FormData();
        fd.append('file', q.file);
        const up = upload('POST', '/api/admin/gallery', fd, { onProgress: (p) => { q.pct = p; updateQ(q); }, onSent: () => { q.pct = 100; updateQ(q); } });
        q.abort = up.abort;
        try {
          const item = await up.promise;
          items.push(item);
          q.status = 'done';
          uploaded++;
          live.textContent = `Качен е файл ${uploaded}.`;
          renderTop(); renderList();
          setTimeout(() => { queue = queue.filter((x) => x !== q); if (!dead) renderTop(); }, 4000);
        } catch (e) {
          if (e.code === 'aborted') { queue = queue.filter((x) => x !== q); }
          else if (e.status === 401) { queue = queue.filter((x) => x !== q); return; }
          else if (e.status === 409) {
            q.status = 'error'; q.error = `Галерията е пълна (${max}).`;
            for (const r of queue) if (r.status === 'queued') r.status = 'cancelled';
            queue = queue.filter((r) => r.status !== 'cancelled');
          } else if (e.status === 413) { q.status = 'error'; q.error = `Файлът е твърде голям. Максимум ${MAX_MB} MB.`; }
          else if (e.status === 415) { q.status = 'error'; q.error = 'Този тип файл не се поддържа.'; }
          else if (e.status === 400) { q.status = 'error'; q.error = (e.fields && (e.fields.file || Object.values(e.fields)[0])) || e.message; }
          else { q.status = 'error'; q.retryable = true; q.error = e.code === 'network' ? 'Качването не успя. Проверете връзката и опитайте отново.' : e.message; }
        }
        q.abort = null;
        if (!dead) renderTop();
      }
    } finally {
      running = false;
      if (uploaded && !dead) {
        toast(uploaded === 1 ? 'Качен е 1 файл.' : `Качени са ${uploaded} файла.`);
        // pick up server truth (positions, counts)
        try { const d = await get('/api/admin/gallery'); if (!dead) { items = d.items; renderTop(); renderList(); } } catch { /* ignore */ }
      }
    }
  }

  // ---------- list ----------
  function renderList() {
    const active = document.activeElement;
    const fk = active && active.dataset && active.dataset.fk && listHost.contains(active) ? active.dataset.fk : null;
    if (!items.length) {
      listHost.replaceChildren(h('div', { class: 'a-empty' }, h('p', { class: 'a-empty__title', text: 'Още няма качени снимки или видео.' }), h('p', { text: 'Качете първите файлове с бутона по-горе.' })));
      return;
    }
    const ul = h('ul', { class: 'a-gal-list' });
    items.forEach((it, i) => ul.append(row(it, i)));
    listHost.replaceChildren(h('h2', { text: 'Качено' }), ul);
    if (fk) { const f = listHost.querySelector(`[data-fk="${fk}"]`); if (f && !f.disabled) f.focus(); }
  }

  function thumb(it) {
    const box = h('div', { class: 'a-gal__thumb' + (it.visible ? '' : ' is-hidden') });
    if (it.kind === 'video') {
      const v = h('video', { muted: true, playsinline: true, preload: 'metadata', tabindex: '-1', 'aria-hidden': 'true', src: it.fileUrl + '#t=0.001' });
      v.muted = true;
      box.append(v, h('span', { class: 'a-gal__play', 'aria-hidden': 'true' }, h('span', { class: 'a-gal__tri' })));
    } else box.append(h('img', { src: it.fileUrl, alt: '', loading: 'lazy' }));
    const a = h('a', { class: 'a-gal__open', href: it.fileUrl, target: '_blank', rel: 'noopener', 'aria-label': `Преглед на № ${it.position} (отваря се в нов раздел)` });
    a.append(box);
    return a;
  }

  function captionField(it, key, label) {
    const id = `g${it.id}-${key}`;
    const input = h('input', { type: 'text', class: 'a-input', id, maxlength: '300', 'data-fk': `${it.id}:${key}`, lang: key === 'captionEn' ? 'en' : 'bg' });
    input.value = it[key] || '';
    const counter = h('span', { class: 'a-counter', 'aria-hidden': 'true' });
    const status = h('p', { class: 'a-gal__status', 'aria-live': 'polite' });
    const err = h('p', { class: 'a-error', hidden: true }, icon('alert'), h('span'));
    const upd = () => { counter.textContent = `${input.value.length}/300`; counter.classList.toggle('is-limit', input.value.length >= 300); };
    upd();
    let saved = it[key] || '';
    let fadeTimer;
    async function commit() {
      it[key] = input.value;
      const v = input.value.trim();
      if (v === saved.trim()) return;
      status.textContent = 'Запазване…'; err.hidden = true; input.classList.remove('is-invalid');
      try {
        const r = await patch(`/api/admin/gallery/${it.id}`, { [key]: v });
        saved = r[key] || '';
        it[key] = input.value;
        status.textContent = '';
        status.append(icon('check'), document.createTextNode(' Запазено'));
        status.classList.add('is-ok');
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => { status.textContent = ''; status.classList.remove('is-ok'); }, 2000);
      } catch (e) {
        status.textContent = '';
        if (e.status !== 401) { err.hidden = false; err.lastChild.textContent = (e.fields && e.fields[key]) || e.message; input.classList.add('is-invalid'); }
      }
    }
    input.addEventListener('input', () => { it[key] = input.value; upd(); });
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    return h('div', { class: 'a-field' },
      h('label', { for: id, class: 'a-label' }, label, h('span', { class: 'a-help a-gal__opt', text: ' (не е задължително)' })),
      input, err, h('div', { class: 'a-counter-row' }, counter), status);
  }

  function row(it, i) {
    const n = it.position;
    const li = h('li', { class: 'a-gal' });
    const heading = h('h3', { class: 'a-gal__h', tabindex: '-1', 'data-fk': `${it.id}:h` }, `№ ${n}`);
    const head = h('div', { class: 'a-gal__head' }, heading,
      badge(it.kind === 'video' ? 'Видео' : 'Снимка', it.kind === 'video' ? 'info' : 'neutral', it.kind === 'video' ? 'clock' : 'image'),
      h('span', { class: 'a-muted a-gal__size', text: formatSize(it.size) }),
      it.visible ? badge('Видимо', 'ok') : badge('Скрито', 'neutral', 'ring'));
    const fields = h('div', { class: 'a-gal__fields' }, captionField(it, 'captionBg', 'Надпис (български)'), captionField(it, 'captionEn', 'Надпис (English)'));
    const sw = makeSwitch({
      label: `Показвай в галерията (№ ${n})`, checked: it.visible,
      onChange: async (v) => {
        try { const r = await patch(`/api/admin/gallery/${it.id}`, { visible: v }); it.visible = r.visible; }
        catch (e) { reportError(e); throw e; }
        li.replaceWith(row(it, i));
        const f = listHost.querySelector(`[data-fk="${it.id}:sw"]`); if (f) f.focus();
      },
    });
    sw.dataset.fk = `${it.id}:sw`;
    const up = iconBtn({ ic: 'arrow-up', aria: `Премести № ${n} нагоре`, onClick: () => move(i, -1, `${it.id}:up`) });
    const down = iconBtn({ ic: 'arrow-down', aria: `Премести № ${n} надолу`, onClick: () => move(i, 1, `${it.id}:down`) });
    up.dataset.fk = `${it.id}:up`; down.dataset.fk = `${it.id}:down`;
    if (i === 0) { up.disabled = true; }
    if (i === items.length - 1) { down.disabled = true; }
    const delBtn = btn({ label: 'Изтрий', variant: 'ghost-danger', icon: 'trash', aria: `Изтрий № ${n}`, onClick: () => remove(it, i) });
    delBtn.dataset.fk = `${it.id}:del`;
    const acts = h('div', { class: 'a-gal__acts' }, up, down, delBtn);
    li.append(thumb(it), head, fields, h('div', { class: 'a-gal__side' }, sw, acts));
    return li;
  }

  async function move(i, d, fk) {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const before = items.slice();
    const moved = items[i];
    [items[i], items[j]] = [items[j], items[i]];
    items.forEach((x, k) => { x.position = k + 1; });
    renderList();
    const f = listHost.querySelector(`[data-fk="${fk}"]`);
    if (f && !f.disabled) f.focus(); else { const o = listHost.querySelector(`[data-fk="${moved.id}:${d < 0 ? 'down' : 'up'}"]`); if (o) o.focus(); }
    live.textContent = `№ ${i + 1} е преместен на позиция ${j + 1}.`;
    try {
      const r = await put('/api/admin/gallery/order', { ids: items.map((x) => x.id) });
      items = r.items;
    } catch (e) {
      items = before; items.forEach((x, k) => { x.position = k + 1; });
      renderList(); reportError(e);
    }
  }

  async function remove(it, i) {
    const cap = (it.captionBg || it.captionEn || '').trim();
    const body = h('p');
    body.append(document.createTextNode('Сигурни ли сте, че искате да изтриете този файл'));
    if (cap) { body.append(document.createTextNode(' „'), document.createTextNode(cap), document.createTextNode('“')); }
    body.append(document.createTextNode('? Файлът ще бъде изтрит. Това не може да бъде върнато.'));
    const ok = await confirmDialog({
      title: 'Изтриване от галерията', body, confirmLabel: 'Изтрий файла', danger: true,
      run: async () => { await del(`/api/admin/gallery/${it.id}`); },
    });
    if (!ok) return;
    items = items.filter((x) => x.id !== it.id);
    items.forEach((x, k) => { x.position = k + 1; });
    toast('Файлът е изтрит.');
    renderTop(); renderList();
    const next = items[i] || items[i - 1];
    const target = next ? listHost.querySelector(`[data-fk="${next.id}:h"]`) : uploadBtn;
    if (target) target.focus();
  }

  load();
  return { el, destroy() { dead = true; if (running) for (const q of queue) if (q.abort) q.abort(); }, dirty: () => false };
}
