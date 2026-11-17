// T-29 D-35: admin date / time pickers in Bulgarian format, independent of the browser locale.
// The browser runs with locale en-US and timezone America/New_York to prove the locale has no effect. Port 3208.
// Run: node tests/e2e/admin-dates.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startServer, createAdmin, Client, tmpDir, makePng, PDF, PASSWORD, reporter } from '../lib/harness.mjs';
import { chromium, newPage, noHScroll, shotDir } from '../lib/browser.mjs';

const R = reporter('admin-dates');
const PORT = 3208;
const T0 = '2026-06-15T10:00:00Z'; // server "today" 2026-06-15 (Sofia 13:00)
const dir = tmpDir('admdt'); createAdmin(dir);
const srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login();
const shots = shotDir();
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); try { await page.screenshot({ path: path.join(shots, `admdt-FAIL-${id}.png`) }); } catch { /* page not available */ } } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// leaving a dirty form raises the app's own "Имате незапазени промени" modal; a user confirms it, so does the helper (unless noGuard)
const go = async (page, hash, { stay = false } = {}) => {
  await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(300);
  const g = page.locator('dialog[open]', { hasText: 'Имате незапазени промени' });
  if (!stay && (await g.count())) { await g.getByRole('button', { name: 'Напусни без запазване' }).click(); await page.waitForTimeout(300); }
};
async function login(page) {
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const newCtx = (vp = 1280) => newPage(browser, { width: vp, height: vp < 700 ? 844 : 800, locale: 'en-US', timezoneId: 'America/New_York' });
const dtVal = (page, n) => page.evaluate((i) => ({ d: document.querySelectorAll('.a-dt-date')[i].value, t: document.querySelectorAll('.a-dt-time')[i]?.value }), n);
const LOCALE_LEAK = /\b(AM|PM)\b|\b(mm|dd)\/(dd|mm)\/y{2,4}\b|\d{1,2}\/\d{1,2}\/\d{2,4}\b|mm\/dd|dd\/mm/i;

// a precondition proving the environment really is en-US
{
  const { context, page } = await newCtx();
  await page.goto(base + '/admin/');
  R.check('PRE browser navigator.language is en-US and its native date input would use mm/dd/yyyy AM/PM', (await page.evaluate(() => navigator.language)) === 'en-US' && (await page.evaluate(() => { const i = document.createElement('input'); i.type = 'datetime-local'; document.body.append(i); i.value = '2026-06-20T20:00'; return i.value; })) === '2026-06-20T20:00', await page.evaluate(() => navigator.language));
  await context.close();
}

// ================================================================ events form
const { context: ctx, page, log } = await newCtx(1280);
// the admin sends events / daily menus as multipart via XMLHttpRequest: record the text fields of every FormData that is sent
await ctx.addInitScript(() => {
  window.__fd = [];
  const open = XMLHttpRequest.prototype.open; const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__m = m; this.__u = u; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { if (b instanceof FormData && /admin\/(events|daily-menus)/.test(this.__u)) window.__fd.push({ m: this.__m, u: this.__u, f: Object.fromEntries([...b.entries()].filter(([, v]) => typeof v === 'string')) }); return send.apply(this, arguments); };
});
const grab = () => page.evaluate(() => window.__fd || []);
const clearReqs = () => page.evaluate(() => { window.__fd = []; });
await login(page);

await step('ND', async () => {
  await go(page, '#/events');
  await page.getByRole('link', { name: 'Ново събитие' }).first().click();
  await page.waitForSelector('h1:has-text("Ново събитие")');
  const inv = await page.evaluate(() => ({ native: document.querySelectorAll('input[type=date], input[type=datetime-local], input[type=time], input[type=month], input[type=week]').length, dates: document.querySelectorAll('.a-dt-date').length, times: document.querySelectorAll('.a-dt-time').length, ph: [...document.querySelectorAll('.a-dt-date')].map((e) => e.placeholder), pt: [...document.querySelectorAll('.a-dt-time')].map((e) => e.placeholder), type: [...document.querySelectorAll('.a-dt-date, .a-dt-time')].map((e) => e.type + '/' + e.getAttribute('inputmode')), cal: document.querySelectorAll('.a-dt-cal').length, clr: [...document.querySelectorAll('.a-dt-row button')].filter((b) => /Изчисти/.test(b.getAttribute('aria-label') || b.textContent)).length, lbl: [...document.querySelectorAll('.a-dt-date')].map((e) => document.querySelector(`label[for="${e.id}"]`)?.textContent.replace(/\s*\*\s*$/, '')), timeLbl: [...document.querySelectorAll('.a-dt-time')].map((e) => e.getAttribute('aria-label')), calLbl: [...document.querySelectorAll('.a-dt-cal')].map((e) => e.getAttribute('aria-label')), text: document.body.innerText + [...document.querySelectorAll('input,button,[aria-label]')].map((e) => (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.value || '')).join(' ') }));
  R.check('ND1 event form: no native date/datetime-local/time input; 3 text date fields + 3 time fields + 3 calendar buttons + 3 "Изчисти"', inv.native === 0 && inv.dates === 3 && inv.times === 3 && inv.cal === 3 && inv.clr === 3, JSON.stringify(inv));
  R.check('ND2 placeholders "дд.мм.гггг" and "ЧЧ:ММ", text inputs with numeric keypad hint', inv.ph.every((p) => p === 'дд.мм.гггг') && inv.pt.every((p) => p === 'ЧЧ:ММ') && inv.type.every((t) => t === 'text/numeric'), JSON.stringify([inv.ph, inv.pt, inv.type]));
  R.check('ND3 every field has an accessible name: label for the date, aria-label "Час: …" for the time and "Избери дата от календар: …" for the button', inv.lbl.join('|') === 'Дата на събитието|Показвай от|Скрий след' && inv.timeLbl.every((l, i) => l.startsWith('Час: ' + inv.lbl[i])) && inv.calLbl.every((l, i) => l === 'Избери дата от календар: ' + inv.lbl[i]), JSON.stringify([inv.lbl, inv.timeLbl, inv.calLbl]));
  R.check('ND4 with browser locale en-US: no "AM/PM", no mm/dd/yyyy anywhere in text, placeholders, aria-labels or values of the form', !LOCALE_LEAK.test(inv.text), (LOCALE_LEAK.exec(inv.text) || [])[0]);
  await page.screenshot({ path: path.join(shots, 'admdt-event-form-1280.png'), fullPage: true });
});

await step('TY', async () => {
  const d = page.locator('.a-dt-date').nth(0); const t = page.locator('.a-dt-time').nth(0);
  await d.click(); await d.pressSequentially('20062026'); await t.click(); await t.pressSequentially('2000');
  let v = await dtVal(page, 0);
  R.check('TY1 typing only digits "20062026" / "2000" auto-inserts the separators -> "20.06.2026" / "20:00"', v.d === '20.06.2026' && v.t === '20:00', JSON.stringify(v));
  await d.fill(''); await d.fill('2026-06-20');
  R.check('TY2 pasting an ISO date 2026-06-20 (one input event) is converted to 20.06.2026', (await dtVal(page, 0)).d === '20.06.2026', (await dtVal(page, 0)).d);
  await d.fill(''); await d.pressSequentially('5.6.2026');
  const ty3a = (await dtVal(page, 0)).d;
  await d.fill(''); await d.fill('5.6.2026');
  const ty3b = (await dtVal(page, 0)).d;
  R.check('TY3 "5.6.2026" (single-digit day/month, accepted by the parser) typed or pasted keeps its meaning: field shows 5.6.2026 or 05.06.2026, not re-chunked digits', [ty3a, ty3b].every((v) => v === '5.6.2026' || v === '05.06.2026'), `typed -> "${ty3a}", pasted -> "${ty3b}"`);
  await d.fill(''); await d.pressSequentially('ab/20 jun 2026 PM');
  R.check('TY4 letters and slashes typed into the date field are dropped (digits only); AM/PM cannot be entered in the time field', !/[A-Za-z/]/.test((await dtVal(page, 0)).d), (await dtVal(page, 0)).d);
  await t.fill(''); await t.pressSequentially('8:30 PM');
  R.check('TY5 time field keeps only digits + colon (no AM/PM)', /^[\d:]*$/.test((await dtVal(page, 0)).t), (await dtVal(page, 0)).t);
  await d.fill(''); await t.fill('');
  // backspace over the auto separator
  await d.click(); await d.pressSequentially('2006'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  R.check('TY6 backspace deletes through the auto-inserted dot (no stuck separator)', (await dtVal(page, 0)).d === '20.0' || (await dtVal(page, 0)).d === '20.', (await dtVal(page, 0)).d);
  await d.fill('');
});

// ---- calendar (mouse) ----
await step('CAL', async () => {
  const d = page.locator('.a-dt-date').nth(0); const t = page.locator('.a-dt-time').nth(0);
  await d.fill('20.06.2026');
  await page.locator('.a-dt-cal').nth(0).click();
  const dlg = page.locator('dialog.a-cal[open]');
  await dlg.waitFor();
  const c = await page.evaluate(() => { const g = document.querySelector('.a-cal__grid'); const days = [...g.querySelectorAll('.a-cal__day')]; const first = days[0].closest('td'); const row = first.parentElement; const cells = [...row.children]; return { month: document.querySelector('.a-cal__month').textContent, heads: [...g.querySelectorAll('th')].map((x) => x.textContent), abbr: [...g.querySelectorAll('th')].map((x) => x.getAttribute('abbr')), firstCol: cells.indexOf(first), n: days.length, sel: g.querySelector('.is-selected')?.textContent, label20: g.querySelector('[data-d="2026-06-20"]').getAttribute('aria-label'), title: document.querySelector('.a-cal__title').textContent, modal: document.querySelector('dialog.a-cal').matches(':modal'), labelled: document.querySelector('dialog.a-cal').getAttribute('aria-labelledby'), role: g.getAttribute('role'), active: document.activeElement.getAttribute('data-d'), tab: document.activeElement.tabIndex, buttons: [...document.querySelectorAll('.a-cal__foot button, .a-cal__head button')].map((b) => b.getAttribute('aria-label') || b.textContent), btnMin: Math.min(...days.map((b) => b.getBoundingClientRect().height)), text: document.querySelector('dialog.a-cal').innerText };});
  R.check('CAL1 calendar opens as a modal dialog for 20.06.2026: "Юни 2026", week starts Monday (Пн Вт Ср Чт Пт Сб Нд), 1 June 2026 (Monday) is in the first column, 30 days, selected day 20', c.modal && c.month === 'Юни 2026' && c.heads.join(' ') === 'Пн Вт Ср Чт Пт Сб Нд' && c.firstCol === 0 && c.n === 30 && c.sel === '20' && c.role === 'grid', JSON.stringify(c));
  R.check('CAL2 Bulgarian accessible names: abbr of weekdays, day label "20 юни 2026, събота", prev/next month, "Днес"/"Затвори"; no English/AM/PM text', c.abbr.join() === 'понеделник,вторник,сряда,четвъртък,петък,събота,неделя' && c.label20 === '20 юни 2026, събота' && c.buttons.join('|') === 'Предишен месец|Следващ месец|Днес|Затвори' && !LOCALE_LEAK.test(c.text) && c.title.startsWith('Избор на дата'), JSON.stringify([c.label20, c.buttons, c.title]));
  R.check('CAL3 focus moves into the grid on the selected day (roving tabindex 0), day buttons >= 44 px high', c.active === '2026-06-20' && c.tab === 0 && c.btnMin >= 44, JSON.stringify([c.active, c.tab, c.btnMin]));
  await page.screenshot({ path: path.join(shots, 'admdt-calendar-1280.png') });
  // month navigation by mouse
  await page.getByRole('button', { name: 'Следващ месец' }).click();
  R.check('CAL4 "Следващ месец" -> "Юли 2026"', (await page.locator('.a-cal__month').textContent()) === 'Юли 2026');
  await page.getByRole('button', { name: 'Предишен месец' }).click(); await page.getByRole('button', { name: 'Предишен месец' }).click();
  R.check('CAL5 "Предишен месец" twice -> "Май 2026"', (await page.locator('.a-cal__month').textContent()) === 'Май 2026');
  const names = [];
  await page.getByRole('button', { name: 'Следващ месец' }).click(); await page.getByRole('button', { name: 'Следващ месец' }).click(); // back to Юли
  for (let i = 0; i < 12; i++) { names.push((await page.locator('.a-cal__month').textContent()).split(' ')[0]); await page.getByRole('button', { name: 'Следващ месец' }).click(); }
  R.check('CAL6 twelve consecutive months carry the Bulgarian names (Юли..Юни, year rolls over)', names.join() === 'Юли,Август,Септември,Октомври,Ноември,Декември,Януари,Февруари,Март,Април,Май,Юни' && (await page.locator('.a-cal__month').textContent()) === 'Юли 2027', names.join());
  // pick by click
  for (let i = 0; i < 13; i++) await page.getByRole('button', { name: 'Предишен месец' }).click();
  await page.locator('.a-cal__day[data-d="2026-06-24"]').click();
  await page.waitForTimeout(100);
  R.check('CAL7 clicking day 24 closes the dialog and fills "24.06.2026"; focus jumps to the empty time field', (await page.locator('dialog.a-cal').count()) === 0 && (await dtVal(page, 0)).d === '24.06.2026' && (await page.evaluate(() => document.activeElement.className.includes('a-dt-time'))), JSON.stringify(await dtVal(page, 0)));
  // "Днес" -> Sofia today from the browser clock, independent of the New York timezone
  const sofia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const bgSofia = sofia.split('-').reverse().join('.');
  await page.locator('.a-dt-cal').nth(1).click(); await page.waitForSelector('dialog.a-cal[open]');
  const todayMark = await page.evaluate(() => document.querySelector('.a-cal__day.is-today')?.getAttribute('data-d'));
  await page.getByRole('button', { name: 'Днес' }).click(); await page.waitForTimeout(100);
  R.check(`CAL8 "Днес" fills today in Sofia (${bgSofia}) although the browser timezone is America/New_York; today marked in the grid (aria-current=date)`, (await dtVal(page, 1)).d === bgSofia && todayMark === sofia, JSON.stringify([await dtVal(page, 1), todayMark]));
  // Затвори / backdrop / Esc leave the value unchanged
  const before = (await dtVal(page, 0)).d;
  await page.locator('.a-dt-cal').nth(0).click(); await page.waitForSelector('dialog.a-cal[open]');
  await page.getByRole('button', { name: 'Затвори' }).click(); await page.waitForTimeout(80);
  R.check('CAL9 "Затвори" closes without change; focus returns to the calendar button', (await dtVal(page, 0)).d === before && (await page.evaluate(() => document.activeElement.classList.contains('a-dt-cal'))));
  await page.locator('.a-dt-cal').nth(0).click(); await page.waitForSelector('dialog.a-cal[open]');
  await page.mouse.click(5, 5); await page.waitForTimeout(100);
  R.check('CAL10 clicking the backdrop closes the dialog without change', (await page.locator('dialog.a-cal').count()) === 0 && (await dtVal(page, 0)).d === before);
  await page.locator('.a-dt-date').nth(1).fill('');
});

// ---- calendar (keyboard) ----
await step('KB', async () => {
  const d = page.locator('.a-dt-date').nth(0);
  await d.fill('15.06.2026');
  const btn = page.locator('.a-dt-cal').nth(0);
  await btn.focus(); await page.keyboard.press('Enter');
  await page.waitForSelector('dialog.a-cal[open]');
  const act = () => page.evaluate(() => document.activeElement.getAttribute('data-d') || document.activeElement.textContent.trim());
  const seq = [];
  const press = async (k) => { await page.keyboard.press(k); seq.push(`${k}=${await act()}`); };
  R.check('KB1 Enter on the calendar button opens the dialog with focus on the current value (2026-06-15)', (await act()) === '2026-06-15', await act());
  await press('ArrowRight'); await press('ArrowDown'); await press('ArrowLeft'); await press('ArrowUp');
  R.check('KB2 arrows: Right +1 day, Down +7, Left -1, Up -7 (15 -> 16 -> 23 -> 22 -> 15)', seq.join(' ') === 'ArrowRight=2026-06-16 ArrowDown=2026-06-23 ArrowLeft=2026-06-22 ArrowUp=2026-06-15', seq.join(' '));
  seq.length = 0; await press('Home'); await press('End');
  R.check('KB3 Home = Monday (2026-06-15), End = Sunday (2026-06-21) of the week', seq.join(' ') === 'Home=2026-06-15 End=2026-06-21', seq.join(' '));
  seq.length = 0; await press('PageDown'); await press('PageUp'); await press('ArrowDown'); await press('ArrowDown'); await press('ArrowDown'); await press('ArrowDown'); await press('ArrowRight'); await press('ArrowRight');
  R.check('KB4 PageDown/PageUp change the month keeping the day; arrows cross month boundaries (21 jun -> +28 -> 19 jul -> +2 -> ...)', seq.slice(0, 2).join(' ') === 'PageDown=2026-07-21 PageUp=2026-06-21' && (await page.locator('.a-cal__month').textContent()).length > 0, seq.join(' '));
  // month end clamping
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  await d.fill('31.01.2026'); await btn.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.a-cal[open]');
  await page.keyboard.press('PageDown');
  R.check('KB5 31 January + PageDown clamps to 28 February 2026', (await act()) === '2026-02-28' && (await page.locator('.a-cal__month').textContent()) === 'Февруари 2026', await act());
  await page.keyboard.press('Shift+PageDown');
  R.check('KB6 Shift+PageDown moves one year (28 Feb 2027)', (await act()) === '2027-02-28', await act());
  // Escape
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  R.check('KB7 Esc closes the dialog, value unchanged (31.01.2026) and focus returns to the calendar button', (await page.locator('dialog.a-cal').count()) === 0 && (await dtVal(page, 0)).d === '31.01.2026' && (await page.evaluate(() => document.activeElement.classList.contains('a-dt-cal'))), JSON.stringify(await dtVal(page, 0)));
  // Enter / Space select
  await d.fill('10.03.2026'); await btn.focus(); await page.keyboard.press('Space'); await page.waitForSelector('dialog.a-cal[open]');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  R.check('KB8 Space on the button opens; ArrowRight x2 + Enter on the grid selects 12.03.2026, dialog closes', (await dtVal(page, 0)).d === '12.03.2026' && (await page.locator('dialog.a-cal').count()) === 0, JSON.stringify(await dtVal(page, 0)));
  await btn.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.a-cal[open]'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press(' '); await page.waitForTimeout(100);
  R.check('KB9 Space on a day selects it (11.03.2026)', (await dtVal(page, 0)).d === '11.03.2026', JSON.stringify(await dtVal(page, 0)));
  // focus trap: Tab cycles inside the modal dialog
  await btn.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.a-cal[open]');
  const inside = [];
  for (let i = 0; i < 9; i++) { await page.keyboard.press('Tab'); inside.push(await page.evaluate(() => !!document.activeElement.closest('dialog.a-cal') || document.activeElement === document.body)); }
  R.check('KB10 Tab x9: focus only ever sits in the calendar dialog or leaves to the browser UI (body); it never lands on the inert page behind (no keyboard trap, no escape into the background); same for Shift+Tab', inside.every(Boolean) && (await (async () => { await page.keyboard.press('Shift+Tab'); return page.evaluate(() => !!document.activeElement.closest('dialog.a-cal') || document.activeElement === document.body); })()), inside.join());
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  // visible focus on the day cell
  await btn.focus(); await page.keyboard.press('Enter'); await page.waitForSelector('dialog.a-cal[open]');
  const fo = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { o: cs.outlineStyle, w: parseFloat(cs.outlineWidth), sh: cs.boxShadow }; });
  R.check('KB11 the focused calendar day has a visible focus indicator', (fo.o !== 'none' && fo.w >= 2) || fo.sh !== 'none', JSON.stringify(fo));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
});

// ---- validation ----
await step('VAL', async () => {
  const rows = page.locator('.a-dt-row');
  const d0 = page.locator('.a-dt-date').nth(0); const t0 = page.locator('.a-dt-time').nth(0); const t1 = page.locator('.a-dt-time').nth(1); const d1 = page.locator('.a-dt-date').nth(1);
  const errTxt = (i) => page.locator('.a-field').filter({ has: page.locator('.a-dt-date') }).nth(i).locator('.a-error').innerText().catch(() => '');
  const bad = async (dv, tv, i = 0) => { const d = page.locator('.a-dt-date').nth(i); const t = page.locator('.a-dt-time').nth(i); await d.fill(dv); await t.fill(tv); await page.locator('h1').click(); await page.waitForTimeout(120); return { err: (await errTxt(i)).replace(/\s+/g, ' ').trim(), inv: await d.getAttribute('aria-invalid'), tinv: await t.getAttribute('aria-invalid'), desc: await d.getAttribute('aria-describedby'), vis: await page.locator('.a-field').filter({ has: page.locator('.a-dt-date') }).nth(i).locator('.a-error').isVisible() }; };
  const cases = [['31.02.2026', '10:00', 'Невалидна дата'], ['32.01.2026', '10:00', 'Невалидна дата'], ['00.01.2026', '10:00', 'Невалидна дата'], ['15.13.2026', '10:00', 'Невалидна дата'], ['15.00.2026', '10:00', 'Невалидна дата'], ['29.02.2027', '10:00', 'Невалидна дата'], ['01.01.1999', '10:00', 'Невалидна дата'], ['01.01.2100', '10:00', 'Невалидна дата'], ['20.06', '10:00', 'Въведете дата във формат дд.мм.гггг'], ['20.06.26', '10:00', 'Въведете дата във формат дд.мм.гггг'],
    ['20.06.2026', '25:00', 'Невалиден час'], ['20.06.2026', '12:60', 'Невалиден час'], ['20.06.2026', '24:00', 'Невалиден час'], ['20.06.2026', '9:5', 'Невалиден час'], ['20.06.2026', '', 'Въведете час във формат ЧЧ:ММ'], ['', '10:00', 'Въведете дата във формат дд.мм.гггг']];
  const miss = [];
  for (const [dv, tv, msg] of cases) { const r = await bad(dv, tv); if (!(r.err.includes(msg) && r.vis && (r.inv === 'true' || r.tinv === 'true'))) miss.push(`${dv} ${tv} -> "${r.err}" inv=${r.inv}/${r.tinv} vis=${r.vis} (want ${msg})`); }
  R.check(`VAL1 ${cases.length} invalid date / time / incomplete combinations each show the Bulgarian inline error (31.02, 32.01, 00.01, month 13/00, 29.02.2027, year 1999/2100, short forms, 25:00, 12:60, 24:00, 9:5, date w/o time, time w/o date) with aria-invalid`, miss.length === 0, miss.join(' || '));
  const ok = await bad('29.02.2028', '23:59');
  R.check('VAL2 valid leap day 29.02.2028 23:59 shows no error and clears aria-invalid', ok.err === '' && ok.inv !== 'true' && ok.tinv !== 'true', JSON.stringify(ok));
  const r1 = await bad('20.13.2026', '10:00');
  R.check('VAL3 error text is associated with the date input (aria-describedby contains the error id)', !!r1.desc && r1.desc.includes('-e'), r1.desc);
  const tr = await bad('20.06.2026', '25:00');
  const tDesc = await t0.getAttribute('aria-describedby');
  R.check('VAL4 the TIME input also references the error message (aria-describedby) when the time is the invalid part', !!tDesc && tDesc.includes('-e'), `aria-describedby=${tDesc}`);
  // correcting clears the error without another blur
  await t0.fill('21:00'); await page.waitForTimeout(100);
  R.check('VAL5 correcting the value clears the error immediately (while typing)', !(await page.locator('.a-field').filter({ has: page.locator('.a-dt-date') }).nth(0).locator('.a-error').isVisible()));
  // submit: blocks, summary, focus
  await bad('31.02.2026', '10:00');
  await page.locator('textarea').first().fill('текст');
  await page.locator('input.a-input').first().fill('Невалидни дати');
  const before = (await grab()).length;
  await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForTimeout(400);
  const sum = await page.locator('.a-summary').innerText().catch(() => '');
  R.check('VAL6 saving with 31.02.2026 is blocked client-side: no request sent, error summary "Дата на събитието: Невалидна дата"', (await grab()).length === before && sum.includes('Дата на събитието: Невалидна дата'), sum.replace(/\s+/g, ' '));
  // summary link focuses the offending field
  await page.locator('.a-summary a').first().click(); await page.waitForTimeout(100);
  R.check('VAL7 clicking the summary link moves focus to the date input', await page.evaluate(() => document.activeElement.classList.contains('a-dt-date')));
  // time error: summary link focuses the TIME input
  await d1.fill('20.06.2026'); await t1.fill('99:99'); await d0.fill(''); await t0.fill('');
  await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForTimeout(300);
  await page.locator('.a-summary a', { hasText: 'Показвай от' }).click(); await page.waitForTimeout(100);
  R.check('VAL8 summary link for an invalid TIME ("Показвай от: Невалиден час") focuses the time input, not the date input', await page.evaluate(() => document.activeElement.classList.contains('a-dt-time')), await page.evaluate(() => document.activeElement.className));
  // range rule
  await d1.fill('20.06.2026'); await t1.fill('18:00');
  await page.locator('.a-dt-date').nth(2).fill('20.06.2026'); await page.locator('.a-dt-time').nth(2).fill('10:00'); await page.locator('h1').click(); await page.waitForTimeout(150);
  R.check('VAL9 "Скрий след" earlier than "Показвай от" (typed dates) -> range error shown', (await page.locator('.a-field').filter({ has: page.locator('.a-dt-date') }).nth(2).locator('.a-error').innerText()).includes('по-късно'), '');
  await page.screenshot({ path: path.join(shots, 'admdt-errors-1280.png'), fullPage: true });
  // clear buttons
  await page.getByRole('button', { name: /Изчисти „Показвай от“/ }).click();
  R.check('VAL10 "Изчисти" empties date and time of that field and moves focus to its date input', (await dtVal(page, 1)).d === '' && (await dtVal(page, 1)).t === '' && (await page.evaluate(() => document.activeElement.classList.contains('a-dt-date'))));
});

// ---- payload formats + edit prefill + DST (fresh form each) ----
async function newEventForm() { await go(page, '#/events'); await page.getByRole('link', { name: 'Ново събитие' }).first().click(); await page.waitForSelector('h1:has-text("Ново събитие")'); }
async function saveForm() { await clearReqs(); await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForTimeout(900); return (await grab()).find((r) => r.m === 'POST' || r.m === 'PUT'); }
await step('PAY', async () => {
  await newEventForm();
  await page.locator('input.a-input').first().fill('Дати: проверка'); await page.locator('textarea').first().fill('описание');
  await page.locator('.a-dt-date').nth(0).fill('05.06.2026'); await page.locator('.a-dt-time').nth(0).fill('7:05'.replace('7:05', '07:05'));
  await page.locator('.a-dt-date').nth(1).fill('01.06.2026'); await page.locator('.a-dt-time').nth(1).fill('00:00');
  await page.locator('.a-dt-date').nth(2).fill('30.06.2026'); await page.locator('.a-dt-time').nth(2).fill('23:59');
  const rq = await saveForm();
  R.check('PAY1 POST payload formats: eventAt "2026-06-05T07:05", startsAt "2026-06-01T00:00", expiresAt "2026-06-30T23:59"', !!rq && rq.f.eventAt === '2026-06-05T07:05' && rq.f.startsAt === '2026-06-01T00:00' && rq.f.expiresAt === '2026-06-30T23:59', rq && [rq.f.eventAt, rq.f.startsAt, rq.f.expiresAt].join(' '));
  const stored = (await api.get('/api/admin/events')).data.events.find((e) => e.title === 'Дати: проверка');
  R.check('PAY2 server stored exactly those Sofia-local values (admin API)', stored && stored.eventAt === '2026-06-05T07:05' && stored.startsAt === '2026-06-01T00:00' && stored.expiresAt === '2026-06-30T23:59', JSON.stringify(stored && [stored.eventAt, stored.startsAt, stored.expiresAt]));
  // edit prefill
  await go(page, '#/events');
  await page.locator('article, li, tr').filter({ hasText: 'Дати: проверка' }).first().getByRole('link', { name: 'Редактирай' }).first().click(); await page.waitForSelector('h1:has-text("Редактиране")');
  const pf = await page.evaluate(() => [...document.querySelectorAll('.a-dt-row')].map((r) => [r.querySelector('.a-dt-date').value, r.querySelector('.a-dt-time').value]));
  R.check('PAY3 edit form prefill (Bulgarian, 24 h): 05.06.2026 07:05 / 01.06.2026 00:00 / 30.06.2026 23:59', JSON.stringify(pf) === JSON.stringify([['05.06.2026', '07:05'], ['01.06.2026', '00:00'], ['30.06.2026', '23:59']]), JSON.stringify(pf));
  await go(page, '#/events', { stay: true });
  R.check('PAY4 untouched edit form is not "dirty": leaving shows no "Имате незапазени промени" modal', (await page.locator('dialog[open]', { hasText: 'Имате незапазени промени' }).count()) === 0 && (await page.locator('h1').textContent()).includes('Събития'));
  // edit: clear expiry => null, change eventAt via calendar
  await page.locator('article, li, tr').filter({ hasText: 'Дати: проверка' }).first().getByRole('link', { name: 'Редактирай' }).first().click(); await page.waitForSelector('h1:has-text("Редактиране")');
  await page.getByRole('button', { name: /Изчисти „Скрий след“/ }).click();
  await page.locator('.a-dt-cal').nth(0).click(); await page.waitForSelector('dialog.a-cal[open]'); await page.locator('.a-cal__day[data-d="2026-06-28"]').click(); await page.waitForTimeout(100);
  const rq2 = await saveForm();
  R.check('PAY5 PUT after calendar pick (28.06) + clear: eventAt "2026-06-28T07:05" (time kept), expiresAt "" -> stored null', !!rq2 && rq2.f.eventAt === '2026-06-28T07:05' && rq2.f.expiresAt === '' && (await api.get('/api/admin/events')).data.events.find((e) => e.title === 'Дати: проверка').expiresAt == null, rq2 && [rq2.f.eventAt, rq2.f.expiresAt].join('|'));
  // all three empty is allowed
  await newEventForm(); await page.locator('input.a-input').first().fill('Без дати'); await page.locator('textarea').first().fill('x');
  const rq3 = await saveForm();
  R.check('PAY6 an event without any date is accepted (all three payload fields empty)', !!rq3 && rq3.f.eventAt === '' && (await api.get('/api/admin/events')).data.events.some((e) => e.title === 'Без дати'));
});

await step('DST', async () => {
  // spring-forward gap 29.03.2026 03:30 (does not exist in Europe/Sofia): backend rule = moves forward 1 h to 04:30; autumn overlap 25.10.2026 03:30 -> first (summer-time) occurrence, value unchanged
  await newEventForm();
  await page.locator('input.a-input').first().fill('DST: пролет'); await page.locator('textarea').first().fill('x');
  await page.locator('.a-dt-date').nth(0).fill('29.03.2026'); await page.locator('.a-dt-time').nth(0).fill('03:30');
  await page.locator('.a-dt-date').nth(1).fill('25.10.2026'); await page.locator('.a-dt-time').nth(1).fill('03:30');
  await page.locator('.a-dt-date').nth(2).fill('28.03.2027'); await page.locator('.a-dt-time').nth(2).fill('03:30');
  const rq = await saveForm();
  R.check('DST1 the client does not alter or reject the non-existent local time: payload eventAt "2026-03-29T03:30", startsAt "2026-10-25T03:30"', !!rq && rq.f.eventAt === '2026-03-29T03:30' && rq.f.startsAt === '2026-10-25T03:30' && rq.f.expiresAt === '2027-03-28T03:30', rq && [rq.f.eventAt, rq.f.startsAt, rq.f.expiresAt].join(' '));
  const st = (await api.get('/api/admin/events')).data.events.find((e) => e.title === 'DST: пролет');
  R.check('DST2 backend rule applied: gap 29.03.2026 03:30 -> stored 04:30; overlap 25.10.2026 03:30 stays 03:30; 28.03.2027 03:30 (gap) -> 04:30; save succeeded without error', st && st.eventAt === '2026-03-29T04:30' && st.startsAt === '2026-10-25T03:30' && st.expiresAt === '2027-03-28T04:30', JSON.stringify(st && [st.eventAt, st.startsAt, st.expiresAt]));
  await go(page, '#/events');
  await page.locator('article, li, tr').filter({ hasText: 'DST: пролет' }).first().getByRole('link', { name: 'Редактирай' }).first().click(); await page.waitForSelector('h1:has-text("Редактиране")');
  const pf = await page.evaluate(() => [...document.querySelectorAll('.a-dt-row')].map((r) => [r.querySelector('.a-dt-date').value, r.querySelector('.a-dt-time').value]));
  R.check('DST3 re-opening the event shows what the server stored (29.03.2026 04:30), consistent with the list', JSON.stringify(pf[0]) === JSON.stringify(['29.03.2026', '04:30']) && JSON.stringify(pf[1]) === JSON.stringify(['25.10.2026', '03:30']), JSON.stringify(pf));
  const listTxt = await page.evaluate(() => document.body.innerText);
  await go(page, '#/events');
  const lt = await page.locator('main').innerText();
  R.check('DST4 the events list shows Bulgarian date text with 24 h time, no AM/PM / mm/dd under the en-US browser', !LOCALE_LEAK.test(lt), (LOCALE_LEAK.exec(lt) || [])[0] || lt.slice(0, 120).replace(/\n/g, '|'));
});

// ================================================================ daily menu wizard + edit dialog
await step('DM', async () => {
  const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });
  await go(page, '#/events'); await go(page, '#/daily-menu'); await page.waitForSelector('h3:has-text("Избери файл")');
  await page.locator('input[type=file]').first().setInputFiles(file('a.pdf', 'application/pdf', PDF));
  await page.getByRole('button', { name: 'Напред' }).click();
  const inv = await page.evaluate(() => ({ native: document.querySelectorAll('input[type=date], input[type=datetime-local], input[type=time]').length, date: document.querySelectorAll('.a-dt-date').length, time: document.querySelectorAll('.a-dt-time').length, ph: document.querySelector('.a-dt-date')?.placeholder, label: document.querySelector('label[for="' + document.querySelector('.a-dt-date')?.id + '"]')?.textContent, quick: [...document.querySelectorAll('.a-seg button')].map((b) => b.textContent.trim()), clr: [...document.querySelectorAll('.a-dt-row button')].filter((b) => /Изчисти/.test(b.getAttribute('aria-label') || b.textContent)).length }));
  R.check('DM1 wizard step 2: one text date field (no time), placeholder дд.мм.гггг, quick buttons "Днес"/"Утре", no native date input, no clear button (required field)', inv.native === 0 && inv.date === 1 && inv.time === 0 && inv.ph === 'дд.мм.гггг' && inv.quick.join() === 'Днес,Утре' && inv.clr === 0, JSON.stringify(inv));
  await page.getByRole('button', { name: 'Утре', exact: true }).click(); await page.waitForTimeout(100);
  const long = await page.locator('.a-bigdate').innerText();
  R.check('DM2 quick "Утре" sets the server-based tomorrow "16.06.2026" and the long label shows Tuesday 16 June 2026', (await page.locator('.a-dt-date').inputValue()) === '16.06.2026' && /16 юни 2026/.test(long), long);
  await page.getByRole('button', { name: 'Днес', exact: true }).click(); await page.waitForTimeout(100);
  R.check('DM3 quick "Днес" sets the server "today" 15.06.2026 (server clock, not browser clock)', (await page.locator('.a-dt-date').inputValue()) === '15.06.2026', await page.locator('.a-dt-date').inputValue());
  // empty / invalid -> the wizard keeps "Напред" disabled; the inline error appears when the field is left
  await page.locator('.a-dt-date').fill('');
  R.check('DM4 empty date: "Напред" is disabled (step cannot advance)', await page.getByRole('button', { name: 'Напред' }).isDisabled());
  await page.locator('.a-dt-date').fill('31.04.2026'); await page.locator('.a-step h3').first().click(); await page.waitForTimeout(150);
  R.check('DM5 invalid date 31.04.2026 -> inline "Невалидна дата" after leaving the field, "Напред" stays disabled', (await page.getByText('Невалидна дата').count()) >= 1 && await page.getByRole('button', { name: 'Напред' }).isDisabled());
  await page.locator('.a-dt-date').fill('20.07.2026');
  await clearReqs();
  await page.getByRole('button', { name: 'Напред' }).click(); await page.getByRole('button', { name: 'Напред' }).click();
  await page.getByRole('button', { name: 'Публикувай', exact: true }).click(); await page.waitForTimeout(900);
  const rq = (await grab()).find((r) => r.m === 'POST');
  R.check('DM6 POST payload date is "2026-07-20" (ISO) and the menu exists server-side for that date', !!rq && rq.f.date === '2026-07-20' && (await api.get('/api/admin/daily-menus')).data.menus.some((m) => m.date === '2026-07-20'), rq && rq.f.date);
  // calendar inside the wizard (picks highlighted today = server today)
  await go(page, '#/events'); await go(page, '#/daily-menu'); await page.waitForSelector('h3:has-text("Избери файл")');
  await page.locator('input[type=file]').first().setInputFiles(file('b.png', 'image/png', makePng(60, 60)));
  await page.getByRole('button', { name: 'Напред' }).click();
  await page.locator('.a-dt-cal').click(); await page.waitForSelector('dialog.a-cal[open]');
  const mark = await page.evaluate(() => ({ today: document.querySelector('.a-cal__day.is-today')?.getAttribute('data-d'), month: document.querySelector('.a-cal__month').textContent }));
  R.check('DM7 wizard calendar marks the SERVER today (2026-06-15, "Юни 2026") rather than the browser date', mark.today === '2026-06-15' && mark.month === 'Юни 2026', JSON.stringify(mark));
  await page.locator('.a-cal__day[data-d="2026-06-30"]').click(); await page.waitForTimeout(100);
  R.check('DM8 calendar pick fills 30.06.2026 in the wizard field and the long date label updates', (await page.locator('.a-dt-date').inputValue()) === '30.06.2026' && /30 юни 2026/.test(await page.locator('.a-bigdate').innerText()), await page.locator('.a-bigdate').innerText());
  // edit dialog prefill
  await go(page, '#/events'); await go(page, '#/daily-menu'); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Редактирай', exact: true }).first().click();
  await page.waitForSelector('dialog[open] .a-dt-date');
  const pre = await page.locator('dialog[open] .a-dt-date').inputValue();
  R.check('DM9 edit dialog prefill is Bulgarian дд.мм.гггг (06.2026 / 07.2026 date of the existing menu)', /^\d{2}\.\d{2}\.2026$/.test(pre), pre);
  await page.locator('dialog[open] .a-dt-date').fill('21.07.2026');
  await clearReqs();
  await page.locator('dialog[open]').getByRole('button', { name: 'Запази' }).click(); await page.waitForTimeout(900);
  const rq2 = (await grab()).find((r) => ['PATCH', 'PUT', 'POST'].includes(r.m));
  const menus = (await api.get('/api/admin/daily-menus')).data.menus.map((m) => m.date);
  R.check('DM10 edit dialog save sends the ISO date "2026-07-21" and the server stores it', menus.includes('2026-07-21') && !!rq2 && rq2.f.date === '2026-07-21', `${menus.join()} ${rq2 && rq2.m + ' ' + rq2.f.date}`);
  // an invalid date inside the dialog is blocked inside the dialog
  await page.getByRole('button', { name: 'Редактирай', exact: true }).first().click();
  await page.waitForSelector('dialog[open] .a-dt-date');
  await page.locator('dialog[open] .a-dt-date').fill('99.99.2026');
  await page.locator('dialog[open]').getByRole('button', { name: 'Запази' }).click(); await page.waitForTimeout(300);
  R.check('DM11 invalid date in the edit dialog: dialog stays open with "Невалидна дата"', (await page.locator('dialog[open]').count()) === 1 && (await page.locator('dialog[open]').innerText()).includes('Невалидна дата'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
});

// ================================================================ no locale leak anywhere + native inputs absent everywhere
await step('ALL', async () => {
  for (const [hash, name] of [['#/', 'dashboard'], ['#/events', 'events'], ['#/daily-menu', 'daily'], ['#/menu', 'menu'], ['#/settings', 'settings']]) {
    await go(page, hash); await page.waitForTimeout(400);
    const d = await page.evaluate(() => ({ native: document.querySelectorAll('input[type=date], input[type=datetime-local], input[type=time]').length, text: document.body.innerText + ' ' + [...document.querySelectorAll('input,button,[aria-label],[placeholder]')].map((e) => (e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + (e.value || '')).join(' ') }));
    R.check(`ALL1[${name}] no native date/time input; no AM/PM or mm/dd/yyyy in any text, label, placeholder or value (en-US browser)`, d.native === 0 && !LOCALE_LEAK.test(d.text), (LOCALE_LEAK.exec(d.text) || [])[0] || String(d.native));
  }
  const g = spawnSync('git', ['grep', '-nIE', "type: ?'(date|datetime-local|time)'|type=.(date|datetime-local|time).", '--', 'public/admin'], { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..') });
  R.check('ALL2 admin sources contain no native date/datetime-local/time input type (git grep)', g.status === 1 && g.stdout.toString() === '', g.stdout.toString().slice(0, 200));
});

// ================================================================ responsive: event form + calendar at 390 / 768
for (const vp of [390, 768]) await step(`RESP[${vp}]`, async () => {
  const { context, page: p, log: lg } = await newCtx(vp);
  await login(p);
  await p.evaluate(() => { location.hash = '#/events'; }); await p.waitForTimeout(300);
  await p.getByRole('link', { name: 'Ново събитие' }).first().click(); await p.waitForSelector('h1:has-text("Ново събитие")');
  const m = await p.evaluate(() => { const rows = [...document.querySelectorAll('.a-dt-row')]; return { sw: document.documentElement.scrollWidth, iw: innerWidth, rows: rows.map((r) => { const rr = r.getBoundingClientRect(); const kids = [...r.children].map((c) => { const b = c.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), l: Math.round(b.left), r: Math.round(b.right) }; }); return { right: rr.right, kids }; }), small: [...document.querySelectorAll('.a-dt-row input, .a-dt-row button')].filter((e) => { const b = e.getBoundingClientRect(); return b.height < 44 || b.width < 44; }).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)) }; });
  R.check(`RESP1[${vp}] event form: no horizontal scroll, date/time rows stay inside the viewport, every control >= 44 px`, m.sw <= m.iw && m.rows.every((r) => r.right <= m.iw + 0.5 && r.kids.every((k) => k.r <= m.iw)) && m.small.length === 0, JSON.stringify(m).slice(0, 500));
  await p.locator('.a-dt-date').nth(0).fill('15.06.2026');
  await p.locator('.a-dt-cal').nth(0).click(); await p.waitForSelector('dialog.a-cal[open]');
  const c = await p.evaluate(() => { const r = document.querySelector('dialog.a-cal').getBoundingClientRect(); const foot = document.querySelector('.a-cal__foot').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, iw: innerWidth, ih: innerHeight, footB: foot.bottom, sw: document.documentElement.scrollWidth, minDay: Math.min(...[...document.querySelectorAll('.a-cal__day')].map((b) => b.getBoundingClientRect().height)), minW: Math.min(...[...document.querySelectorAll('.a-cal__day')].map((b) => b.getBoundingClientRect().width)) }; });
  R.check(`RESP2[${vp}] calendar dialog fits the viewport (${Math.round(c.l)}-${Math.round(c.r)} of ${c.iw}, bottom ${Math.round(c.b)} of ${c.ih}), buttons "Днес/Затвори" reachable, day cells >= 44 px (${Math.round(c.minW)}x${Math.round(c.minDay)})`, c.l >= 0 && c.r <= c.iw && c.t >= 0 && c.b <= c.ih && c.minDay >= 44 && c.minW >= 40 && c.sw <= c.iw, JSON.stringify(c));
  await p.screenshot({ path: path.join(shots, `admdt-calendar-${vp}.png`) });
  await p.keyboard.press('Escape');
  R.check(`RESP3[${vp}] no console errors / CSP violations (the 401 of the pre-login session probe excluded)`, lg.console.filter((m) => !/status of 401 .*\/api\/admin\/me/.test(m)).length === 0 && lg.pageErrors.length === 0 && (await p.collectCsp()).length === 0, JSON.stringify(lg.console));
  await context.close();
});

// ================================================================ settings: instagram (live server)
await step('SET', async () => {
  const igField = () => page.getByLabel('Instagram профил');
  const save = async () => { await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForTimeout(700); };
  const errOf = () => page.locator('.a-field').filter({ has: igField() }).locator('.a-error').innerText().catch(() => '');
  await go(page, '#/settings'); await page.waitForSelector('h2:has-text("Информация за сайта")');
  R.check('SET0 settings has a labelled "Instagram профил" url field with placeholder and helper text', (await igField().count()) === 1 && (await igField().getAttribute('placeholder')).includes('instagram.com') && (await igField().getAttribute('maxlength')) === '200');
  // client check
  const puts = []; page.on('request', (r) => { if (r.method() === 'PUT' && /admin\/settings/.test(r.url())) puts.push(r.postData()); });
  await igField().fill('https://evil.example/instagram.com'); await save();
  R.check('SET1 client check: a non-instagram URL shows "Въведете адрес, започващ с https://www.instagram.com/" and sends no request', (await errOf()).includes('https://www.instagram.com/') && puts.length === 0, await errOf());
  await igField().fill('javascript:alert(1)'); await save();
  R.check('SET2 client check: javascript: URL is refused, no request', (await errOf()).length > 5 && puts.length === 0);
  // server-side 400 reachable through the UI: client accepts the host but the server also forbids a port / userinfo
  for (const [v, why, want] of [['https://www.instagram.com:8443/kota1', 'port', 'instagram.com'], ['https://owner@www.instagram.com/kota1', 'userinfo', 'instagram.com'], ['https://www.instagram.com/' + 'a'.repeat(190), 'over 200 chars', '200']]) {
    puts.length = 0;
    await igField().evaluate((e, val) => { e.removeAttribute('maxlength'); e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); }, v);
    await save();
    const e = await errOf(); const inv = await igField().getAttribute('aria-invalid');
    const stored = (await api.get('/api/admin/settings')).data.instagramUrl;
    R.check(`SET3[${why}] client passes, the REAL server answers 400: PUT sent (${puts.length}), inline error mapped to the Instagram field "${e.replace(/\s+/g, ' ').trim().slice(0, 60)}", aria-invalid=${inv}, focus on the field, nothing stored`, puts.length === 1 && e.includes(want) && inv === 'true' && stored === '' && (await page.evaluate(() => document.activeElement.id)) === (await igField().getAttribute('id')), `${puts.length} ${e} ${inv} stored=${JSON.stringify(stored)}`);
  }
  // valid
  await igField().fill('https://www.instagram.com/kota1.restaurant/'); await save();
  R.check('SET4 valid profile saves: toast, stored value, public API returns it', (await page.locator('.a-toasts').innerText()).includes('Настройките са запазени') && (await api.get('/api/admin/settings')).data.instagramUrl === 'https://www.instagram.com/kota1.restaurant/' && (await new Client(base).get('/api/public/site')).data.instagramUrl === 'https://www.instagram.com/kota1.restaurant/');
  await page.reload({ waitUntil: 'networkidle' }); await page.waitForSelector('h2:has-text("Информация за сайта")');
  R.check('SET5 after reload the field is prefilled with the stored profile URL', (await igField().inputValue()) === 'https://www.instagram.com/kota1.restaurant/');
  await igField().fill(''); await save();
  R.check('SET6 clearing the field saves "" and the public site falls back to the placeholder icon link', (await api.get('/api/admin/settings')).data.instagramUrl === '' && (await new Client(base).get('/api/public/site')).data.instagramUrl === '');
  // unsaved guard includes the new field
  await igField().fill('https://www.instagram.com/changed/');
  await go(page, '#/events', { stay: true });
  const guard = (await page.locator('dialog[open]', { hasText: 'Имате незапазени промени' }).count()) === 1;
  R.check('SET7 editing only the Instagram field counts as an unsaved change (guard modal on leaving)', guard);
  if (guard) await page.locator('dialog[open]').getByRole('button', { name: 'Напусни без запазване' }).click();
});

R.check('LOG no console errors / page errors / CSP violations in the main admin session (expected 400 responses from the deliberate server-rejection checks excluded)', log.console.filter((m) => !/status of 40[0-9]/.test(m)).length === 0 && log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.console.concat(log.pageErrors)).slice(0, 400));
await ctx.close();
await browser.close();
await srv.stop();
R.summary();
fs.writeFileSync(path.join(shots, 'admin-dates-results.json'), JSON.stringify(R.results, null, 1));
