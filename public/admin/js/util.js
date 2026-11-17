// Small DOM + formatting helpers. No innerHTML anywhere: all content goes through textContent / DOM APIs.

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'open' || k === 'required') node[k] = v;
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

let uid = 0;
export const nextId = (p = 'id') => `${p}-${++uid}`;

const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  calendar: ['r:3,5,18,16,2', 'M16 3v4', 'M8 3v4', 'M3 10h18'],
  utensils: ['M7 3v8', 'M4 3v5a3 3 0 0 0 6 0V3', 'M7 11v10', 'M17 21V3c-2 1-3 4-3 8h3'],
  'book-open': ['M12 7v14', 'M3 5h6a3 3 0 0 1 3 3', 'M21 5h-6a3 3 0 0 0-3 3', 'M3 5v13h7a2 2 0 0 1 2 2', 'M21 5v13h-7a2 2 0 0 0-2 2'],
  settings: ['c:12,12,4', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.9 4.9L7 7', 'M17 17l2.1 2.1', 'M4.9 19.1L7 17', 'M17 7l2.1-2.1'],
  'log-out': ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  plus: ['M12 5v14', 'M5 12h14'],
  'arrow-up': ['M12 19V5', 'M5 12l7-7 7 7'],
  'arrow-down': ['M12 5v14', 'M19 12l-7 7-7-7'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 15h10l1-15', 'M10 11v6', 'M14 11v6'],
  pencil: ['M4 20l4-1 11-11-3-3L5 16z', 'M14 6l3 3'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'c:12,12,3'],
  upload: ['M12 16V4', 'M6 10l6-6 6 6', 'M4 20h16'],
  'file-pdf': ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 14h6', 'M9 17h4'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12l5 5 9-10'],
  alert: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17.5v.01'],
  info: ['c:12,12,9', 'M12 11v6', 'M12 7.5v.01'],
  chevron: ['M6 9l6 6 6-6'],
  clock: ['c:12,12,9', 'M12 7v5l3 2'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  image: ['r:3,4,18,16,2', 'c:9,10,1.5', 'M21 16l-5-5-9 9'],
  dot: ['c:12,12,4'],
  ring: ['c:12,12,4'],
};

export function icon(name, extraClass) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', 'a-icon' + (extraClass ? ' ' + extraClass : ''));
  for (const spec of ICONS[name] || []) {
    let el;
    if (spec.startsWith('c:')) {
      const [cx, cy, r] = spec.slice(2).split(',');
      el = document.createElementNS(SVG, 'circle');
      el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    } else if (spec.startsWith('r:')) {
      const [x, y, w, hh, rx] = spec.slice(2).split(',');
      el = document.createElementNS(SVG, 'rect');
      el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', hh); el.setAttribute('rx', rx);
    } else {
      el = document.createElementNS(SVG, 'path');
      el.setAttribute('d', spec);
    }
    svg.append(el);
  }
  return svg;
}

// ---- Bulgarian dates (no Intl, no timezone maths) ----
const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
}

export function formatDateLong(s) {
  const p = parseDate(s);
  if (!p) return '';
  const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${p.d} ${MONTHS[p.mo - 1]} ${p.y}`;
}

export const formatDateShort = (s) => {
  const p = parseDate(s);
  return p ? `${p.d} ${MONTHS[p.mo - 1]} ${p.y}` : '';
};

export function formatDateTime(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  return m ? `${formatDateLong(m[1])}, ${m[2]}:${m[3]}` : '';
}

/** "12 ноември 2026, 14:30" */
export function formatStamp(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  return m ? `${formatDateShort(m[1])}, ${m[2]}:${m[3]}` : (s ? formatDateShort(s) : '');
}

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Add days to a YYYY-MM-DD string using UTC arithmetic only (never the device clock). */
export function addDays(s, n) {
  const p = parseDate(s);
  if (!p) return '';
  const d = new Date(Date.UTC(p.y, p.mo - 1, p.d + n));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ---- Money ----
const NBSP = ' ';
export function formatPrice(cents, symbol = '€') {
  if (!cents) return '';
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${w},${frac}${NBSP}${symbol}`;
}

/** "12,50" | "12.5" | "12" | "" -> integer cents, or null when invalid. Empty = 0. */
export function parsePrice(str) {
  const t = String(str ?? '').trim().replace(/\s/g, '');
  if (t === '') return 0;
  if (!/^\d+([.,]\d{1,2})?$/.test(t)) return null;
  const [w, f = ''] = t.replace(',', '.').split('.');
  return parseInt(w, 10) * 100 + parseInt((f + '0').slice(0, 2), 10);
}

export function centsToInput(cents) {
  if (!cents) return '';
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac ? `${whole},${String(frac).padStart(2, '0')}` : String(whole);
}

export function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const kindLabel = (kindOrMime) => (kindOrMime === 'pdf' || kindOrMime === 'application/pdf' ? 'PDF' : 'Снимка');

export function groupSpaces(secret, n = 4) {
  return String(secret).replace(/\s/g, '').replace(new RegExp(`(.{${n}})`, 'g'), '$1 ').trim();
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
