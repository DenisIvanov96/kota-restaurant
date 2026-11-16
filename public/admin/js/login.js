import { h, icon } from './util.js';
import { post, ApiError } from './api.js';
import { btn, field, passwordField, alertBox, setBusy } from './ui.js';

const fmtWait = (s) => (s < 60 ? `${s} сек.` : `${Math.ceil(s / 60)} мин.`);

/** Returns the login screen element. onSuccess(admin) is called after a successful login. */
export function renderLogin({ expired, onSuccess }) {
  const root = h('div', { class: 'a-login' });
  const sign = h('div', { class: 'a-login__sign' },
    h('p', { class: 'a-logo a-logo--xl', 'aria-label': 'Kota 1' }, h('span', { class: 'a-logo__kota', text: 'KOTA' }), h('span', { class: 'a-logo__one', text: '1' })),
    h('p', { class: 'a-login__tag', text: 'Админ панел' }));
  const card = h('div', { class: 'a-login__card' });
  root.append(sign, card, h('p', { class: 'a-login__note', text: 'Забравена парола? Свържете се с администратора на сайта.' }));

  let creds = { username: '', password: '' };
  let step = 1;
  let timer = null;
  let ctl = null;

  function stepOne(message, kind) {
    step = 1;
    card.replaceChildren();
    const form = h('form', { novalidate: true, class: 'a-form' });
    const alertSlot = h('div', { class: 'a-login__alert' });
    const user = field({ label: 'Потребителско име', autocomplete: 'username', autocapitalize: 'none', value: creds.username });
    const pass = passwordField({ label: 'Парола', autocomplete: 'current-password' });
    const submit = btn({ label: 'Вход', variant: 'primary', type: 'submit', cls: 'a-btn--block' });
    form.append(alertSlot, user.el, pass.el, submit);
    card.append(h('h1', { class: 'a-vh', text: 'Вход' }), form);
    if (expired && !message) alertSlot.append(alertBox('warning', 'Сесията ви изтече. Влезте отново.', { role: 'alert' }));
    if (message) alertSlot.append(alertBox(kind === 'info' ? 'info' : 'error', message, { role: 'alert' }));

    const lock = (secs) => {
      pass.value = '';
      [user, pass].forEach((f) => f.setDisabled(true));
      submit.disabled = true;
      alertSlot.replaceChildren(alertBox('error', `Твърде много опити. Опитайте отново след ${fmtWait(secs)}`, { role: 'alert' }));
      timer = setTimeout(() => {
        [user, pass].forEach((f) => f.setDisabled(false));
        submit.disabled = false;
        alertSlot.replaceChildren(alertBox('info', 'Можете да опитате отново.', { role: 'status' }));
      }, secs * 1000);
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      user.setError(''); pass.setError('');
      if (!user.value.trim()) { user.setError('Въведете потребителско име.'); user.input.focus(); return; }
      if (!pass.value) { pass.setError('Въведете парола.'); pass.input.focus(); return; }
      creds = { username: user.value.trim(), password: pass.value };
      await attempt(submit, alertSlot, null, () => pass);
    });
    if (!message) user.input.focus();
    ctl = { lock };
  }

  async function attempt(submitBtn, alertSlot, totp, focusAfter) {
    setBusy(submitBtn, true, 'Вход…');
    try {
      const body = { username: creds.username, password: creds.password };
      if (totp) body.totp = totp;
      const res = await post('/api/admin/login', body, { noSession: true });
      creds = { username: '', password: '' };
      onSuccess(res.admin);
    } catch (err) {
      setBusy(submitBtn, false);
      if (!(err instanceof ApiError)) throw err;
      if (err.status === 401 && err.code === 'totp_required') { stepTwo(); return; }
      if (err.status === 429) {
        const secs = Number(err.data.retryAfter) || 60;
        if (step === 2) { creds.password = ''; stepOne(); }
        ctl.lock(secs);
        return;
      }
      let msg;
      if (err.status === 401) msg = step === 2 ? 'Невалиден код. Опитайте с нов код.' : 'Грешно потребителско име или парола.';
      else msg = 'Няма връзка със сървъра. Опитайте отново.';
      alertSlot.replaceChildren(alertBox('error', msg, { role: 'alert' }));
      if (step === 1) { const f = focusAfter(); f.value = ''; f.input.focus(); } else { focusAfter().input.focus(); }
    }
  }

  function stepTwo() {
    step = 2;
    card.replaceChildren();
    const form = h('form', { novalidate: true, class: 'a-form' });
    const alertSlot = h('div', { class: 'a-login__alert' });
    const code = field({ label: 'Код', inputmode: 'numeric', autocomplete: 'one-time-code', max: 6, cls: 'a-code', helper: 'Въведете 6-цифрения код от приложението за удостоверяване.' });
    code.input.setAttribute('pattern', '[0-9]*');
    const submit = btn({ label: 'Потвърди', variant: 'primary', type: 'submit', cls: 'a-btn--block' });
    const back = btn({ label: 'Назад', variant: 'ghost', cls: 'a-btn--block', onClick: () => { creds.password = ''; stepOne(); } });
    form.append(alertSlot, code.el, submit, back);
    card.append(h('h1', { class: 'a-login__title', text: 'Потвърждение със код' }), form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      code.setError('');
      const v = code.value.trim();
      if (!/^\d{6}$/.test(v)) { code.setError('Въведете 6-цифрен код.'); code.input.focus(); return; }
      await attempt(submit, alertSlot, v, () => code);
    });
    code.input.focus();
  }

  stepOne();
  root.destroy = () => clearTimeout(timer);
  return root;
}
