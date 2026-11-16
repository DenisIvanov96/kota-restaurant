// Shared UI components: toasts, dialogs, switches, fields, alerts, upload widget.
import { h, icon, clear, nextId, formatSize, kindLabel, append } from './util.js';

// ---------- Toasts ----------
let toastHost;
function host() {
  if (!toastHost) {
    toastHost = h('div', { class: 'a-toasts' });
    document.body.append(toastHost);
  }
  return toastHost;
}

export function toast(message, { type = 'ok', action } = {}) {
  const box = host();
  while (box.children.length >= 3) box.firstChild.remove();
  const item = h('div', { class: `a-toast a-toast--${type}`, role: type === 'err' ? 'alert' : 'status' });
  const close = () => { clearTimeout(timer); item.remove(); };
  let timer;
  append(item, h('span', { class: 'a-toast__msg', text: message }));
  if (action) {
    item.append(h('button', { type: 'button', class: 'a-toast__btn', text: action.label, onclick: () => { close(); action.onClick(); } }));
  }
  if (type === 'err') {
    item.append(h('button', { type: 'button', class: 'a-toast__close', 'aria-label': 'Затвори', onclick: close }, icon('x')));
  } else {
    const start = () => { timer = setTimeout(close, 5000); };
    item.addEventListener('mouseenter', () => clearTimeout(timer));
    item.addEventListener('mouseleave', start);
    item.addEventListener('focusin', () => clearTimeout(timer));
    item.addEventListener('focusout', start);
    start();
  }
  box.append(item);
  return close;
}

/** Report an API error unless it already triggered the session-expired overlay. */
export function reportError(e, fallback) {
  if (!e || e.status === 401) return;
  if (e.code === 'network') toast('Няма връзка. Промените не са записани.', { type: 'err' });
  else toast(e.message || fallback || 'Възникна грешка.', { type: 'err' });
}

// ---------- Buttons ----------
export function btn({ label, variant = 'secondary', icon: ic, onClick, type = 'button', aria, cls, title }) {
  const b = h('button', { type, class: `a-btn a-btn--${variant}${cls ? ' ' + cls : ''}`, title });
  if (ic) b.append(icon(ic));
  if (label) b.append(h('span', { text: label }));
  if (aria) b.setAttribute('aria-label', aria);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export const iconBtn = ({ ic, aria, onClick, cls }) =>
  h('button', { type: 'button', class: `a-btn a-btn--icon${cls ? ' ' + cls : ''}`, 'aria-label': aria, onclick: onClick }, icon(ic));

export function setBusy(button, on, busyLabel = 'Запазване…') {
  if (on) {
    if (button._orig) return;
    button._orig = Array.from(button.childNodes);
    clear(button);
    button.append(h('span', { class: 'a-spinner', 'aria-hidden': 'true' }), h('span', { text: busyLabel }));
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else if (button._orig) {
    clear(button);
    button.append(...button._orig);
    button._orig = null;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

/** Run an async action on a button with busy state; returns result or undefined on error (already reported). */
export async function withBusy(button, fn, busyLabel) {
  setBusy(button, true, busyLabel);
  try { return await fn(); } catch (e) { reportError(e); return undefined; } finally { setBusy(button, false); }
}

// ---------- Badges / alerts ----------
const BADGE_GLYPH = { ok: 'dot', solid: 'check', info: 'clock', neutral: 'ring', warn: 'alert', danger: 'alert', edit: 'pencil' };
export function badge(text, variant = 'neutral', glyph) {
  return h('span', { class: `a-badge a-badge--${variant}` }, icon(glyph || BADGE_GLYPH[variant] || 'dot'), h('span', { text }));
}

export function alertBox(type, content, { role, cls } = {}) {
  const ic = { success: 'check', warning: 'alert', error: 'alert', info: 'info' }[type];
  const node = h('div', { class: `a-alert a-alert--${type}${cls ? ' ' + cls : ''}` }, icon(ic), h('div', { class: 'a-alert__body' }, content));
  if (role) node.setAttribute('role', role);
  return node;
}

export function skeleton(n = 3) {
  const wrap = h('div', { class: 'a-skeletons', 'aria-busy': 'true' }, h('span', { class: 'a-vh', text: 'Зареждане…' }));
  for (let i = 0; i < n; i++) wrap.append(h('div', { class: 'a-card' }, h('div', { class: 'a-skeleton a-skeleton--lg' }), h('div', { class: 'a-skeleton' }), h('div', { class: 'a-skeleton a-skeleton--short' })));
  return wrap;
}

export function loadError(message, retry) {
  return h('div', { class: 'a-card' }, alertBox('error', [h('strong', { text: message || 'Данните не могат да се заредят.' })], { role: 'alert' }),
    h('div', { class: 'a-actions' }, btn({ label: 'Опитай отново', variant: 'secondary', onClick: retry })));
}

export function emptyState(title, text, actionLabel, onAction) {
  return h('div', { class: 'a-empty' }, h('p', { class: 'a-empty__title', text: title }), text && h('p', { text }),
    actionLabel && btn({ label: actionLabel, variant: 'primary', icon: 'plus', onClick: onAction }));
}

// ---------- Dialogs ----------
/**
 * Generic modal. buttons: [{label, value, variant, focus, run}]
 * run: async () => result; returning 'keep' leaves the dialog open; throwing closes it with an error toast.
 * Resolves with the clicked button's value, or null if dismissed.
 */
export function modal({ title, body, buttons, wide, sheet = true }) {
  return new Promise((resolve) => {
    const titleId = nextId('dlg');
    const dlg = h('dialog', { class: `a-dialog${wide ? ' a-dialog--wide' : ''}`, 'aria-labelledby': titleId });
    const bodyBox = h('div', { class: 'a-dialog__body' });
    append(bodyBox, Array.isArray(body) ? body : [body]);
    const row = h('div', { class: 'a-dialog__actions' });
    const box = h('div', { class: 'a-dialog__box' }, h('h2', { id: titleId, text: title }), bodyBox, row);
    dlg.append(box);
    let locked = false;
    let result = null;
    const els = [];
    const finish = (v) => { result = v; dlg.close(); };
    for (const b of buttons || []) {
      const el = btn({ label: b.label, variant: b.variant || 'secondary' });
      el.addEventListener('click', async () => {
        if (locked) return;
        if (!b.run) { finish(b.value === undefined ? true : b.value); return; }
        locked = true;
        els.forEach((x) => { x.disabled = true; });
        setBusy(el, true, 'Моля, изчакайте…');
        try {
          const r = await b.run();
          if (r === 'keep') { locked = false; setBusy(el, false); els.forEach((x) => { x.disabled = false; }); return; }
          finish(b.value === undefined ? true : b.value);
        } catch (e) {
          reportError(e);
          finish(null);
        }
      });
      els.push(el);
      row.append(el);
      if (b.focus) el.dataset.focus = '1';
    }
    dlg.addEventListener('cancel', (e) => { if (locked) e.preventDefault(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg && !locked) finish(null); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
    const f = dlg.querySelector('[data-focus]') || dlg.querySelector('input,select,textarea,button');
    if (f) f.focus();
    dlg.modalApi = { finish, els };
  });
}

/** Confirm dialog. Safe button ("Отказ") is focused. Resolves true/false. */
export async function confirmDialog({ title, body, confirmLabel, danger = false, cancelLabel = 'Отказ', run }) {
  const r = await modal({
    title,
    body: typeof body === 'string' ? h('p', { text: body }) : body,
    buttons: [
      { label: cancelLabel, value: false, focus: true },
      { label: confirmLabel, value: true, variant: danger ? 'danger' : 'primary', run },
    ],
  });
  return r === true;
}

/** Plain-text body helper with bold parts: bodyWith('Изтриване на ', ['name'], '?') */
export function para(...parts) {
  const p = h('p');
  for (const part of parts) {
    if (Array.isArray(part)) p.append(h('strong', { text: part[0] }));
    else p.append(document.createTextNode(part));
  }
  return p;
}

export function openLightbox(url, alt) {
  const dlg = h('dialog', { class: 'a-lightbox', 'aria-label': 'Преглед на снимка' });
  const img = h('img', { src: url, alt: alt || 'Преглед на избрания файл' });
  const closeBtn = h('button', { type: 'button', class: 'a-btn a-btn--secondary a-lightbox__close', 'aria-label': 'Затвори', onclick: () => dlg.close() }, icon('x'), h('span', { text: 'Затвори' }));
  dlg.append(closeBtn, h('div', { class: 'a-lightbox__scroll' }, img));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Switch ----------
export function makeSwitch({ label, checked, onChange }) {
  const text = h('span', { class: 'a-switch__text' });
  const b = h('button', { type: 'button', role: 'switch', class: 'a-switch', 'aria-label': label },
    h('span', { class: 'a-switch__track' }, h('span', { class: 'a-switch__knob' })), text);
  const set = (v) => { b.setAttribute('aria-checked', v ? 'true' : 'false'); text.textContent = v ? 'Вкл.' : 'Изкл.'; };
  set(!!checked);
  b.setChecked = set;
  b.isChecked = () => b.getAttribute('aria-checked') === 'true';
  b.addEventListener('click', async () => {
    if (b.disabled) return;
    const next = !b.isChecked();
    if (!onChange) { set(next); return; }
    b.disabled = true;
    b.classList.add('is-busy');
    b.setAttribute('aria-busy', 'true');
    try { await onChange(next); set(next); } catch { /* caller reports; state stays as before */ }
    b.classList.remove('is-busy');
    b.removeAttribute('aria-busy');
    b.disabled = false;
  });
  return b;
}

// ---------- Form fields ----------
export function field({ label, required, helper, type = 'text', multiline, rows = 3, max, value = '', inputmode, autocomplete, suffix, cls, name, placeholder, onInput, onBlur, hideLabel, autocapitalize }) {
  const id = nextId('f');
  const helpId = `${id}-h`;
  const errId = `${id}-e`;
  const attrs = { id, name: name || id, class: 'a-input' };
  if (inputmode) attrs.inputmode = inputmode;
  if (autocomplete) attrs.autocomplete = autocomplete;
  if (placeholder) attrs.placeholder = placeholder;
  if (max) attrs.maxlength = max;
  if (autocapitalize) { attrs.autocapitalize = autocapitalize; attrs.autocorrect = 'off'; attrs.spellcheck = 'false'; }
  const input = multiline ? h('textarea', { ...attrs, rows }) : h('input', { ...attrs, type });
  input.value = value ?? '';
  const describedBy = [];
  const labelEl = h('label', { for: id, class: hideLabel ? 'a-vh' : 'a-label' }, label, required && h('span', { class: 'a-req', 'aria-hidden': 'true', text: ' *' }));
  const counter = max ? h('span', { class: 'a-counter', 'aria-hidden': 'true' }) : null;
  const err = h('p', { class: 'a-error', id: errId, hidden: true }, icon('alert'), h('span'));
  const help = helper ? h('p', { class: 'a-help', id: helpId, text: helper }) : null;
  if (help) describedBy.push(helpId);
  const setDescribed = (withErr) => input.setAttribute('aria-describedby', (withErr ? [errId, ...describedBy] : describedBy).join(' '));
  setDescribed(false);
  const updCounter = () => {
    if (!counter) return;
    const n = input.value.length;
    counter.textContent = `${n}/${max}`;
    counter.classList.toggle('is-limit', n >= max);
  };
  updCounter();
  const control = suffix ? h('div', { class: 'a-input-wrap' }, input, h('span', { class: 'a-suffix', text: suffix })) : input;
  const el = h('div', { class: `a-field${cls ? ' ' + cls : ''}` }, labelEl, control, err, help, counter && h('div', { class: 'a-counter-row' }, counter));
  const api = {
    el, input, id,
    get value() { return input.value; },
    set value(v) { input.value = v; updCounter(); },
    setError(msg) {
      const on = !!msg;
      err.hidden = !on;
      err.lastChild.textContent = msg || '';
      input.classList.toggle('is-invalid', on);
      if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
      setDescribed(on);
    },
    get error() { return err.hidden ? '' : err.lastChild.textContent; },
    setDisabled(d) { input.disabled = d; },
    updCounter,
  };
  input.addEventListener('input', () => { updCounter(); if (onInput) onInput(api); });
  if (onBlur) input.addEventListener('blur', () => onBlur(api));
  return api;
}

/** Password field with "Покажи / Скрий". */
export function passwordField(opts) {
  const f = field({ ...opts, type: 'password', autocapitalize: 'none' });
  const toggle = h('button', { type: 'button', class: 'a-btn a-btn--ghost a-pw-toggle', 'aria-pressed': 'false', text: 'Покажи', 'aria-label': 'Покажи паролата' });
  toggle.addEventListener('click', () => {
    const show = f.input.type === 'password';
    f.input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Скрий' : 'Покажи';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Скрий паролата' : 'Покажи паролата');
  });
  const wrap = h('div', { class: 'a-input-wrap a-input-wrap--pw' });
  f.input.replaceWith(wrap);
  wrap.append(f.input, toggle);
  return f;
}

/** Error summary box with links to fields. */
export function errorSummary() {
  const box = h('div', { class: 'a-alert a-alert--error a-summary', role: 'alert', tabindex: '-1', hidden: true });
  return {
    el: box,
    show(items, lead) {
      clear(box);
      if (!items.length) { box.hidden = true; return; }
      const list = h('ul');
      for (const it of items) {
        const a = h('a', { href: `#${it.id}`, text: it.label ? `${it.label}: ${it.msg}` : it.msg });
        a.addEventListener('click', (e) => { e.preventDefault(); const t = document.getElementById(it.id); if (t) t.focus(); });
        list.append(h('li', null, a));
      }
      box.append(icon('alert'), h('div', { class: 'a-alert__body' }, h('strong', { text: lead || `Моля, поправете ${items.length} ${items.length === 1 ? 'поле' : 'полета'}:` }), list));
      box.hidden = false;
      box.focus();
    },
    hide() { box.hidden = true; clear(box); },
  };
}

// ---------- Upload widget ----------
const MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
export const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]?.toLowerCase() || '';

export function createUpload({ exts, maxMB, onChange, onCancel, imageOnly }) {
  const state = { file: null, url: null };
  const allowedLabel = exts.map((e) => e.toUpperCase()).filter((e) => e !== 'JPEG').join(', ');
  const input = h('input', { type: 'file', class: 'a-vh', tabindex: '-1', 'aria-hidden': 'true', accept: imageOnly ? 'image/jpeg,image/png,image/webp' : '.pdf,.jpg,.jpeg,.png,.webp,image/*' });
  const errBox = h('div', { class: 'a-upload__err', hidden: true });
  const idle = h('div', { class: 'a-upload__idle' });
  const picked = h('div', { class: 'a-upload__picked', hidden: true });
  const prog = h('div', { class: 'a-upload__prog', hidden: true });
  const el = h('div', { class: 'a-upload' }, input, idle, picked, prog, errBox);

  const pick = () => input.click();
  append(idle, [
    icon('upload'),
    btn({ label: 'Избери файл', variant: 'primary', onClick: pick }),
    h('p', { class: 'a-help', text: `${imageOnly ? 'Снимка' : 'Позволени'}: ${allowedLabel}, до ${maxMB} MB.` }),
  ]);

  const progress = h('progress', { max: '100', value: '0', 'aria-label': 'Качване' });
  const progText = h('p', { class: 'a-upload__pct', 'aria-live': 'polite' });
  const cancelBtn = btn({ label: 'Откажи качването', variant: 'secondary', onClick: () => onCancel && onCancel() });
  append(prog, [progress, progText, cancelBtn]);
  let lastAnnounced = -1;

  function setError(msg, retry) {
    clear(errBox);
    if (!msg) { errBox.hidden = true; return; }
    errBox.append(alertBox('error', [h('strong', { text: msg })], { role: 'alert' }));
    if (retry) errBox.append(btn({ label: 'Опитай отново', variant: 'secondary', onClick: retry }));
    errBox.hidden = false;
  }

  function revoke() { if (state.url) { URL.revokeObjectURL(state.url); state.url = null; } }

  function render() {
    clear(picked);
    if (!state.file) { picked.hidden = true; idle.hidden = false; return; }
    const f = state.file;
    const isPdf = extOf(f.name) === 'pdf';
    const thumb = isPdf
      ? h('span', { class: 'a-thumb a-thumb--tile' }, icon('file-pdf'))
      : h('img', { class: 'a-thumb', src: state.url, alt: '' });
    append(picked, [
      thumb,
      h('div', { class: 'a-upload__info' }, h('strong', { class: 'a-trunc', title: f.name, text: f.name }), h('span', { class: 'a-help', text: `${formatSize(f.size)} · ${isPdf ? 'PDF' : 'Снимка'}` })),
      h('div', { class: 'a-upload__btns' },
        btn({ label: 'Смени', variant: 'secondary', onClick: pick }),
        btn({ label: 'Премахни', variant: 'ghost-danger', onClick: () => api.clear() })),
    ]);
    picked.hidden = false; idle.hidden = true;
  }

  function validate(f) {
    const ext = extOf(f.name);
    if (!exts.includes(ext) || (f.type && f.type !== MIME[ext] && f.type !== 'application/octet-stream')) {
      return `Този тип файл не се поддържа. Позволени: ${allowedLabel}.`;
    }
    if (f.size > maxMB * 1024 * 1024) return `Файлът е твърде голям (${(f.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB). Максимум ${maxMB} MB.`;
    return null;
  }

  const api = {
    el,
    get file() { return state.file; },
    get url() { return state.url; },
    pick,
    setFile(f) {
      const bad = validate(f);
      setError(bad);
      if (bad) return false;
      revoke();
      state.file = f; state.url = URL.createObjectURL(f);
      render();
      if (onChange) onChange(f);
      return true;
    },
    clear() {
      revoke(); state.file = null; input.value = '';
      setError(null); render();
      if (onChange) onChange(null);
    },
    setError,
    showProgress(pct) {
      prog.hidden = false; picked.hidden = true; idle.hidden = true; setError(null);
      cancelBtn.hidden = false;
      progress.value = pct;
      const step = Math.floor(pct / 10) * 10;
      if (step !== lastAnnounced || pct === 100) { lastAnnounced = step; progText.textContent = pct >= 100 ? 'Обработване…' : `Качване… ${pct}%`; }
    },
    showProcessing() { progress.removeAttribute('value'); progText.textContent = 'Обработване…'; cancelBtn.hidden = true; },
    hideProgress() { prog.hidden = true; lastAnnounced = -1; progress.value = 0; render(); },
    setDisabled(d) { el.querySelectorAll('button').forEach((b) => { b.disabled = d; }); input.disabled = d; },
  };

  input.addEventListener('change', () => { if (input.files && input.files[0]) api.setFile(input.files[0]); input.value = ''; });
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('is-drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('is-drag'));
  el.addEventListener('drop', (e) => {
    e.preventDefault(); el.classList.remove('is-drag');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) api.setFile(e.dataTransfer.files[0]);
  });
  render();
  return api;
}

/** Preview of a locally chosen file (blob URL): image with lightbox, or PDF tile/object. */
export function filePreview(upl) {
  const f = upl.file;
  const url = upl.url;
  const wrap = h('div', { class: 'a-preview' });
  if (extOf(f.name) === 'pdf') {
    if (navigator.pdfViewerEnabled && window.matchMedia('(min-width: 768px)').matches) {
      wrap.append(h('object', { type: 'application/pdf', data: url, class: 'a-preview__pdf', 'aria-label': 'Преглед на PDF' }));
    } else {
      wrap.append(h('div', { class: 'a-pdf-card' }, icon('file-pdf'), h('p', { text: 'Менюто е във формат PDF.' }),
        h('a', { class: 'a-btn a-btn--secondary', href: url, target: '_blank', rel: 'noopener' }, h('span', { text: 'Отвори за преглед' }))));
    }
  } else {
    wrap.append(h('button', { type: 'button', class: 'a-preview__btn', 'aria-label': 'Увеличи прегледа', onclick: () => openLightbox(url) },
      h('img', { src: url, alt: 'Преглед на избрания файл' })));
  }
  return wrap;
}

// ---- English (optional) sub-section: collapsible, open when any field already has text.
export const EN_HELP = 'По избор. Ако е празно, на английската версия се показва българският текст.';
export function enGroup(fields, title = 'English / Английски') {
  const det = h('details', { class: 'a-en' });
  det.open = fields.some((f) => f.value);
  det.append(h('summary', { class: 'a-en__sum', text: title }), h('div', { class: 'a-en__body' }, ...fields.map((f) => f.el)));
  return det;
}
