// Public-site language support (D-27). One dictionary, one language state.
// The admin (/admin) always stays Bulgarian, even when it reuses these modules.
export const STRINGS = {
  bg: {
    'skip': 'Към съдържанието',
    'topbar.label': 'Резервации:',
    'nav.menu': 'Меню',
    'nav.daily': 'Обедно меню',
    'nav.event': 'Събитие',
    'nav.about': 'За нас',
    'nav.contact': 'Контакти',
    'nav.aria': 'Основна навигация',
    'nav.toggle': 'Навигация',
    'logo.aria': 'Kota1 — начало',
    'lang.group': 'Език',
    'lang.bg': 'Български',
    'lang.en': 'English',
    'hero.tagline': 'Ресторант',
    'hero.lead': 'Прясна храна, топло посрещане.',
    'hero.daily': 'Обедно меню',
    'hero.book': 'Резервирай маса',
    'menu.heading': 'Меню',
    'about.heading': 'За нас',
    'about.text': 'Прясна храна и топло посрещане.',
    'contact.heading': 'Контакти',
    'contact.phone': 'Телефон',
    'contact.address': 'Адрес',
    'contact.hours': 'Работно време',
    'event.one': 'Събитие',
    'event.many': 'Събития',
    'event.tag': 'Събитие',
    'event.zoom': 'Увеличи снимката: {title}',
    'lb.aria': 'Увеличена снимка',
    'lb.close': 'Затвори',
    'lb.zoomIn': 'Увеличи',
    'lb.zoomOut': 'Намали',
    'daily.h1': 'Обедно меню',
    'daily.tag': 'Само за днес',
    'daily.section': 'Меню за днес',
    'daily.zoom': 'Увеличи менюто',
    'daily.alt': 'Обедно меню за {date}',
    'zoom.hint': 'Докосни за увеличение',
    'loading': 'Зареждане на менюто…',
    'err.menu': 'Менюто не може да се зареди.',
    'err.body': 'Проверете връзката и опитайте отново.',
    'retry': 'Опитай отново',
    'daily.empty': 'Няма обедно меню за днес.',
    'daily.emptyBody': 'Заглеждайте пак по-късно или вижте основното ни меню.',
    'toMenu': 'Към основното меню',
    'call': 'Обади се',
    'pdf.open': 'Отвори PDF',
    'pdf.download': 'Изтегли PDF',
    'pdf.openMenu': 'Отвори меню (PDF)',
    'file.openTab': 'Отвори в нов раздел',
    'file.download': 'Изтегли',
    'pdf.card': 'Менюто е във формат PDF.',
    'pdf.cardBody': 'Натиснете „{open}“, за да го прочетете на целия екран.',
    'menu.alt': 'Основно меню',
    'menu.categories': 'Категории',
    'menu.unavail': 'Няма в наличност',
    'menu.empty': 'Менюто скоро ще бъде публикувано.',
    'menu.seeDaily': 'Вижте обедното меню',
    'title.index': 'Kota1 Restaurant',
    'meta.index': 'Kota1 Restaurant — прясна храна и топло посрещане. Обедно меню, основно меню и събития.',
    'title.daily': 'Обедно меню — Kota1 Restaurant',
    'meta.daily': 'Обедното меню на Kota1 Restaurant за днес.',
  },
  en: {
    'skip': 'Skip to content',
    'topbar.label': 'For reservation:',
    'nav.menu': 'Menu',
    'nav.daily': 'Daily Special',
    'nav.event': 'Event',
    'nav.about': 'About',
    'nav.contact': 'Contact',
    'nav.aria': 'Main navigation',
    'nav.toggle': 'Navigation',
    'logo.aria': 'Kota1 — home',
    'lang.group': 'Language',
    'lang.bg': 'Български',
    'lang.en': 'English',
    'hero.tagline': 'Restaurant',
    'hero.lead': 'Fresh food, warm welcome.',
    'hero.daily': 'Daily Special',
    'hero.book': 'Book a table',
    'menu.heading': 'Menu',
    'about.heading': 'About',
    'about.text': 'Fresh food and a warm welcome.',
    'contact.heading': 'Contact',
    'contact.phone': 'Phone',
    'contact.address': 'Address',
    'contact.hours': 'Opening hours',
    'event.one': 'Event',
    'event.many': 'Events',
    'event.tag': 'Event',
    'event.zoom': 'Enlarge image: {title}',
    'lb.aria': 'Enlarged image',
    'lb.close': 'Close',
    'lb.zoomIn': 'Zoom in',
    'lb.zoomOut': 'Zoom out',
    'daily.h1': 'Daily Special',
    'daily.tag': 'Today only',
    'daily.section': "Today's menu",
    'daily.zoom': 'Enlarge the menu',
    'daily.alt': 'Daily menu for {date}',
    'zoom.hint': 'Tap to enlarge',
    'loading': 'Loading the menu…',
    'err.menu': 'The menu could not be loaded.',
    'err.body': 'Check your connection and try again.',
    'retry': 'Try again',
    'daily.empty': 'No daily menu for today.',
    'daily.emptyBody': 'Check back later or see our regular menu.',
    'toMenu': 'To the regular menu',
    'call': 'Call us',
    'pdf.open': 'Open PDF',
    'pdf.download': 'Download PDF',
    'pdf.openMenu': 'Open menu (PDF)',
    'file.openTab': 'Open in new tab',
    'file.download': 'Download',
    'pdf.card': 'The menu is a PDF file.',
    'pdf.cardBody': 'Tap "{open}" to read it full screen.',
    'menu.alt': 'Regular menu',
    'menu.categories': 'Categories',
    'menu.unavail': 'Unavailable',
    'menu.empty': 'Menu coming soon.',
    'menu.seeDaily': 'See the daily menu',
    'title.index': 'Kota1 Restaurant',
    'meta.index': 'Kota1 Restaurant — fresh food and a warm welcome. Daily special, regular menu and events.',
    'title.daily': 'Daily Special — Kota1 Restaurant',
    'meta.daily': "Today's daily menu at Kota1 Restaurant.",
  },
};

export const DATE_NAMES = {
  bg: {
    weekdays: ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'],
    months: ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'],
  },
  en: {
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  },
};

const KEY = 'kota_lang';
const ok = (v) => v === 'bg' || v === 'en';
let current = null;
const listeners = [];

function resolve() {
  if (location.pathname.startsWith('/admin')) return 'bg';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (ok(q)) {
      try { localStorage.setItem(KEY, q); } catch { /* storage blocked */ }
      return q;
    }
  } catch { /* ignore */ }
  try {
    const s = localStorage.getItem(KEY);
    if (ok(s)) return s;
  } catch { /* storage blocked */ }
  return 'bg';
}

export function getLang() {
  if (!current) current = resolve();
  return current;
}

export function t(key, vars) {
  let s = STRINGS[getLang()][key];
  if (s === undefined) s = STRINGS.bg[key] !== undefined ? STRINGS.bg[key] : key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}

export function onLangChange(fn) { listeners.push(fn); }

/** Internal page links keep the language: '/#menu' -> '/?lang=en#menu'. Other URLs are returned unchanged. */
export function langHref(href) {
  if (getLang() !== 'en') return href;
  if (!(href === '/' || href.startsWith('/#') || href === '/daily-menu' || href.startsWith('/daily-menu#') || href.startsWith('/daily-menu?'))) return href;
  const hashAt = href.indexOf('#');
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt);
  if (/[?&]lang=/.test(path)) return href;
  return path + (path.includes('?') ? '&' : '?') + 'lang=en' + hash;
}

/** API URL with the lang parameter. */
export function apiUrl(path) {
  return path + (path.includes('?') ? '&' : '?') + 'lang=' + getLang();
}

/** Translate everything marked with data-* in the page, update <html lang>, title, meta, switch and internal links. */
export function applyStatic(root = document) {
  const lang = getLang();
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  const page = document.body.dataset.page;
  if (page) {
    document.title = t('title.' + page);
    const m = document.querySelector('meta[name="description"]');
    if (m) m.setAttribute('content', t('meta.' + page));
  }
  document.querySelectorAll('.lang-btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  localizeLinks(root);
}

export function localizeLinks(root = document) {
  root.querySelectorAll('a[href]').forEach((a) => {
    if (a.dataset.href0 === undefined) {
      const h = a.getAttribute('href');
      a.dataset.href0 = (h === '/' || h.startsWith('/#') || h.startsWith('/daily-menu')) ? h : '';
    }
    if (a.dataset.href0) a.setAttribute('href', langHref(a.dataset.href0));
  });
}

function writeUrl(lang) {
  try {
    const u = new URL(location.href);
    if (lang === 'en') u.searchParams.set('lang', 'en'); else u.searchParams.delete('lang');
    history.replaceState(null, '', u.pathname + u.search + u.hash);
  } catch { /* ignore */ }
}

export function setLang(lang) {
  if (!ok(lang) || lang === getLang()) return;
  current = lang;
  try { localStorage.setItem(KEY, lang); } catch { /* storage blocked */ }
  writeUrl(lang);
  applyStatic();
  for (const fn of listeners) fn(lang);
}

/** Call once per page: wires the БГ / EN buttons, normalises the URL and translates static text. */
export function initI18n() {
  const lang = getLang();
  if (lang === 'en') writeUrl('en');
  document.querySelectorAll('.lang-btn').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  applyStatic();
}
