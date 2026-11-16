import { h, icon, clear, formatSize, kindLabel, formatStamp, centsToInput, parsePrice, nextId } from './util.js';
import { get, post, put, patch, del, upload } from './api.js';
import { badge, alertBox, btn, iconBtn, skeleton, loadError, emptyState, reportError, toast, modal, confirmDialog, para, makeSwitch, field, errorSummary, createUpload, filePreview, setBusy } from './ui.js';
import { renderMenuPreview, previewScroller } from './preview.js';

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
  let guardActive = true;

  const view = { dirty: () => false };
  const symbol = () => (data ? data.currencySymbol : '€');

  const mkItem = (it) => ({ k: ++seq, id: it.id, name: it.name || '', description: it.description || '', price: centsToInput(it.priceCents), available: it.available !== false });
  const mkCat = (c, open) => ({ k: ++seq, id: c.id, name: c.name || '', open, items: (c.items || []).map(mkItem) });
  const wide = () => window.matchMedia('(min-width: 1024px)').matches;
  const fromDraft = (draft) => draft.categories.map((c, i) => mkCat(c, wide() || i === 0));
  const serialize = () => JSON.stringify(cats.map((c) => [c.name, c.items.map((i) => [i.name, i.description, i.price.trim(), i.available])]));
  const isDirty = () => serialize() !== saved;

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
    structPanel = h('div', { role: 'tabpanel', id: 'panel-structured', 'aria-labelledby': 'tab-structured' }, statusHost, summary.el, editorHost, announcer);
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
  const vDesc = (s) => (s.length > 500 ? 'Максимум 500 знака.' : '');

  function validateAll() {
    errors = {};
    const list = [];
    cats.forEach((c, ci) => {
      let bad = false;
      const m = vName(c.name);
      if (m) { errors[`c${c.k}.name`] = m; list.push({ cat: c, key: `c${c.k}.name`, label: `Категория ${ci + 1}`, msg: m }); bad = true; }
      c.items.forEach((it, ii) => {
        for (const [f, fn, val, lab] of [['name', vName, it.name, 'Име'], ['price', vPrice, it.price, 'Цена'], ['description', vDesc, it.description, 'Описание']]) {
          const mm = fn(val);
          if (mm) { errors[`i${it.k}.${f}`] = mm; list.push({ cat: c, key: `i${it.k}.${f}`, label: `${c.name.trim() || `Категория ${ci + 1}`}, ястие ${ii + 1} — ${lab}`, msg: mm }); bad = true; }
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
    renderEditor();
    summary.show(list.map((x) => ({ id: ids[x.key], label: x.label, msg: x.msg })).filter((x) => x.id));
    return false;
  }

  // ---------------------------------------------------------------- persistence
  function payload() {
    return {
      categories: cats.map((c) => ({
        ...(c.id ? { id: c.id } : {}), name: c.name.trim(),
        items: c.items.map((i) => ({ ...(i.id ? { id: i.id } : {}), name: i.name.trim(), description: i.description, priceCents: parsePrice(i.price), available: i.available })),
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
    const model = cats.map((c) => ({ name: c.name.trim(), items: c.items.map((i) => ({ name: i.name.trim(), description: i.description, priceCents: parsePrice(i.price) || 0, available: i.available })) }));
    const frame = h('div', { class: 'preview-frame public-theme w-390' });
    const seg = h('div', { class: 'a-seg', role: 'group', 'aria-label': 'Ширина на прегледа' });
    for (const [wc, label] of [['w-390', 'Телефон'], ['w-960', 'Компютър']]) {
      seg.append(h('button', { type: 'button', class: 'a-seg__btn', 'aria-pressed': String(wc === 'w-390'), text: label, onclick: (e) => {
        frame.classList.remove('w-390', 'w-960'); frame.classList.add(wc);
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
      } }));
    }
    frame.append(renderMenuPreview(model, symbol()));
    modal({ title: 'Преглед за клиенти', wide: true, body: [alertBox('info', `Това е преглед на чернова.${isDirty() ? ' Съдържа незапазени промени.' : ''}`), seg, previewScroller(frame)], buttons: [{ label: 'Затвори', focus: true }] });
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

  const changed = () => renderStatus();

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
    let touched = !!c.name;
    const catLabel = () => (c.name || '').trim() || 'Без име';
    const labelled = [];
    const relabel = () => labelled.forEach(([el, fn]) => el.setAttribute('aria-label', fn()));
    const nameF = field({ label: 'Име на категория', hideLabel: true, required: true, max: 100, value: c.name, placeholder: 'Име на категория, напр. Салати', cls: 'a-cat__name',
      onInput: () => { touched = true; c.name = nameF.value; relabel(); if (errors[`c${c.k}.name`]) { const m = vName(c.name); errors[`c${c.k}.name`] = m; nameF.setError(m); } changed(); },
      onBlur: () => { if (!touched && !errors[`c${c.k}.name`]) return; const m = vName(nameF.value); if (m) errors[`c${c.k}.name`] = m; else delete errors[`c${c.k}.name`]; nameF.setError(m); } });
    nameF.input.dataset.fk = `cat-${c.k}-name`;
    ids[`c${c.k}.name`] = nameF.id;
    if (errors[`c${c.k}.name`]) nameF.setError(errors[`c${c.k}.name`]);
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
      const untouched = !c.id && !c.name.trim() && !c.items.length;
      if (!untouched) {
        const ok = await confirmDialog({ title: 'Изтриване на категория', body: c.items.length ? para('Изтриване на „', [c.name.trim() || 'Без име'], `“ и всичките му ${c.items.length} ястия?`) : para('Изтриване на „', [c.name.trim() || 'Без име'], '“?'), confirmLabel: 'Изтрий категорията', danger: true });
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
    const dishLabel = () => (it.name || '').trim() || 'Без име';
    const mk = (f, fn, setter) => (a) => {
      touched[f] = true;
      setter(a.value);
      if (f === 'name') relabelDish();
      if (errors[ek(f)]) { const m = fn(a.value); if (m) errors[ek(f)] = m; else delete errors[ek(f)]; a.setError(m); }
      changed();
    };
    const touched = {}; for (const f of ['name', 'price', 'description']) touched[f] = !!it[f];
    const blur = (f, fn) => (a) => { if (!touched[f] && !errors[ek(f)]) return; const m = fn(a.value); if (m) errors[ek(f)] = m; else delete errors[ek(f)]; a.setError(m); };
    const nameF = field({ label: 'Име на ястието', required: true, max: 100, value: it.name, onInput: mk('name', vName, (v) => { it.name = v; }), onBlur: blur('name', vName) });
    nameF.input.dataset.fk = `dish-${it.k}-name`;
    const priceF = field({ label: 'Цена', inputmode: 'decimal', value: it.price, suffix: symbol(), helper: '0 или празно = без цена', cls: 'a-price', onInput: mk('price', vPrice, (v) => { it.price = v; }), onBlur: blur('price', vPrice) });
    const descF = field({ label: 'Описание', multiline: true, rows: 2, max: 500, value: it.description, onInput: mk('description', vDesc, (v) => { it.description = v; }), onBlur: blur('description', vDesc) });
    ids[ek('name')] = nameF.id; ids[ek('price')] = priceF.id; ids[ek('description')] = descF.id;
    for (const [f, a] of [['name', nameF], ['price', priceF], ['description', descF]]) if (errors[ek(f)]) a.setError(errors[ek(f)]);
    const offHelp = h('p', { class: 'a-help', hidden: it.available, text: 'Показва се като „Няма в наличност“' });
    const sw = makeSwitch({ label: `Налично: ${dishLabel()}`, checked: it.available });
    sw.addEventListener('click', () => { it.available = sw.isChecked(); offHelp.hidden = it.available; changed(); });
    const up = iconBtn({ ic: 'arrow-up', aria: 'Премести ястието нагоре', onClick: () => move(c.items, c.items.indexOf(it), -1, 'dish', it.k) });
    const down = iconBtn({ ic: 'arrow-down', aria: 'Премести ястието надолу', onClick: () => move(c.items, c.items.indexOf(it), 1, 'dish', it.k) });
    up.dataset.fk = `dish-${it.k}-up`; down.dataset.fk = `dish-${it.k}-down`;
    up.setAttribute('aria-label', `Премести „${dishLabel()}“ нагоре`); down.setAttribute('aria-label', `Премести „${dishLabel()}“ надолу`);
    up.disabled = ii === 0; down.disabled = ii === c.items.length - 1;
    const del2 = btn({ label: 'Изтрий', variant: 'ghost-danger', icon: 'trash', aria: `Изтрий ястието „${dishLabel()}“`, onClick: async () => {
      const untouched = !it.id && !it.name.trim() && !it.price.trim() && !it.description.trim();
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
  function renderFiles() {
    if (!fileHost) return;
    clear(fileHost);
    fileHost.append(h('h3', { class: 'a-sub', text: 'Файлове на менюто' }));
    if (fileAlert) fileHost.append(alertBox('error', fileAlert, { role: 'alert' }));
    const box = h('div', { class: 'a-filebox' });
    const extra = h('div');
    let abort = null;
    const upl = createUpload({ exts: ['pdf', 'jpg', 'jpeg', 'png', 'webp'], maxMB: 15, onCancel: () => abort && abort(),
      onChange: () => { clear(extra); if (!upl.file) return; extra.append(filePreview(upl), h('div', { class: 'a-actionrow' }, btn({ label: 'Отказ', variant: 'secondary', onClick: () => upl.clear() }), uploadBtn)); } });
    const uploadBtn = btn({ label: 'Качи', variant: 'primary', onClick: async () => {
      const fd = new FormData(); fd.append('file', upl.file);
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
    if (!data.files.length) fileHost.append(h('p', null, h('strong', { text: 'Още няма качени файлове.' }), ' Качете снимка или PDF на менюто.'));
    fileHost.append(box);
    const list = h('div', { class: 'a-list', role: 'list' });
    for (const f of data.files) list.append(fileRow(f));
    fileHost.append(list);
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
        const other = data.files.find((x) => x.published);
        const run = async () => { await patch(`/api/admin/menu/files/${f.id}/published`, { published: true }); };
        if (other) {
          const ok = await confirmDialog({ title: 'Смяна на публикувания файл', body: para('Текущо публикуваният файл „', [other.originalName], '“ ще бъде заменен. Само един файл може да е публикуван.'), confirmLabel: 'Публикувай', run });
          if (!ok) return;
        } else { try { await run(); } catch (e) { reportError(e); return; } }
        toast('Файлът е публикуван.'); fileAlert = null; await refreshMeta();
      } }));
    } else if (!fileMode) {
      acts.append(btn({ label: 'Скрий', variant: 'ghost', onClick: async () => {
        try { await patch(`/api/admin/menu/files/${f.id}/published`, { published: false }); toast('Файлът е скрит.'); await refreshMeta(); } catch (e) { reportError(e); }
      } }));
    } else acts.append(h('p', { class: 'a-help', text: 'За да скриете този файл, публикувайте друг или превключете към Структурирано меню.' }));
    acts.append(btn({ label: 'Изтрий', variant: 'ghost-danger', icon: 'trash', aria: `Изтрий файла ${f.originalName}`, onClick: async () => {
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
