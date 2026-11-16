# Kota1 admin guide

How to manage the website yourself. You never need to edit code. Button names are shown in **bold Bulgarian**, exactly as they appear on screen.

Open the admin at **`https://<your-domain>/admin`** on a phone or computer. On a phone, the sections are in the bar at the bottom of the screen. On a computer, they are on the left.

| Section | What it is for |
|---|---|
| **Табло** (Dashboard) | Quick overview: is an event live, is today's lunch menu uploaded, is the regular menu published. |
| **Събития** (Events) | The "Събитие / Event" banner on the home page. |
| **Обедно меню** (Daily Menu) | The lunch menu customers open with the "Обедно меню / Daily Special" button. |
| **Основно меню** (Regular Menu) | The permanent menu with dishes and prices. |
| **Настройки** (Settings) | Phone, address, opening hours, your password, two-step login, logging out. |

Every change shows on the website **immediately after you save or publish**. Nothing needs to be redeployed.

---

## 1. Logging in and out
1. Enter your username and password.
2. If you turned on two-step login, enter the 6-digit code from your authenticator app.
3. After 5 wrong attempts, login is blocked for 15 minutes. This protects your account.
4. To log out, use **Изход** in the top bar.

If you are logged out while editing (for example after 12 hours of inactivity), a login window appears over the page. Log in again and your unsaved work is still there.

## 2. Events (Събития)
**Create an event:** **Събития → Ново събитие**
- **Заглавие** (title) is required. **Описание** (description) is optional. New lines are kept.
- **Снимка** (image) is optional: JPG, PNG or WebP, up to 5 MB. Landscape photos look best.
- **Дата на събитието** is when the event happens. Customers see it on the banner.
- **Показвай от** is when the banner starts showing. Leave it empty to show it right away.
- **Скрий след** is when the banner disappears automatically. Leave it empty to keep it until you turn it off.
- **Включено** is the ON/OFF switch. When it is off, the event is never shown.
- The preview at the bottom shows exactly what customers will see. Tap **Запази** to save.

All times are Bulgarian time.

**Turn an event on or off:** use the switch next to it in the list. It takes effect immediately.

**Status badges:**
- **Активно**: live on the site now.
- **Предстоящо**: switched on, but its "Показвай от" time has not come yet.
- **Изключено**: switched off.
- **Изтекло**: its "Скрий след" time has passed. It stays in the list for your records, but customers no longer see it.

**Edit:** tap **Редактирай**, change anything, then **Запази**. **Delete:** **Изтрий**. You are asked to confirm, and deleting cannot be undone.

## 3. Daily lunch menu (Обедно меню)
Upload in four steps: **Избери файл → Избери дата → Преглед → Публикувай**
1. **Избери файл:** choose a photo (JPG, PNG, WebP) or a PDF of the menu, up to 10 MB.
2. **Избери дата:** tap **Днес** (today) or **Утре** (tomorrow), or pick any date.
3. **Преглед:** check that it is the right file and readable.
4. **Публикувай:** publish it. A progress bar shows the upload. You can also save it without publishing and publish it later.

**How customers see it:**
- They only ever see the published menu **for today's date**, in Bulgarian time.
- You can upload tomorrow's menu the evening before. It appears automatically after midnight, not earlier.
- Yesterday's menu is never shown as today's. If nothing is uploaded for today, customers see "no menu today".

**Replace a menu:** upload a new file for the same date. You are asked to confirm **Замени** (replace), and the old file is removed.

**List:** shows all menus, grouped into **Предстоящи** (upcoming) and **Минали** (past). The one customers see today is marked **На живо днес**. From the list you can publish or hide a menu, replace its file, or **Изтрий** it (asks for confirmation).

## 4. Regular menu (Основно меню)
At the top, choose **what customers see**:
- **Структурирано меню**: the menu you build with categories and dishes (recommended: it is easy to read on phones).
- **Файл**: an uploaded PDF or photo of the whole menu.

Only one of them is public at a time. You can only switch to an option that has something published.

### Editing dishes and prices
- **Добави категория** adds a category (e.g. "Салати"). Rename it in its name field. Move it with the up/down arrows. **Изтрий категорията** asks for confirmation.
- **Добави ястие** adds a dish: name, description, price (type it like `12,50`) and an available switch. A dish switched to unavailable stays on the menu, greyed out with "Няма в наличност". Leave the price empty or 0 to show no price.

Your changes are a **draft (чернова)**. Customers keep seeing the old menu until you publish.
- **Запази чернова** saves your work without publishing.
- **Преглед** shows how customers will see it.
- **Публикувай** makes it live.
- **Откажи промените** throws away unsaved and unpublished changes and goes back to the published version.

If you try to leave with unsaved changes, you are warned.

### Uploading a whole-menu file
Use the **Файл** tab. Upload a PDF or photo (up to 15 MB), preview it, then publish it. Only one file can be live at a time. The live file cannot be deleted or hidden while "Файл" is the selected mode. Switch to the structured menu first, or publish a newer file.

## 5. Settings (Настройки)
- **Site information:**
  - Reservation phone, shown in the top bar and the contact section.
  - Address and opening hours.
  - Currency symbol (default €).
  - Leave a field empty to hide it on the site.
- **Change password:** at least 12 characters. Changing it logs out your other devices.
- **Two-step login (recommended):**
  1. Tap set up.
  2. Type the shown key into an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…).
  3. Confirm with the 6-digit code.
  4. To turn it off, you need your password and a code.

## 6. If something goes wrong
- **Forgot your password, or lost the phone with the authenticator app:** the person who runs the server can reset it. See `docs/DEPLOYMENT.md` §6:
  - `npm run admin:reset-password`
  - `npm run admin:disable-2fa`
- **An upload is rejected:** only PDF, JPG, PNG and WebP are accepted, within the size limits above. A file renamed to `.pdf` that is not really a PDF is refused.
- **The site shows old content:** refresh the page. The server never caches menus or events.
