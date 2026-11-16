// Bulgarian date / price formatting. No Intl, no Date objects in the browser time zone.
export const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
export const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

const RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;
const pad = (n) => String(n).padStart(2, '0');

function parts(str) {
  const m = RE.exec(String(str || ''));
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d, h: m[4] === undefined ? null : +m[4], mi: m[5] === undefined ? null : +m[5] };
}

function weekday(p) {
  return WEEKDAYS[new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay()];
}

/** 'YYYY-MM-DD' -> 'понеделник, 16 ноември 2026' ('' if invalid) */
export function formatDateLong(str) {
  const p = parts(str);
  return p ? `${weekday(p)}, ${p.d} ${MONTHS[p.mo - 1]} ${p.y}` : '';
}

/** Same, first letter uppercase: 'Понеделник, 16 ноември 2026' */
export function formatDateLongCap(str) {
  const s = formatDateLong(str);
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** 'YYYY-MM-DDTHH:mm' -> 'петък, 20 ноември 2026, 20:00' (date only if no time part) */
export function formatDateTime(str) {
  const p = parts(str);
  if (!p) return '';
  const base = formatDateLong(str);
  return p.h === null ? base : `${base}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** priceCents + symbol -> '12,50 €' (NBSP before symbol and as thousands separator); '' when 0/invalid */
export function formatPrice(cents, symbol) {
  if (!Number.isInteger(cents) || cents <= 0) return '';
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const text = `${whole},${pad(cents % 100)}`;
  return symbol ? `${text} ${symbol}` : text;
}

/** Phone as stored -> tel: href with spaces, brackets and dashes stripped */
export function telHref(phone) {
  return 'tel:' + String(phone || '').replace(/[\s()\-]/g, '');
}
