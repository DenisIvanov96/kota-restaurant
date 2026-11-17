import { h, icon, groupSpaces } from './util.js';
import { get, put, post, ApiError } from './api.js';
import { badge, alertBox, btn, skeleton, loadError, reportError, toast, confirmDialog, field, passwordField, setBusy, enGroup, EN_HELP } from './ui.js';

export function settingsView(ctx) {
  const el = h('div');
  el.append(h('h1', { class: 'a-h1', text: 'Настройки' }));
  const body = h('div');
  el.append(body);
  let dead = false;
  let siteDirty = () => false;

  async function load() {
    body.replaceChildren(skeleton(3));
    try {
      const s = await get('/api/admin/settings');
      if (dead) return;
      body.replaceChildren(siteCard(s), passwordCard(), totpCard(), profileCard());
    } catch (e) { if (!dead) { body.replaceChildren(loadError(null, load)); reportError(e); } }
  }

  // ---- 1. site info
  function siteCard(s) {
    const phone = field({ label: 'Телефон за резервации', type: 'tel', inputmode: 'tel', max: 30, value: s.reservationPhone, helper: 'Показва се най-горе на сайта и в „Контакти“. Оставете празно, за да го скриете.', autocomplete: 'off' });
    const addr = field({ label: 'Адрес', multiline: true, rows: 2, max: 200, value: s.address, helper: 'Оставете празно, за да се скрие.' });
    const hours = field({ label: 'Работно време', multiline: true, rows: 5, max: 500, value: s.openingHours, helper: 'Всеки ред се показва на нов ред на сайта. Пример: Пон–Пет 11:00–23:00' });
    const addrEn = field({ label: 'Адрес (английски)', multiline: true, rows: 2, max: 200, value: s.addressEn || '', helper: EN_HELP });
    const hoursEn = field({ label: 'Работно време (английски)', multiline: true, rows: 5, max: 500, value: s.openingHoursEn || '', helper: EN_HELP });
    addrEn.input.setAttribute('aria-label', 'Адрес на английски');
    hoursEn.input.setAttribute('aria-label', 'Работно време на английски');
    const enBox = enGroup([addrEn, hoursEn]);
    const insta = field({ label: 'Instagram профил', type: 'url', inputmode: 'url', max: 200, value: s.instagramUrl || '', placeholder: 'https://www.instagram.com/вашият-профил', autocomplete: 'off', autocapitalize: 'none', helper: 'Връзка към профила ви в Instagram. Оставете празно, ако нямате профил.' });
    const cur = field({ label: 'Валутен символ', max: 5, value: s.currencySymbol, cls: 'a-field--narrow', helper: 'Показва се след цената, например €.' });
    const snap = () => JSON.stringify([phone.value, addr.value, hours.value, addrEn.value, hoursEn.value, cur.value, insta.value]);
    let base = snap();
    siteDirty = () => snap() !== base;
    const save = btn({ label: 'Запази', variant: 'primary', type: 'submit' });
    const form = h('form', { class: 'a-card a-form', novalidate: true }, h('h2', { text: 'Информация за сайта' }), phone.el, addr.el, hours.el, enBox, insta.el, cur.el, h('div', { class: 'a-actionrow' }, save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      [phone, addr, hours, addrEn, hoursEn, cur, insta].forEach((f) => f.setError(''));
      if (!/^[+0-9 ()-]*$/.test(phone.value)) { phone.setError('Само цифри, интервали, +, ( ) и -.'); phone.input.focus(); return; }
      const iu = insta.value.trim();
      if (iu) {
        let ok = false;
        try { const u = new URL(iu); ok = u.protocol === 'https:' && /^(www\.)?instagram\.com$/i.test(u.hostname); } catch { ok = false; }
        if (!ok) { insta.setError('Въведете адрес, започващ с https://www.instagram.com/'); insta.input.focus(); return; }
      }
      setBusy(save, true);
      try {
        const r = await put('/api/admin/settings', { reservationPhone: phone.value.trim(), address: addr.value.trim(), openingHours: hours.value.trim(), addressEn: addrEn.value.trim(), openingHoursEn: hoursEn.value.trim(), currencySymbol: cur.value.trim(), instagramUrl: iu });
        phone.value = r.reservationPhone; addr.value = r.address; hours.value = r.openingHours; cur.value = r.currencySymbol;
        if (r.instagramUrl !== undefined) insta.value = r.instagramUrl;
        if (r.addressEn !== undefined) addrEn.value = r.addressEn;
        if (r.openingHoursEn !== undefined) hoursEn.value = r.openingHoursEn;
        base = snap();
        toast('Настройките са запазени.');
      } catch (err) {
        if (err.status === 400 && err.fields) {
          const m = { reservationPhone: phone, address: addr, openingHours: hours, addressEn: addrEn, openingHoursEn: hoursEn, currencySymbol: cur, instagramUrl: insta };
          let first = null;
          for (const [k, msg] of Object.entries(err.fields)) if (m[k]) { if (m[k] === addrEn || m[k] === hoursEn) enBox.open = true; m[k].setError(msg); first = first || m[k]; }
          if (first) first.input.focus();
        } else reportError(err);
      } finally { setBusy(save, false); }
    });
    return form;
  }

  // ---- 2. password
  function passwordCard() {
    const cur = passwordField({ label: 'Текуща парола', autocomplete: 'current-password' });
    const nw = passwordField({ label: 'Нова парола', autocomplete: 'new-password', helper: 'Най-малко 12 знака. Подходяща е фраза от няколко думи.' });
    const rep = passwordField({ label: 'Повторете новата парола', autocomplete: 'new-password' });
    const hint = h('p', { class: 'a-help', 'aria-hidden': 'true' });
    const upd = () => { const n = nw.value.length; hint.textContent = n >= 12 ? `${n}/12 ✓` : `${n}/12`; hint.classList.toggle('a-ok-text', n >= 12); };
    upd();
    nw.input.addEventListener('input', () => { upd(); if (nw.error) nw.setError(nw.value.length >= 12 ? '' : 'Паролата трябва да е най-малко 12 знака.'); });
    nw.el.append(hint);
    const save = btn({ label: 'Смени паролата', variant: 'primary', type: 'submit' });
    const form = h('form', { class: 'a-card a-form', novalidate: true }, h('h2', { text: 'Смяна на парола' }), cur.el, nw.el, rep.el, h('div', { class: 'a-actionrow' }, save));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      [cur, nw, rep].forEach((f) => f.setError(''));
      let bad = null;
      if (!cur.value) { cur.setError('Въведете текущата парола.'); bad = bad || cur; }
      if (nw.value.length < 12) { nw.setError('Паролата трябва да е най-малко 12 знака.'); bad = bad || nw; }
      if (rep.value !== nw.value) { rep.setError('Паролите не съвпадат.'); bad = bad || rep; }
      if (bad) { bad.input.focus(); return; }
      setBusy(save, true);
      try {
        await post('/api/admin/password', { currentPassword: cur.value, newPassword: nw.value });
        [cur, nw, rep].forEach((f) => { f.value = ''; });
        upd();
        toast('Паролата е сменена. Излязохте от другите устройства.');
      } catch (err) {
        if (err.fields && err.fields.currentPassword) { cur.setError('Текущата парола е грешна.'); cur.input.focus(); }
        else if (err.fields && err.fields.newPassword) { nw.setError(err.fields.newPassword); nw.input.focus(); }
        else reportError(err);
      } finally { setBusy(save, false); }
    });
    return form;
  }

  // ---- 3. 2FA
  function totpCard() {
    const card = h('section', { class: 'a-card' });
    const draw = () => {
      card.replaceChildren();
      card.append(h('h2', { text: 'Двуфакторна защита (2FA)' }),
        h('p', null, ctx.session.totpEnabled ? badge('Включена', 'ok') : badge('Изключена', 'neutral', 'ring')),
        h('p', { text: 'Освен паролата при вход се иска код от приложение в телефона ви. Така профилът е по-защитен.' }));
      card.append(ctx.session.totpEnabled ? disableForm() : enableStart());
    };

    function enableStart() {
      const area = h('div');
      const start = btn({ label: 'Включи 2FA', variant: 'primary', onClick: async () => {
        setBusy(start, true, 'Подготовка…');
        try { const r = await post('/api/admin/totp/setup'); area.replaceChildren(setupPanel(r)); const c = area.querySelector('input'); if (c) c.focus(); } catch (e) { reportError(e); } finally { setBusy(start, false); }
      } });
      area.append(start);
      return area;
    }

    function setupPanel(r) {
      const secret = groupSpaces(r.secret);
      const code = field({ label: 'Код', inputmode: 'numeric', autocomplete: 'one-time-code', max: 6, cls: 'a-field--narrow' });
      const ok = btn({ label: 'Потвърди и включи', variant: 'primary', type: 'submit' });
      const cancel = btn({ label: 'Откажи', variant: 'secondary', onClick: () => draw() });
      const copy = btn({ label: 'Копирай ключа', variant: 'secondary', onClick: async () => {
        try { await navigator.clipboard.writeText(r.secret); toast('Ключът е копиран.'); } catch { toast('Копирането не е възможно. Маркирайте ключа и го копирайте ръчно.', { type: 'err' }); }
      } });
      const form = h('form', { class: 'a-form', novalidate: true },
        h('ol', { class: 'a-ol' },
          h('li', { text: 'Инсталирайте приложение за удостоверяване, например Google Authenticator, Microsoft Authenticator или Aegis.' }),
          h('li', { text: 'В приложението изберете „Добавяне на акаунт“ и „Въведете ключ ръчно“.' }),
          h('li', { text: 'Въведете име „Kota1“, ключа по-долу и изберете тип „Базиран на време“.' })),
        h('p', { class: 'a-secret', 'aria-label': 'Таен ключ', text: secret }),
        h('div', { class: 'a-actionrow a-actionrow--left' }, copy, h('a', { class: 'a-btn a-btn--ghost', href: r.otpauthUrl }, h('span', { text: 'Отвори в приложението за удостоверяване' }))),
        alertBox('warning', 'Пазете ключа в тайна. Не го споделяйте.'),
        h('p', { text: 'Въведете 6-цифрения код от приложението:' }), code.el, h('div', { class: 'a-actionrow' }, cancel, ok));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); code.setError('');
        if (!/^\d{6}$/.test(code.value.trim())) { code.setError('Невалиден код. Проверете часовника на телефона и опитайте отново.'); code.input.focus(); return; }
        setBusy(ok, true);
        try {
          await post('/api/admin/totp/enable', { code: code.value.trim() });
          ctx.session.totpEnabled = true; toast('2FA е включена.'); draw();
        } catch (err) {
          if (err.status === 400 || err.status === 409) { code.setError(err.status === 400 ? 'Невалиден код. Проверете часовника на телефона и опитайте отново.' : err.message); code.input.focus(); } else reportError(err);
        } finally { setBusy(ok, false); }
      });
      return form;
    }

    function disableForm() {
      const pw = passwordField({ label: 'Парола', autocomplete: 'current-password' });
      const code = field({ label: 'Код от приложението', inputmode: 'numeric', autocomplete: 'one-time-code', max: 6, cls: 'a-field--narrow' });
      const off = btn({ label: 'Изключи 2FA', variant: 'danger', type: 'submit' });
      const err = h('div');
      const form = h('form', { class: 'a-form', novalidate: true }, h('h3', { text: 'Изключване' }), err, pw.el, code.el, h('div', { class: 'a-actionrow' }, off));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.replaceChildren(); pw.setError(''); code.setError('');
        let bad = null;
        if (!pw.value) { pw.setError('Въведете парола.'); bad = pw; }
        if (!/^\d{6}$/.test(code.value.trim())) { code.setError('Въведете 6-цифрен код.'); bad = bad || code; }
        if (bad) { bad.input.focus(); return; }
        let fail = false;
        const ok = await confirmDialog({
          title: 'Изключване на 2FA', body: 'Профилът ви ще се защитава само с парола.', confirmLabel: 'Изключи', danger: true,
          run: async () => {
            try { await post('/api/admin/totp/disable', { password: pw.value, code: code.value.trim() }); } catch (x) { if (x.status === 400 || x.status === 409) { fail = true; return; } throw x; }
          },
        });
        if (ok && !fail) { ctx.session.totpEnabled = false; toast('2FA е изключена.'); draw(); }
        else if (fail) { err.replaceChildren(alertBox('error', 'Грешна парола или код.', { role: 'alert' })); pw.value = ''; pw.input.focus(); }
      });
      return form;
    }
    draw();
    return card;
  }

  // ---- 4. profile
  function profileCard() {
    return h('section', { class: 'a-card' }, h('h2', { text: 'Профил и изход' }), h('p', { text: `Влезли сте като ${ctx.session.username}.` }),
      h('div', { class: 'a-actions' }, btn({ label: 'Изход', variant: 'secondary', icon: 'log-out', onClick: () => document.dispatchEvent(new CustomEvent('admin:logout')) })));
  }

  load();
  return { el, dirty: () => !dead && siteDirty(), destroy() { dead = true; } };
}
