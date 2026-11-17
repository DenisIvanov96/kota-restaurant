// Bulgarian date / time inputs. The browser locale never matters: everything is typed text or our own calendar.
// Values exchanged with the rest of the app stay YYYY-MM-DD and YYYY-MM-DDTHH:mm.
import { h, icon, addDays, nextId } from './util.js';
import { field, btn } from './ui.js';

const MONTHS = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const MONTHS_LC = MONTHS.map((m) => m.toLowerCase());
const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
const WD_LONG = ['понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота', 'неделя'];

export const MSG_DATE_FORMAT = 'Въведете дата във формат дд.мм.гггг';
export const MSG_DATE_INVALID = 'Невалидна дата';
export const MSG_TIME_INVALID = 'Невалиден час';
export const MSG_TIME_MISSING = 'Въведете час във формат ЧЧ:ММ';

const pad = (n) => String(n).padStart(2, '0');

/** Today in Sofia as YYYY-MM-DD (fallback only; callers pass the server's string when they have it). */
function sofiaToday() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const g = (t) => parts.find((p) => p.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
}

export const isoToBg = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };

/** 'дд.мм.гггг' -> {iso} | {error}. Empty text -> {iso: ''}. */
export function parseBgDate(text) {
  const t = String(text || '').trim();
  if (!t) return { iso: '' };
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (!m) return { error: MSG_DATE_FORMAT };
  const d = +m[1], mo = +m[2], y = +m[3];
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (y < 2000 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > dim) return { error: MSG_DATE_INVALID };
  return { iso: `${y}-${pad(mo)}-${pad(d)}` };
}

export function parseTime(text) {
  const t = String(text || '').trim();
  if (!t) return { time: '' };
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m || +m[1] > 23 || +m[2] > 59) return { error: MSG_TIME_INVALID };
  return { time: `${pad(+m[1])}:${m[2]}` };
}

// ---- typing helpers: keep only digits and add the separator automatically ----
function maskDate(raw, deleting) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  // typed separators: "5.6.2026" / "5." -> pad single-digit day / month ("05.06.2026"); otherwise chunk the digits
  if (/\D/.test(raw)) {
    const segs = raw.trim().split(/\D+/);
    const trailing = segs.length > 1 && segs[segs.length - 1] === '';
    if (trailing) segs.pop();
    const ok = (segs.length >= 2 || trailing) && segs.length <= 3 && segs[0] && segs.every((x, i) => x.length <= (i < 2 ? 2 : 4)) && segs.slice(0, -1).every((x) => x);
    if (ok) {
      const out = segs.map((x, i) => (i < segs.length - 1 && x.length === 1 ? '0' + x : x));
      let r = out.join('.');
      const last = segs[segs.length - 1];
      if (segs.length < 3 && (trailing || (last.length === 2 && !deleting))) r += '.';
      return r;
    }
  }
  const d = raw.replace(/\D/g, '').slice(0, 8);
  let out = d.slice(0, 2);
  if (d.length > 2) out += '.' + d.slice(2, 4); else if (d.length === 2 && !deleting) out += '.';
  if (d.length > 4) out += '.' + d.slice(4);
  else if (d.length === 4 && !deleting) out += '.';
  return out;
}
function maskTime(raw, deleting) {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  let out = d.slice(0, 2);
  if (d.length > 2) out += ':' + d.slice(2);
  else if (d.length === 2 && !deleting) out += ':';
  return out;
}
function attachMask(input, mask, after) {
  input.addEventListener('input', (e) => {
    const del = !!(e.inputType && e.inputType.startsWith('delete'));
    const v = mask(input.value, del);
    if (v !== input.value) input.value = v;
    after();
  });
}

// ---- calendar popup (a native modal <dialog>: focus trap, Esc and inert background come for free) ----
/** Resolves with 'YYYY-MM-DD' or null when dismissed. */
export function openCalendar({ selected, today, title = 'Избор на дата' }) {
  return new Promise((resolve) => {
    const base = selected || today;
    let focus = base;
    let result = null;
    const titleId = nextId('cal');
    const dlg = h('dialog', { class: 'a-cal', 'aria-labelledby': titleId });
    const monthLabel = h('div', { class: 'a-cal__month', 'aria-live': 'polite', id: nextId('calm') });
    const prev = h('button', { type: 'button', class: 'a-btn a-btn--secondary a-cal__nav', 'aria-label': 'Предишен месец' }, h('span', { 'aria-hidden': 'true', text: '‹' }));
    const next = h('button', { type: 'button', class: 'a-btn a-btn--secondary a-cal__nav', 'aria-label': 'Следващ месец' }, h('span', { 'aria-hidden': 'true', text: '›' }));
    const tbody = h('tbody');
    const grid = h('table', { class: 'a-cal__grid', role: 'grid', 'aria-labelledby': monthLabel.id },
      h('thead', null, h('tr', null, ...WD_SHORT.map((s, i) => h('th', { scope: 'col', abbr: WD_LONG[i], text: s })))), tbody);

    const parts = (iso) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) });
    const finish = (v) => { result = v; dlg.close(); };

    function draw() {
      const { y, m } = parts(focus);
      monthLabel.textContent = `${MONTHS[m - 1]} ${y}`;
      tbody.replaceChildren();
      const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const lead = (first + 6) % 7;
      const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
      let day = 1 - lead;
      for (let r = 0; r < 6 && day <= dim; r++) {
        const tr = h('tr');
        for (let c = 0; c < 7; c++, day++) {
          if (day < 1 || day > dim) { tr.append(h('td', { class: 'a-cal__empty' })); continue; }
          const iso = `${y}-${pad(m)}-${pad(day)}`;
          const b = h('button', {
            type: 'button', class: 'a-cal__day', tabindex: iso === focus ? '0' : '-1', 'data-d': iso,
            'aria-label': `${day} ${MONTHS_LC[m - 1]} ${y}, ${WD_LONG[c]}`, text: String(day),
          });
          if (iso === today) { b.classList.add('is-today'); b.setAttribute('aria-current', 'date'); }
          if (iso === selected) b.classList.add('is-selected');
          b.addEventListener('click', () => finish(iso));
          tr.append(h('td', { role: 'gridcell', 'aria-selected': iso === selected ? 'true' : 'false' }, b));
        }
        tbody.append(tr);
      }
    }
    function move(iso, refocus = true) {
      focus = iso; draw();
      if (refocus) { const b = tbody.querySelector(`[data-d="${iso}"]`); if (b) b.focus(); }
    }
    const shiftMonth = (n) => {
      const { y, m, d } = parts(focus);
      const t = new Date(Date.UTC(y, m - 1 + n, 1));
      const dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
      return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(Math.min(d, dim))}`;
    };
    prev.addEventListener('click', () => { focus = shiftMonth(-1); draw(); });
    next.addEventListener('click', () => { focus = shiftMonth(1); draw(); });
    grid.addEventListener('keydown', (e) => {
      const k = e.key;
      const fp = parts(focus);
      const lead = (new Date(Date.UTC(fp.y, fp.m - 1, fp.d)).getUTCDay() + 6) % 7;
      let to = null;
      if (k === 'ArrowLeft') to = addDays(focus, -1);
      else if (k === 'ArrowRight') to = addDays(focus, 1);
      else if (k === 'ArrowUp') to = addDays(focus, -7);
      else if (k === 'ArrowDown') to = addDays(focus, 7);
      else if (k === 'Home') to = addDays(focus, -lead);
      else if (k === 'End') to = addDays(focus, 6 - lead);
      else if (k === 'PageUp') to = shiftMonth(e.shiftKey ? -12 : -1);
      else if (k === 'PageDown') to = shiftMonth(e.shiftKey ? 12 : 1);
      if (to) { e.preventDefault(); move(to); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); finish(focus); }
    });

    const todayBtn = btn({ label: 'Днес', variant: 'secondary', onClick: () => finish(today) });
    const closeBtn = btn({ label: 'Затвори', variant: 'ghost', onClick: () => finish(null) });
    dlg.append(h('div', { class: 'a-cal__box' },
      h('h2', { id: titleId, class: 'a-cal__title', text: title }),
      h('div', { class: 'a-cal__head' }, prev, monthLabel, next),
      grid,
      h('div', { class: 'a-cal__foot' }, todayBtn, closeBtn)));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); });
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    draw();
    document.body.append(dlg);
    dlg.showModal();
    const f = tbody.querySelector(`[data-d="${focus}"]`);
    if (f) f.focus();
  });
}

// ---- fields ----
/**
 * Shared builder. withTime=false -> date only. Returns the same shape as ui.field()
 * ({el, input, id, value, setError, error}) plus validate(), hasFormatError, clear().
 * value: '' | 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:mm'; reading returns '' unless the text is complete and valid.
 */
function build({ label, required, helper, value, today, onInput, onBlur, clearable, withTime }) {
  const todayStr = today || sofiaToday();
  const f = field({ label, required, helper });
  const dateIn = f.input;
  dateIn.type = 'text';
  dateIn.setAttribute('inputmode', 'numeric');
  dateIn.setAttribute('autocomplete', 'off');
  dateIn.setAttribute('placeholder', 'дд.мм.гггг');
  dateIn.setAttribute('maxlength', '10');
  dateIn.classList.add('a-dt-date');
  const timeIn = withTime ? h('input', {
    type: 'text', class: 'a-input a-dt-time', inputmode: 'numeric', autocomplete: 'off', placeholder: 'ЧЧ:ММ', maxlength: '5',
    'aria-label': `Час: ${label} (ЧЧ:ММ, 24-часов формат)`,
  }) : null;
  const calBtn = h('button', { type: 'button', class: 'a-btn a-btn--secondary a-dt-cal', 'aria-haspopup': 'dialog', 'aria-label': `Избери дата от календар: ${label}` }, icon('calendar'));
  const row = h('div', { class: 'a-dt-row' });
  dateIn.replaceWith(row);
  row.append(dateIn, calBtn);
  if (timeIn) row.append(timeIn);
  let clearBtn = null;

  let fmtErr = false;
  const split = (v) => { const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(v || ''); return m ? [m[1], m[2] || ''] : ['', '']; };
  const set = (v) => { const [d, t] = split(v); dateIn.value = isoToBg(d); if (timeIn) timeIn.value = t; };
  set(value);

  const state = () => {
    const d = parseBgDate(dateIn.value);
    if (d.error) return { error: d.error, focus: dateIn };
    if (!timeIn) return { value: d.iso };
    const t = parseTime(timeIn.value);
    if (t.error) return { error: t.error, focus: timeIn };
    if (!d.iso && !t.time) return { value: '' };
    if (!d.iso) return { error: MSG_DATE_FORMAT, focus: dateIn };
    if (!t.time) return { error: MSG_TIME_MISSING, focus: timeIn };
    return { value: `${d.iso}T${t.time}` };
  };
  const baseSet = f.setError;
  // One shared message element (id `${f.id}-e`); aria-describedby / aria-invalid point from whichever input the error is about.
  const errRef = `${f.id}-e`;
  const assoc = (msg, onTime) => {
    if (!timeIn) return;
    const strip = (el) => (el.getAttribute('aria-describedby') || '').split(' ').filter((x) => x && x !== errRef);
    const dd = strip(dateIn), td = strip(timeIn);
    if (msg) (onTime ? td : dd).unshift(errRef);
    dateIn.setAttribute('aria-describedby', dd.join(' '));
    timeIn.setAttribute('aria-describedby', td.join(' '));
    if (msg && onTime) { dateIn.removeAttribute('aria-invalid'); dateIn.classList.remove('is-invalid'); timeIn.setAttribute('aria-invalid', 'true'); timeIn.classList.add('is-invalid'); }
    else { timeIn.removeAttribute('aria-invalid'); timeIn.classList.remove('is-invalid'); }
  };
  function validate() {
    const s = state();
    if (s.error) { fmtErr = true; baseSet(s.error); assoc(s.error, s.focus === timeIn); return s.error; }
    fmtErr = false; baseSet(''); assoc('', false);
    return '';
  }
  Object.defineProperty(f, 'value', {
    get() { return state().value || ''; },
    set(v) { set(v); fmtErr = false; baseSet(''); assoc('', false); },
    configurable: true,
  });
  f.setError = (msg) => { fmtErr = false; baseSet(msg); assoc(msg, false); };
  Object.defineProperty(f, 'hasFormatError', { get: () => fmtErr });
  f.validate = validate;
  f.timeInput = timeIn;
  f.focusInvalid = () => { const s = state(); (s.focus || dateIn).focus(); };

  const changed = () => { if (fmtErr) validate(); if (onInput) onInput(f); };
  attachMask(dateIn, maskDate, changed);
  if (timeIn) attachMask(timeIn, maskTime, changed);

  // validate once focus leaves the whole group (not when moving between date, calendar button and time)
  row.addEventListener('focusout', (e) => {
    if (picking || (e.relatedTarget && row.contains(e.relatedTarget))) return;
    if (document.activeElement && row.contains(document.activeElement)) return;
    validate();
    if (onBlur) onBlur(f);
  });

  let picking = false;
  calBtn.addEventListener('click', async () => {
    picking = true;
    const cur = parseBgDate(dateIn.value);
    const picked = await openCalendar({ selected: cur.iso || '', today: todayStr, title: `Избор на дата: ${label}` });
    picking = false;
    calBtn.focus();
    if (!picked) return;
    dateIn.value = isoToBg(picked);
    validate();
    if (onInput) onInput(f);
    if (timeIn && !timeIn.value) timeIn.focus(); else dateIn.focus();
  });

  if (clearable) {
    clearBtn = btn({ label: 'Изчисти', variant: 'ghost', aria: `Изчисти „${label}“`, onClick: () => { f.value = ''; if (onInput) onInput(f); dateIn.focus(); } });
    row.append(clearBtn);
  }
  return f;
}

export const dateField = (opts) => build({ ...opts, withTime: false });
export const dateTimeField = (opts) => build({ ...opts, withTime: true });
