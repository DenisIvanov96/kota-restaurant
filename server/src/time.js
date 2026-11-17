// Europe/Sofia helpers, no external libs.
//
// Sofia-local strings ("YYYY-MM-DDTHH:mm") are converted to UTC ms as follows:
//  - normal time: unique mapping.
//  - autumn overlap (local time occurs twice, e.g. 03:30 on the last Sunday of October):
//    the EARLIER instant (first occurrence, summer time, UTC+3) is used.
//  - spring-forward gap (local time does not exist, e.g. 03:30 on the last Sunday of March):
//    the time is interpreted with the offset in force BEFORE the change (UTC+2),
//    which moves it forward by one hour (03:30 -> 04:30 local).
const TZ = 'Europe/Sofia';
const DAY = 86400000;
const dtf = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function parts(ms) {
  const o = {};
  for (const p of dtf.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/** Offset of Sofia from UTC at the given instant, in ms. */
export function offsetMs(ms) {
  const p = parts(ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n, l = 2) => String(n).padStart(l, '0');

/** UTC ms -> "YYYY-MM-DDTHH:mm" in Sofia. */
export function utcToSofiaLocal(ms) {
  const p = parts(ms);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** UTC ms -> "YYYY-MM-DD" (today in Sofia). */
export function sofiaDate(ms) {
  return utcToSofiaLocal(ms).slice(0, 10);
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * DAY);
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "YYYY-MM-DDTHH:mm" (Sofia) -> UTC ms, or null if malformed / not a real calendar time. */
export function sofiaLocalToUtc(str) {
  const m = typeof str === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(str);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (!isValidDate(`${m[1]}-${m[2]}-${m[3]}`) || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offs = [...new Set([offsetMs(guess - DAY), offsetMs(guess + DAY)])];
  const ok = offs.map((o) => guess - o).filter((t) => utcToSofiaLocal(t) === str).sort((a, b) => a - b);
  if (ok.length) return ok[0];
  // gap: use the offset before the change
  return guess - offs[0];
}
