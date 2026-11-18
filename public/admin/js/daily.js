import { h, icon, clear, formatDateLong, formatSize, kindLabel, addDays, capitalize } from './util.js';
import { dateField } from './datetime.js';
import { get, patch, del, upload } from './api.js';
import { badge, alertBox, btn, skeleton, loadError, emptyState, reportError, toast, modal, confirmDialog, para, makeSwitch, field, createUpload, filePreview, setBusy, withBusy } from './ui.js';

const STEPS = ['Избери файлове', 'Избери дата', 'Преглед', 'Публикувай'];
const EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'webp'];

export function dailyView(ctx) {
  const el = h('div');
  el.append(h('h1', { class: 'a-h1', text: 'Обедно меню' }));
  const wizardHost = h('div');
  const listHost = h('div');
  el.append(wizardHost, listHost);
  let dead = false;
  let today = '';
  let menus = [];

  // wizard state
  const w = { step: 1, date: '', done: null, sending: false, error: null, dateError: '' };
  const upl = createUpload({ exts: EXTS, maxMB: 50, onChange: () => { renderWizard(); }, onCancel: () => w.abort && w.abort() });
  const uplEn = createUpload({ exts: EXTS, maxMB: 50, onChange: () => { renderWizard(); }, onCancel: () => w.abort && w.abort() });
  const upl2 = createUpload({ exts: EXTS, maxMB: 50, onChange: () => { renderWizard(); }, onCancel: () => w.abort && w.abort() });
  const uplEn2w = createUpload({ exts: EXTS, maxMB: 50, onChange: () => { renderWizard(); }, onCancel: () => w.abort && w.abort() });
  const hasFile = () => !!(upl.file || uplEn.file);
  const fileLines = () => [upl.file && `Български файл: ${upl.file.name} (${formatSize(upl.file.size)})`, upl2.file && `Български файл, 2-ра страница: ${upl2.file.name} (${formatSize(upl2.file.size)})`,
    uplEn.file && `English файл: ${uplEn.file.name} (${formatSize(uplEn.file.size)})`, uplEn2w.file && `English файл, 2-ра страница: ${uplEn2w.file.name} (${formatSize(uplEn2w.file.size)})`].filter(Boolean);
  // a second page only makes sense with a first one
  const syncSecond = () => { if (!upl.file && upl2.file) upl2.clear(); if (!uplEn.file && uplEn2w.file) uplEn2w.clear(); };
  const second = (first, upl2x, id) => first.file
    ? h('div', { class: 'a-field' }, h('span', { class: 'a-label', id, text: 'Втора страница (по избор)' }), upl2x.el)
    : null;

  async function load(first) {
    if (first) { wizardHost.replaceChildren(skeleton(1)); listHost.replaceChildren(skeleton(2)); }
    try {
      const r = await get('/api/admin/daily-menus');
      if (dead) return;
      today = r.today; menus = r.menus;
      if (!w.date) w.date = today;
      renderWizard(); renderList();
    } catch (e) {
      if (dead) return;
      wizardHost.replaceChildren();
      listHost.replaceChildren(loadError(null, () => load(true)));
      reportError(e);
    }
  }

  const menuOn = (date) => menus.find((m) => m.date === date);

  // ================= WIZARD =================
  function stepper() {
    const wrap = h('div', { class: 'a-stepper' });
    const compact = h('div', { class: 'a-steps-compact' }, h('strong', { text: `Стъпка ${w.step} от 4 — ${STEPS[w.step - 1]}` }));
    const bar = h('div', { class: 'a-steps-bar', 'aria-hidden': 'true' });
    STEPS.forEach((_, i) => bar.append(h('span', { class: i < w.step ? 'is-on' : '' })));
    compact.append(bar);
    const ol = h('ol', { class: 'a-steps', 'aria-label': 'Стъпки' });
    STEPS.forEach((name, i) => {
      const n = i + 1;
      const state = n < w.step ? 'done' : n === w.step ? 'current' : 'todo';
      const circle = h('span', { class: 'a-steps__n' }, state === 'done' ? [icon('check'), h('span', { class: 'a-vh', text: 'завършена' })] : String(n));
      const inner = state === 'done' && !w.done
        ? h('button', { type: 'button', class: 'a-steps__btn', onclick: () => { w.step = n; renderWizard(); } }, circle, h('span', { text: name }))
        : h('span', { class: 'a-steps__btn' }, circle, h('span', { text: name }));
      const li = h('li', { class: `a-steps__item is-${state}` }, inner);
      if (state === 'current') li.setAttribute('aria-current', 'step');
      ol.append(li);
    });
    wrap.append(compact, ol);
    return wrap;
  }

  function nav(next, back) {
    return h('div', { class: 'a-actionrow' }, back && btn({ label: 'Назад', variant: 'ghost', onClick: back }), next);
  }

  let rendering = false; // guard: upl.clear() in syncSecond fires onChange; a nested render would steal the uploaders' elements
  function renderWizard() {
    if (!today || rendering) return;
    rendering = true;
    try { renderWizardNow(); } finally { rendering = false; }
  }
  function renderWizardNow() {
    const card = h('section', { class: 'a-card', 'aria-labelledby': 'wiz-h' });
    wizardHost.replaceChildren(card);
    if (w.done) { card.append(h('h2', { id: 'wiz-h', text: 'Качване на меню' }), doneView()); return; }
    card.append(h('h2', { id: 'wiz-h', text: 'Качване на меню' }), stepper());
    const panel = h('div', { class: 'a-step' });
    card.append(panel);
    if (w.step === 1) step1(panel); else if (w.step === 2) step2(panel); else if (w.step === 3) step3(panel); else step4(panel);
  }

  function step1(p) {
    syncSecond();
    p.append(h('h3', { text: 'Избери файлове' }),
      h('p', { class: 'a-help', text: 'Качете български файл, английски файл или и двата. Ако за даден език няма файл, клиентите виждат другия.' }),
      h('section', { class: 'a-fileslang', 'aria-labelledby': 'dw-bg', lang: 'bg' }, h('h4', { id: 'dw-bg', text: 'Български файл' }), upl.el, second(upl, upl2, 'dw-bg2')),
      h('section', { class: 'a-fileslang', 'aria-labelledby': 'dw-en', lang: 'en' }, h('h4', { id: 'dw-en', text: 'English файл (по избор)' }), uplEn.el, second(uplEn, uplEn2w, 'dw-en2')));
    const next = btn({ label: 'Напред', variant: 'primary', onClick: () => { w.step = 2; renderWizard(); focusStep(); } });
    next.disabled = !hasFile();
    p.append(h('p', { class: 'a-help', text: 'Менютата от минали дни се изтриват автоматично при качване на ново меню.' }));
    if (!hasFile()) p.append(h('p', { class: 'a-help', text: 'Изберете поне един файл, за да продължите.' }));
    p.append(nav(next));
  }

  function focusStep() { const t = wizardHost.querySelector('.a-step h3'); if (t) { t.tabIndex = -1; t.focus(); } }

  function step2(p) {
    const dateF = dateField({ label: 'Дата на менюто', required: true, today, value: w.date, helper: 'Менюто се показва на клиентите само на тази дата.', onInput: () => { w.date = dateF.value; sync(); } });
    if (w.dateError) dateF.setError(w.dateError);
    const seg = h('div', { class: 'a-seg', role: 'group', 'aria-label': 'Бърз избор на дата' });
    const quick = [['Днес', today], ['Утре', addDays(today, 1)]];
    const segBtns = quick.map(([label, d]) => {
      const b = h('button', { type: 'button', class: 'a-seg__btn', text: label, onclick: () => { w.date = d; dateF.value = d; dateF.setError(''); sync(); } });
      b.dataset.d = d; return b;
    });
    seg.append(...segBtns);
    const long = h('p', { class: 'a-bigdate' });
    const notes = h('div');
    const next = btn({ label: 'Напред', variant: 'primary', onClick: () => {
      if (!w.date) { if (!dateF.validate()) dateF.setError('Изберете дата.'); dateF.input.focus(); return; }
      w.step = 3; renderWizard(); focusStep();
    } });
    function sync() {
      segBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.d === w.date)));
      long.textContent = w.date ? formatDateLong(w.date) : '';
      clear(notes);
      if (w.date && w.date < today) notes.append(alertBox('warning', 'Тази дата е в миналото. Клиентите няма да видят менюто.'));
      if (w.date && menuOn(w.date)) notes.append(alertBox('info', 'За тази дата вече има меню. При публикуване можете да го замените.'));
      next.disabled = !w.date;
    }
    p.append(h('h3', { text: 'Избери дата' }), dateF.el, seg, long, notes, nav(next, () => { w.step = 1; renderWizard(); focusStep(); }));
    sync();
  }

  function step3(p) {
    p.append(h('h3', { text: 'Преглед' }));
    if (hasFile()) {
      if (upl.file) p.append(filePreview(upl));
      if (upl2.file) p.append(filePreview(upl2));
      if (uplEn.file) p.append(filePreview(uplEn));
      if (uplEn2w.file) p.append(filePreview(uplEn2w));
      const dl = h('dl', { class: 'a-summary-list' },
        h('dt', { text: 'Файлове' }), h('dd', null, ...fileLines().map((t) => h('div', { text: t }))),
        h('dt', { text: 'Дата' }), h('dd', { text: formatDateLong(w.date) }),
        h('dt', { text: 'Как ще го видят клиентите' }), h('dd', { text: `на ${formatDateLong(w.date)}` }));
      p.append(dl);
    }
    const next = btn({ label: 'Напред', variant: 'primary', onClick: () => { w.step = 4; renderWizard(); focusStep(); } });
    p.append(nav(next, () => { w.step = 2; renderWizard(); focusStep(); }));
  }

  function step4(p) {
    const isToday = w.date === today;
    const dateTxt = formatDateLong(w.date);
    p.append(h('h3', { text: 'Публикувай' }),
      h('div', { class: 'a-summary-card' }, h('strong', { text: 'Готово за качване' }),
        ...fileLines().map((t) => h('p', { text: t })), h('p', { text: `Дата: ${dateTxt}` })));
    if (w.error) p.append(alertBox('error', [h('strong', { text: w.error })], { role: 'alert' }));
    const prog = h('div', { class: 'a-upload__prog', hidden: true });
    const progress = h('progress', { max: '100', value: '0', 'aria-label': 'Качване' });
    const pct = h('p', { class: 'a-upload__pct', 'aria-live': 'polite' });
    const cancel = btn({ label: 'Откажи качването', variant: 'secondary', onClick: () => w.abort && w.abort() });
    prog.append(progress, pct, cancel);
    const pubBtn = btn({ label: 'Публикувай', variant: 'primary', cls: 'a-btn--xl' });
    const draftBtn = btn({ label: 'Запази като чернова (непубликувано)', variant: 'secondary', cls: 'a-btn--xl' });
    const backBtn = btn({ label: 'Назад', variant: 'ghost', onClick: () => { w.step = 3; w.error = null; renderWizard(); focusStep(); } });
    const run = (published, replace) => send(published, { prog, progress, pct, buttons: [pubBtn, draftBtn, backBtn], busyBtn: published ? pubBtn : draftBtn }, replace);
    w.rerun = run;
    pubBtn.addEventListener('click', () => run(true));
    draftBtn.addEventListener('click', () => run(false));
    p.append(
      h('div', { class: 'a-choice' }, pubBtn, h('p', { class: 'a-help', text: isToday ? 'Клиентите ще го видят веднага.' : `Ще се показва на сайта на ${dateTxt}.` })),
      h('div', { class: 'a-choice' }, draftBtn, h('p', { class: 'a-help', text: 'Менюто се записва, но клиентите няма да го виждат, докато не го публикувате.' })),
      prog, nav(null, backBtn));
  }

  async function conflict(existing) {
    return modal({
      title: 'Вече има меню за тази дата',
      body: h('p', { text: `За ${formatDateLong(existing ? existing.date : w.date)} вече има качено меню (${existing && existing.published ? 'Публикувано' : 'Чернова'}). Старото меню (и двата езика) ще бъде заменено с новите файлове и изтрито. Език, за който не качите файл, ще остане празен. Да заменя ли?` }),
      buttons: [{ label: 'Избери друга дата', value: 'other', focus: true }, { label: 'Замени', value: 'replace', variant: 'danger' }],
    });
  }

  async function send(published, ui, replace = false) {
    if (w.sending) return;
    const ex = menuOn(w.date);
    if (ex && !replace) {
      const c = await conflict(ex);
      if (c === 'other') { w.step = 2; renderWizard(); focusStep(); return; }
      if (c !== 'replace') return;
      replace = true;
    }
    w.sending = true; w.error = null;
    ui.buttons.forEach((b) => { b.disabled = true; });
    setBusy(ui.busyBtn, true, 'Качване…');
    ui.prog.hidden = false;
    const fd = new FormData();
    fd.append('date', w.date); fd.append('published', String(published));
    if (upl.file) fd.append('file', upl.file);
    if (upl2.file && upl.file) fd.append('file2', upl2.file);
    if (uplEn.file) fd.append('fileEn', uplEn.file);
    if (uplEn2w.file && uplEn.file) fd.append('fileEn2', uplEn2w.file);
    if (replace) fd.append('replace', 'true');
    let last = -1;
    const up = upload('POST', '/api/admin/daily-menus', fd, {
      onProgress: (p) => { ui.progress.value = p; const s = Math.floor(p / 10) * 10; if (s !== last) { last = s; ui.pct.textContent = p >= 100 ? 'Обработване…' : `Качване… ${p}%`; } },
      onSent: () => { ui.progress.removeAttribute('value'); ui.pct.textContent = 'Обработване…'; },
    });
    w.abort = up.abort;
    try {
      const m = await up.promise;
      w.sending = false;
      w.done = { published, date: w.date, today: w.date === today, menu: m };
      toast(published ? 'Менюто е качено и публикувано.' : 'Менюто е записано като чернова.');
      await load();
    } catch (e) {
      w.sending = false;
      if (e.code === 'aborted') { renderWizard(); return; }
      if (e.status === 401) { renderWizard(); return; }
      if (e.status === 409 && e.code === 'date_exists') {
        await load();
        const c = await conflict(menuOn(w.date));
        if (c === 'replace') { renderWizard(); await w.rerun(published, true); return; }
        if (c === 'other') { w.step = 2; }
        renderWizard(); return;
      }
      if (e.status === 413 || e.status === 415 || (e.status === 400 && e.fields && (e.fields.file || e.fields.fileEn || e.fields.file2 || e.fields.fileEn2))) {
        w.step = 1; renderWizard();
        const f = e.fields || {};
        const target = f.file ? upl : f.file2 ? upl2 : f.fileEn ? uplEn : f.fileEn2 ? uplEn2w : upl;
        target.setError(f.file || f.file2 || f.fileEn || f.fileEn2 || e.message); return;
      }
      if (e.status === 400 && e.fields && e.fields.date) { w.step = 2; w.dateError = e.fields.date; renderWizard(); w.dateError = ''; return; }
      w.error = e.code === 'network' ? 'Качването не успя. Проверете връзката и опитайте отново.' : e.message;
      renderWizard();
    }
  }

  function doneView() {
    const d = w.done;
    const box = h('div');
    const msg = d.published ? `Менюто за ${formatDateLong(d.date)} е публикувано.` : `Менюто за ${formatDateLong(d.date)} е записано като чернова.`;
    box.append(alertBox('success', [h('strong', { text: msg }), d.published && d.today ? ' Клиентите вече го виждат.' : ''], { role: 'status' }));
    box.append(h('div', { class: 'a-actionrow' },
      btn({ label: 'Качи ново меню', variant: 'secondary', onClick: () => { upl.clear(); uplEn.clear(); upl2.clear(); uplEn2w.clear(); w.done = null; w.step = 1; w.date = today; renderWizard(); focusStep(); } }),
      btn({ label: 'Виж менютата', variant: 'primary', onClick: () => { const t = listHost.querySelector('h2'); if (t) { t.tabIndex = -1; t.focus(); } } })));
    return box;
  }

  // ================= LIST =================
  function renderList() {
    clear(listHost);
    const card = h('section', { class: 'a-card', 'aria-labelledby': 'list-h' }, h('h2', { id: 'list-h', text: 'Менюта' }));
    listHost.append(card);
    if (!menus.length) {
      card.append(emptyState('Още няма качени менюта.', null, 'Качи първото меню', () => { w.step = 1; renderWizard(); wizardHost.scrollIntoView(); focusStep(); }));
      return;
    }
    const todays = menus.filter((m) => m.date === today);
    const upcoming = menus.filter((m) => m.date > today).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!todays.some((m) => m.published)) {
      card.append(alertBox('warning', [h('strong', { text: 'За днес няма публикувано меню.' })]),
        h('div', { class: 'a-actions' }, btn({ label: 'Качи меню', variant: 'secondary', onClick: () => { upl.clear(); uplEn.clear(); upl2.clear(); uplEn2w.clear(); w.done = null; w.step = 1; w.date = today; renderWizard(); wizardHost.scrollIntoView(); focusStep(); } })));
    }
    const section = (title, items) => {
      if (!items.length) return;
      card.append(h('h3', { class: 'a-sub', text: title }));
      const l = h('div', { class: 'a-list', role: 'list' });
      items.forEach((m) => l.append(menuRow(m)));
      card.append(l);
    };
    section('Днес', todays); section('Предстоящи', upcoming);
    if (!todays.length && !upcoming.length) card.append(h('p', { class: 'a-help', text: 'Няма менюта за днес и предстоящи дни.' }));
  }

  function menuRow(m) {
    const live = m.date === today && m.published;
    const stripe = live ? 'is-live' : m.date === today ? 'is-warn' : '';
    const mainUrl = m.fileUrl || m.fileEnUrl;
    const mainKind = m.fileUrl ? m.kind : m.kindEn;
    const thumb = mainKind === 'image' ? h('img', { class: 'a-thumb', src: mainUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'a-thumb a-thumb--tile' }, icon('file-pdf'));
    const badges = h('div', { class: 'a-badges' });
    badges.append(badge(m.fileUrl ? 'БГ файл' : 'Няма БГ файл', m.fileUrl ? 'ok' : 'neutral', m.fileUrl ? undefined : 'ring'), badge(m.fileEnUrl ? 'EN файл' : 'Няма EN файл', m.fileEnUrl ? 'ok' : 'neutral', m.fileEnUrl ? undefined : 'ring'));
    if (live) badges.append(badge('На живо днес', 'solid'));
    else if (m.date === today) badges.append(badge('Днес — не е публикувано', 'warn'));
    else if (m.date === addDays(today, 1)) badges.append(badge('Утре', 'info'), m.published ? badge('Публикувано', 'ok') : badge('Чернова', 'neutral', 'pencil'));
    else if (m.date > today) badges.append(badge('Предстоящо', 'info'), m.published ? badge('Публикувано', 'ok') : badge('Чернова', 'neutral', 'pencil'));
    else badges.append(badge('Минало', 'neutral'), m.published ? badge('Публикувано', 'ok') : badge('Чернова', 'neutral', 'pencil'));
    const sw = makeSwitch({ label: `Публикувано за ${formatDateLong(m.date)}`, checked: m.published, onChange: async (next) => {
      try { const u = await patch(`/api/admin/daily-menus/${m.id}/published`, { published: next }); Object.assign(m, u); setTimeout(renderList, 0); toast(next ? 'Менюто е публикувано.' : 'Менюто е скрито.'); } catch (e) { reportError(e); throw e; }
    } });
    const pg = (u2) => (u2 ? ' · 2 стр.' : '');
    const info = h('div', { class: 'a-menu__info' }, h('h4', { class: 'a-menu__date', text: capitalize(formatDateLong(m.date)) }),
      m.fileUrl && h('p', { class: 'a-help' }, `БГ: ${kindLabel(m.kind)} · `, h('span', { class: 'a-trunc-inline', title: m.originalName, text: m.originalName }), ` · ${formatSize(m.sizeBytes)}${pg(m.file2)}`),
      m.fileEnUrl && h('p', { class: 'a-help', lang: 'en' }, `EN: ${kindLabel(m.kindEn)} · `, h('span', { class: 'a-trunc-inline', title: m.originalNameEn, text: m.originalNameEn }), ` · ${formatSize(m.sizeBytesEn)}${pg(m.fileEn2)}`),
      badges, m.date === today && !m.published ? h('p', { class: 'a-warn-text', text: 'Клиентите не го виждат.' }) : null);
    const actions = h('div', { class: 'a-menu__act' },
      m.fileUrl && h('a', { href: m.fileUrl, target: '_blank', rel: 'noopener', class: 'a-btn a-btn--secondary', 'aria-label': m.fileEnUrl ? 'Преглед на българския файл' : undefined }, icon('eye'), h('span', { text: m.fileEnUrl ? 'Преглед БГ' : 'Преглед' })),
      m.fileEnUrl && h('a', { href: m.fileEnUrl, target: '_blank', rel: 'noopener', class: 'a-btn a-btn--secondary', 'aria-label': 'Преглед на английския файл' }, icon('eye'), h('span', { text: m.fileUrl ? 'Преглед EN' : 'Преглед' })),
      m.file2 && m.file2.fileUrl && h('a', { href: m.file2.fileUrl, target: '_blank', rel: 'noopener', class: 'a-btn a-btn--secondary', 'aria-label': 'Преглед на втората страница (български)' }, icon('eye'), h('span', { text: 'БГ стр. 2' })),
      m.fileEn2 && m.fileEn2.fileUrl && h('a', { href: m.fileEn2.fileUrl, target: '_blank', rel: 'noopener', class: 'a-btn a-btn--secondary', 'aria-label': 'Преглед на втората страница (английски)' }, icon('eye'), h('span', { text: 'EN стр. 2' })),
      btn({ label: 'Редактирай', variant: 'secondary', icon: 'pencil', onClick: () => editDialog(m) }),
      btn({ label: 'Изтрий', variant: 'ghost-danger', icon: 'trash', aria: `Изтрий менюто за ${formatDateLong(m.date)}`, onClick: async () => {
        const ok = await confirmDialog({
          title: 'Изтриване на меню',
          body: h('div', null, para(`Сигурни ли сте, че искате да изтриете менюто за ${formatDateLong(m.date)}? Файлът ще бъде изтрит. Това не може да бъде върнато.`), live ? para('', ['Това меню се показва на клиентите сега.']) : null),
          confirmLabel: 'Изтрий менюто', danger: true, run: async () => { await del(`/api/admin/daily-menus/${m.id}`); },
        });
        if (ok) { toast('Менюто е изтрито.'); load(); }
      } }));
    return h('article', { class: `a-card a-menu ${stripe}`, role: 'listitem' }, thumb, info, h('div', { class: 'a-menu__sw' }, sw), actions);
  }

  async function editDialog(m) {
    const dateF = dateField({ label: 'Дата', required: true, today, value: m.date });
    let abort = null;
    const mk = () => createUpload({ exts: EXTS, maxMB: 50, onChange: () => redraw(), onCancel: () => abort && abort() });
    const uplBg = mk(), uplBg2 = mk(), uplEnX = mk(), uplEnX2 = mk();
    const st = { removeBg: false, removeBg2: false, removeEn: false, removeEn2: false };
    const bgBox = h('div', { class: 'a-field' });
    const enBox = h('div', { class: 'a-field' });
    // lang block: first file (replace/remove) + optional second slot (replace/remove)
    function langBox(box, cfg) {
      clear(box);
      const { title, cur, curName, up1, up2, k1, k2, lang, label1 } = cfg;
      box.append(h('span', { class: 'a-label', text: title }), h('p', { class: 'a-help', lang, text: cur ? `Текущ файл: ${curName}` : (lang === 'en' ? 'Няма качен английски файл.' : 'Няма качен български файл.') }));
      if (cfg.removable && cur && !up1.file) {
        if (st[k1]) box.append(alertBox('info', `${label1} ще бъде премахнат при запазване.`), btn({ label: `Върни ${cfg.short}`, variant: 'ghost', onClick: () => { st[k1] = false; redraw(); } }));
        else box.append(btn({ label: `Премахни ${cfg.short}`, variant: 'ghost-danger', onClick: () => { st[k1] = true; redraw(); } }));
      }
      box.append(up1.el);
      const hasFirst = (cur && !st[k1]) || up1.file;
      if (hasFirst) {
        const sec = h('div', { class: 'a-field' }, h('span', { class: 'a-label', text: 'Втора страница (по избор)' }));
        if (cfg.cur2) {
          sec.append(h('p', { class: 'a-help', lang, text: `Текуща 2-ра страница: ${cfg.cur2Name}` }));
          if (!up2.file) {
            if (st[k2]) sec.append(alertBox('info', 'Втората страница ще бъде премахната при запазване.'), btn({ label: 'Върни втората страница', variant: 'ghost', onClick: () => { st[k2] = false; redraw(); } }));
            else sec.append(btn({ label: 'Премахни втората страница', variant: 'ghost-danger', onClick: () => { st[k2] = true; redraw(); } }));
          }
        }
        sec.append(up2.el);
        box.append(sec);
      } else if (up2.file) up2.clear();
    }
    let drawing = false;
    function redraw() {
      if (drawing) return;
      drawing = true;
      try { redrawNow(); } finally { drawing = false; }
    }
    function redrawNow() {
      langBox(bgBox, { title: 'Български файл (нов, по избор)', cur: m.fileUrl, curName: m.originalName, cur2: m.file2 && m.file2.fileUrl, cur2Name: m.file2 && m.file2.originalName, up1: uplBg, up2: uplBg2, k1: 'removeBg', k2: 'removeBg2', lang: 'bg', label1: 'Българският файл', short: 'българския файл', removable: false });
      langBox(enBox, { title: 'English файл (по избор)', cur: m.fileEnUrl, curName: m.originalNameEn, cur2: m.fileEn2 && m.fileEn2.fileUrl, cur2Name: m.fileEn2 && m.fileEn2.originalName, up1: uplEnX, up2: uplEnX2, k1: 'removeEn', k2: 'removeEn2', lang: 'en', label1: 'Английският файл', short: 'английския файл', removable: true });
    }
    redraw();
    const body = h('div', { class: 'a-form' }, dateF.el, bgBox, enBox);
    const r = await modal({
      title: 'Редактиране на меню', wide: true, body,
      buttons: [{ label: 'Отказ', value: false, focus: true }, { label: 'Запази', variant: 'primary', value: true, run: async () => {
        dateF.setError('');
        if (!dateF.value) { if (!dateF.validate()) dateF.setError('Изберете дата.'); dateF.input.focus(); return 'keep'; }
        const fd = new FormData();
        fd.append('date', dateF.value);
        if (st.removeEn && !uplEnX.file && !m.fileUrl && !uplBg.file) { enBox.prepend(alertBox('error', 'Менюто трябва да има поне един файл.', { role: 'alert' })); return 'keep'; }
        if (uplBg.file) fd.append('file', uplBg.file);
        if (uplBg2.file) fd.append('file2', uplBg2.file);
        else if (st.removeBg2) fd.append('removeFile2', 'true');
        if (uplEnX.file) fd.append('fileEn', uplEnX.file);
        else if (st.removeEn) { fd.append('removeFileEn', 'true'); if (m.fileEn2) fd.append('removeFileEn2', 'true'); }
        if (uplEnX2.file) fd.append('fileEn2', uplEnX2.file);
        else if (st.removeEn2 && !(st.removeEn && !uplEnX.file)) fd.append('removeFileEn2', 'true');
        const busy = [uplBg, uplBg2, uplEnX, uplEnX2].filter((u) => u.file);
        busy.forEach((u) => u.showProgress(0));
        const up = upload('PUT', `/api/admin/daily-menus/${m.id}`, fd, { onProgress: (p) => busy.forEach((u) => u.showProgress(p)), onSent: () => busy.forEach((u) => u.showProcessing()) });
        abort = up.abort;
        try { await up.promise; } catch (e) {
          busy.forEach((u) => u.hideProgress());
          if (e.code === 'aborted') return 'keep';
          if (e.status === 409) { dateF.setError('На тази дата вече има меню.'); dateF.input.focus(); return 'keep'; }
          if (e.status === 400 && e.fields && e.fields.date) { dateF.setError(e.fields.date); return 'keep'; }
          const f = e.fields || {};
          if ([400, 413, 415].includes(e.status) && (f.file || f.file2 || f.fileEn || f.fileEn2)) {
            const t = f.file ? uplBg : f.file2 ? uplBg2 : f.fileEn ? uplEnX : uplEnX2;
            t.setError(f.file || f.file2 || f.fileEn || f.fileEn2); return 'keep';
          }
          if (e.status === 413 || e.status === 415) { uplBg.setError(e.message); return 'keep'; }
          throw e;
        }
        return undefined;
      } }],
    });
    [uplBg, uplBg2, uplEnX, uplEnX2].forEach((u) => u.clear());
    if (r === true) { toast('Менюто е обновено.'); load(); }
  }

  load(true);
  return { el, destroy() { dead = true; upl.clear(); uplEn.clear(); upl2.clear(); uplEn2w.clear(); } };
}
