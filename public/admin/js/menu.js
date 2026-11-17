import { h, icon, clear, formatSize, kindLabel, formatStamp, centsToInput, parsePrice, nextId } from './util.js';
import { get, post, put, patch, del, upload } from './api.js';
import { badge, alertBox, btn, iconBtn, skeleton, loadError, emptyState, reportError, toast, modal, confirmDialog, para, makeSwitch, field, errorSummary, createUpload, filePreview, setBusy, langTabs, EN_HELP } from './ui.js';
import { renderMenuPreview, previewScroller, langToggle } from './preview.js';

const MODE_LABEL = { structured: 'Структурирано меню', file: 'Файл' };
const MAX_CATS = 50;
const MAX_ITEMS = 200;

export function menuView() {
  const el = h('div');
  el.append(h('h1', { class: 'a-h1', text: 'Основно меню' }));
  const body = h('div');
  el.append(body);
  let dead = false;
  let data = null;      // last server state (mode, symbol, files, published, hasUnpublishedChanges)
  let seq = 0;
  let cats = [];        // local draft
  let saved = '';       // serialised saved draft
  let errors = {};      // key -> message
  let tab = 'structured';
  let lang = 'bg';      // editor language tab (bg | en)
  let langBox = null;
  let guardActive = true;

  const view = { dirty: () => false };
  const symbol = () => (data ? data.currencySymbol : '€');

  const mkItem = (it) => ({ k: ++seq, id: it.id, name: it.name || '', nameEn: it.nameEn || '', description: it.description || '', descriptionEn: it.descriptionEn || '', price: centsToInput(it.priceCents), available: it.available !== false });
  const mkCat = (c, open) => ({ k: ++seq, id: c.id, name: c.name || '', nameEn: c.nameEn || '', open, items: (c.items || []).map(mkItem) });
  const wide = () => window.matchMedia('(min-width: 1024px)').matches;
  const fromDraft = (draft) => draft.categories.map((c, i) => mkCat(c, wide() || i === 0));
  const serialize = () => JSON.stringify(cats.map((c) => [c.name, c.nameEn, c.items.map((i) => [i.name, i.nameEn, i.description, i.descriptionEn, i.price.trim(), i.available])]));
  const isDirty = () => serialize() !== saved;
  const hasLang = (l) => { const k = l === 'en' ? 'nameEn' : 'name'; return cats.some((c) => c[k].trim() || c.items.some((i) => i[k].trim())); };
  const setLang = (l) => { if (l !== lang) { lang = l; if (langBox) langBox.select(l, false, true); } };
  const keyLang = (key) => (/\.(nameEn|descriptionEn)$/.test(key) ? 'en' : /\.description$/.test(key) ? 'bg' : null);
  // switch the language tab to one that actually contains an error field
  const focusErrLang = (keys) => {
    if (keys.some((k) => { const l = keyLang(k); return !l || l === lang; })) return;
    const l = keyLang(keys[0] || ''); if (l) setLang(l);
  };

  async function load(first) {
    if (first) body.replaceChildren(skeleton(3));
    try {
      const r = await get('/api/admin/menu');
      if (dead) return;
      data = r;
      cats = fromDraft(r.draft);
      saved = serialize();
      tab = r.mode;
      build();
    } catch (e) { if (!dead) { body.replaceChildren(loadError(null, () => load(true))); reportError(e); } }
  }

  async function refreshMeta() {
    try {
      const r = await get('/api/admin/menu');
      data.mode = r.mode; data.published = r.published; data.hasUnpublishedChanges = r.hasUnpublishedChanges; data.files = r.files; data.draft.updatedAt = r.draft.updatedAt;
      renderStatus(); renderModeCard(); renderTabs(); renderFiles();
    } catch (e) { reportError(e); }
  }

  // ---------------------------------------------------------------- layout
  let modeHost; let tabsHost; let structPanel; let filePanel; let statusHost; let editorHost; let summary; let announcer; let fileHost; let tabBar;
  function build() {
    clear(body);
    modeHost = h('section', { class: 'a-card', 'aria-labelledby': 'mode-h' });
    tabBar = h('div', { class: 'a-tabs', role: 'tablist', 'aria-label': 'Редактиране' });
    tabsHost = h('div');
    statusHost = h('div', { class: 'a-statusbar' });
    summary = errorSummary();
    editorHost = h('div', { class: 'a-editor' });
    announcer = h('p', { class: 'a-vh', 'aria-live': 'polite' });
    langBox = langTabs({
      label: 'Език на имената и описанията', shared: [h('p', { class: 'a-help', text: 'Цени, наличност и подредба са общи за двата езика. Име — задължително поне на един език.' }), editorHost],
      filled: (l) => hasLang(l),
      onChange: (l) => { lang = l; renderEditor(); },
    });
    structPanel = h('div', { role: 'tabpanel', id: 'panel-structured', 'aria-labelledby': 'tab-structured' }, statusHost, summary.el, langBox.el, announcer);
    fileHost = h('div');
    filePanel = h('div', { role: 'tabpanel', id: 'panel-file', 'aria-labelledby': 'tab-file' }, fileHost);
    body.append(modeHost, h('section', { class: 'a-card a-card--flush' }, h('h2', { class: 'a-pad', text: 'Редактиране' }), tabBar, tabsHost, structPanel, filePanel));
    renderModeCard(); renderTabs(); renderStatus(); renderEditor(); renderFiles(); showTab();
  }

  // ---------------------------------------------------------------- mode
  let modeAlert = null;
  async function changeMode(target) {
    let ok = false;
    const confirmed = await confirmDialog({
      title: 'Смяна на менюто на сайта', body: para('Клиентите ще започнат да виждат: ', [MODE_LABEL[target]], '.'),
      confirmLabel: 'Покажи на сайта',
      run: async () => {
        try { await put('/api/admin/menu/mode', { mode: target }); ok = true; } catch (e) {
          if (e.code === 'nothing_published') { modeAlert = `Не можете да превключите — няма публикувано ${target === 'file' ? 'файл' : 'структурирано меню'}. Публикувайте първо.`; return; }
          throw e;
        }
      },
    });
    if (confirmed && ok) { data.mode = target; modeAlert = null; toast(`Клиентите виждат: ${MODE_LABEL[target]}.`); renderModeCard(); renderTabs(); showTab(); }
    else { if (confirmed && modeAlert) { renderModeCard(); const a = modeHost.querySelector('[role="alert"]'); if (a) a.focus(); } else renderModeCard(); }
  }

  function renderModeCard() {
    clear(modeHost);
    const grp = h('div', { class: 'a-radios', role: 'radiogroup', 'aria-labelledby': 'mode-h' });
    const defs = [['structured', 'Структурирано меню', 'Ястия по категории с цени. Лесно за редактиране и четене на телефон.'], ['file', 'Файл', 'Качена снимка или PDF на цялото ви меню.']];
    for (const [val, title, text] of defs) {
      const id = nextId('mode');
      const input = h('input', { type: 'radio', name: 'live-mode', id, value: val, class: 'a-radio__input' });
      input.checked = data.mode === val;
      input.addEventListener('change', () => { if (input.checked && val !== data.mode) { modeAlert = null; changeMode(val); } });
      const sel = data.mode === val;
      grp.append(h('label', { class: `a-radio${sel ? ' is-selected' : ''}`, for: id }, input,
        h('span', { class: 'a-radio__body' }, h('strong', { text: title }), h('span', { text }), sel && h('span', { class: 'a-radio__live' }, icon('check'), 'Показва се на сайта'))));
    }
    modeHost.append(h('h2', { id: 'mode-h', text: 'Какво виждат клиентите?' }), grp);
    if (modeAlert) modeHost.append(alertBox('error', modeAlert, { role: 'alert' }));
    modeHost.querySelectorAll('[role="alert"]').forEach((a) => { a.tabIndex = -1; });
    modeHost.append(alertBox('info', 'Клиентите виждат само публикуваната версия. Промените в чернова не се показват, докато не натиснете „Публикувай“.'));
    // radios: after re-render keep focus on the selected radio is handled by user; set revert
    grp.querySelectorAll('input').forEach((i) => { i.checked = i.value === data.mode; });
  }

  // ---------------------------------------------------------------- tabs
  function renderTabs() {
    clear(tabBar);
    for (const key of ['structured', 'file']) {
      const t = h('button', { type: 'button', role: 'tab', id: `tab-${key}`, class: 'a-tab', 'aria-selected': String(tab === key), 'aria-controls': `panel-${key}`, tabindex: tab === key ? '0' : '-1' },
        h('span', { text: MODE_LABEL[key] }), data.mode === key && h('span', { class: 'a-badge a-badge--ok a-badge--sm' }, 'На сайта'));
      t.addEventListener('click', () => { tab = key; renderTabs(); showTab(); });
      t.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { tab = key === 'structured' ? 'file' : 'structured'; renderTabs(); showTab(); document.getElementById(`tab-${tab}`).focus(); }
      });
      tabBar.append(t);
    }
  }

  function showTab() {
    structPanel.hidden = tab !== 'structured';
    filePanel.hidden = tab !== 'file';
    clear(tabsHost);
    if (tab !== data.mode) {
      tabsHost.append(alertBox('warning', [h('strong', { text: `Това меню не се показва на сайта в момента. Активно е: ${MODE_LABEL[data.mode]}.` }), ' ',
        btn({ label: 'Покажи това на сайта', variant: 'secondary', onClick: () => changeMode(tab) })], { cls: 'a-alert--inline' }));
    }
  }

  // ---------------------------------------------------------------- validation
  const vName = (s) => { const t = s.trim(); return !t ? 'Въведете име.' : t.length > 100 ? 'Максимум 100 знака.' : ''; };
  const vPrice = (s) => { const c = parsePrice(s); return c === null ? 'Въведете цена, например 12,50.' : c > 10000000 ? 'Цената е твърде висока.' : ''; };
  const vNameEn = (s) => (s.trim().length > 100 ? 'Максимум 100 знака.' : '');
  // name rules: at least one language, max 100 each. Returns { name?, nameEn? } (required error lives under "name").
  const nameErrs = (o) => {
    const e = {};
    if (!o.name.trim() && !o.nameEn.trim()) e.name = 'Въведете име поне на един език.';
    else { if (o.name.trim().length > 100) e.name = 'Максимум 100 знака.'; if (o.nameEn.trim().length > 100) e.nameEn = 'Максимум 100 знака.'; }
    return e;
  };
  const shownNameErr = (o, pre, L) => (L === 'en' ? (errors[`${pre}nameEn`] || (errors[`${pre}name`] && !o.name.trim() && !o.nameEn.trim() ? errors[`${pre}name`] : '')) : errors[`${pre}name`] || '');
  const recheckName = (o, pre) => { const e = nameErrs(o); for (const k of ['name', 'nameEn']) { if (e[k]) errors[`${pre}${k}`] = e[k]; else delete errors[`${pre}${k}`]; } };
  const vDesc = (s) => (s.length > 500 ? 'Максимум 500 знака.' : '');

  function validateAll() {
    errors = {};
    const list = [];
    cats.forEach((c, ci) => {
      let bad = false;
      const ne = nameErrs(c);
      for (const [f, lab] of [['name', `Категория ${ci + 1}`], ['nameEn', `Категория ${ci + 1} — Име (английски)`]]) if (ne[f]) { errors[`c${c.k}.${f}`] = ne[f]; list.push({ cat: c, key: `c${c.k}.${f}`, label: lab, msg: ne[f] }); bad = true; }
      c.items.forEach((it, ii) => {
        const ie = nameErrs(it);
        for (const [f, fn, val, lab] of [['name', () => ie.name || '', it.name, 'Име'], ['price', vPrice, it.price, 'Цена'], ['description', vDesc, it.description, 'Описание'], ['nameEn', () => ie.nameEn || '', it.nameEn, 'Име (английски)'], ['descriptionEn', vDesc, it.descriptionEn, 'Описание (английски)']]) {
          const mm = fn(val);
          if (mm) { errors[`i${it.k}.${f}`] = mm; list.push({ cat: c, key: `i${it.k}.${f}`, label: `${(c.name.trim() || c.nameEn.trim()) || `Категория ${ci + 1}`}, ястие ${ii + 1} — ${lab}`, msg: mm }); bad = true; }
        }
      });
      if (bad) c.open = true;
    });
    return list;
  }

  const ids = {}; // key -> element id of the input (filled during render)
  function validateAndShow() {
    const list = validateAll();
    if (!list.length) { summary.hide(); return true; }
    focusErrLang(list.map((x) => x.key));
    renderEditor();
    summary.show(list.map((x) => ({ id: ids[x.key], label: x.label, msg: x.msg })).filter((x) => x.id));
    return false;
  }

  // ---------------------------------------------------------------- persistence
  function payload() {
    return {
      categories: cats.map((c) => ({
        ...(c.id ? { id: c.id } : {}), name: c.name.trim(), nameEn: c.nameEn.trim(),
        items: c.items.map((i) => ({ ...(i.id ? { id: i.id } : {}), name: i.name.trim(), nameEn: i.nameEn.trim(), description: i.description, descriptionEn: i.descriptionEn, priceCents: parsePrice(i.price), available: i.available })),
      })),
    };
  }

  function mapServerFields(fields) {
    errors = {};
    const list = [];
    for (const [path, msg] of Object.entries(fields || {})) {
      const m = /^categories\[(\d+)\](?:\.items\[(\d+)\])?\.(\w+)$/.exec(path);
      if (!m) { list.push({ id: null, msg }); continue; }
      const c = cats[+m[1]]; if (!c) continue;
      c.open = true;
      let key;
      if (m[2] === undefined) key = `c${c.k}.${m[3]}`;
      else { const it = c.items[+m[2]]; if (!it) continue; key = `i${it.k}.${m[3] === 'priceCents' ? 'price' : m[3]}`; }
      errors[key] = msg; list.push({ key, msg });
    }
    return list;
  }

  async function persist() {
    try {
      const res = await put('/api/admin/menu/draft', payload());
      // assign server ids in place (order is preserved)
      res.categories.forEach((rc, ci) => {
        const c = cats[ci]; if (!c) return;
        c.id = rc.id;
        rc.items.forEach((ri, ii) => { if (c.items[ii]) c.items[ii].id = ri.id; });
      });
      saved = serialize();
      data.draft.updatedAt = res.updatedAt;
      guardActive = true;
      renderStatus();
      await refreshMeta();
    } catch (e) {
      if (e.status === 400 && e.fields) {
        const list = mapServerFields(e.fields);
        focusErrLang(list.filter((x) => x.key).map((x) => x.key));
        renderEditor();
        summary.show(list.map((x) => ({ id: x.key ? ids[x.key] : null, msg: x.msg })).map((x) => ({ id: x.id || 'main', msg: x.msg })));
        e.handled = true;
      }
      throw e;
    }
  }

  async function saveDraftClick(button) {
    if (!validateAndShow()) return false;
    setBusy(button, true);
    try {
      const differs = true;
      await persist();
      toast(differs && data.hasUnpublishedChanges ? 'Чернавата е запазена. Клиентите още виждат старата версия.' : 'Чернавата е запазена.');
      return true;
    } catch (e) { if (!e.handled) reportError(e); else toast('Не можа да се запази. Проверете маркираните полета.', { type: 'err' }); return false; } finally { setBusy(button, false); renderStatus(); }
  }

  view.saveDraft = async () => {
    if (!validateAndShow()) return false;
    try { await persist(); toast('Чернавата е запазена.'); return true; } catch (e) { if (!e.handled) reportError(e); return false; }
  };

  async function publishClick() {
    if (isDirty() && !validateAndShow()) return;
    const fileMode = data.mode === 'file';
    await confirmDialog({
      title: 'Публикуване на менюто',
      body: para(fileMode ? 'Менюто няма да се покаже на сайта, докато не изберете „Структурирано меню“ по-горе.' : 'Промените ще се покажат веднага на сайта.'),
      confirmLabel: 'Публикувай',
      run: async () => {
        if (isDirty()) await persist();
        await post('/api/admin/menu/publish');
        toast('Менюто е публикувано.');
        await refreshMeta();
      },
    });
    renderStatus();
  }

  async function discardClick() {
    const never = !data.published;
    const ok = await confirmDialog({
      title: 'Отказване на промените',
      body: para(never ? 'Чернавата ще се изчисти напълно. Всички промени след последното публикуване ще бъдат изгубени.' : 'Чернавата ще се върне към последно публикуваната версия. Всички промени след нея ще бъдат изгубени.'),
      confirmLabel: 'Откажи промените', danger: true,
      run: async () => {
        const d = await post('/api/admin/menu/draft/discard');
        cats = fromDraft(d); saved = serialize(); errors = {}; summary.hide();
      },
    });
    if (ok) { toast('Промените са отказани.'); renderEditor(); await refreshMeta(); }
  }

  function previewClick() {
    const model = (en) => cats.map((c) => ({ name: en ? (c.nameEn.trim() || c.name.trim()) : (c.name.trim() || c.nameEn.trim()), items: c.items.map((i) => ({ name: en ? (i.nameEn.trim() || i.name.trim()) : (i.name.trim() || i.nameEn.trim()), description: en ? (i.descriptionEn.trim() ? i.descriptionEn : i.description) : (i.description.trim() ? i.description : i.descriptionEn), priceCents: parsePrice(i.price) || 0, available: i.available })) }));
    const frame = h('div', { class: 'preview-frame public-theme w-390' });
    const seg = h('div', { class: 'a-seg', role: 'group', 'aria-label': 'Ширина на прегледа' });
    for (const [wc, label] of [['w-390', 'Телефон'], ['w-960', 'Компютър']]) {
      seg.append(h('button', { type: 'button', class: 'a-seg__btn', 'aria-pressed': String(wc === 'w-390'), text: label, onclick: (e) => {
        frame.classList.remove('w-390', 'w-960'); frame.classList.add(wc);
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      } }));
    }
    const draw = (l) => { frame.setAttribute('lang', l); frame.replaceChildren(renderMenuPreview(model(l === 'en'), symbol(), l)); };
    draw('bg');
    const langSeg = langToggle(draw);
    modal({ title: 'Преглед за клиенти', wide: true, body: [alertBox('info', `Това е преглед на чернова.${isDirty() ? ' Съдържа незапазени промени.' : ''}`), seg, langSeg, previewScroller(frame)], buttons: [{ label: 'Затвори', focus: true }] });
  }

  // ---------------------------------------------------------------- status bar
  let btns = {};
  function renderStatus() {
    if (!statusHost) return;
    const dirty = isDirty();
    clear(statusHost);
    let b;
    if (dirty) b = badge('Незапазени промени', 'danger', 'dot');
    else if (data.hasUnpublishedChanges || !data.published) b = badge('Чернова — не е публикувано', 'warn', 'pencil');
    else b = badge('Публикувано', 'ok');
    const info = h('div', { class: 'a-statusbar__info' }, b);
    if (!dirty && !data.hasUnpublishedChanges && data.published) info.append(h('span', { class: 'a-help', text: `от ${formatStamp(data.published.publishedAt)}` }));
    btns.save = btn({ label: 'Запази чернова', variant: 'secondary', onClick: () => saveDraftClick(btns.save) });
    btns.pub = btn({ label: 'Публикувай', variant: 'primary', onClick: publishClick });
    btns.discard = btn({ label: 'Откажи промените', variant: 'ghost-danger', onClick: discardClick });
    btns.preview = btn({ label: 'Преглед', variant: 'secondary', icon: 'eye', onClick: previewClick });
    btns.save.disabled = !dirty;
    btns.pub.disabled = !(dirty || data.hasUnpublishedChanges);
    btns.discard.disabled = !(dirty || data.hasUnpublishedChanges);
    statusHost.append(info, h('div', { class: 'a-statusbar__btns' }, btns.save, btns.pub, btns.discard, btns.preview));
    if (data.mode === 'file') statusHost.append(h('p', { class: 'a-help a-statusbar__note', text: 'Публикуването запазва версията, но клиентите виждат файла, докато не смените режима.' }));
  }

  const changed = () => { renderStatus(); if (langBox) langBox.update(); };

  // ---------------------------------------------------------------- editor
  function announce(text) { announcer.textContent = ''; setTimeout(() => { announcer.textContent = text; }, 30); }

  function move(arr, idx, dir, focusPrefix, k, label) {
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    const wanted = dir < 0 ? 'up' : 'down';
    const atEnd = j === 0 && dir < 0 || j === arr.length - 1 && dir > 0;
    renderEditor(`${focusPrefix}-${k}-${atEnd ? (wanted === 'up' ? 'down' : 'up') : wanted}`);
    announce(`Преместено: позиция ${j + 1} от ${arr.length}.`);
    changed();
    const f = editorHost.querySelector(`[data-fk="${focusPrefix}-${k}-${atEnd ? (wanted === 'up' ? 'down' : 'up') : wanted}"]`);
    if (f) f.scrollIntoView({ block: 'nearest' });
    void label;
  }

  function renderEditor(focusKey) {
    clear(editorHost);
    Object.keys(ids).forEach((k) => delete ids[k]);
    if (!cats.length) {
      editorHost.append(h('div', { class: 'a-card a-card--flat' }, emptyState('Менюто е празно.', 'Добавете първата категория, например „Салати“.', 'Добави категория', addCat)));
    }
    cats.forEach((c, ci) => editorHost.append(catCard(c, ci)));
    if (cats.length) {
      const add = btn({ label: 'Добави категория', variant: 'secondary', icon: 'plus', cls: 'a-btn--block a-btn--outline', onClick: addCat });
      if (cats.length >= MAX_CATS) { add.disabled = true; editorHost.append(add, h('p', { class: 'a-error' }, icon('alert'), h('span', { text: 'Най-много 50 категории.' }))); } else editorHost.append(add);
    }
    if (langBox) langBox.update();
    if (focusKey) { const f = editorHost.querySelector(`[data-fk="${focusKey}"]`); if (f) f.focus(); }
  }

  function addCat() {
    const c = mkCat({ name: '', items: [] }, true);
    cats.push(c);
    renderEditor(`cat-${c.k}-name`);
    changed();
  }

  function catCard(c, ci) {
    const bodyId = nextId('catbody');
    const L = lang;
    const nk = L === 'en' ? 'nameEn' : 'name';
    let touched = !!c[nk];
    const pre = `c${c.k}.`;
    const catLabel = () => (c.name || '').trim() || (c.nameEn || '').trim() || 'Без име';
    const labelled = [];
    const relabel = () => labelled.forEach(([el, fn]) => el.setAttribute('aria-label', fn()));
    const nameF = field({ label: L === 'en' ? 'Category name (English)' : 'Име на категория', hideLabel: true, max: 100, value: c[nk], placeholder: L === 'en' ? (c.name || 'Category name, e.g. Salads') : (c.nameEn ? c.nameEn : 'Име на категория, напр. Салати'), cls: 'a-cat__name',
      onInput: () => { touched = true; c[nk] = nameF.value; relabel(); if (errors[`${pre}name`] || errors[`${pre}nameEn`]) { recheckName(c, pre); nameF.setError(shownNameErr(c, pre, L)); } changed(); },
      onBlur: () => { if (!touched && !errors[`${pre}name`] && !errors[`${pre}nameEn`]) return; recheckName(c, pre); nameF.setError(shownNameErr(c, pre, L)); } });
    nameF.input.dataset.fk = `cat-${c.k}-name`;
    nameF.input.setAttribute('aria-label', L === 'en' ? 'Име на категория на английски' : 'Име на категория');
    ids[`${pre}name`] = nameF.id; ids[`${pre}${nk}`] = nameF.id;
    nameF.setError(shownNameErr(c, pre, L));
    const toggle = h('button', { type: 'button', class: 'a-btn a-btn--icon a-chev', 'aria-expanded': String(c.open), 'aria-controls': bodyId, 'aria-label': `${c.open ? 'Свий' : 'Разгъни'} категорията`, 'data-fk': `cat-${c.k}-toggle` }, icon('chevron'));
    const bodyEl = h('div', { class: 'a-cat__body', id: bodyId, hidden: !c.open });
    toggle.addEventListener('click', () => {
      c.open = !c.open; bodyEl.hidden = !c.open; toggle.setAttribute('aria-expanded', String(c.open));
      relabel(); toggle.classList.toggle('is-open', c.open);
    });
    toggle.classList.toggle('is-open', c.open);
    const up = iconBtn({ ic: 'arrow-up', aria: 'Премести категорията нагоре', onClick: () => move(cats, cats.indexOf(c), -1, 'cat', c.k) });
    const down = iconBtn({ ic: 'arrow-down', aria: 'Премести категорията надолу', onClick: () => move(cats, cats.indexOf(c), 1, 'cat', c.k) });
    up.dataset.fk = `cat-${c.k}-up`; down.dataset.fk = `cat-${c.k}-down`;
    labelled.push([up, () => `Премести „${catLabel()}“ нагоре`], [down, () => `Премести „${catLabel()}“ надолу`]);
    up.disabled = ci === 0; down.disabled = ci === cats.length - 1;
    const delBtn = iconBtn({ ic: 'trash', aria: 'Изтрий категорията', cls: 'a-btn--icon-danger', onClick: async () => {
      const untouched = !c.id && !c.name.trim() && !c.nameEn.trim() && !c.items.length;
      if (!untouched) {
        const ok = await confirmDialog({ title: 'Изтриване на категория', body: c.items.length ? para('Изтриване на „', [catLabel()], `“ и всичките му ${c.items.length} ястия?`) : para('Изтриване на „', [catLabel()], '“?'), confirmLabel: 'Изтрий категорията', danger: true });
        if (!ok) return;
      }
      cats.splice(cats.indexOf(c), 1);
      renderEditor(cats.length ? 'cat-' + cats[Math.min(ci, cats.length - 1)].k + '-name' : null); changed();
    } });
    labelled.push([delBtn, () => `Изтрий категорията „${catLabel()}“`], [toggle, () => `${c.open ? 'Свий' : 'Разгъни'} категорията „${catLabel()}“`]);
    relabel();
    const count = h('span', { class: 'a-help a-cat__count', text: `(${c.items.length} ${c.items.length === 1 ? 'ястие' : 'ястия'})` });
    const head = h('div', { class: 'a-cat__head' }, nameF.el, h('div', { class: 'a-cat__btns' }, toggle, count, up, down, delBtn));
    c.items.forEach((it, ii) => bodyEl.append(dishCard(c, it, ii)));
    const addDish = btn({ label: 'Добави ястие', variant: 'secondary', icon: 'plus', cls: 'a-btn--block', onClick: () => {
      const it = mkItem({ name: '', description: '', priceCents: 0, available: true });
      c.items.push(it); c.open = true; renderEditor(`dish-${it.k}-name`); changed();
    } });
    if (c.items.length >= MAX_ITEMS) { addDish.disabled = true; bodyEl.append(addDish, h('p', { class: 'a-error' }, icon('alert'), h('span', { text: 'Най-много 200 ястия в категория.' }))); } else bodyEl.append(addDish);
    return h('section', { class: 'a-card a-cat' }, head, bodyEl);
  }

  function dishCard(c, it, ii) {
    const ek = (f) => `i${it.k}.${f}`;
    let relabelDish = () => {};
    const L = lang;
    const nk = L === 'en' ? 'nameEn' : 'name';
    const dk = L === 'en' ? 'descriptionEn' : 'description';
    const pre = `i${it.k}.`;
    const dishLabel = () => (it.name || '').trim() || (it.nameEn || '').trim() || 'Без име';
    const touched = {}; for (const f of ['name', 'price', 'description', 'nameEn', 'descriptionEn']) touched[f] = !!it[f];
    const showName = (a) => a.setError(shownNameErr(it, pre, L));
    const onName = (a) => {
      touched[nk] = true; it[nk] = a.value; relabelDish();
      if (errors[ek('name')] || errors[ek('nameEn')]) { recheckName(it, pre); showName(a); }
      changed();
    };
    const mk = (f, fn, setter) => (a) => {
      touched[f] = true;
      setter(a.value);
      if (errors[ek(f)]) { const m = fn(a.value); if (m) errors[ek(f)] = m; else delete errors[ek(f)]; a.setError(m); }
      changed();
    };
    const blur = (f, fn) => (a) => { if (!touched[f] && !errors[ek(f)]) return; const m = fn(a.value); if (m) errors[ek(f)] = m; else delete errors[ek(f)]; a.setError(m); };
    const nameF = field({ label: L === 'en' ? 'Dish name (English)' : 'Име на ястието', max: 100, value: it[nk], placeholder: L === 'en' ? it.name : it.nameEn, helper: L === 'en' ? 'По избор. Ако е празно, се показва българското име.' : undefined, onInput: onName,
      onBlur: (a) => { if (!touched.name && !touched.nameEn && !errors[ek('name')] && !errors[ek('nameEn')]) return; recheckName(it, pre); showName(a); } });
    nameF.input.dataset.fk = `dish-${it.k}-name`;
    const priceF = field({ label: 'Цена', inputmode: 'decimal', value: it.price, suffix: symbol(), helper: '0 или празно = без цена', cls: 'a-price', onInput: mk('price', vPrice, (v) => { it.price = v; }), onBlur: blur('price', vPrice) });
    const descF = field({ label: L === 'en' ? 'Description (English)' : 'Описание', multiline: true, rows: 2, max: 500, value: it[dk], placeholder: L === 'en' ? it.description : it.descriptionEn, helper: L === 'en' ? EN_HELP : undefined, onInput: mk(dk, vDesc, (v) => { it[dk] = v; }), onBlur: blur(dk, vDesc) });
    ids[ek('name')] = nameF.id; ids[ek(nk)] = nameF.id; ids[ek('price')] = priceF.id; ids[ek(dk)] = descF.id;
    showName(nameF);
    for (const [f, a] of [['price', priceF], [dk, descF]]) if (errors[ek(f)]) a.setError(errors[ek(f)]);
    const offHelp = h('p', { class: 'a-help', hidden: it.available, text: 'Показва се като „Няма в наличност“' });
    const sw = makeSwitch({ label: `Налично: ${dishLabel()}`, checked: it.available });
    sw.addEventListener('click', () => { it.available = sw.isChecked(); offHelp.hidden = it.available; changed(); });
    const up = iconBtn({ ic: 'arrow-up', aria: 'Премести ястието нагоре', onClick: () => move(c.items, c.items.indexOf(it), -1, 'dish', it.k) });
    const down = iconBtn({ ic: 'arrow-down', aria: 'Премести ястието надолу', onClick: () => move(c.items, c.items.indexOf(it), 1, 'dish', it.k) });
    up.dataset.fk = `dish-${it.k}-up`; down.dataset.fk = `dish-${it.k}-down`;
    up.setAttribute('aria-label', `Премести „${dishLabel()}“ нагоре`); down.setAttribute('aria-label', `Премести „${dishLabel()}“ надолу`);
    up.disabled = ii === 0; down.disabled = ii === c.items.length - 1;
    const del2 = btn({ label: 'Изтрий', variant: 'ghost-danger', icon: 'trash', aria: `Изтрий ястието „${dishLabel()}“`, onClick: async () => {
      const untouched = !it.id && !it.name.trim() && !it.price.trim() && !it.description.trim() && !it.nameEn.trim() && !it.descriptionEn.trim();
      if (!untouched) {
        const ok = await confirmDialog({ title: 'Изтриване на ястие', body: para('Изтриване на „', [it.name.trim() || 'Без име'], '“?'), confirmLabel: 'Изтрий ястието', danger: true });
        if (!ok) return;
      }
      c.items.splice(c.items.indexOf(it), 1); renderEditor(`cat-${c.k}-toggle`); changed();
    } });
    relabelDish = () => {
      const n = dishLabel();
      sw.setAttribute('aria-label', `Налично: ${n}`); up.setAttribute('aria-label', `Премести „${n}“ нагоре`);
      down.setAttribute('aria-label', `Премести „${n}“ надолу`); del2.setAttribute('aria-label', `Изтрий ястието „${n}“`);
    };
    return h('div', { class: 'a-dish' }, h('div', { class: 'a-dish__top' }, nameF.el, priceF.el), descF.el, h('div', { class: 'a-dish__bottom' }, h('div', null, sw, offHelp), h('div', { class: 'a-dish__act' }, up, down, del2)));
  }

  // ---------------------------------------------------------------- files
  let fileAlert = null;
  const LANG_NAME = { bg: 'Български файл', en: 'English файл' };
  const fileLang = (f) => (f.lang === 'en' ? 'en' : 'bg');
  function renderFiles() {
    if (!fileHost) return;
    clear(fileHost);
    fileHost.append(h('h3', { class: 'a-sub', text: 'Файлове на менюто' }));
    if (fileAlert) fileHost.append(alertBox('error', fileAlert, { role: 'alert' }));
    fileHost.append(h('p', { class: 'a-help', text: 'За всеки език може да е публикуван по един файл. Ако няма файл за избрания език, клиентите виждат другия.' }));
    for (const l of ['bg', 'en']) fileHost.append(fileSection(l));
  }

  function fileSection(l) {
    const sec = h('section', { class: 'a-fileslang', 'aria-labelledby': `files-h-${l}`, lang: l });
    sec.append(h('h4', { id: `files-h-${l}`, text: LANG_NAME[l] }));
    const files = data.files.filter((f) => fileLang(f) === l);
    const box = h('div', { class: 'a-filebox' });
    const extra = h('div');
    let abort = null;
    const upl = createUpload({ exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], maxMB: 15, onCancel: () => abort && abort(),
      onChange: () => { clear(extra); if (!upl.file) return; extra.append(filePreview(upl), h('div', { class: 'a-actionrow' }, btn({ label: 'Отказ', variant: 'secondary', onClick: () => upl.clear() }), uploadBtn)); } });
    const uploadBtn = btn({ label: l === 'en' ? 'Качи английски файл' : 'Качи български файл', variant: 'primary', onClick: async () => {
      const fd = new FormData(); fd.append('file', upl.file); fd.append('lang', l);
      upl.showProgress(0); setBusy(uploadBtn, true, 'Качване…');
      const up = upload('POST', '/api/admin/menu/files', fd, { onProgress: (p) => upl.showProgress(p), onSent: () => upl.showProcessing() });
      abort = up.abort;
      try {
        await up.promise;
        toast('Файлът е качен. Все още не е публикуван.');
        fileAlert = null; upl.clear(); await refreshMeta();
      } catch (e) {
        setBusy(uploadBtn, false); upl.hideProgress();
        if (e.code === 'aborted') return;
        if (e.status === 413 || e.status === 415) upl.setError(e.message); else if (e.status !== 401) upl.setError(e.code === 'network' ? 'Качването не успя. Проверете връзката и опитайте отново.' : e.message, () => uploadBtn.click());
      }
    } });
    box.append(upl.el, extra);
    if (!files.length) sec.append(h('p', null, h('strong', { text: 'Още няма качени файлове.' }), l === 'en' ? ' Незадължително — без него се показва българският.' : ' Качете снимка или PDF на менюто.'));
    sec.append(box);
    const list = h('div', { class: 'a-list', role: 'list' });
    for (const f of files) list.append(fileRow(f));
    sec.append(list);
    return sec;
  }

  function fileRow(f) {
    const thumb = f.kind === 'image' ? h('img', { class: 'a-thumb', src: f.fileUrl, alt: '', loading: 'lazy' }) : h('span', { class: 'a-thumb a-thumb--tile' }, icon('file-pdf'));
    const fileMode = data.mode === 'file';
    const badges = h('div', { class: 'a-badges' });
    if (f.published) {
      badges.append(badge('Публикуван', 'ok'));
      badges.append(h('span', { class: 'a-help', text: fileMode ? 'Виждат го клиентите.' : 'Публикуван — не се показва (активен е Структурираното меню).' }));
    } else badges.append(badge('Непубликуван', 'neutral', 'ring'));
    const info = h('div', { class: 'a-menu__info' }, h('h4', { class: 'a-trunc', title: f.originalName, text: f.originalName }),
      h('p', { class: 'a-help', text: `${kindLabel(f.kind)} · ${formatSize(f.sizeBytes)} · качен на ${formatStamp(f.createdAt)}` }), badges);
    const acts = h('div', { class: 'a-menu__act' }, h('a', { href: f.fileUrl, target: '_blank', rel: 'noopener', class: 'a-btn a-btn--secondary' }, icon('eye'), h('span', { text: 'Преглед' })));
    if (!f.published) {
      acts.append(btn({ label: 'Публикувай', variant: 'primary', onClick: async () => {
        const other = data.files.find((x) => x.published && fileLang(x) === fileLang(f));
        const run = async () => { await patch(`/api/admin/menu/files/${f.id}/published`, { published: true }); };
        if (other) {
          const ok = await confirmDialog({ title: 'Смяна на публикувания файл', body: para('Текущо публикуваният файл „', [other.originalName], '“ ще бъде заменен. Само един файл на език може да е публикуван.'), confirmLabel: 'Публикувай', run });
          if (!ok) return;
        } else { try { await run(); } catch (e) { reportError(e); return; } }
        toast('Файлът е публикуван.'); fileAlert = null; await refreshMeta();
      } }));
    } else if (!fileMode) {
      acts.append(btn({ label: 'Скрий', variant: 'ghost', onClick: async () => {
        try { await patch(`/api/admin/menu/files/${f.id}/published`, { published: false }); toast('Файлът е скрит.'); await refreshMeta(); } catch (e) { reportError(e); }
      } }));
    } else acts.append(h('p', { class: 'a-help', text: 'За да скриете този файл, публикувайте друг или превключете към Структурирано меню.' }));
    acts.append(btn({ label: 'Изтрий', variant: 'ghost-danger', icon: 'trash', aria: `Изтрий файла ${f.originalName} (${fileLang(f) === 'en' ? 'английски' : 'български'})`, onClick: async () => {
      const ok = await confirmDialog({
        title: 'Изтриване на файл', body: para('Сигурни ли сте, че искате да изтриете „', [f.originalName], '“? Това не може да бъде върнато.'), confirmLabel: 'Изтрий файла', danger: true,
        run: async () => { try { await del(`/api/admin/menu/files/${f.id}`); } catch (e) { if (e.code === 'in_use') { fileAlert = 'Този файл се показва на клиентите. Първо публикувайте друг файл или превключете на Структурирано меню.'; renderFiles(); } throw e; } },
      });
      if (ok) { toast('Файлът е изтрит.'); fileAlert = null; await refreshMeta(); }
    } }));
    return h('article', { class: 'a-card a-menu a-file', role: 'listitem' }, thumb, info, acts);
  }

  view.el = el;
  view.destroy = () => { dead = true; };
  view.dirty = () => !dead && data && isDirty();
  load(true);
  return view;
}
