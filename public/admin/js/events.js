import { h, icon, clear, formatDateTime, debounce } from './util.js';
import { get, post, put, patch, del, upload } from './api.js';
import { badge, alertBox, btn, iconBtn, skeleton, loadError, emptyState, reportError, toast, confirmDialog, para, makeSwitch, field, errorSummary, createUpload, setBusy, langTabs, EN_HELP } from './ui.js';
import { dateTimeField } from './datetime.js';
import { renderEventCard, previewScroller, langToggle } from './preview.js';

const STATUS = {
  active: ['Активно', 'ok'], scheduled: ['Предстоящо', 'info'], disabled: ['Изключено', 'neutral'], expired: ['Изтекло', 'warn'],
};
const statusBadge = (s) => badge(STATUS[s][0], STATUS[s][1], s === 'disabled' ? 'ring' : undefined);

function showWindow(ev) {
  const from = ev.startsAt ? `от ${formatDateTime(ev.startsAt)}` : 'от веднага';
  const to = ev.expiresAt ? `до ${formatDateTime(ev.expiresAt)}` : 'без крайна дата';
  return `Показва се: ${from} ${to}`;
}

const evTitle = (ev) => ev.title || ev.titleEn || 'Без заглавие';
async function deleteEvent(ev) {
  return confirmDialog({
    title: 'Изтриване на събитие',
    body: para('Сигурни ли сте, че искате да изтриете „', [evTitle(ev)], '“? Снимките също ще бъде изтрита. Това не може да бъде върнато.'),
    confirmLabel: 'Изтрий събитието', danger: true,
    run: async () => { await del(`/api/admin/events/${ev.id}`); },
  });
}

// =============== LIST ===============
export function eventsView() {
  const el = h('div');
  const body = h('div');
  const newBtn = h('a', { href: '#/events/new', class: 'a-btn a-btn--primary' }, icon('plus'), h('span', { text: 'Ново събитие' }));
  el.append(h('div', { class: 'a-pagehead' }, h('h1', { class: 'a-h1', text: 'Събития' }), newBtn), body);
  let events = [];
  let filter = 'all';
  let dead = false;

  async function load() {
    body.replaceChildren(skeleton(3));
    try {
      const r = await get('/api/admin/events');
      if (dead) return;
      events = r.events;
      render();
    } catch (e) { if (!dead) { body.replaceChildren(loadError(null, load)); reportError(e); } }
  }

  function render() {
    clear(body);
    if (!events.length) { body.append(h('div', { class: 'a-card' }, emptyState('Още няма събития.', 'Създайте първото събитие, за да се покаже на сайта.', 'Ново събитие', () => { location.hash = '#/events/new'; }))); return; }
    const count = (s) => events.filter((e) => e.status === s).length;
    const defs = [['all', `Всички (${events.length})`], ['active', `Активни (${count('active')})`], ['scheduled', `Предстоящи (${count('scheduled')})`], ['disabled', `Изключени (${count('disabled')})`], ['expired', `Изтекли (${count('expired')})`]];
    const seg = h('div', { class: 'a-seg a-seg--scroll', role: 'group', 'aria-label': 'Филтър по статус' });
    for (const [k, label] of defs) {
      seg.append(h('button', { type: 'button', class: 'a-seg__btn', 'aria-pressed': String(filter === k), text: label, onclick: () => { filter = k; render(); const b = body.querySelector('[aria-pressed="true"]'); if (b) b.focus(); } }));
    }
    body.append(seg);
    const shown = filter === 'all' ? events : events.filter((e) => e.status === filter);
    if (!shown.length) {
      body.append(h('div', { class: 'a-card a-empty' }, h('p', { class: 'a-empty__title', text: 'Няма събития с този статус.' }), btn({ label: 'Покажи всички', variant: 'secondary', onClick: () => { filter = 'all'; render(); } })));
      return;
    }
    const list = h('div', { class: 'a-list', role: 'list' });
    for (const ev of shown) list.append(row(ev));
    body.append(list);
  }

  function row(ev) {
    const thumb = (ev.imageUrl || ev.imageEnUrl) ? h('img', { class: 'a-thumb', src: ev.imageUrl || ev.imageEnUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'a-thumb a-thumb--tile' }, icon('calendar'));
    const sw = makeSwitch({
      label: `Показвай „${evTitle(ev)}“`, checked: ev.enabled,
      onChange: async (next) => {
        try {
          const u = await patch(`/api/admin/events/${ev.id}/enabled`, { enabled: next });
          Object.assign(ev, u);
          toast(next ? 'Събитието е включено.' : 'Събитието е изключено.');
          setTimeout(render, 0);
        } catch (e) { reportError(e); throw e; }
      },
    });
    const swWrap = h('div', { class: 'a-event__sw' }, sw);
    const note = h('div', { class: 'a-event__note' });
    if (ev.status === 'expired') note.append(h('p', { class: 'a-warn-text', text: 'Изтекъл срок — променете „Скрий след“, за да се покаже отново.' }));
    if (ev.status === 'scheduled' && ev.startsAt) note.append(h('p', { class: 'a-help', text: `Ще се покаже от ${formatDateTime(ev.startsAt)}.` }));
    const info = h('div', { class: 'a-event__info' },
      h('h2', { class: 'a-event__title', text: evTitle(ev) }), statusBadge(ev.status),
      h('p', { class: 'a-help', text: ev.eventAt ? `Събитие: ${formatDateTime(ev.eventAt)}` : 'Без дата на събитието' }),
      h('p', { class: 'a-help', text: showWindow(ev) }));
    const actions = h('div', { class: 'a-event__act' },
      h('a', { href: `#/events/${ev.id}`, class: 'a-btn a-btn--secondary' }, icon('pencil'), h('span', { text: 'Редактирай' })),
      btn({ label: 'Изтрий', variant: 'ghost-danger', icon: 'trash', aria: `Изтрий „${evTitle(ev)}“`, onClick: async () => {
        if (await deleteEvent(ev)) { toast('Събитието е изтрито.'); events = events.filter((x) => x.id !== ev.id); render(); }
      } }));
    return h('article', { class: `a-card a-event${ev.status === 'expired' ? ' is-expired' : ''}`, role: 'listitem' }, thumb, info, swWrap, actions, note);
  }

  load();
  return { el, destroy() { dead = true; } };
}

// =============== FORM ===============
export function eventFormView(ctx) {
  const id = ctx.params.id;
  const isEdit = id !== undefined;
  const el = h('div');
  const head = h('div', { class: 'a-pagehead' }, h('h1', { class: 'a-h1', text: isEdit ? 'Редактиране на събитие' : 'Ново събитие' }));
  el.append(h('a', { href: '#/events', class: 'a-btn a-btn--ghost a-back' }, h('span', { text: '← Към събитията' })), head);
  const body = h('div');
  el.append(body);
  let dead = false;
  let view = { dirty: () => false };

  async function load() {
    if (!isEdit) { build(null); return; }
    body.replaceChildren(skeleton(2));
    try {
      const r = await get('/api/admin/events');
      if (dead) return;
      const ev = r.events.find((e) => e.id === id);
      if (!ev) { body.replaceChildren(h('div', { class: 'a-card' }, alertBox('error', 'Събитието не е намерено.', { role: 'alert' }))); return; }
      build(ev);
    } catch (e) { if (!dead) { body.replaceChildren(loadError(null, load)); reportError(e); } }
  }

  function build(ev) {
    clear(body);
    if (ev) head.append(statusBadge(ev.status));
    const summary = errorSummary();
    let saving = false;
    let saved = false;

    const title = field({ label: 'Заглавие', max: 120, value: ev ? ev.title : '', onInput: () => { if (title.error) vTitle(); refreshD(); }, onBlur: () => vTitle() });
    const desc = field({ label: 'Описание', multiline: true, rows: 6, max: 2000, value: ev ? ev.description : '', helper: 'Обикновен текст. Новите редове се запазват.', onInput: refreshD, onBlur: () => vDesc() });
    const titleEn = field({ label: 'Title (English)', max: 120, value: ev ? ev.titleEn || '' : '', helper: EN_HELP, onInput: () => { if (title.error) vTitle(); refreshD(); } });
    const descEn = field({ label: 'Description (English)', multiline: true, rows: 5, max: 2000, value: ev ? ev.descriptionEn || '' : '', helper: EN_HELP, onInput: refreshD });
    let pvLang = 'bg';
    let langBox = null;
    let langSeg = null;
    const mkDt = (label, key, helper, val) => {
      return dateTimeField({ label, value: val || '', helper, clearable: true, onInput: () => { checkRange(true); refresh(); }, onBlur: () => checkRange(true) });
    };
    const eventAt = mkDt('Дата на събитието', 'eventAt', 'Кога се случва събитието. Показва се на клиентите. Не е задължително.', ev && ev.eventAt);
    const startsAt = mkDt('Показвай от', 'startsAt', 'От кога събитието да се вижда на сайта. Оставете празно, за да се покаже веднага.', ev && ev.startsAt);
    const expiresAt = mkDt('Скрий след', 'expiresAt', 'След този момент събитието изчезва от сайта автоматично. Оставете празно, ако искате да остане, докато го изключите.', ev && ev.expiresAt);
    const enabledSw = makeSwitch({ label: 'Показвай събитието', checked: ev ? ev.enabled : true, onChange: null });
    enabledSw.addEventListener('click', refresh);

    const warnBox = h('div', { class: 'a-warnbox' });

    // images (one per language)
    function imageBlock(lang) {
      const en = lang === 'en';
      const url = ev ? (en ? ev.imageEnUrl : ev.imageUrl) : null;
      const st = { remove: false, abort: null };
      const block = h('div', { class: 'a-field' });
      const existingBox = h('div', { class: 'a-existing' });
      const upl = createUpload({ exts: ['jpg', 'jpeg', 'png', 'webp'], maxMB: 50, imageOnly: true, onChange: () => { sync(); refreshD(); }, onCancel: () => st.abort && st.abort() });
      function sync() {
        clear(existingBox);
        if (url && !st.remove && !upl.file) {
          upl.el.hidden = true;
          existingBox.append(h('img', { class: 'a-existing__img', src: url, alt: en ? 'Текуща английска снимка на събитието' : 'Текуща снимка на събитието' }),
            h('div', { class: 'a-upload__btns' },
              btn({ label: 'Смени снимка', variant: 'secondary', onClick: () => upl.pick() }),
              btn({ label: 'Премахни снимка', variant: 'ghost-danger', onClick: () => { st.remove = true; sync(); refreshD(); } })));
        } else {
          upl.el.hidden = false;
          if (url && st.remove && !upl.file) existingBox.append(alertBox('info', 'Снимката ще бъде премахната при запазване.'), btn({ label: 'Върни снимката', variant: 'ghost', onClick: () => { st.remove = false; sync(); refreshD(); } }));
        }
      }
      block.append(h('span', { class: 'a-label', text: en ? 'Снимка (English)' : 'Снимка' }), existingBox, upl.el,
        h('p', { class: 'a-help', text: en ? 'По избор. Ако е празно, на английската версия се показва българската снимка.' : 'Препоръчваме хоризонтална снимка. На сайта се показва цяла, без изрязване.' }));
      sync();
      return { el: block, upl, st, url, has: () => !!upl.file || (!!url && !st.remove) };
    }
    const imgBg = imageBlock('bg');
    const imgEn = imageBlock('en');
    const upl = imgBg.upl; const uplEn = imgEn.upl;
    langBox = langTabs({
      label: 'Език на събитието',
      panels: { bg: [title.el, desc.el, imgBg.el], en: [titleEn.el, descEn.el, imgEn.el] },
      filled: (l) => (l === 'bg' ? !!(title.value.trim() || desc.value.trim() || imgBg.has()) : !!(titleEn.value.trim() || descEn.value.trim() || imgEn.has())),
      onChange: (l) => { pvLang = l; if (langSeg) langSeg.setLang(l); drawPreview(); },
    });

    // preview
    const frame = h('div', { class: 'preview-frame public-theme w-390' });
    const previewSeg = h('div', { class: 'a-seg', role: 'group', 'aria-label': 'Ширина на прегледа' });
    for (const [w, label] of [['w-390', 'Телефон'], ['w-960', 'Компютър']]) {
      previewSeg.append(h('button', { type: 'button', class: 'a-seg__btn', 'aria-pressed': String(w === 'w-390'), text: label, onclick: (e) => {
        frame.classList.remove('w-390', 'w-960'); frame.classList.add(w);
        previewSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      } }));
    }
    langSeg = langToggle((l) => { pvLang = l; drawPreview(); });
    const previewCard = h('section', { class: 'a-card a-previewcard' }, h('h2', { text: 'Така ще изглежда на сайта' }), previewSeg, langSeg, previewScroller(frame),
      h('p', { class: 'a-help', text: 'Дали е видимо сега зависи от превключвателя и датите.' }));
    function drawPreview() {
      const en = pvLang === 'en';
      const pick = (bg, e) => (en ? (e || bg) : (bg || e));
      const imgOf = (im) => (im.upl.file ? im.upl.url : (im.url && !im.st.remove ? im.url : null));
      const imageUrl = en ? (imgOf(imgEn) || imgOf(imgBg)) : (imgOf(imgBg) || imgOf(imgEn));
      const pt = pick(title.value.trim(), titleEn.value.trim());
      const pd = pick(desc.value.trim() ? desc.value : '', descEn.value.trim() ? descEn.value : '');
      frame.setAttribute('lang', en ? 'en' : 'bg');
      frame.replaceChildren(renderEventCard({ title: pt, description: pd, imageUrl, eventAt: eventAt.value }, en ? 'en' : 'bg'));
      if (langBox) langBox.update();
    }
    const drawDebounced = debounce(drawPreview, 120);
    function refreshD() { drawDebounced(); refresh(); }

    function vTitle() {
      const t = title.value.trim();
      if (!t && !titleEn.value.trim()) { title.setError('Въведете заглавие поне на един език.'); return false; }
      if (t.length > 120) { title.setError('Заглавието е твърде дълго (макс. 120 знака).'); return false; }
      title.setError(''); return true;
    }
    function vDesc() {
      if (desc.value.length > 2000) { desc.setError('Описанието е твърде дълго (макс. 2000 знака).'); return false; }
      desc.setError(''); return true;
    }
    function checkRange(soft) {
      let ok = true;
      if (!expiresAt.hasFormatError) expiresAt.setError('');
      if (startsAt.value && expiresAt.value && expiresAt.value <= startsAt.value) { expiresAt.setError('„Скрий след“ трябва да е по-късно от „Показвай от“.'); ok = false; }
      clear(warnBox);
      if (eventAt.value && expiresAt.value && expiresAt.value < eventAt.value) warnBox.append(alertBox('warning', 'Събитието ще изчезне от сайта, преди да започне.'));
      if (eventAt.value && startsAt.value && startsAt.value > eventAt.value) warnBox.append(alertBox('warning', 'Събитието ще се покаже след като е започнало.'));
      return ok;
    }

    const snapshot = () => JSON.stringify([title.value, desc.value, titleEn.value, descEn.value, eventAt.value, startsAt.value, expiresAt.value, enabledSw.isChecked(), !!upl.file, imgBg.st.remove, !!uplEn.file, imgEn.st.remove]);
    const initial = snapshot();
    function refresh() { drawDebounced(); }
    view.dirty = () => !saved && !saving && snapshot() !== initial;

    const saveBtn = btn({ label: 'Запази', variant: 'primary', type: 'submit' });
    const cancelLink = h('a', { href: '#/events', class: 'a-btn a-btn--secondary' }, h('span', { text: 'Отказ' }));
    const form = h('form', { novalidate: true, class: 'a-card a-formcard' },
      h('p', { class: 'a-help', text: '* задължително' }), summary.el,
      langBox.el, eventAt.el, startsAt.el, expiresAt.el,
      h('p', { class: 'a-help a-tznote', text: 'Всички часове са по българско време.' }), warnBox,
      h('div', { class: 'a-field' }, h('span', { class: 'a-label', text: 'Включено' }), enabledSw, h('p', { class: 'a-help', text: 'Когато е изключено, събитието не се показва на сайта, независимо от датите.' })),
      ev && h('div', { class: 'a-actions' }, btn({ label: 'Изтрий събитието', variant: 'ghost-danger', icon: 'trash', onClick: async () => {
        if (await deleteEvent(ev)) { saved = true; toast('Събитието е изтрито.'); location.hash = '#/events'; }
      } })),
      h('div', { class: 'a-actionbar' }, cancelLink, saveBtn));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (saving) return;
      const errs = [];
      const goto = (f, lang) => () => { langBox.select(lang, false); f.input.focus(); };
      if (!vTitle()) errs.push({ id: title.id, label: 'Заглавие', msg: title.error, focus: goto(title, 'bg') });
      if (titleEn.value.trim().length > 120) { titleEn.setError('Заглавието е твърде дълго (макс. 120 знака).'); errs.push({ id: titleEn.id, label: 'Title (English)', msg: titleEn.error, focus: goto(titleEn, 'en') }); } else titleEn.setError('');
      if (descEn.value.length > 2000) { descEn.setError('Описанието е твърде дълго (макс. 2000 знака).'); errs.push({ id: descEn.id, label: 'Description (English)', msg: descEn.error, focus: goto(descEn, 'en') }); } else descEn.setError('');
      if (!vDesc()) errs.push({ id: desc.id, label: 'Описание', msg: desc.error, focus: goto(desc, 'bg') });
      for (const [f, l] of [[eventAt, 'Дата на събитието'], [startsAt, 'Показвай от'], [expiresAt, 'Скрий след']]) { const m = f.validate(); if (m) errs.push({ id: f.id, label: l, msg: m, focus: () => f.focusInvalid() }); }
      if (!errs.some((x) => x.id === expiresAt.id) && !checkRange()) errs.push({ id: expiresAt.id, label: 'Скрий след', msg: expiresAt.error, focus: () => expiresAt.focusInvalid() });
      if (errs.length) { summary.show(errs); const f0 = errs[0]; if (f0.focus && (f0.id === title.id || f0.id === titleEn.id || f0.id === desc.id || f0.id === descEn.id)) langBox.select(f0.id === titleEn.id || f0.id === descEn.id ? 'en' : 'bg', false); return; }
      summary.hide();
      const fd = new FormData();
      fd.append('title', title.value.trim());
      fd.append('description', desc.value);
      fd.append('titleEn', titleEn.value.trim());
      fd.append('descriptionEn', descEn.value);
      fd.append('eventAt', eventAt.value);
      fd.append('startsAt', startsAt.value);
      fd.append('expiresAt', expiresAt.value);
      fd.append('enabled', String(enabledSw.isChecked()));
      if (upl.file) fd.append('image', upl.file);
      if (imgBg.st.remove && !upl.file) fd.append('removeImage', 'true');
      if (uplEn.file) fd.append('imageEn', uplEn.file);
      if (imgEn.st.remove && !uplEn.file) fd.append('removeImageEn', 'true');
      saving = true;
      setBusy(saveBtn, true);
      const lockables = [...form.querySelectorAll('input,textarea,button')].filter((x) => x !== saveBtn);
      lockables.forEach((x) => { x.disabled = true; });
      cancelLink.setAttribute('aria-disabled', 'true');
      const busyUpl = [upl, uplEn].filter((u) => u.file);
      busyUpl.forEach((u) => u.showProgress(0));
      const up = upload(isEdit ? 'PUT' : 'POST', isEdit ? `/api/admin/events/${id}` : '/api/admin/events', fd, {
        onProgress: (p) => busyUpl.forEach((u) => u.showProgress(p)), onSent: () => busyUpl.forEach((u) => u.showProcessing()),
      });
      imgBg.st.abort = up.abort; imgEn.st.abort = up.abort;
      try {
        await up.promise;
        saved = true;
        toast(isEdit ? 'Промените са запазени.' : 'Събитието е създадено.');
        location.hash = '#/events';
      } catch (err) {
        saving = false;
        setBusy(saveBtn, false);
        lockables.forEach((x) => { x.disabled = false; });
        cancelLink.removeAttribute('aria-disabled');
        busyUpl.forEach((u) => u.hideProgress());
        if (err.code === 'aborted') return;
        handleError(err);
      }
    });

    function handleError(err) {
      if (err.status === 401) return;
      const items = [];
      if ([400, 413, 415].includes(err.status) && err.fields && Object.keys(err.fields).length) {
        const map = { title: [title, 'Заглавие'], description: [desc, 'Описание'], titleEn: [titleEn, 'Title (English)'], descriptionEn: [descEn, 'Description (English)'], eventAt: [eventAt, 'Дата на събитието'], startsAt: [startsAt, 'Показвай от'], expiresAt: [expiresAt, 'Скрий след'] };
        for (const [k, msg] of Object.entries(err.fields)) {
          const m = map[k];
          if (m) { const lg = (m[0] === titleEn || m[0] === descEn) ? 'en' : 'bg'; m[0].setError(msg); items.push({ id: m[0].id, label: m[1], msg, focus: lg ? () => { langBox.select(lg, false); m[0].input.focus(); } : undefined }); } else if (k === 'imageEn') { uplEn.setError(msg); langBox.select('en', false); items.push({ id: title.id, label: 'Снимка (English)', msg, focus: () => { langBox.select('en', false); } }); } else if (k === 'image') { upl.setError(msg); langBox.select('bg', false); items.push({ id: title.id, label: 'Снимка', msg }); } else items.push({ id: title.id, msg });
        }
        summary.show(items);
        const first = Object.keys(err.fields)[0];
        if (first === 'titleEn' || first === 'descriptionEn' || first === 'imageEn') langBox.select('en', false); else if (first === 'title' || first === 'description' || first === 'image') langBox.select('bg', false);
      } else if (err.status === 413 || err.status === 415) {
        upl.setError(err.message); langBox.select('bg', false);
        summary.show([{ id: title.id, label: 'Снимка', msg: err.message }]);
      } else if (err.code === 'network') {
        toast('Няма връзка. Промените не са записани.', { type: 'err' });
      } else {
        summary.show([{ id: title.id, msg: err.message }], 'Записът не успя:');
      }
    }

    const layout = h('div', { class: 'a-evform' }, form, previewCard);
    body.append(layout);
    drawPreview();
  }

  load();
  return { el, dirty: () => view.dirty(), destroy() { dead = true; } };
}
