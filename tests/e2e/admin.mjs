// Admin SPA end-to-end (Playwright) against a real server. Port 3202. Run: node tests/e2e/admin.mjs
import fs from 'node:fs';
import path from 'node:path';
import { startServer, createAdmin, Client, form, tmpDir, makePng, PDF, JPG, WEBP, PASSWORD, reporter, SCRATCH } from '../lib/harness.mjs';
import { chromium, VIEWPORTS, newPage, noHScroll, shotDir } from '../lib/browser.mjs';

const R = reporter('admin-e2e');
const PORT = 3202;
const T0 = '2026-06-15T10:00:00Z';
const dir = tmpDir('adminui'); createAdmin(dir);
let srv = await startServer({ port: PORT, dataDir: dir, now: T0 });
const base = srv.url;
const api = new Client(base); await api.login();
const anon = new Client(base);
const shots = shotDir();
const pubEvents = async () => (await anon.get('/api/public/events')).data.events;
const file = (name, mimeType, buffer) => ({ name, mimeType, buffer });
const browser = await chromium.launch();
const step = async (id, fn) => { try { await fn(); } catch (e) { R.fail(id, String(e.message).split('\n').slice(0, 3).join(' ')); } };

async function login(page) {
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  await page.getByLabel('Потребителско име').fill('owner');
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
}
const sw = (page, name) => page.getByRole('switch', { name });
const toast = (page) => page.locator('.a-toasts');
// A user dismisses persistent error toasts (they have a close button) before pressing Save; at 390px they overlap the sticky save bar (BUG-5).
const dismissToasts = async (page) => { for (let i = 0; i < 5 && (await page.locator('.a-toast__close').count()); i++) await page.locator('.a-toast__close').first().click(); };
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(250); };

// ================= login =================
await step('L', async () => {
  const { context, page, log } = await newPage(browser, { width: 390, height: 844 });
  await page.goto(base + '/admin/', { waitUntil: 'networkidle' });
  R.check('L0 unauthenticated /admin shows login (h1 "Вход" present, no shell)', (await page.locator('.a-login').count()) === 1 && (await page.locator('.a-nav').count()) === 0);
  R.check('L0b login inputs have labels + autocomplete tokens', (await page.getByLabel('Потребителско име').getAttribute('autocomplete')) === 'username' && (await page.getByLabel('Парола', { exact: true }).getAttribute('autocomplete')) === 'current-password');
  await page.getByRole('button', { name: 'Вход' }).click();
  R.check('L1 empty submit => inline field error, no request failure', (await page.locator('.a-error:visible').count()) >= 1);
  await page.getByLabel('Потребителско име').fill('owner'); await page.getByLabel('Парола', { exact: true }).fill('wrong-password-xx');
  await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('[role=alert]:has-text("Грешно потребителско име или парола")');
  R.pass('L2 wrong password => "Грешно потребителско име или парола." alert');
  await page.screenshot({ path: path.join(shots, 'admin-login-390.png') });
  await page.getByLabel('Парола', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('h1:has-text("Табло")');
  const cookies = await context.cookies();
  const c = cookies.find((x) => x.name === 'kota_session');
  R.check('L3 login success => dashboard; cookie HttpOnly + SameSite=Strict, not readable via document.cookie', c && c.httpOnly && c.sameSite === 'Strict' && !(await page.evaluate(() => document.cookie.includes('kota_session'))), JSON.stringify(c && { h: c.httpOnly, s: c.sameSite, sec: c.secure }));
  // logout
  await page.locator('.a-logout-top:visible, .a-logout-side:visible').first().click();
  await page.waitForSelector('.a-login');
  R.pass('L4 logout via UI returns to the login screen');
  const r = await anon.get('/api/admin/me', { cookie: `kota_session=${c.value}` });
  R.check('L4b old cookie rejected by server after UI logout', r.status === 401, String(r.status));
  await page.goBack().catch(() => {}); await page.waitForTimeout(300);
  R.check('L5 after logout + back navigation no admin shell visible', (await page.locator('.a-nav').count()) === 0);
  R.check('L6 login screen: no unexpected console errors / CSP violations (expected 401s from the session probe and the wrong-password attempt excluded)', log.console.filter((m) => !/status of 401 .*\/api\/admin\/(me|login)/.test(m)).length === 0 && log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify(log.console));
  await context.close();
});

// ================= events =================
const { context: ctx, page, log } = await newPage(browser, { width: 390, height: 844 });
await login(page);
await step('E', async () => {
  await go(page, '#/events');
  R.check('EV0 empty state shown when no events', (await page.getByText('Още няма събития.').count()) === 1);
  await page.getByRole('link', { name: 'Ново събитие' }).first().click();
  await page.waitForSelector('h1:has-text("Ново събитие")');
  await page.getByRole('button', { name: 'Запази', exact: true }).click();
  R.check('EV1 saving empty form => client validation error summary ("Въведете заглавие поне на един език." D-39, no required star), nothing created', (await page.getByText('Въведете заглавие поне на един език.').count()) >= 1 && (await page.locator('label:has-text("Заглавие")').first().innerText()).indexOf('*') < 0 && (await api.get('/api/admin/events')).data.events.length === 0);
  await page.locator('input.a-input').first().fill('Джаз вечер');
  await page.locator('textarea').first().fill('Жива музика\nВход свободен');
  // D-35: typed Bulgarian date + 24h time (the native datetime-local input no longer exists); API format asserted in EV3
  await page.locator('.a-dt-date').nth(0).fill('20.06.2026'); await page.locator('.a-dt-time').nth(0).fill('20:00');
  await page.locator('input[type=file]').first().setInputFiles(file('poster.png', 'image/png', makePng(400, 250, [30, 160, 90])));
  await page.waitForTimeout(300);
  R.check('EV2 image chosen => preview thumbnail appears', (await page.locator('.a-upload img, .a-upload canvas, .a-preview img, .a-previewcard img').count()) >= 1);
  await page.screenshot({ path: path.join(shots, 'admin-event-form-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Запази', exact: true }).click();
  await page.waitForSelector('h1:has-text("Събития")'); await page.waitForSelector('article:has-text("Джаз вечер")');
  let pe = await pubEvents();
  R.check('EV3 event created via UI with default ON: public API shows it with image + description + eventAt', pe.length === 1 && pe[0].title === 'Джаз вечер' && pe[0].description.replace(/\r\n/g, '\n') === 'Жива музика\nВход свободен' && pe[0].imageUrl && pe[0].eventAt === '2026-06-20T20:00', JSON.stringify(pe));
  const s = sw(page, 'Показвай „Джаз вечер“');
  R.check('EV4 switch has role=switch, aria-checked=true, text "Вкл."', (await s.getAttribute('aria-checked')) === 'true' && (await s.innerText()).includes('Вкл'));
  await s.click(); await page.waitForTimeout(500);
  R.check('EV5 click OFF => public API empty immediately; badge "Изключено"', (await pubEvents()).length === 0 && (await page.locator('article:has-text("Джаз вечер") .a-badge:has-text("Изключено")').count()) === 1);
  // keyboard
  const s2 = sw(page, 'Показвай „Джаз вечер“'); await s2.focus();
  const focusStyle = await s2.evaluate((e) => { const cs = getComputedStyle(e); return cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.boxShadow; });
  await page.keyboard.press('Space'); await page.waitForTimeout(500);
  R.check('EV6 keyboard: focus switch + Space => ON, public shows event', (await pubEvents()).length === 1 && (await sw(page, 'Показвай „Джаз вечер“').getAttribute('aria-checked')) === 'true', focusStyle);
  await sw(page, 'Показвай „Джаз вечер“').focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  R.check('EV6b keyboard: Enter toggles OFF', (await pubEvents()).length === 0);
  await sw(page, 'Показвай „Джаз вечер“').focus(); await page.keyboard.press('Space'); await page.waitForTimeout(500);
  // rollback on server failure
  await page.route('**/api/admin/events/*/enabled', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"server_error","message":"Вътрешна грешка на сървъра."}' }));
  await sw(page, 'Показвай „Джаз вечер“').click(); await page.waitForTimeout(600);
  R.check('EV7 PATCH fails (500): switch rolls back to ON, error toast shown, server state unchanged', (await sw(page, 'Показвай „Джаз вечер“').getAttribute('aria-checked')) === 'true' && (await toast(page).innerText()).includes('грешка') && (await pubEvents()).length === 1, await toast(page).innerText());
  await page.unroute('**/api/admin/events/*/enabled');
  await page.route('**/api/admin/events/*/enabled', (r) => r.abort('connectionrefused'));
  await sw(page, 'Показвай „Джаз вечер“').click(); await page.waitForTimeout(600);
  R.check('EV7b network failure: switch rolls back + "Няма връзка" toast', (await sw(page, 'Показвай „Джаз вечер“').getAttribute('aria-checked')) === 'true' && (await toast(page).innerText()).includes('Няма връзка'));
  await page.unroute('**/api/admin/events/*/enabled');
  // BUG-5 evidence: with ONE persistent error toast on screen at 390px, does it cover the sticky Save button?
  await page.getByRole('link', { name: 'Редактирай' }).first().click();
  await page.waitForSelector('h1:has-text("Редактиране на събитие")');
  await page.evaluate(() => { document.querySelector('.a-toasts')?.replaceChildren(); });
  await page.evaluate(() => import('/admin/js/ui.js').then((m) => m.toast('Тестова грешка', { type: 'err' })));
  await page.waitForTimeout(200);
  const cover = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Запази'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { hit: el && (el.closest('.a-toast') ? 'toast' : el.closest('button') === b ? 'save' : el.className), top: r.top | 0 }; });
  R.check('TOAST-OVERLAP[390] one persistent error toast does not cover the sticky "Запази" button (centre point hits the button)', cover.hit === 'save', JSON.stringify(cover));
  await dismissToasts(page);
  await page.goBack().catch(() => {}); await page.waitForTimeout(300);
  // edit: description + image
  await page.getByRole('link', { name: 'Редактирай' }).first().click();
  await page.waitForSelector('h1:has-text("Редактиране на събитие")');
  await page.locator('textarea').first().fill('Нов опис');
  await page.getByRole('button', { name: 'Смени снимка' }).click().catch(() => {});
  await page.locator('input[type=file]').first().setInputFiles(file('new.png', 'image/png', makePng(300, 300, [0, 0, 200])));
  await page.getByRole('button', { name: 'Запази', exact: true }).click();
  await page.waitForSelector('h1:has-text("Събития")'); await page.waitForTimeout(300);
  pe = await pubEvents();
  const old = pe[0].imageUrl;
  R.check('EV8 edit description + replace image via UI: public API updated, new image 300px', pe[0].description === 'Нов опис' && (await anon.get(pe[0].imageUrl)).status === 200);
  // server-side 400 surfaced in form: intercept PUT to return fields
  await page.getByRole('link', { name: 'Редактирай' }).first().click(); await page.waitForSelector('h1:has-text("Редактиране")');
  await page.route('**/api/admin/events/*', (r) => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { title: 'СЪРВЪРНА-ГРЕШКА-ЗАГЛАВИЕ', expiresAt: 'СЪРВЪРНА-ГРЕШКА-ДАТА' } }) }) : r.continue());
  await page.locator('textarea').first().fill('x');
  await page.getByRole('button', { name: 'Запази', exact: true }).click(); await page.waitForTimeout(600);
  const body = await page.locator('main').innerText();
  R.check('EV9 server 400 `fields` (title, expiresAt) surface next to the fields and in summary; form stays editable', body.includes('СЪРВЪРНА-ГРЕШКА-ЗАГЛАВИЕ') && body.includes('СЪРВЪРНА-ГРЕШКА-ДАТА') && (await page.getByRole('button', { name: 'Запази', exact: true }).isEnabled()) && (await page.locator('input.a-input').first().isEnabled()), body.slice(0, 200));
  await page.screenshot({ path: path.join(shots, 'admin-event-400-390.png'), fullPage: true });
  await page.unroute('**/api/admin/events/*');
  // REAL server-side rejection reachable through UI: description 2000 chars is client-limited; use event date that the client allows but server rejects (year 99999?)
  await page.locator('.a-dt-date').nth(2).fill(''); await page.locator('.a-dt-time').nth(2).fill('');
  // oversize image: client-side limit 5MB; send >5MB via UI to see 413 handling
  await page.locator('input[type=file]').first().setInputFiles(file('big.png', 'image/png', Buffer.concat([makePng(10, 10), Buffer.alloc(5.5 * 1024 * 1024)]))).catch(() => {});
  await page.waitForTimeout(400);
  const upErr = await page.locator('.a-upload').first().innerText().catch(() => '');
  R.check('EV10 oversize image (5.5MB) is refused in UI with a visible message', /5\s?MB|голям/i.test(upErr + (await page.locator('main').innerText())), upErr.slice(0, 120));
  await page.goto(base + '/admin/#/events'); await page.waitForTimeout(500);
  if (await page.locator('dialog[open]').count()) await page.getByRole('button', { name: 'Напусни без запазване' }).click();
  // expired event stays listed
  await api.post('/api/admin/events', { form: form({ title: 'Минало събитие', enabled: 'true', expiresAt: '2026-06-01T10:00' }) });
  await api.post('/api/admin/events', { form: form({ title: 'Бъдещо събитие', enabled: 'true', startsAt: '2026-07-01T10:00' }) });
  await page.reload({ waitUntil: 'networkidle' });
  R.check('EV11 expired event remains listed in admin with badge "Изтекло", warning text; scheduled shows "Предстоящо"', (await page.locator('article:has-text("Минало събитие") .a-badge:has-text("Изтекло")').count()) === 1 && (await page.locator('article:has-text("Бъдещо събитие") .a-badge:has-text("Предстоящо")').count()) === 1);
  R.check('EV11b expired/future events are NOT public', !(await pubEvents()).some((e) => /Минало|Бъдещо/.test(e.title)));
  await page.getByRole('button', { name: /^Изтекли/ }).click();
  R.check('EV12 status filter "Изтекли" shows only the expired one', (await page.locator('article').count()) === 1);
  await page.getByRole('button', { name: /^Всички/ }).click();
  // delete confirmation
  await page.getByRole('button', { name: 'Изтрий „Минало събитие“' }).click();
  await page.waitForSelector('dialog[open]');
  R.check('EV13 delete asks confirmation dialog (modal, titled, safe button "Отказ" focused)', (await page.locator('dialog[open] h2').textContent()).includes('Изтриване') && (await page.evaluate(() => document.activeElement.textContent)).trim() === 'Отказ' && (await api.get('/api/admin/events')).data.events.length === 3, `active=${await page.evaluate(() => document.activeElement.textContent)}`);
  // focus trap
  const inDialog = [];
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); inDialog.push(await page.evaluate(() => !!document.activeElement.closest('dialog') || document.activeElement === document.body)); }
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Tab'); inDialog.push(await page.evaluate(() => !!document.activeElement.closest('dialog') || document.activeElement === document.body)); }
  R.check('A-DLG1 modal dialog keeps focus away from the page behind (Tab/Shift+Tab 12x: only dialog buttons or browser chrome/body, never background controls)', inDialog.every(Boolean));
  await page.keyboard.press('Escape');
  R.check('EV14 Esc closes the dialog and does NOT delete', (await page.locator('dialog[open]').count()) === 0 && (await api.get('/api/admin/events')).data.events.length === 3);
  R.check('A-DLG2 focus returns to the trigger button after close', (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))) === 'Изтрий „Минало събитие“');
  await page.getByRole('button', { name: 'Изтрий „Минало събитие“' }).click(); await page.getByRole('button', { name: 'Отказ' }).click();
  R.check('EV15 "Отказ" keeps event', (await api.get('/api/admin/events')).data.events.length === 3);
  await page.getByRole('button', { name: 'Изтрий „Минало събитие“' }).click(); await page.getByRole('button', { name: 'Изтрий събитието' }).click();
  await page.waitForTimeout(600);
  R.check('EV16 confirming deletes the event (API + list)', (await api.get('/api/admin/events')).data.events.length === 2 && (await page.locator('article:has-text("Минало събитие")').count()) === 0);
});

// ================= XSS in admin + public =================
await step('X', async () => {
  const X = '<img src=x onerror="window.__xss=11">T';
  const e = await api.post('/api/admin/events', { form: form({ title: X, description: '<script>window.__xss=12</script>', enabled: 'true' }) });
  await api.put('/api/admin/menu/draft', { json: { categories: [{ name: '<b onmouseover=window.__xss=13>Cat</b>', items: [{ name: '<img src=x onerror=window.__xss=14>', description: '<i>d</i>', priceCents: 100, available: true }] }] } });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('article:has-text("onerror")');
  R.check('X4 admin events list: XSS title shown as text, not executed, no injected nodes', (await page.evaluate(() => window.__xss)) === undefined && (await page.locator('main img[src="x"]').count()) === 0);
  await page.getByRole('link', { name: 'Редактирай' }).last().click().catch(() => {});
  await go(page, `#/events/${e.data.id}`); await page.waitForSelector('.a-previewcard');
  R.check('X5 admin event form + live preview render payload as text', (await page.evaluate(() => window.__xss)) === undefined && (await page.locator('.preview-frame img[src="x"], .preview-frame b, .preview-frame script').count()) === 0 && (await page.locator('.preview-frame').innerText()).toLowerCase().includes('onerror'));
  await go(page, '#/menu'); await page.waitForSelector('.a-cat');
  await page.locator('.a-preview, button:has-text("Преглед")').first().click().catch(() => {});
  await page.waitForTimeout(400);
  R.check('X6 admin menu editor + preview: XSS category/dish shown as text, not executed', (await page.evaluate(() => window.__xss)) === undefined && (await page.locator('main b, dialog b, main img[src="x"], dialog img[src="x"]').count()) === 0);
  await page.keyboard.press('Escape');
  await api.del(`/api/admin/events/${e.data.id}`);
  await api.put('/api/admin/menu/draft', { json: { categories: [] } });
});

// ================= daily menu wizard =================
await step('D', async () => {
  await go(page, '#/daily-menu'); await page.waitForSelector('h1:has-text("Обедно меню")');
  const cases = [['dnes.pdf', 'application/pdf', PDF, '2026-06-15', 'pdf'], ['utre.jpg', 'image/jpeg', JPG, '2026-06-16', 'image'], ['sled.png', 'image/png', makePng(200, 300), '2026-06-17', 'image'], ['sled2.webp', 'image/webp', WEBP, '2026-06-18', 'image']];
  for (const [name, type, buf, date, kind] of cases) {
    await go(page, '#/events'); await go(page, '#/daily-menu'); await page.waitForSelector('h3:has-text("Избери файл")');
    await page.locator('input[type=file]').first().setInputFiles(file(name, type, buf));
    await page.getByRole('button', { name: 'Напред' }).click();
    await page.locator('.a-dt-date').fill(date.split('-').reverse().join('.'));
    await page.getByRole('button', { name: 'Напред' }).click();
    await page.getByRole('button', { name: 'Напред' }).click();
    await page.getByRole('button', { name: 'Публикувай', exact: true }).click();
    await page.waitForSelector('[role=status]:has-text("публикувано")');
    const list = (await api.get('/api/admin/daily-menus')).data.menus.find((m) => m.date === date);
    R.check(`DM1[${name}] wizard upload+publish works; stored kind=${kind}, date=${date}, published`, list && list.kind === kind && list.published && list.originalName === name, JSON.stringify(list && { k: list.kind, p: list.published }));
  }
  const pd = (await anon.get('/api/public/daily-menu')).data;
  R.check('DM2 today (15 June) PDF menu is public; tomorrow/later are not', pd.menu && pd.menu.date === '2026-06-15' && pd.menu.kind === 'pdf');
  R.check('DM3 list groups: "Днес" + "Предстоящи"; badge "На живо днес"; screenshot saved', (await page.getByText('На живо днес').count()) >= 1);
  await page.screenshot({ path: path.join(shots, 'admin-daily-390.png'), fullPage: true });
  // conflict -> replace
  await page.getByRole('button', { name: 'Качи ново меню' }).click();
  await page.locator('input[type=file]').first().setInputFiles(file('repl.png', 'image/png', makePng(120, 120, [9, 9, 9])));
  await page.getByRole('button', { name: 'Напред' }).click(); await page.locator('.a-dt-date').fill('15.06.2026');
  R.check('DM4 selecting an occupied date shows info note', (await page.getByText('вече има меню').count()) >= 1);
  await page.getByRole('button', { name: 'Напред' }).click(); await page.getByRole('button', { name: 'Напред' }).click();
  await page.getByRole('button', { name: 'Публикувай', exact: true }).click();
  await page.waitForSelector('dialog[open]:has-text("Вече има меню")');
  await page.getByRole('button', { name: 'Замени' }).click();
  for (let i = 0; i < 30 && (await anon.get('/api/public/daily-menu')).data.menu?.kind !== 'image'; i++) await page.waitForTimeout(200);
  const nd = (await anon.get('/api/public/daily-menu')).data;
  R.check('DM5 conflict dialog -> Замени: public today now the new PNG; old pdf URL dead', nd.menu && nd.menu.kind === 'image' && (await anon.get(pd.menu.fileUrl)).status === 404, JSON.stringify(nd));
  // delete today's
  const delBtn = page.getByRole('button', { name: /Изтрий менюто за понеделник/ });
  await delBtn.click(); await page.waitForSelector('dialog[open]');
  R.check('DM6 deleting a daily menu requires confirmation and warns when it is live', (await page.locator('dialog[open]').innerText()).includes('показва на клиентите сега'));
  await page.getByRole('button', { name: 'Отказ' }).click();
  R.check('DM6b cancel keeps menu', (await anon.get('/api/public/daily-menu')).data.menu !== null);
  // toggle publish off
  await sw(page, /Публикувано за понеделник/).click(); await page.waitForTimeout(500);
  R.check('DM7 publish switch OFF hides today at once', (await anon.get('/api/public/daily-menu')).data.menu === null);
  await sw(page, /Публикувано за понеделник/).click(); await page.waitForTimeout(500);
  R.check('DM7b switch ON shows again', (await anon.get('/api/public/daily-menu')).data.menu !== null);
  // invalid upload type surfaced in UI
  await page.getByRole('button', { name: 'Качи ново меню' }).click().catch(() => {});
  await go(page, '#/events'); await go(page, '#/daily-menu'); await page.waitForSelector('h3:has-text("Избери файл")');
  await page.locator('input[type=file]').first().setInputFiles(file('evil.html', 'text/html', Buffer.from('<script>alert(1)</script>')));
  await page.waitForTimeout(400);
  R.check('DM8 .html file refused by UI (message visible, Напред disabled)', (await page.getByRole('button', { name: 'Напред' }).isDisabled()) && /формат|поддържа|PDF|JPG/i.test(await page.locator('.a-step').innerText()), (await page.locator('.a-step').innerText()).slice(0, 150));
  // server 415: renamed file passes client (ext ok) but server rejects by magic
  await page.locator('input[type=file]').first().setInputFiles(file('fake.pdf', 'application/pdf', Buffer.from('<html>not a pdf</html>')));
  await page.getByRole('button', { name: 'Напред' }).click(); await page.locator('.a-dt-date').fill('01.07.2026');
  await page.getByRole('button', { name: 'Напред' }).click(); await page.getByRole('button', { name: 'Напред' }).click();
  await page.getByRole('button', { name: 'Публикувай', exact: true }).click(); await page.waitForTimeout(800);
  const txt = await page.locator('.a-step').innerText();
  R.check('DM9 REAL server 415 (fake.pdf with HTML content) is surfaced to the user in the wizard; nothing stored', /PDF|JPG|съдържанието|Позволени|формат/i.test(txt) && !(await api.get('/api/admin/daily-menus')).data.menus.some((m) => m.date === '2026-07-01'), txt.slice(0, 200));
  await page.screenshot({ path: path.join(shots, 'admin-daily-415-390.png'), fullPage: true });
});

// ================= regular menu =================
await step('M', async () => {
  await go(page, '#/menu'); await page.waitForSelector('h1:has-text("Основно меню")');
  await page.getByRole('button', { name: 'Добави категория' }).first().click();
  await page.locator('.a-cat__name input, input.a-input').first().fill('Салати');
  await page.getByRole('button', { name: 'Добави ястие' }).click();
  await page.getByLabel('Име на ястието').first().fill('Шопска');
  await page.getByLabel('Цена').first().fill('6,50');
  await page.getByRole('button', { name: 'Добави ястие' }).click();
  await page.getByLabel('Име на ястието').nth(1).fill('Таратор');
  await page.getByLabel('Цена').nth(1).fill('5');
  await page.getByRole('button', { name: 'Запази чернова' }).click(); await page.waitForTimeout(600);
  let a = (await api.get('/api/admin/menu')).data;
  R.check('MN1 add category + 2 dishes via UI, comma price "6,50" => 650 cents; draft saved', a.draft.categories[0].items.map((i) => `${i.name}=${i.priceCents}`).join() === 'Шопска=650,Таратор=500', JSON.stringify(a.draft.categories));
  R.check('MN2 draft NOT public before publish', (await anon.get('/api/public/menu')).data.structured === null);
  await page.getByRole('button', { name: 'Публикувай', exact: true }).first().click();
  await page.waitForSelector('dialog[open]'); await page.locator('dialog[open]').getByRole('button', { name: 'Публикувай' }).click(); await page.waitForTimeout(600);
  let p = (await anon.get('/api/public/menu')).data;
  R.check('MN3 publish => public menu shows both dishes', p.structured && p.structured.categories[0].items.length === 2);
  // edit name + price, remove dish; public unchanged until publish
  await page.getByLabel('Име на ястието').first().fill('Шопска салата'); await page.getByLabel('Цена').first().fill('7,5');
  await page.locator('.a-dish').nth(1).getByRole('button', { name: /Изтрий/ }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Изтрий ястието' }).click();
  await page.getByRole('button', { name: 'Запази чернова' }).click(); await page.waitForTimeout(600);
  p = (await anon.get('/api/public/menu')).data;
  R.check('MN4 edits (rename, price, remove) saved as draft: public still old', p.structured.categories[0].items.map((i) => `${i.name}=${i.priceCents}`).join() === 'Шопска=650,Таратор=500');
  await page.screenshot({ path: path.join(shots, 'admin-menu-draft-390.png'), fullPage: true });
  // discard
  await page.getByRole('button', { name: 'Откажи промените' }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Откажи промените' }).click(); await page.waitForTimeout(700);
  a = (await api.get('/api/admin/menu')).data;
  R.check('MN5 discard restores draft to published (2 dishes, old name/price); UI fields reflect it', a.draft.categories[0].items.length === 2 && (await page.getByLabel('Име на ястието').first().inputValue()) === 'Шопска');
  // edit again and publish
  await page.getByLabel('Име на ястието').first().fill('Шопска салата'); await page.getByLabel('Цена').first().fill('7,5');
  await page.getByRole('button', { name: 'Публикувай', exact: true }).first().click(); await page.waitForSelector('dialog[open]'); await page.locator('dialog[open]').getByRole('button', { name: 'Публикувай' }).click(); await page.waitForTimeout(700);
  p = (await anon.get('/api/public/menu')).data;
  R.check('MN6 publish with unsaved edits saves then publishes: public shows new name + 750', p.structured.categories[0].items[0].name === 'Шопска салата' && p.structured.categories[0].items[0].priceCents === 750);
  // reorder via keyboard
  const up = page.locator('.a-dish').getByRole('button', { name: /^Премести „.*“ нагоре$/ });
  const down = page.locator('.a-dish').getByRole('button', { name: /^Премести „.*“ надолу$/ });
  await down.first().focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const order = await page.getByLabel('Име на ястието').evaluateAll((els) => els.map((e) => e.value));
  R.check('MN7 keyboard: "down" button (focus + Enter) reorders dishes; focus stays on a move button', order.join() === 'Таратор,Шопска салата' && /Премести/.test(await page.evaluate(() => document.activeElement.getAttribute('aria-label') || '')), order.join() + ' / ' + (await page.evaluate(() => document.activeElement.getAttribute('aria-label'))));
  R.check('MN7b first dish "up" disabled, last "down" disabled', (await up.first().isDisabled()) && (await down.last().isDisabled()));
  await page.getByRole('button', { name: 'Откажи промените' }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Откажи промените' }).click(); await page.waitForTimeout(500);
  // client validation + server 400 mapping
  await page.getByLabel('Цена').first().fill('abc');
  await page.getByRole('button', { name: 'Запази чернова' }).click();
  R.check('MN8 invalid price blocked client-side with message', (await page.getByText('Въведете цена').count()) >= 1);
  await page.getByLabel('Цена').first().fill('9');
  await page.route('**/api/admin/menu/draft', (r) => r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'validation', message: 'Невалидни данни.', fields: { 'categories[0].items[0].name': 'СЪРВЪР-ИМЕ', 'categories[0].items[0].priceCents': 'СЪРВЪР-ЦЕНА', 'categories[0].name': 'СЪРВЪР-КАТ' } }) }) : r.continue());
  await page.getByRole('button', { name: 'Запази чернова' }).click(); await page.waitForTimeout(600);
  const mt = await page.locator('main').innerText();
  R.check('MN9 server 400 `fields` with paths categories[0].items[0].priceCents|name and categories[0].name mapped onto the right inputs + summary', mt.includes('СЪРВЪР-ИМЕ') && mt.includes('СЪРВЪР-ЦЕНА') && mt.includes('СЪРВЪР-КАТ') && (await page.locator('input[aria-invalid=true]').count()) >= 3, `invalid inputs=${await page.locator('input[aria-invalid=true]').count()}`);
  await page.screenshot({ path: path.join(shots, 'admin-menu-400-390.png'), fullPage: true });
  await page.unroute('**/api/admin/menu/draft');
  await page.getByRole('button', { name: 'Откажи промените' }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Откажи промените' }).click(); await page.waitForTimeout(500);
  // unsaved guard
  await page.getByLabel('Цена').first().fill('1');
  await page.getByRole('link', { name: 'Табло' }).first().click(); await page.waitForTimeout(300);
  R.check('MN10 leaving with unsaved edits opens "Имате незапазени промени" guard; "Остани" keeps page', (await page.locator('dialog[open]').textContent()).includes('незапазени'));
  await page.getByRole('button', { name: 'Остани' }).click();
  await page.getByRole('button', { name: 'Откажи промените' }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Откажи промените' }).click(); await page.waitForTimeout(400);
  // mode: file with nothing published => 409 nothing_published message
  await page.getByLabel(/^Файл/).check().catch(async () => { await page.locator('label.a-radio:has-text("Файл")').click(); });
  await page.waitForSelector('dialog[open]'); await page.locator('dialog[open]').getByRole('button', { name: 'Покажи на сайта' }).click(); await page.waitForTimeout(600);
  const alertTxt = await page.locator('[role=alert]').allInnerTexts();
  R.check('MN11 mode switch to "Файл" with nothing published: REAL 409 nothing_published message shown, mode unchanged', alertTxt.some((t) => /няма публикуван/i.test(t)) && (await api.get('/api/admin/menu')).data.mode === 'structured', alertTxt.join('|'));
  await page.screenshot({ path: path.join(shots, 'admin-menu-409-390.png') });
  // file tab: upload + publish + mode switch
  await page.getByRole('tab', { name: /Файл/ }).click();
  // T-33/34: one file section per language; the first is Bulgarian (D-40)
  await page.locator('input[type=file]').first().setInputFiles(file('menu.png', 'image/png', makePng(300, 400, [10, 120, 200])));
  await page.getByRole('button', { name: 'Качи български файл', exact: true }).click(); await page.waitForTimeout(800);
  R.check('MN12 menu file uploaded via UI (unpublished), public unchanged', (await api.get('/api/admin/menu')).data.files.length === 1 && (await anon.get('/api/public/menu')).data.file === null);
  await page.getByRole('button', { name: 'Публикувай', exact: true }).last().click(); await page.waitForTimeout(600);
  await page.getByRole('radio', { name: /Файл/ }).check({ force: true }).catch(async () => { await page.locator('label.a-radio:has-text("Файл")').click(); });
  await page.waitForSelector('dialog[open]'); await page.locator('dialog[open]').getByRole('button', { name: 'Покажи на сайта' }).click(); await page.waitForTimeout(700);
  p = (await anon.get('/api/public/menu')).data;
  R.check('MN13 mode switch via UI: public = file only (structured null)', p.mode === 'file' && p.file && p.structured === null);
  // delete live file blocked UI
  await page.getByRole('button', { name: /Изтрий файла menu.png/ }).click(); await page.locator('dialog[open]').getByRole('button', { name: 'Изтрий файла' }).click(); await page.waitForTimeout(700);
  R.check('MN14 deleting the LIVE file: server 409 surfaced as visible message; file still there + still public', (await page.locator('[role=alert]').allInnerTexts()).join().includes('показва на клиентите') && (await api.get('/api/admin/menu')).data.files.length === 1 && (await anon.get('/api/public/menu')).data.file !== null, (await page.locator('[role=alert]').allInnerTexts()).join('|'));
  await page.screenshot({ path: path.join(shots, 'admin-menu-file-390.png'), fullPage: true });
  await page.keyboard.press('Escape');
  // back to structured
  await page.getByRole('radio', { name: /Структурирано/ }).check({ force: true }).catch(async () => { await page.locator('label.a-radio:has-text("Структурирано")').click(); });
  await page.waitForSelector('dialog[open]'); await page.locator('dialog[open]').getByRole('button', { name: 'Покажи на сайта' }).click(); await page.waitForTimeout(600);
  R.check('MN15 mode switch back via UI: public structured, file hidden', (await anon.get('/api/public/menu')).data.mode === 'structured' && (await anon.get('/api/public/menu')).data.file === null);
});

// ================= session expiry =================
await step('S', async () => {
  await go(page, '#/events');
  await ctx.clearCookies();
  await page.reload({ waitUntil: 'networkidle' });
  R.check('SE1 lost session on reload => login screen', (await page.locator('.a-login').count()) === 1);
  await page.getByLabel('Потребителско име').fill('owner'); await page.getByLabel('Парола', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Вход' }).click();
  await page.waitForSelector('.a-nav');
  const cookies = await ctx.cookies();
  await ctx.clearCookies(); // session vanishes while the SPA is open
  await sw(page, /Показвай/).first().click().catch(() => {});
  await go(page, '#/settings'); await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  await ctx.addCookies(cookies);
  void cookies;
});
R.check('LOG admin session (deliberate 500/abort/400 excluded): no page errors / CSP violations / unexpected console errors', log.console.filter((m) => !/\/api\/admin\/(me|events\/\d+\/enabled|events\/\d+|menu\/draft)|ERR_CONNECTION_REFUSED|status of 4\d\d|status of 500/.test(m)).length === 0 && log.pageErrors.length === 0 && (await page.collectCsp()).length === 0, JSON.stringify({ c: log.console, p: log.pageErrors, f: log.failed, csp: await page.collectCsp() }));
await ctx.close();

// ================= overlay on expiry mid-session =================
await step('SO', async () => {
  const c = await newPage(browser, { width: 390, height: 844 });
  await login(c.page); await go(c.page, '#/events');
  await api.post('/api/admin/events', { form: form({ title: 'ForOverlay', enabled: 'true' }) });
  await c.page.reload({ waitUntil: 'networkidle' }); await c.page.waitForSelector('article:has-text("ForOverlay")');
  await c.context.clearCookies();
  await sw(c.page, 'Показвай „ForOverlay“').click(); await c.page.waitForTimeout(800);
  R.check('SE2 401 during action => session-expired login overlay (modal, labelled), UI behind inert', (await c.page.locator('.a-overlay[role=dialog]').count()) === 1 && (await c.page.locator('#app[inert]').count()) === 1);
  await c.page.screenshot({ path: path.join(shots, 'admin-session-expired-390.png') });
  await c.page.getByLabel('Потребителско име').fill('owner'); await c.page.getByLabel('Парола', { exact: true }).fill(PASSWORD); await c.page.getByRole('button', { name: 'Вход' }).click(); await c.page.waitForTimeout(900);
  R.check('SE3 re-login in overlay returns to the same page without reload', (await c.page.locator('.a-overlay').count()) === 0 && (await c.page.locator('article:has-text("ForOverlay")').count()) === 1, `overlay=${await c.page.locator('.a-overlay').count()} toast=${await toast(c.page).innerText().catch(() => '')}`);
  await c.context.close();
});

// ================= known-edge checks (BUG candidates) =================
await step('EDGE', async () => {
  const c = await newPage(browser, { width: 1280, height: 800 });
  const pg = c.page; await login(pg);
  await pg.evaluate(() => { location.hash = '#/events/new'; }); await pg.waitForSelector('textarea');
  await pg.locator('input.a-input').first().fill('Edge CRLF');
  await pg.locator('textarea').first().fill(('a'.repeat(98) + '\n').repeat(20) + 'b'.repeat(20)); // exactly 2000 chars with 20 line breaks (client counter 2000/2000)
  await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(1000);
  R.check('EDGE1 description of exactly 2000 chars incl. line breaks (the UI limit) is accepted (browsers send CRLF in multipart; server must normalise before counting)', (await api.get('/api/admin/events')).data.events.some((e) => e.title === 'Edge CRLF'), (await pg.locator('.a-error:visible').allTextContents()).join('|'));
  const stored = (await api.get('/api/admin/events')).data.events.find((e) => e.title === 'Edge CRLF');
  R.check('EDGE1b stored description has no \\r and is exactly 2000 chars with 20 line breaks (via admin API)', !!stored && !stored.description.includes('\r') && stored.description.length === 2000 && (stored.description.match(/\n/g) || []).length === 20, stored ? `len=${stored.description.length} cr=${stored.description.includes('\r')}` : 'not stored');
  const pubDesc = ((await anon.get('/api/public/events')).data.events.find((e) => e.title === 'Edge CRLF') || {}).description;
  R.check('EDGE1c public API description has no \\r', typeof pubDesc === 'string' && !pubDesc.includes('\r'));
  await c.context.close();
  const c2 = await newPage(browser, { width: 1280, height: 800 }); const pg2 = c2.page; await login(pg2);
  await api.put('/api/admin/menu/draft', { json: { categories: [] } });
  await pg2.evaluate(() => { location.hash = '#/menu'; }); await pg2.waitForSelector('h1:has-text("Основно меню")'); await pg2.waitForTimeout(500);
  await pg2.getByRole('button', { name: 'Добави категория' }).first().click();
  await pg2.getByRole('button', { name: 'Добави ястие' }).click({ timeout: 5000 }); await pg2.waitForTimeout(300);
  R.check('EDGE3 add category then click "Добави ястие" ONCE (category name still empty): a dish is added (blur validation message must not shift the button and swallow the click)', (await pg2.locator('.a-dish').count()) === 1, `dishes=${await pg2.locator('.a-dish').count()}`);
  if (!(await pg2.locator('.a-dish').count())) { await pg2.locator('.a-cat__name input').first().fill('Кат'); await pg2.getByRole('button', { name: 'Добави ястие' }).click(); }
  await pg2.getByLabel('Име на ястието').first().pressSequentially('Моето');
  const labMid = await pg2.locator('.a-dish').first().getByRole('button', { name: /Изтрий/ }).getAttribute('aria-label');
  await pg2.getByLabel('Име на ястието').first().pressSequentially(' ястие');
  await pg2.locator('.a-cat__name input').first().pressSequentially('Супи');
  const catLabs = await pg2.locator('.a-cat__btns button[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  R.check('EDGE2b labels update on every keystroke (dish after "Моето" = ' + labMid + '); category buttons carry category name', /Моето/.test(labMid || '') && !/ястие“/.test(labMid || '') && catLabs.some((l) => /Изтрий категорията „Супи“/.test(l)), JSON.stringify({ labMid, catLabs }));
  const lab = await pg2.locator('.a-dish').first().getByRole('button', { name: /Изтрий/ }).getAttribute('aria-label');
  const sw1 = await pg2.locator('.a-dish [role=switch]').first().getAttribute('aria-label');
  R.check('EDGE2 dish delete button / availability switch accessible names include the dish name AFTER it is typed (not stale from render time)', /Моето ястие/.test(lab || '') && /Моето ястие/.test(sw1 || ''), `delete="${lab}" switch="${sw1}"`);
  await pg2.getByRole('button', { name: 'Откажи промените' }).click().catch(() => {});
  await c2.context.close();
});

// ================= settings: site info, password (server 400 fields), 2FA =================
import crypto from 'node:crypto';
const totp = (b32, t = Date.parse(T0)) => { // server clock is frozen at T0
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of b32.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((x) => parseInt(x, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', key).update(ctr).digest(); const o = h[19] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
};
await step('ST', async () => {
  const c = await newPage(browser, { width: 390, height: 844 });
  const pg = c.page; await login(pg); await go(pg, '#/settings'); await pg.waitForSelector('h1:has-text("Настройки")');
  await pg.getByLabel('Телефон за резервации').fill('+359 88 111 2222'); await pg.getByLabel('Адрес', { exact: true }).fill('ул. Тест 5');
  await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(600);
  const site = (await anon.get('/api/public/site')).data;
  R.check('ST1 site info saved via UI shows in public API without restart', site.reservationPhone === '+359 88 111 2222' && site.address === 'ул. Тест 5', JSON.stringify(site));
  await pg.getByLabel('Телефон за резервации').fill('abc');
  await pg.getByRole('button', { name: 'Запази', exact: true }).click(); await pg.waitForTimeout(600);
  R.check('ST2 invalid phone rejected (client or server) with visible error, public unchanged', (await pg.locator('.a-error:visible, [role=alert]:visible').count()) >= 1 && (await anon.get('/api/public/site')).data.reservationPhone === '+359 88 111 2222');
  await pg.getByLabel('Телефон за резервации').fill('+359 88 111 2222');
  // password: wrong current => server 400 fields.currentPassword must be shown inline and must NOT log out
  await pg.getByLabel('Текуща парола', { exact: true }).fill('wrong-current-pass'); await pg.getByLabel('Нова парола', { exact: true }).fill('new-password-12345'); await pg.getByLabel('Повторете новата парола', { exact: true }).fill('new-password-12345');
  await pg.getByRole('button', { name: 'Смени паролата' }).click(); await pg.waitForTimeout(800);
  R.check('ST3 REAL server 400 for wrong current password is shown as field error; still logged in (no expired overlay)', (await pg.locator('main').textContent()).includes('Текущата парола е грешна') && (await pg.locator('.a-overlay').count()) === 0 && (await pg.locator('.a-login').count()) === 0, (await pg.locator('.a-error:visible').allTextContents()).join('|'));
  await pg.getByLabel('Текуща парола', { exact: true }).fill(PASSWORD); await pg.getByLabel('Нова парола', { exact: true }).fill('short'); await pg.getByLabel('Повторете новата парола', { exact: true }).fill('short');
  await pg.getByRole('button', { name: 'Смени паролата' }).click(); await pg.waitForTimeout(600);
  R.check('ST4 short new password rejected with message', (await pg.locator('.a-error:visible').count()) >= 1);
  // 2FA
  await pg.getByRole('button', { name: 'Включи 2FA' }).click(); await pg.waitForSelector('.a-secret');
  const secret = (await pg.locator('.a-secret').first().innerText()).replace(/\s/g, '');
  await pg.getByLabel('Код', { exact: true }).fill('000000'); await pg.getByRole('button', { name: 'Потвърди и включи' }).click(); await pg.waitForTimeout(600);
  R.check('ST5 wrong 2FA code => REAL server 400 fields.code shown inline, not treated as logout', (await pg.locator('.a-error:visible').count()) >= 1 && (await pg.locator('.a-overlay').count()) === 0 && (await api.get('/api/admin/me')).status === 200);
  await pg.getByLabel('Код', { exact: true }).fill(totp(secret)); await pg.getByRole('button', { name: 'Потвърди и включи' }).click(); await pg.waitForTimeout(800);
  R.check('ST6 correct TOTP code (computed independently by QA) enables 2FA', (await pg.getByText(/Изключи 2FA/).count()) >= 1);
  await pg.locator('.a-logout-top:visible, .a-logout-side:visible').first().click(); await pg.waitForSelector('.a-login');
  await pg.getByLabel('Потребителско име').fill('owner'); await pg.getByLabel('Парола', { exact: true }).fill(PASSWORD); await pg.getByRole('button', { name: 'Вход' }).click();
  await pg.waitForSelector('h1:has-text("Потвърждение")');
  await pg.getByLabel('Код', { exact: true }).fill('123456'); await pg.getByRole('button', { name: 'Потвърди' }).click(); await pg.waitForTimeout(500);
  R.check('ST7 login step 2: wrong code => error, no session', (await pg.locator('[role=alert]').count()) >= 1 && (await pg.locator('.a-nav').count()) === 0);
  await pg.getByLabel('Код', { exact: true }).fill(totp(secret)); await pg.getByRole('button', { name: 'Потвърди' }).click();
  await pg.waitForSelector('.a-nav');
  R.pass('ST8 login with password + valid TOTP succeeds');
  await pg.screenshot({ path: path.join(shots, 'admin-settings-2fa-390.png'), fullPage: true });
  // restore: disable 2FA via UI so later tests (viewports) can log in with the password only
  await go(pg, '#/settings');
  await pg.getByLabel('Парола', { exact: true }).fill(PASSWORD);
  await pg.getByLabel('Код от приложението').fill(totp(secret)); await pg.getByRole('button', { name: 'Изключи 2FA' }).click(); await pg.locator('dialog[open]').getByRole('button', { name: 'Изключи', exact: true }).click(); await pg.waitForTimeout(800);
  R.check('ST9 2FA can be disabled with password + code', (await pg.getByRole('button', { name: 'Включи 2FA' }).count()) === 1, (await pg.locator('main').innerText()).slice(-700));
  await c.context.close();
});

// ================= viewports: all admin routes =================
await step('V', async () => {
  const e0 = (await api.get('/api/admin/events')).data.events; // ensure some data
  for (const vp of VIEWPORTS) {
    const c = await newPage(browser, { width: vp.width, height: vp.height });
    await login(c.page);
    for (const hash of ['#/', '#/events', '#/events/new', '#/daily-menu', '#/menu', '#/settings']) {
      await go(c.page, hash); await c.page.waitForTimeout(500);
      const hs = await noHScroll(c.page);
      const h1 = await c.page.locator('h1').count();
      const unlabeled = await c.page.$$eval('input:not([type=file]):not([type=radio]), textarea, select', (els) => els.filter((e) => !(e.labels && e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length);
      R.check(`AV[${vp.name}] ${hash}: no hscroll, exactly 1 h1, all inputs labelled`, hs.ok && h1 === 1 && unlabeled === 0, `sw=${hs.sw} iw=${hs.iw} h1=${h1} unlabeled=${unlabeled}`);
      await c.page.screenshot({ path: path.join(shots, `admin-${hash.replace(/[#/]+/g, '_')}-${vp.name}.png`), fullPage: true });
    }
    // covering: scroll to bottom of long pages, check last content is not under fixed/sticky bars
    for (const hash of ['#/events/new', '#/menu', '#/daily-menu', '#/settings']) {
      await go(c.page, hash); await c.page.waitForTimeout(400);
      await c.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await c.page.waitForTimeout(200);
      const r = await c.page.evaluate(() => {
        const bars = [...document.querySelectorAll('*')].filter((e) => ['fixed', 'sticky'].includes(getComputedStyle(e).position) && e.getBoundingClientRect().height > 0 && !e.closest('.a-toasts') && e.getBoundingClientRect().bottom > innerHeight - 140 && e.getBoundingClientRect().top > innerHeight / 2);
        const last = [...document.querySelectorAll('main a, main button, main input, main textarea, main p')].filter((e) => e.offsetParent !== null && !bars.some((b) => b.contains(e))).pop();
        const lb = last ? last.getBoundingClientRect().bottom : 0;
        const minTop = Math.min(innerHeight, ...bars.map((b) => b.getBoundingClientRect().top));
        return { bars: bars.map((b) => b.className.toString().slice(0, 30)), lastBottom: Math.round(lb), barTop: Math.round(minTop), last: last && (last.textContent || last.tagName).slice(0, 25) };
      });
      R.check(`AV-COVER[${vp.name}] ${hash}: at scroll bottom the last content (${r.last}) is not hidden under bottom bars ${JSON.stringify(r.bars)}`, r.lastBottom <= r.barTop + 1, JSON.stringify(r));
      await c.page.screenshot({ path: path.join(shots, `admin-bottom${hash.replace(/[#/]+/g, '_')}-${vp.name}.png`) });
    }
    R.check(`AV-LOG[${vp.name}] no console/page errors, CSP violations, failed requests`, c.log.console.filter((m) => !/401 \(Unauthorized\) @ \S+\/api\/admin\/me/.test(m)).length === 0 && c.log.pageErrors.length === 0 && c.log.failed.length === 0 && (await c.page.collectCsp()).length === 0, JSON.stringify({ c: c.log.console, p: c.log.pageErrors, f: c.log.failed, h: c.log.http4xx }));
    await c.context.close();
  }
  void e0;
});

await browser.close();
await srv.stop();
fs.rmSync(dir, { recursive: true, force: true });
R.summary();
fs.writeFileSync(path.join(SCRATCH, 'admin-e2e-results.json'), JSON.stringify(R.results, null, 1));
