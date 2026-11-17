// Small DOM helpers. Text always goes through textContent.
import { langHref } from './i18n.js';

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

// Trusted constant SVG markup only (never API data).
const ICONS = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v5M12 16.5v.01"/>',
  'file-pdf': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 16h1.5a1.5 1.5 0 0 0 0-3H8v5M13 18v-5h1a2 2 0 0 1 0 5zM18 13h-2v5M16 15.5h2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
};
export function icon(name, className) {
  const wrap = document.createElement('span');
  wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
  const svg = wrap.firstChild;
  if (className) svg.setAttribute('class', className);
  return svg;
}

export function bilingual(parent, bg, en) {
  parent.append(document.createTextNode(bg));
  if (en) {
    parent.append(' ');
    const s = el('span', 'en', en);
    s.lang = 'en';
    parent.append(s);
  }
  return parent;
}

export async function getJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/** Error / empty state box. actions: [{label, href?, onClick?, className?}] */
export function stateBox({ title, body, role, isError, actions }) {
  const box = el('div', 'state-box');
  if (role) box.setAttribute('role', role);
  if (isError) box.append(icon('alert', 'state-icon'));
  const t = el('p', 'state-title');
  t.append(document.createTextNode(title));
  box.append(t);
  if (body) box.append(el('p', '', body));
  if (actions && actions.length) {
    const row = el('div', 'state-actions');
    for (const a of actions) {
      const node = el(a.href ? 'a' : 'button', a.className || 'btn', a.label);
      if (a.href) node.href = langHref(a.href); else node.type = 'button';
      if (a.onClick) node.addEventListener('click', a.onClick);
      row.append(node);
    }
    box.append(row);
  }
  return box;
}
