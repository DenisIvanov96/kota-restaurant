import express from 'express';
import { DOC_TYPES, kindOf } from '../../files.js';
import { tx } from '../../db.js';
import {
  getSetting, setSetting, siteSettings, readDraft, latestSnapshot, hasUnpublishedChanges, fileUrlAdmin, loc,
  LANGS, MAX_MENU_PAGES, pagesFlag, setPagesFlag, touchPages, pageRows, liveLangs,
} from '../../store.js';
import { HttpError, validationError, notFound, parseBool, parseId, normText, has } from '../../http.js';

export function menuRoutes({ db, nowMs, files }) {
  const r = express.Router();
  const upload = files.uploadSingle('file');

  const draftObj = () => ({ updatedAt: loc(Number(getSetting(db, 'draft_updated_at')) || null), categories: readDraft(db) });
  // ----- pages (file mode, D-46) -----
  const pageObj = (m) => ({
    id: m.id, lang: m.lang, fileUrl: fileUrlAdmin(m.stored_name), mimeType: m.mime_type, kind: kindOf(m.mime_type),
    originalName: m.original_name, sizeBytes: m.size_bytes, position: m.position, createdAt: loc(m.created_at),
  });
  const langBlock = (lang) => ({ lang, published: pagesFlag(db, lang), items: pageRows(db, lang).map(pageObj) });
  const pagesObj = () => ({ bg: langBlock('bg'), en: langBlock('en') });
  const pageById = (id) => db.prepare('SELECT * FROM menu_files WHERE id = ?').get(id);
  const parseLang = (v) => {
    if (!LANGS.includes(v)) throw validationError({ lang: 'Допустими стойности: bg, en.' });
    return v;
  };
  const noMenuMsg = 'Това е единственото публикувано меню (файлове). Първо превключете на структурирано меню.';

  r.get('/', (req, res) => {
    const snap = latestSnapshot(db);
    res.json({
      mode: getSetting(db, 'menu_mode'),
      currencySymbol: siteSettings(db).currencySymbol,
      draft: draftObj(),
      published: snap ? { publishedAt: loc(snap.publishedAt), categories: snap.categories } : null,
      hasUnpublishedChanges: hasUnpublishedChanges(db),
      pages: Object.fromEntries(LANGS.map((l) => { const { lang, ...rest } = langBlock(l); return [lang, rest]; })),
    });
  });

  // ----- draft -----
  function validateDraft(body) {
    const errors = {};
    const cats = body && body.categories;
    if (!Array.isArray(cats)) throw validationError({ categories: 'Очаква се списък с категории.' });
    if (cats.length > 50) throw validationError({ categories: 'Най-много 50 категории.' });
    const seenCat = new Set(); const seenItem = new Set();
    const optId = (v, seen, path) => {
      if (v === undefined || v === null) return null;
      if (!Number.isInteger(v) || v < 1) { errors[path] = 'Невалиден идентификатор.'; return null; }
      if (seen.has(v)) { errors[path] = 'Повтарящ се идентификатор.'; return null; }
      seen.add(v); return v;
    };
    const optText = (v, max, path, msg) => {
      if (v === undefined || v === null) return '';
      const t = typeof v === 'string' ? normText(v) : null;
      if (t === null || t.length > max) { errors[path] = msg; return ''; }
      return t;
    };
    const out = cats.map((c, ci) => {
      const cp = `categories[${ci}]`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) { errors[cp] = 'Невалидна категория.'; return null; }
      const id = optId(c.id, seenCat, `${cp}.id`);
      const name = optText(c.name, 100, `${cp}.name`, 'Името е до 100 символа.');
      const nameEn = optText(c.nameEn, 100, `${cp}.nameEn`, 'Английското име е до 100 символа.');
      if (!name && !nameEn && !errors[`${cp}.name`] && !errors[`${cp}.nameEn`]) errors[`${cp}.name`] = 'Името е задължително (на български или на английски, 1–100 символа).';
      const items = Array.isArray(c.items) ? c.items : (c.items === undefined ? [] : null);
      if (items === null) { errors[`${cp}.items`] = 'Очаква се списък.'; return null; }
      if (items.length > 200) errors[`${cp}.items`] = 'Най-много 200 артикула в категория.';
      return {
        id, name, nameEn,
        items: items.slice(0, 200).map((it, ii) => {
          const ip = `${cp}.items[${ii}]`;
          if (!it || typeof it !== 'object' || Array.isArray(it)) { errors[ip] = 'Невалиден артикул.'; return null; }
          const iid = optId(it.id, seenItem, `${ip}.id`);
          const iname = optText(it.name, 100, `${ip}.name`, 'Името е до 100 символа.');
          const desc = it.description === undefined || it.description === null ? '' : normText(it.description);
          if (typeof desc !== 'string' || desc.length > 500) errors[`${ip}.description`] = 'Описанието е до 500 символа.';
          const inameEn = optText(it.nameEn, 100, `${ip}.nameEn`, 'Английското име е до 100 символа.');
          const descEn = optText(it.descriptionEn, 500, `${ip}.descriptionEn`, 'Английското описание е до 500 символа.');
          if (!iname && !inameEn && !errors[`${ip}.name`] && !errors[`${ip}.nameEn`]) errors[`${ip}.name`] = 'Името е задължително (на български или на английски, 1–100 символа).';
          if (!Number.isInteger(it.priceCents) || it.priceCents < 0 || it.priceCents > 10000000) errors[`${ip}.priceCents`] = 'Цената трябва да е цяло число от 0 до 10 000 000 (стотинки).';
          const av = it.available === undefined ? true : parseBool(it.available);
          if (av === undefined) errors[`${ip}.available`] = 'Стойност true или false.';
          return { id: iid, name: iname, nameEn: inameEn, description: typeof desc === 'string' ? desc : '', descriptionEn: descEn, priceCents: it.priceCents, available: av };
        }),
      };
    });
    if (Object.keys(errors).length) throw validationError(errors);
    return out;
  }

  function writeDraft(cats, now) {
    const existingCats = new Set(db.prepare('SELECT id FROM menu_categories').all().map((x) => x.id));
    const existingItems = new Set(db.prepare('SELECT id FROM menu_items').all().map((x) => x.id));
    const errors = {};
    cats.forEach((c, ci) => {
      if (c.id != null && !existingCats.has(c.id)) errors[`categories[${ci}].id`] = 'Непозната категория.';
      c.items.forEach((it, ii) => {
        if (it.id != null && !existingItems.has(it.id)) errors[`categories[${ci}].items[${ii}].id`] = 'Непознат артикул.';
      });
    });
    if (Object.keys(errors).length) throw validationError(errors);
    tx(db, () => {
      const keepCats = cats.map((c) => c.id).filter((x) => x != null);
      const keepItems = cats.flatMap((c) => c.items.map((i) => i.id)).filter((x) => x != null);
      for (const id of existingItems) if (!keepItems.includes(id)) db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
      for (const id of existingCats) if (!keepCats.includes(id)) db.prepare('DELETE FROM menu_categories WHERE id = ?').run(id);
      cats.forEach((c, ci) => {
        let cid = c.id;
        if (cid == null) cid = Number(db.prepare('INSERT INTO menu_categories(name, name_en, position) VALUES (?,?,?)').run(c.name, c.nameEn || null, ci).lastInsertRowid);
        else db.prepare('UPDATE menu_categories SET name = ?, name_en = ?, position = ? WHERE id = ?').run(c.name, c.nameEn || null, ci, cid);
        c.items.forEach((it, ii) => {
          if (it.id == null) {
            db.prepare('INSERT INTO menu_items(category_id, name, name_en, description, description_en, price_cents, available, position) VALUES (?,?,?,?,?,?,?,?)')
              .run(cid, it.name, it.nameEn || null, it.description, it.descriptionEn || null, it.priceCents, it.available ? 1 : 0, ii);
          } else {
            db.prepare('UPDATE menu_items SET category_id=?, name=?, name_en=?, description=?, description_en=?, price_cents=?, available=?, position=? WHERE id=?')
              .run(cid, it.name, it.nameEn || null, it.description, it.descriptionEn || null, it.priceCents, it.available ? 1 : 0, ii, it.id);
          }
        });
      });
      setSetting(db, 'draft_updated_at', String(now));
    });
  }

  r.put('/draft', (req, res) => {
    writeDraft(validateDraft(req.body), nowMs());
    res.json(draftObj());
  });

  r.post('/draft/discard', (req, res) => {
    const snap = latestSnapshot(db);
    tx(db, () => {
      db.prepare('DELETE FROM menu_items').run();
      db.prepare('DELETE FROM menu_categories').run();
      (snap ? snap.categories : []).forEach((c, ci) => {
        const cid = Number(db.prepare('INSERT INTO menu_categories(name, name_en, position) VALUES (?,?,?)').run(c.name, c.nameEn || null, ci).lastInsertRowid);
        c.items.forEach((it, ii) => {
          db.prepare('INSERT INTO menu_items(category_id, name, name_en, description, description_en, price_cents, available, position) VALUES (?,?,?,?,?,?,?,?)')
            .run(cid, it.name, it.nameEn || null, it.description, it.descriptionEn || null, it.priceCents, it.available ? 1 : 0, ii);
        });
      });
      setSetting(db, 'draft_updated_at', String(nowMs()));
    });
    res.json(draftObj());
  });

  r.post('/publish', (req, res) => {
    const now = nowMs();
    tx(db, () => db.prepare('INSERT INTO menu_versions(snapshot_json, published_at) VALUES (?, ?)')
      .run(JSON.stringify(readDraft(db)), now));
    res.json({ publishedAt: loc(now) });
  });

  // ----- pages -----
  r.post('/pages', upload, async (req, res) => {
    if (!req.uploads.file) throw validationError({ file: 'Изберете файл.' });
    const lang = has(req.body, 'lang') ? parseLang(req.body.lang) : 'bg';
    const countOf = () => db.prepare('SELECT COUNT(*) AS n FROM menu_files WHERE lang = ?').get(lang).n;
    const tooMany = () => new HttpError(409, 'too_many_pages', `Най-много ${MAX_MENU_PAGES} страници на език.`);
    if (countOf() >= MAX_MENU_PAGES) throw tooMany();
    const id = await files.withUpload(req.uploads.file, DOC_TYPES, 'file', (staged) => tx(db, () => {
      if (countOf() >= MAX_MENU_PAGES) throw tooMany();
      const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM menu_files WHERE lang = ?').get(lang).p;
      const fid = files.insertRow(staged);
      const now = nowMs();
      touchPages(db, lang, now);
      return Number(db.prepare('INSERT INTO menu_files(file_id, lang, published, position, created_at) VALUES (?,?,0,?,?)').run(fid, lang, pos, now).lastInsertRowid);
    }));
    const row = pageRows(db, lang).find((x) => x.id === id);
    res.status(201).json(pageObj(row));
  });

  r.put('/pages/order', (req, res) => {
    const b = req.body || {};
    const lang = parseLang(b.lang);
    const cur = pageRows(db, lang).map((x) => x.id);
    const ids = b.ids;
    const ok = Array.isArray(ids) && ids.length === cur.length && ids.every((x) => Number.isInteger(x))
      && new Set(ids).size === ids.length && ids.every((x) => cur.includes(x));
    if (!ok) throw validationError({ ids: 'Очаква се пълен списък с идентификаторите на страниците на този език, без повторения.' });
    tx(db, () => {
      ids.forEach((id, i) => db.prepare('UPDATE menu_files SET position = ? WHERE id = ?').run(i + 1, id));
      touchPages(db, lang, nowMs());
    });
    res.json(langBlock(lang));
  });

  r.put('/pages/published', (req, res) => {
    const b = req.body || {};
    const lang = parseLang(b.lang);
    const p = parseBool(b.published);
    if (p === undefined) throw validationError({ published: 'Стойност true или false.' });
    if (!p && getSetting(db, 'menu_mode') === 'file' && liveLangs(db).includes(lang) && liveLangs(db).length === 1) {
      throw new HttpError(409, 'in_use', noMenuMsg);
    }
    tx(db, () => { setPagesFlag(db, lang, p); touchPages(db, lang, nowMs()); });
    res.json(langBlock(lang));
  });

  r.delete('/pages/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const ex = pageById(id);
    if (!ex) throw notFound('Страницата не е намерена.');
    const live = liveLangs(db);
    const lastOfLang = db.prepare('SELECT COUNT(*) AS n FROM menu_files WHERE lang = ?').get(ex.lang).n === 1;
    if (getSetting(db, 'menu_mode') === 'file' && lastOfLang && live.includes(ex.lang) && live.length === 1) {
      throw new HttpError(409, 'in_use', 'Това е последната страница от публичното меню. Първо превключете на структурирано меню.');
    }
    const old = tx(db, () => {
      db.prepare('DELETE FROM menu_files WHERE id = ?').run(id);
      db.prepare('SELECT id FROM menu_files WHERE lang = ? ORDER BY position, id').all(ex.lang)
        .forEach((x, i) => db.prepare('UPDATE menu_files SET position = ? WHERE id = ?').run(i + 1, x.id));
      touchPages(db, ex.lang, nowMs());
      return files.deleteRow(ex.file_id);
    });
    await files.unlink(old);
    res.status(204).end();
  });

  // ----- mode -----
  r.put('/mode', (req, res) => {
    const mode = req.body && req.body.mode;
    if (mode !== 'structured' && mode !== 'file') throw validationError({ mode: 'Допустими стойности: structured, file.' });
    const ready = mode === 'file'
      ? liveLangs(db).length > 0
      : !!latestSnapshot(db);
    if (!ready) {
      throw new HttpError(409, 'nothing_published', mode === 'file'
        ? 'Няма публикувани страници с меню.' : 'Структурираното меню още не е публикувано.');
    }
    setSetting(db, 'menu_mode', mode);
    res.json({ mode });
  });
  return r;
}
