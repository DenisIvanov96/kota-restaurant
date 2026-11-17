// Daily-menu auto-cleanup (D-45).
import { today } from './store.js';
import { tx } from './db.js';

/**
 * Deletes every daily menu dated before today (Europe/Sofia) together with its files.
 * `exceptId` keeps the menu that was just written (an admin may deliberately create a past-dated one; it goes on the next cleanup).
 * Never throws: a failed cleanup must not fail the upload that triggered it. Returns the number of menus deleted.
 */
export async function purgePastDailyMenus({ db, files, nowMs }, exceptId = 0) {
  try {
    const rows = db.prepare('SELECT id, file_id, file_en_id FROM daily_menus WHERE menu_date < ? AND id <> ?').all(today(nowMs()), exceptId);
    for (const d of rows) {
      const names = tx(db, () => {
        db.prepare('DELETE FROM daily_menus WHERE id = ?').run(d.id);
        return [d.file_id, d.file_en_id].filter(Boolean).map((fid) => files.deleteRow(fid));
      });
      for (const n of names) if (n) await files.unlink(n).catch(() => {});
    }
    return rows.length;
  } catch (e) {
    console.error('Daily menu cleanup failed:', e && e.message);
    return 0;
  }
}
