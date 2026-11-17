# Design specification

Owned by the UI/UX Designer. Version 2 (T-1): public CMS features + admin dashboard. Fits `docs/ARCHITECTURE.md` exactly (API shapes, publication rules, CSP).

## 0. Ground rules
- **CSP: no inline `<script>`, no `on*=` attributes, no `style=""`.** Everything below is class-based. Dynamic values (progress %, image sizes) use `<progress>` / `<meter>` / `value` attributes or a small set of utility classes (`.w-0 … .w-100` in steps of 5 is acceptable; or `<progress value max>` which needs no CSS). Use `<progress>` for upload bars.
- Inline `<svg>` is allowed (icons). Icons: 24x24, stroke `currentColor` 2px, round caps, hand-drawn by the frontend developer (home, calendar, utensils, book-open, settings, log-out, plus, arrow-up, arrow-down, trash, pencil, eye, upload, file-pdf, x, check, alert). No icon CDN, no emoji.
- All text content from the API is plain text rendered with `textContent`. Where line breaks must be kept use CSS `white-space: pre-line` (never `innerHTML`).
- Language: public pages `<html lang="bg">`, English fragments wrapped `<span lang="en">`. Admin `lang="bg"`, Bulgarian only.
- Time zone: all API date-times are already Sofia local strings (`YYYY-MM-DDTHH:mm`) or `YYYY-MM-DD`. The browser never converts zones. Use the server's `today` (from `/api/public/daily-menu` or `/api/admin/daily-menus`), never the device clock, for "today".
- Fonts: Oswald 400/500/700 (display), Source Sans 3 400/600/700 (body; replaces Source Sans 3, which has no Cyrillic on Google Fonts — D-22) from Google Fonts with Cyrillic. Google Fonts URL: `family=Oswald:wght@400;500;700&family=Source+Sans+3:wght@400;600;700&display=swap` (Oswald and Source Sans 3 both ship Cyrillic subsets). Fallback stacks: `"Oswald","Arial Narrow",sans-serif`, `"Source Sans 3",system-ui,sans-serif`.

## 1. Brand (unchanged)
Backlit **KOTA 1** sign: condensed bold capitals, thick underline under "KOTA", taller "1", warm cream glow on a dark wall. Public site stays dark/warm. Hero, logo, top bar, About and footer are not redesigned (only the changes listed in section 3).

## 2. Tokens

### 2.1 Public tokens (go in `public/css/tokens.css` `:root`, loaded by public pages AND admin, so the admin preview can reuse the public components)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#121110` | page background |
| `--bg-2` | `#1b1917` | cards, event card, menu file frame |
| `--bg-3` | `#262119` | image backdrops, skeleton base, pressed chips |
| `--text` | `#f1e6d2` | body text |
| `--glow` | `#f3d9a4` | logo, headings, prices, dates |
| `--accent` | `#d9a54a` | top bar, buttons, borders of feature cards, category headings |
| `--muted` | `#a39887` | secondary text |
| `--line` | `#3a342d` | dividers (decorative) |
| `--dim` | `#8c8173` | unavailable dishes |
| `--err` | `#ff9b8f` | public error text |
| `--paper` | `#f1e6d2` | daily-menu "paper" panel |
| `--paper-ink` | `#1a1408` | text on paper and on accent/glow buttons |
| `--paper-muted` | `#5a4f3f` | secondary text on paper |
| `--paper-link` | `#7a4b00` | links on paper |
| `--max` | `960px` | content width |

Spacing scale (both areas): `--s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px`.
Radii: public `2px` (matches existing buttons) and `4px` for cards; admin see 2.2.
Z-index: sticky chips 10 · header 20 · admin tabbar/sidebar 30 · dialog 50 · toast 60.
Motion: transitions 150 ms; skeleton shimmer 1.2 s; everything wrapped so `@media (prefers-reduced-motion: reduce)` disables animation (shimmer becomes a static tone).

### 2.2 Admin tokens (prefix `--a-`, in `public/admin/admin.css`)
Theme decision: **light content area with a dark brand sidebar / top bar.** Reasons: the owner uses the phone in bright kitchens/daylight where light UIs with dark text stay legible; forms, tables and status colours (green/amber/red) are far easier to make accessible on white; the dark brand chrome with the glowing logo keeps the KOTA 1 identity and tells the owner "this is the control room, not the public site".

| Token | Value | Use |
|---|---|---|
| `--a-bg` | `#f6f2ea` | page background |
| `--a-surface` | `#ffffff` | cards, inputs, dialogs |
| `--a-text` | `#1f1a14` | text |
| `--a-muted` | `#5c5347` | helper text, secondary |
| `--a-line` | `#d8cfc0` | card borders/dividers (decorative only) |
| `--a-border` | `#8a7f6f` | input, switch-off, progress borders (UI component, needs 3:1) |
| `--a-primary` | `#8a5300` | primary button, links, selected borders |
| `--a-primary-hover` | `#6e4200` | primary hover/pressed |
| `--a-primary-tint` | `#fbf3e4` | selected card background |
| `--a-danger` | `#b3261e` | danger button, error text |
| `--a-danger-hover` | `#8f1d17` | danger hover |
| `--a-danger-tint` | `#fdecea` | error panel |
| `--a-ok` | `#1b6e3a` | success, "on" switch, live |
| `--a-ok-tint` | `#e3f4e8` | success badge/panel bg |
| `--a-warn-ink` | `#5c4400` | warning text |
| `--a-warn-tint` | `#fff1c2` | warning bg |
| `--a-warn-line` | `#b58100` | warning border (decorative) |
| `--a-info-ink` | `#1d4f7a` | "Предстоящо" badge text |
| `--a-info-tint` | `#e4f0fa` | info bg |
| `--a-neutral-ink` | `#4a4238` | grey badge text |
| `--a-neutral-tint` | `#e9e3d8` | grey badge bg, progress track |
| `--a-focus` | `#0b5fff` | focus ring on light surfaces |
| `--a-chrome` | `#121110` | sidebar / top bar / tab bar |
| `--a-chrome-text` | `#f1e6d2` | text on chrome |
| `--a-chrome-muted` | `#cfc5b3` | inactive nav on chrome |
| `--a-toast-ok` | `#14532d` | success toast bg (white text) |
| `--a-toast-err` | `#8f1d17` | error toast bg (white text) |

Admin radii: cards/dialogs `12px`, buttons/inputs `8px`, badges `999px`. Card shadow `0 1px 2px rgba(31,26,20,.10)`; dialog `0 12px 40px rgba(0,0,0,.35)`.
Admin type: body Source Sans 3 400 16px/1.5 (inputs are **16px minimum** to stop iOS zoom); labels Source Sans 3 700 15px; helper text 14px; badges Source Sans 3 700 14px; h1 Oswald 500 uppercase `.06em` 1.5rem (mobile) / 1.875rem (>=768); h2 Oswald 500 uppercase 1.125rem; card titles Source Sans 3 700 18px; tab-bar labels Source Sans 3 700 12px.

## 3. Breakpoints
Mobile < 600px · Tablet 600-1023px · Desktop >= 1024px (mobile-first `min-width` queries). Content max width 960px (public), 880px (admin content column). Verified widths: 390 / 768 / 1280. Nothing may scroll horizontally at 360px+. Allow browser zoom (never `user-scalable=no`).

Public specifics: two-column layouts begin at **768px**. Admin navigation switches from bottom tab bar to sidebar at **768px**.

## 4. Focus, targets, states (global)
- Public focus: `outline: 3px solid var(--glow); outline-offset: 3px` on every interactive element (`:focus-visible`). On the amber top bar and amber/glow buttons: `outline-color: var(--paper-ink)`.
- Admin focus: `outline: 3px solid var(--a-focus); outline-offset: 2px`. On chrome (dark) surfaces: `outline-color: var(--glow)`. Never remove outlines without a replacement.
- Tap targets >= 44x44px (buttons/inputs 48px high; icon-only buttons 48x48; text links in running text exempt but nav/list links get 44px height via padding). 8px minimum gap between adjacent targets.
- Hover (pointer only, wrap in `@media (hover:hover)`): public buttons fill goes `--glow`; admin primary -> `--a-primary-hover`. Pressed: `transform: translateY(1px)`. Disabled: admin `opacity .55`, `cursor:not-allowed`, text meaning must still read from the label (e.g. "Запазване…"); disabled text is exempt from contrast but never used for essential info alone.
- State is never by colour alone: badges carry text, switches carry "Вкл./Изкл." text, errors carry text + icon, current nav item carries bold + indicator bar + `aria-current`.
- Respect `prefers-reduced-motion`.

---

# PART A - PUBLIC SITE

## A1. Page structure (index)
Top bar -> header (logo + nav) -> hero -> **[Събитие section, only if events]** -> **Меню** -> За нас -> Контакти -> footer.
Skip link "Към съдържанието" as first focusable element on every public page (visually hidden until focused, then top-left, glow bg, `--paper-ink` text).

Bilingual display rule: **section headings, hero buttons, daily-menu page title/messages and empty/error messages show Bulgarian first with English second** (`<h2>Меню <span class="en" lang="en">/ Menu</span></h2>`; `.en` = Source Sans 3 400, `--muted`, 0.55em of heading size, letter-spacing normal, not uppercase). Navigation, dish tags and short field labels are Bulgarian only (English in the string table in section A9 for reference/future toggle).

## A2. Top bar and header (changes)
- **Top bar** (`.top-bar`, unchanged style): text "Резервации: <a href="tel:…">телефон</a>" from `reservationPhone`. **If phone empty, the whole bar is removed from the DOM.** `href` = phone with spaces, brackets and dashes stripped. Show the number as stored.
- **Header** `.site-header`: logo left; nav right on >= 768px.
- **Nav items (in order):** Меню (`/#menu`) · Обедно меню (`/daily-menu`) · Събитие (`/#event`, **only when events exist**; on daily-menu page it is omitted because the DOM section is not there — or links to `/#event` only if the page knows events exist; simplest: omitted there) · За нас (`/#about`) · Контакти (`/#contact`). On `/daily-menu` all in-page anchors are `/#…` and the "Обедно меню" item has `aria-current="page"`.
- Nav item style: Oswald 400, uppercase, `.1em`, 0.9rem, `--text`; hover `--glow`; current: `--glow` + 2px `--accent` underline offset 6px. Item hit area min height 44px.
- **Desktop/tablet >= 768px:** inline nav as today (gap 1.25rem). "Обедно меню" item gets a pill treatment: 1px `--accent` border, padding 0 14px, radius 2px, so it reads as the special.
- **Mobile < 768px (390 must work):** header row = logo (left) · "Обедно меню" compact pill button (`.btn-special-sm`, 44px high, glow bg, `--paper-ink` text, Oswald 500 0.85rem uppercase) · hamburger button (48x48, 3-line icon, `aria-expanded`, `aria-controls="site-nav"`, `aria-label="Навигация"`). The daily-menu button is therefore **always visible without opening the menu**. Tapping the hamburger toggles `.nav-open`: a full-width panel under the header, bg `--bg-2`, 1px top border `--line`, items stacked, each 52px high, left padding 16px, 1px `--line` separators, font 1rem. Esc / link tap / outside tap closes; focus returns to the hamburger. Panel max one screen; no animation beyond 150 ms fade.
  - Width check at 390px: logo ~110px + pill ~118px + burger 48px + gaps 16*2 + padding 16*2 = ~340px. If the pill would overflow at 360px, hide its text "Обедно меню" to "Обедно" is **not** allowed — instead reduce logo to 1.3rem (existing rule) and pill font to 0.8rem.

## A3. Hero (changes)
Existing hero unchanged (sign, "Restaurant" tagline, lead). Buttons area becomes `.hero-actions` (flex, wrap, centered, gap 12px; stacked full-width max 320px on < 600px):
1. **Обедно меню** (`.btn.btn-special`) — the prominent one, first. Filled `--glow`, text `--paper-ink`, 2px `--accent` border, glow shadow `0 0 24px rgba(243,217,164,.35)`, min-height 56px, padding 0 32px, Oswald 500 1.1rem uppercase `.1em`. Under the Bulgarian label a second line `<span class="en" lang="en">Daily Special</span>` (Source Sans 3 700 0.75rem, `--paper-ink`, letter-spacing .06em, uppercase). Hover: bg `#ffffff`-ish is NOT used; hover = `--accent` bg, same ink (contrast 8.22). Links to `/daily-menu`. Always visible (static link — the daily-menu page handles "no menu today").
2. **Резервирай маса** (`.btn`, existing amber fill; text changed from "Book a table"), links `#contact`. Secondary: min-height 56px to align.
No JS needed for hero.

## A4. Event section `#event` ("Събитие / Event")
- **Placement:** directly below the hero, above Меню. Rationale: hero identity stays first; the event is the first thing seen on scroll and the nav has an anchor. Absent from DOM when `events` is empty or the request fails (fail silently; no empty space, no placeholder, no skeleton).
- Section heading (h2): "Събитие / Event" for exactly one event; "Събития / Events" for 2+. Section bg `--bg`, with 1px `--line` top border; padding 48px 16px (mobile 32px 16px). Subtle warm backdrop: `radial-gradient(ellipse at top, #2a2014 0%, var(--bg) 70%)`.
- **Multiple simultaneous events:** stacked vertically as separate cards in API order (`eventAt`, then `startsAt`), gap 24px, **all shown** (no carousel — fewer interactions, nothing hidden). On >= 768px with 2+ events and no images, cards stay one per row; each card is its own two-column layout (image | text). No cap; the owner controls how many are on.
- **Event card** `.event-card`: bg `--bg-2`, 1px solid `--accent`, radius 4px, top accent bar 4px (`border-top: 4px solid var(--glow)`), glow `box-shadow: 0 0 32px rgba(217,165,74,.12)`, overflow hidden.
  - Corner label `.event-tag`: text "Събитие" (Oswald 500 0.8rem, uppercase `.12em`), bg `--accent`, color `--paper-ink`, padding 4px 10px, sits above the title inside text column (not floating over the image).
  - **Layout mobile (<768):** image on top (full width, `max-height: 360px`, `object-fit: contain`, bg `--bg-3`, so poster text is never cropped), then text block padding 20px 16px.
  - **Layout >= 768:** CSS grid `5fr 7fr`; image left column (`object-fit: contain`, bg `--bg-3`, min-height 280px, `max-height: 520px`), text right padding 32px. **No image:** single column, text only, padding 32px, title can span wider; no empty image slot.
  - **Image:** `<img alt="{event title}" loading="lazy">`, wrapped in `<button class="zoom-btn">` that opens the shared lightbox (A5.3) so posters can be read at full size. Button min target is the whole image; `aria-label="Увеличи снимката: {title}"`.
  - **Title** h3: Oswald 700 uppercase `.04em`, `--glow`, clamp(1.5rem, 5vw, 2.25rem), line-height 1.15, margin 8px 0 12px. `overflow-wrap:anywhere`.
  - **Date line** (only if `eventAt`): Oswald 500 1.1rem, `--accent`, `.03em`, margin-bottom 16px. Format built manually from the string (no timezone maths): `{weekday}, {d} {month} {yyyy}, {HH}:{mm}` -> **"петък, 20 ноември 2026, 20:00"**. Weekday and month lowercase Bulgarian names (see A9 arrays); no "г." suffix; day without leading zero; hour/minute zero-padded 24h. Wrapped in `<time datetime="2026-11-20T20:00">`.
  - **Description** (only if non-empty): `white-space: pre-line`, `--text`, 1.05rem/1.7, max-width 62ch; long words wrap.
- Loading: none. Error: none (section absent).

## A5. Daily menu page `/daily-menu` (`public/daily-menu.html`)
Header, top bar, footer identical to index (nav anchors are `/#…`). No hero; below header a **page band** `.page-band`: same radial background as hero, padding 48px 16px 32px (mobile 32px 16px 24px), centered.

### A5.1 Content (inside `.section`, max 960px)
1. Eyebrow (Oswald 500, `.3em`, uppercase, `--muted`, 0.85rem): "Обедно меню" + `<span class="en">/ Daily Special</span>` — this is the page **h1**.
2. **Date** (when a menu exists, or always when `today` is known): the Bulgarian long date from `today` (or `menu.date`): "Понеделник, 16 ноември 2026" — Oswald 700, `--glow`, clamp(1.75rem, 7vw, 3rem), first letter uppercase, line-height 1.15, glow text-shadow like `.logo`. Directly under it a small "Само за днес" tag (`.event-tag` style). When no menu: date still shown (today) with the empty message below.
3. **Menu viewer** in `.paper` panel: bg `--paper`, ink `--paper-ink`, radius 4px, padding 12px (mobile 8px), `box-shadow: 0 0 40px rgba(243,217,164,.18)`. Visually distinct from the regular menu (which sits on the dark background) so customers never confuse the two.
4. Action row under the panel (`.viewer-actions`, flex wrap, gap 12px, centered): see below.

### A5.2 States
- **Loading:** inside the panel a skeleton (`.skeleton` block 100% x 420px, bg `--bg-3`... on paper use `#e4d6bb` base shimmer to `#f1e6d2`) plus text "Зареждане на менюто…" (`role="status"`). Date line shows a 60% wide skeleton bar until loaded.
- **Error** (network/5xx): replaces the panel with `.state-box` (bg `--bg-2`, 1px `--line`, radius 4px, padding 32px, centered): title "Менюто не може да се зареди." / English "The menu could not be loaded." (`--err`? no — `--text`, with a small alert icon in `--err`), body "Проверете връзката и опитайте отново.", button "Опитай отново" (`.btn`). `role="alert"`.
- **No menu today** (`menu: null`): `.state-box` with title "Няма обедно меню за днес." / "No daily menu for today.", body "Заглеждайте пак по-късно или вижте основното ни меню." + two buttons: "Към основното меню" (`.btn`, `/#menu`) and "Обади се" (`tel:` link, only if phone set). `role="status"`. Page title is still "Обедно меню".
- **Image menu** (`kind: "image"`): `<img alt="Обедно меню за {date}">` full width of the panel (`width:100%; height:auto; display:block`), natural aspect, no cropping. The image is wrapped in `<button class="zoom-btn">` (`aria-label="Увеличи менюто"`) with a 44px "увеличи" chip (`.zoom-hint`, bottom-right, bg `--paper-ink`, text `--glow`, contrast 13.7:1, text "Докосни за увеличение") shown on < 1024px and on hover for desktop. Actions row: "Отвори в нов раздел" (`<a target=_blank rel=noopener>`) and "Изтегли" (`<a download>`), both `.btn-ghost-dark`.
- **Lightbox** (`<dialog class="lightbox">`, shared with event images and file-mode menu): full-viewport, bg `rgba(18,17,16,.96)`; image initially fit-to-width (`max-width:100%`), area `overflow:auto` with `touch-action: pan-x pan-y pinch-zoom` so pinch zoom + panning work natively; "Увеличи / Намали" toggle button (48px) switches the image between fit width and 250% width (scrollable); close button "Затвори" top-right 48x48 (X icon + `aria-label`), Esc and backdrop-tap close; focus trapped by `<dialog>` modal; focus returns to the trigger. Buttons on dark: bg `--bg-2`, text `--text`, 1px `--accent` border.
- **PDF menu** (`kind: "pdf"`):
  - Primary actions always rendered first, above the viewer on mobile and below on desktop: **"Отвори PDF"** (`.btn`, `target=_blank rel=noopener`, label with English sub-line "Open PDF") and **"Изтегли PDF"** (`.btn-ghost-dark`, `download`). Min height 52px, full width on < 600px, stacked.
  - Embedded viewer (`<object type="application/pdf" data=…>` with the fallback content below, height `min(80vh, 900px)`, min 480px, width 100%) is rendered **only when `navigator.pdfViewerEnabled === true` AND viewport >= 768px**. In all other cases (mobile browsers, iOS Safari, Android, no PDF plugin) **no embed is attempted**; instead show a `.pdf-card` inside the paper panel: large PDF icon (64px, `--paper-ink`), "Менюто е във формат PDF." and "Натиснете „Отвори PDF“, за да го прочетете на целия екран." (`--paper-muted`). The buttons above are the way in.
  - If `<object>` fails to load, its fallback content is the same `.pdf-card`.
- Dates other than today are never shown (API only returns today's menu). If `today` in the response differs from the client's idea, trust the API.

## A6. Regular menu section `#menu` ("Меню / Menu") on index
Data: `GET /api/public/menu`. The section is always present (nav link must work); content depends on state. Visually: **dark, typographic list on the page background** (no paper, no glow card) — distinct from the cream daily-menu panel.

- **Loading:** three skeleton category blocks (heading bar 30% wide + 4 rows of two bars) `role="status"` + visually-hidden "Зареждане на менюто…". 
- **Error:** `.state-box` (same as A5.2 error, text "Менюто не може да се зареди." / "The menu could not be loaded." + "Опитай отново").
- **Empty** (mode structured with zero categories / `structured: null`, or mode file with `file: null`): `.state-box` "Менюто скоро ще бъде публикувано." / "Menu coming soon." + "Вижте обедното меню" button linking `/daily-menu`.
- **Structured mode:**
  - **Category jump-nav** (`.cat-nav`, only when >= 2 categories): `<nav aria-label="Категории">` horizontal chip row. Mobile: `position: sticky; top: 0; z-index:10; background: var(--bg); border-bottom: 1px solid var(--line); overflow-x:auto; white-space:nowrap; scroll-snap-type:x proximity; padding: 8px 16px`, chips 44px high, `-webkit-overflow-scrolling: touch`, scrollbar hidden but scrollable; sticks under the viewport top (header is not sticky, so it does not stack). Desktop >= 768: not sticky, wraps, centered, gap 8px. Chip: Oswald 400 0.9rem uppercase `.08em`, padding 0 16px, 1px `--line` border, radius 999px, `--text`; hover border `--accent`; **current category** (updated by IntersectionObserver, optional) `aria-current="true"`, bg `--accent`, text `--paper-ink`. Tapping scrolls to `#cat-{id}` with `scroll-margin-top: 64px`.
  - **Category** `<section id="cat-{id}">`: h3 Oswald 500 uppercase `.1em`, `--accent`, 1.4rem, padding-bottom 8px, border-bottom 2px `--accent` width 100%... (thin: 1px `--line` plus 48px wide 3px `--accent` stub, echoing the KOTA underline). Items list `<ul class="dish-list">`.
  - **Layout:** one column on < 768; from 768 the categories flow in **two CSS columns** (`columns: 2; column-gap: 48px`), **each category block is unbreakable** (`break-inside: avoid` on `.cat`, so a category never splits across columns — D-23), `break-inside: avoid` on each dish, `break-after: avoid` on category headings.
  - **Dish row** `<li class="dish">`: top line is flex: name (Source Sans 3 700 1.05rem `--text`) · dotted leader (`flex:1; border-bottom: 1px dotted var(--line); margin: 0 8px 6px`) · price (Oswald 500 1.05rem `--glow`, `white-space: nowrap`, tabular numbers). Description below: `--muted`, 0.95rem, line-height 1.5, `white-space: pre-line`, max-width 52ch. Row padding 12px 0.
  - **Price:** `priceCents` -> "12,50 €" (integer part, comma, two digits, NBSP, `currencySymbol`; thousands separated by NBSP: "1 250,00 €"). `priceCents === 0` -> **no price shown** (admin helper explains "0 = без цена").
  - **Unavailable dishes: shown, greyed, not hidden** (customers know it exists; hiding would make the owner's toggle invisible). Row: name/description/price in `--dim` (`#8c8173`, 4.59:1), name with `text-decoration: line-through`? no — keep readable, **no strikethrough**; add a tag `.tag-unavail` after the name: "Няма в наличност" (Source Sans 3 700 0.75rem, uppercase, border 1px `--dim`, padding 2px 8px, radius 2px, `--dim`). Price is kept greyed. `aria-label` on `<li>` not needed (the tag is text).
- **File mode:** same `.viewer` component as A5 but on the dark page: frame `.menu-file` (bg `--bg-2`, 1px `--line`, radius 4px, padding 12px). Image: zoom button + lightbox + "Отвори в нов раздел"/"Изтегли" (dark ghost buttons: 1px `--accent` border, `--accent` text 7.87:1 on `--bg-2`). PDF: same rules as A5 (embed only if supported and >= 768; otherwise `.pdf-card` + buttons "Отвори меню (PDF)" / "Изтегли"). Under the frame, small muted line "Обновено: {publishedAt date}" optional (skip if format unknown).
- Disclaimer none.

## A7. Contact section `#contact`
Data: `/api/public/site`. Layout: definition-list style, 1 column mobile, three columns >= 768 (Телефон · Адрес · Работно време), each as `<div class="contact-item">` with a small Oswald uppercase label (`--muted`) and value (`--text` 1.1rem). **A piece with an empty value is omitted entirely** (label too). If all three are empty the section body shows nothing but the heading is also removed and the "Контакти" nav item is hidden. Phone value is a `tel:` link (min height 44px, `--accent`, underline). Address plain text. Opening hours `white-space: pre-line`. Keep the "Резервирай маса" action here too: a `.btn` linking `tel:` only when phone set.
Top bar and contact are the only places phone appears.

## A8. Reused public components (CSS file `public/css/components.css`, class-only)
`.btn`, `.btn-special`, `.btn-special-sm`, `.btn-ghost-dark` (transparent, 1px `--accent`, text `--accent`, min-height 48px, on paper: border/text `--paper-ink`), `.state-box`, `.skeleton`, `.event-card`, `.event-tag`, `.cat-nav`, `.dish-list`, `.viewer`, `.pdf-card`, `.lightbox`, `.paper`, `.visually-hidden`, `.skip-link`. These are loaded by the admin preview too (inside `.preview-frame`, see B-Events).

## A9. Public strings (BG / EN)
| Where | Bulgarian (shown) | English |
|---|---|---|
| Skip link | Към съдържанието | Skip to content |
| Top bar | Резервации: | For reservation: |
| Nav | Меню · Обедно меню · Събитие · За нас · Контакти | Menu · Daily Special · Event · About · Contact |
| Hamburger aria | Навигация | Navigation |
| Hero btn 1 | Обедно меню | Daily Special |
| Hero btn 2 | Резервирай маса | Book a table |
| Event heading | Събитие / Събития | Event / Events |
| Event tag | Събитие | Event |
| Zoom aria | Увеличи снимката | Enlarge image |
| Lightbox | Затвори · Увеличи · Намали | Close · Zoom in · Zoom out |
| Daily h1 | Обедно меню | Daily Special |
| Daily tag | Само за днес | Today only |
| Daily label for menu | Меню за днес | Today's menu |
| Zoom hint | Докосни за увеличение | Tap to enlarge |
| Daily loading | Зареждане на менюто… | Loading the menu… |
| Daily error | Менюто не може да се зареди. | The menu could not be loaded. |
| Retry | Опитай отново | Try again |
| Daily empty | Няма обедно меню за днес. | No daily menu for today. |
| Daily empty body | Заглеждайте пак по-късно или вижте основното ни меню. | Check back later or see our regular menu. |
| To menu / call | Към основното меню · Обади се | To the regular menu · Call us |
| PDF | Отвори PDF · Изтегли PDF · Отвори в нов раздел · Изтегли | Open PDF · Download PDF · Open in new tab · Download |
| PDF card | Менюто е във формат PDF. | The menu is a PDF file. |
| PDF card body | Натиснете „Отвори PDF“, за да го прочетете на целия екран. | Tap "Open PDF" to read it full screen. |
| Menu heading | Меню | Menu |
| Menu categories aria | Категории | Categories |
| Unavailable | Няма в наличност | Unavailable |
| Menu empty | Менюто скоро ще бъде публикувано. | Menu coming soon. |
| See daily | Вижте обедното меню | See the daily menu |
| Menu error | Менюто не може да се зареди. | The menu could not be loaded. |
| Contact | Контакти · Телефон · Адрес · Работно време | Contact · Phone · Address · Opening hours |
| About | За нас | About |
| Footer | © {година} Kota1 Restaurant | same |

Bulgarian date arrays (used by all date formatting, no `Intl` dependency): weekdays (Sun first) `неделя, понеделник, вторник, сряда, четвъртък, петък, събота`; months `януари, февруари, март, април, май, юни, юли, август, септември, октомври, ноември, декември`. Weekday for a `YYYY-MM-DD` string: `new Date(Date.UTC(y, m-1, d)).getUTCDay()`.

---

# PART B - ADMIN DASHBOARD (`/admin`)

## B1. App shell
Single-page app. Hash routes: `#/` dashboard, `#/events`, `#/events/new`, `#/events/{id}`, `#/daily-menu`, `#/menu`, `#/settings`. On route change: set `document.title` ("Табло — Kota1 админ"), move focus to the page `<h1>` (`tabindex="-1"`), scroll to top.

- **Mobile < 768:**
  - **Top app bar** (`--a-chrome`, 56px, sticky): logo (glow, 1.3rem) left; right: button "Изход" (text + log-out icon, 48px high, `--a-chrome-text`, 1px `rgba(241,230,210,.4)` border). Title of page is the h1 in content, not in the bar.
  - **Bottom tab bar** (`--a-chrome`, fixed bottom, height 64px + `env(safe-area-inset-bottom)`, 5 equal tabs at 390px = 78px each): Табло · Събития · Обедно меню · Основно меню · Настройки. Each tab: icon 24px above label 12px/700 (two-line wrap allowed, line-height 1.1). Inactive `--a-chrome-muted`; **active**: `--glow` text + 3px `--accent` bar on top edge of the tab + label bold (`aria-current="page"`). Whole tab is the target (>= 78x64). Content gets `padding-bottom: 88px` so nothing hides under the bar.
  - Rationale (tab bar vs hamburger): five primary destinations, one-thumb reach, always visible, no hidden menu for a non-technical user.
- **Tablet/Desktop >= 768:** left **sidebar** (`--a-chrome`, fixed, width 220px at 768-1023, 264px >= 1024): logo block at top (padding 24px), nav list (each item 52px high, icon + label 16px/700, padding 0 20px, radius 8px, margin 0 12px 4px; hover bg `rgba(241,230,210,.08)`; active bg `--glow` text `--a-chrome` weight 700, `aria-current`), "Изход" pinned to the bottom (same item style, plus top border). Main column margin-left = sidebar width, padding 32px (768-1023: 24px), content max-width 880px, left-aligned.
- Content cards: `--a-surface`, 1px `--a-line`, radius 12px, padding 20px (mobile 16px), margin-bottom 16px.
- Page header row (`.page-head`): h1 left, primary action right (mobile: action drops below h1, full width).

## B2. Global patterns

### B2.1 Buttons (all `min-height: 48px`, padding 0 20px, radius 8px, Source Sans 3 700 16px, icon+label gap 8px)
| Variant | Default | Hover | Disabled / busy |
|---|---|---|---|
| `.a-btn--primary` | bg `--a-primary`, text #fff (6.33:1) | `--a-primary-hover` | opacity .55; busy: label replaced by "Запазване…" + 20px spinner, `aria-busy="true"`, `disabled` |
| `.a-btn--secondary` | bg #fff, 2px `--a-border` border (3.93:1), text `--a-text` | bg `--a-primary-tint`, border `--a-primary` | same |
| `.a-btn--danger` | bg `--a-danger`, text #fff (6.54:1) | `--a-danger-hover` | same |
| `.a-btn--ghost` | transparent, text `--a-primary` (6.33:1 on white) | underline + tint bg | same |
| `.a-btn--ghost-danger` | transparent, text `--a-danger` | tint `--a-danger-tint` | same |
| `.a-btn--icon` | 48x48, secondary look, icon only, **must** have `aria-label` | | |
Mobile: form-action buttons are full width and stacked (primary first); >= 600 they sit inline, right-aligned.

### B2.2 Form fields
Label above (Source Sans 3 700 15px), required fields marked with " *" and the legend "* задължително" at top of form. Input/textarea/select: height 48px (textarea min 120px), padding 12px 14px, 16px font, bg #fff, 2px solid `--a-border`, radius 8px, text `--a-text`, placeholder `#6b6154` (6.06:1). Focus: outline per section 4 + border `--a-focus`. Helper text below, 14px `--a-muted`, linked with `aria-describedby`. Character counter right-aligned 14px `--a-muted` ("37/120"), turns `--a-danger` + bold at limit. 
**Error state:** border 2px `--a-danger`, message under field: alert icon + text 14px bold `--a-danger` (5.85:1 on page, 6.54 on white), `aria-invalid="true"`, `aria-describedby` points at error. On failed submit an error summary (`.a-alert--error`, `role="alert"`, tabindex -1, focused) at the top of the form: "Моля, поправете {n} полета:" with a list of links to each field. Server `fields` map to inline errors; the top-level `message` shows in the summary if no fields.
Validation timing: on blur and on submit, never while the user is still typing the first time.
Switch (`.a-switch`, `<button role="switch" aria-checked>`): track 56x32, knob 24px; ON track `--a-ok` (6.29:1 vs white), knob white, label **"Вкл."**; OFF track `#6f6659` (5.64:1), knob white, label **"Изкл."**. Label text sits right of the track (or left, consistent), 16px bold. Whole control (track + text) is the target, min 48px high; the accessible name is the thing it controls ("Показвай събитието"), state announced via `aria-checked`. While saving: track shows spinner, disabled.
Segmented control (`.a-seg`): joined buttons 48px, 2px `--a-border`, selected bg `--a-text` text #fff (17.27:1), `aria-pressed` or radio group semantics.
Date/time: native `<input type="date">` / `datetime-local` (48px; they give mobile pickers). Each optional datetime has an adjacent "Изчисти" ghost button (48px) because clearing is awkward on iOS.
Money input: text input `inputmode="decimal"`, accepts "12,5" / "12.50" / "12", right-aligned, with currency symbol (from settings) as a fixed suffix inside the field; converted to cents.

### B2.3 Badges (`.a-badge`, 28px high, padding 0 12px, 14px/700, radius 999px, text + 8px dot ahead of text)
| Badge | Text colour on bg | Ratio |
|---|---|---|
| Активно / Публикувано / На живо (soft) | `--a-ok` on `--a-ok-tint` | 5.50 |
| На живо днес (solid) | #fff on `--a-ok` | 6.29 |
| Предстоящо / Утре / Скоро | `--a-info-ink` on `--a-info-tint` | 7.40 |
| Изключено / Чернова / Минало | `--a-neutral-ink` on `--a-neutral-tint` | 7.73 |
| Изтекло / Непубликувано днес / Има промени | `--a-warn-ink` on `--a-warn-tint` (+1px `--a-warn-line` border) | 8.16 |
| Грешка | `--a-danger` on `--a-danger-tint` | 5.72 |
Each badge has a distinct dot/shape glyph in addition to text: Активно = filled circle, Предстоящо = clock, Изключено = hollow circle, Изтекло = alert triangle, Чернова = pencil.

### B2.4 Alerts / inline messages (`.a-alert`: padding 12px 16px, radius 8px, 1px border, icon + text, `role` as noted)
- success (`--a-ok-tint` bg, text `--a-ok` 5.50:1, border `--a-ok`), warning (`--a-warn-tint`, `--a-warn-ink` 8.16:1, border `--a-warn-line`), error (`--a-danger-tint`, `--a-danger` 5.72:1), info (`--a-info-tint`, `--a-info-ink` 7.40:1). Text 15px, bold lead sentence.

### B2.5 Toasts
Container `aria-live` regions: success toast `role="status"`, error toast `role="alert"`. Position: bottom-center, max-width 480px (mobile: left/right 12px, bottom = 64px + safe area + 12px so it clears the tab bar; >= 768 bottom 24px right 24px). Success: bg `--a-toast-ok` (#14532d), white text 9.11:1, auto-dismiss 5 s. Error: bg `--a-toast-err` (#8f1d17), white 8.91:1, **stays until closed** (close button 44x44 "Затвори"). One line of text + optional action ("Опитай отново"). Stack max 3. Pause the timer on hover/focus. Success feedback for saves is toast + the changed state on screen (never toast alone for destructive results). Messages: server `message` field (already Bulgarian) shown verbatim for errors.

### B2.6 Confirm dialog (`<dialog class="a-dialog">`, modal)
Width: mobile = bottom sheet (full width, radius 16px 16px 0 0, padding 24px 16px calc(16px + safe-area)); >= 600: centered, width 440px, radius 12px, padding 24px. Backdrop `rgba(18,17,16,.6)`. Structure: h2 title (Oswald 1.25rem), body text (16px, names in bold with „“ quotes), button row. **Initial focus on the safe button ("Отказ")**; Esc and backdrop tap = cancel; focus returns to the trigger. Buttons: mobile stacked, destructive first visually? **Order: "Отказ" (secondary) on top/left, destructive/confirm action second** (consistent on all devices, row on >= 600 right-aligned). Destructive confirm button uses specific verb ("Изтрий събитието"), `.a-btn--danger`; non-destructive confirm uses primary. While the action runs: confirm button busy, both disabled, dialog not dismissible. On error: dialog closes, error toast. Dialogs are never used for plain success.

### B2.7 Upload component (`.a-upload`)
- Idle: dashed 2px `--a-border` area (min-height 120px, padding 24px, centered) with upload icon, primary label button "Избери файл", helper line with allowed types and size. On >= 1024 the area also accepts drag-and-drop (extra, never required); on mobile `accept` includes `image/*` so the camera/gallery are offered.
- Client validation **before** upload: type (extension + MIME) -> "Този тип файл не се поддържа. Позволени: …"; size -> "Файлът е твърде голям ({size} MB). Максимум {limit} MB." Server errors 413 "Файлът е твърде голям.", 415 "Неподдържан файлов формат." shown the same way (inline error in the upload area).
- Selected: row with thumbnail/PDF tile 56px, name (truncate with ellipsis, full name in `title`), "{size} · {PDF|Снимка}", buttons "Смени" and "Премахни".
- **Uploading:** native `<progress>` (height 16px, radius 8px, track `--a-neutral-tint` with 1px `--a-border` border, fill `--a-primary` 4.96:1 vs track) + text "Качване… 63%" (`aria-live="polite"`, updated at most every 10%), button "Откажи качването" (aborts the XHR). Upload uses XMLHttpRequest for progress events. All other form buttons disabled meanwhile. After 100% but before server response show "Обработване…" (indeterminate).
- **Failed:** `.a-alert--error` with message and "Опитай отново" button; the chosen file stays selected.

### B2.8 Loading, empty, error
- Page loading: skeleton cards (`.a-skeleton`: bg `#e9e3d8` shimmering to `#f6f2ea`, radius 8px; 3 blocks 20px/16px tall) with `aria-busy="true"` on the region and a visually hidden "Зареждане…". Button actions: spinner inside button (see B2.1).
- Empty states: `.a-empty` centered in card, 32px padding, a title (bold), one sentence, one primary button. E.g. events: "Още няма събития." / "Създайте първото събитие, за да се покаже на сайта." / "Ново събитие".
- Load error: `.a-alert--error` card "Данните не могат да се заредят." + "Опитай отново". Network lost on save: toast "Няма връзка. Промените не са записани." and the form stays as is.

### B2.9 Session expired
Any `401` from an API call (except `/login`) opens the **login view as a full-screen overlay on top of the app** (the app DOM and any unsaved editor state stay intact underneath), with `.a-alert--warning`: "Сесията ви изтече. Влезте отново." After a successful login the overlay closes, toast "Влязохте отново. Повторете последното действие.", the failed action is **not** auto-retried. If the logged-in username differs, reload the app instead. Dashboard load 401 on first visit = plain login screen without the warning.

### B2.10 Unsaved-changes guard
Applies to Events form and Regular menu editor. `beforeunload` native prompt while dirty; in-app navigation (tab bar, back) opens a dialog "Имате незапазени промени" / "Ако напуснете, промените ще бъдат изгубени." with buttons "Остани" (focused), "Напусни без запазване" (danger), and for the menu editor also "Запази и продължи" (primary).

## B3. Login (`#/login` or overlay)
Full-screen `--a-chrome` background with the radial glow (as hero). Centered: the KOTA 1 sign (glow, clamp 3rem-4.5rem, with underline), small tagline "Админ панел". Card below: bg `--a-surface`, radius 12px, padding 24px, width min(100% - 32px, 400px).
- **Step 1:** fields "Потребителско име" (`autocomplete="username"`, `autocapitalize="none"`, `autocorrect="off"`), "Парола" (`autocomplete="current-password"`, with "Покажи" / "Скрий" text button 48px at the field's right, `aria-pressed`). Button "Вход" (primary, full width). Pressing Enter submits.
- **Step 2** (only after a `401 totp_required` response): card content swaps (no page change; username/password kept in memory only): title "Потвърждение със код", help "Въведете 6-цифрения код от приложението за удостоверяване.", one input "Код" (`inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength=6`, `pattern=[0-9]*`, 24px monospace, letter-spacing .3em, centered), buttons "Потвърди" (primary) and "Назад" (ghost). Focus goes to the code field. Auto-submit is not done.
- **Errors** (`.a-alert--error`, `role="alert"`, above the button; the password field is cleared and focused):
  - `invalid_credentials` (step 1): "Грешно потребителско име или парола."
  - any 401 in step 2: "Невалиден код. Опитайте с нов код."
  - `rate_limited` (429): "Твърде много опити. Опитайте отново след {M} мин." computed from `retryAfter` seconds (round up; <60 s -> "{S} сек."); form fields and button disabled until it elapses, then the message is replaced by "Можете да опитате отново." (announce only at start and end, not every second).
  - network/5xx: "Няма връзка със сървъра. Опитайте отново."
  - empty field submit: field-level "Въведете потребителско име." / "Въведете парола." / "Въведете 6-цифрен код."
- Footer note under card (`--a-chrome-muted`, 14px, 8.52:1+ on chrome): "Забравена парола? Свържете се с администратора на сайта." 
- Busy: "Вход…" + spinner.

## B4. Dashboard `#/` ("Табло")
Greeting line "Здравейте, {username}" (muted) under h1. Layout: quick actions, then cards in a grid: 1 column < 768; 2 columns >= 768 (gap 16px); cards stretch to equal height per row.
- **Quick actions** (`.a-quick`, directly under h1): 2x2 grid of large tiles (min-height 88px, icon 28px + bold label, `--a-surface`, 2px `--a-border`, radius 12px; hover border `--a-primary`): "Качи меню за днес" -> `#/daily-menu?step=1`, "Ново събитие" -> `#/events/new`, "Редактирай меню" -> `#/menu`, "Виж сайта" (opens `/` in new tab, with an "external" icon, `rel=noopener`). 4 columns >= 1024.
- **Card "Събитие":** h2 "Събитие"; if `events.active > 0`: badge "Активно", list of `activeTitles` (bold, max 3 then "+ още {n}"); else badge "Изключено"-style grey text "Няма активно събитие". Below, counts line (14px muted): "Предстоящи: {scheduled} · Изключени: {disabled} · Изтекли: {expired}" (omit zero parts; if all zero "Още няма събития."). Button "Управление на събития" (secondary) / "Ново събитие" if there are none.
- **Cards "Обедно меню — днес" and "Обедно меню — утре"** (two cards; date in long Bulgarian under the title, from `today`; tomorrow = today + 1 day computed on the date string):
  - `null`: badge warn "Няма меню"; sentence "За {днес|утре} няма качено меню." (today variant adds bold "Клиентите виждат „Няма обедно меню“."); button "Качи меню" (primary for today, secondary for tomorrow).
  - `published: false`: warn badge "Качено, но не е публикувано"; sentence "Клиентите не го виждат."; buttons "Публикувай" (primary, direct PATCH with busy state) and "Виж" (secondary -> `#/daily-menu`).
  - `published: true`: today = solid green badge "На живо днес"; tomorrow = soft green "Публикувано"; sentence "Клиентите го виждат." (tomorrow: "Ще се покаже утре."); button "Управление" (secondary).
- **Card "Основно меню":** h2 "Основно меню"; line "Клиентите виждат: **Структурирано меню**|**Файл**" (from `menu.mode`). Structured mode: "Последно публикувано: {дата, час}" or, if null, warn alert "Още не е публикувано." Changes: if `hasUnpublishedChanges` -> `.a-alert--warning` "Има непубликувани промени. Клиентите виждат старата версия." + primary button "Прегледай и публикувай" (-> `#/menu`). File mode: "Публикуван файл: {originalName}" or warn "Няма публикуван файл." Else button "Редактирай меню" (secondary).
  - Timestamp format: "12 ноември 2026, 14:30". Assumption: backend returns an ISO instant or Sofia local string; frontend renders in Europe/Sofia with `Intl.DateTimeFormat('bg-BG', {timeZone:'Europe/Sofia'})` for ISO-with-zone/epoch values and by plain parsing for the local `YYYY-MM-DDTHH:mm` form (see Blockers).
- Loading: 4 skeleton cards. Error: alert + retry.

## B5. Events `#/events` and form
### B5.1 List
- Page head: h1 "Събития", button "Ново събитие" (primary, plus icon).
- **Filter chips** below head: `Всички ({n})` `Активни ({n})` `Предстоящи ({n})` `Изключени ({n})` `Изтекли ({n})` as `.a-seg` (horizontally scrollable on mobile, 48px high). Default **Всички** — expired events remain visible and are dimmed (title colour `--a-muted`, card bg `#fbf9f4`). Counts from the loaded list (status field). "Изтекли" keeps expired events findable.
- **Row/card** (`.a-event`, `<article>`): 
  - Mobile: thumbnail 72x72 (object-fit cover, radius 8px; no image -> neutral tile with calendar icon) + title (bold 18px, 2-line clamp) and status badge; below: "Събитие: петък, 20 ноември 2026, 20:00" (or "Без дата на събитието"), "Показва се: от {startsAt} до {expiresAt}" (parts omitted: "от веднага", "без крайна дата"); then a row: switch "Показвай" (label changes Вкл./Изкл.) and buttons "Редактирай" (secondary) and "Изтрий" (ghost-danger icon+text). 
  - >= 768: one-row grid `72px | 1fr | auto | auto`: thumb | info | switch | actions.
  - **Toggle:** `PATCH /enabled`; optimistic UI is not used — switch shows spinner and updates the badge from the response; on error revert + toast. Expired rows show extra helper under the switch: "Изтекъл срок — променете „Скрий след“, за да се покаже отново." (14px, `--a-warn-ink`). Scheduled rows: "Ще се покаже от {startsAt}."
- Status mapping: `active` Активно · `scheduled` Предстоящо · `disabled` Изключено · `expired` Изтекло.
- Empty: B2.8 empty state. Filter with no results: "Няма събития с този статус." + button "Покажи всички".
- Delete: confirm dialog (B2.6): title "Изтриване на събитие", body "Сигурни ли сте, че искате да изтриете „{title}“? Снимката също ще бъде изтрита. Това не може да бъде върнато.", buttons "Отказ" / "Изтрий събитието". Success toast "Събитието е изтрито."

### B5.2 Create/edit form (page `#/events/new`, `#/events/{id}`)
h1 "Ново събитие" / "Редактиране на събитие"; "← Към събитията" ghost link at top. Layout: < 1024 single column: form card then preview card; >= 1024: two columns `1fr 380px`... (content 880 + sidebar leaves ~ 740px at 1024; so the two-column variant applies only >= 1280; below 1280 the preview is the card after the fields). Sticky action bar (`.a-actionbar`, bg `--a-surface`, 1px top `--a-line`, padding 12px 16px; mobile: fixed above tab bar at bottom 64px+safe-area; desktop sticky bottom 0): "Запази" (primary) and "Отказ" (secondary), **side by side in one row on all widths** ("Отказ" left, "Запази" right, each `flex: 1`, 48px high) so the bar stays ≈ 72px tall on phones — D-24. Saving: busy, fields disabled. After create: toast "Събитието е създадено." and go to the list. After edit: toast "Промените са запазени."
Fields in order:
1. **Заглавие** * — text, max 120, counter. Error "Въведете заглавие." / "Заглавието е твърде дълго (макс. 120 знака)."
2. **Описание** — textarea (6 rows, auto-grow optional), max 2000, counter. Helper: "Обикновен текст. Новите редове се запазват."
3. **Снимка** — upload component (jpg, png, webp, до 5 MB); with an existing image: preview 160px tall + "Смени снимка" (opens picker) and "Премахни снимка" (ghost-danger; sets `removeImage=true`, preview returns to the empty upload area; undoable until saved via "Върни снимката"). Helper: "Препоръчваме хоризонтална снимка. На сайта се показва цяла, без изрязване."
4. **Дата на събитието** (datetime-local) + "Изчисти". Helper: "Кога се случва събитието. Показва се на клиентите. Не е задължително."
5. **Показвай от** (datetime-local) + "Изчисти". Helper: "От кога събитието да се вижда на сайта. Оставете празно, за да се покаже веднага."
6. **Скрий след** (datetime-local) + "Изчисти". Helper: "След този момент събитието изчезва от сайта автоматично. Оставете празно, ако искате да остане, докато го изключите."
   - Under the three date fields, a single note: "Всички часове са по българско време." 
   - Validation: "„Скрий след“ трябва да е по-късно от „Показвай от“." (server 400 mirrored client-side). Soft warning (not blocking, `.a-alert--warning`): if `expiresAt` < `eventAt`: "Събитието ще изчезне от сайта, преди да започне."; if `startsAt` > `eventAt`: "Събитието ще се покаже след като е започнало."
7. **Включено** (switch, default Вкл.). Helper: "Когато е изключено, събитието не се показва на сайта, независимо от датите."
- **Live preview card** "Така ще изглежда на сайта": `.preview-frame` (bg `--bg`, 1px `--a-line`, radius 8px, padding 16px, `pointer-events:none` + `aria-hidden` for the interactive bits except the heading; has `class="public-theme"` so the public `tokens.css`/`components.css` apply) rendering exactly the public `.event-card` markup (A4) from the current form values: empty title -> placeholder "Заглавие на събитието" in `--muted`; empty description omitted; no image -> text-only layout; image from `URL.createObjectURL` (blob: allowed by CSP) or the stored `imageUrl`; date formatted with the same Bulgarian formatter. A preview width switch (`.a-seg`: "Телефон" 390 / "Компютър" 960) sets the frame's max-width class (`.w-390` / `.w-960`) so the owner sees both layouts. Below preview a one-line live status computed client-side is **not** shown (server owns status); instead static info: "Дали е видимо сега зависи от превключвателя и датите."
- Edit page extras: shows current status badge next to h1 and "Изтрий събитието" ghost-danger button at the bottom (confirm as in B5.1).
- Errors: 400 `fields` inline + summary; 413/415 inline in upload; network toast.

## B6. Daily menu `#/daily-menu` ("Обедно меню")
Page: h1, **upload wizard card**, then **"Менюта"** list card.

### B6.1 Wizard "Качване на меню" (4 steps, one panel visible at a time)
- **Stepper** (`<ol class="a-steps" aria-label="Стъпки">`): 4 items "1 Избери файл", "2 Избери дата", "3 Преглед", "4 Публикувай". >= 600: horizontal row with numbered circles (32px: done = green fill ✓ with `aria-label` "завършена", current = `--a-primary` fill white number, todo = 2px `--a-neutral-ink` outline; labels 14px bold under/next to circles; connecting line 2px `--a-line`). < 600: compact "Стъпка {n} от 4 — {име}" (bold) + 4-segment bar (segments 8px tall; done/current `--a-primary`, todo `--a-neutral-tint` with border). Current step `aria-current="step"`. Steps already done are clickable (go back); future ones are not.
- Each step panel has h2 and buttons "Назад" (ghost) / "Напред" (primary; disabled until step valid; on step 4 it is replaced by the publish buttons).
- **Step 1 — Избери файл:** upload component (pdf, jpg, jpeg, png, webp, до 10 MB). "Напред" enabled once a valid file is chosen.
- **Step 2 — Избери дата:** field "Дата на менюто" (`<input type=date>`, 48px, default = `today` from the API), quick buttons "Днес" and "Утре" (`.a-seg`, `aria-pressed`, the one matching the field is pressed). Under it the date in long Bulgarian in bold ("понеделник, 16 ноември 2026") so there is no ambiguity. Helper: "Менюто се показва на клиентите само на тази дата." Messages: past date -> `.a-alert--warning` "Тази дата е в миналото. Клиентите няма да видят менюто."; date already has a menu (from the loaded list) -> `.a-alert--info` "За тази дата вече има меню. При публикуване можете да го замените."; empty -> error "Изберете дата."
- **Step 3 — Преглед:** client-side preview of the chosen file via `URL.createObjectURL`: image full width in `.a-preview` (max-height 520px, contained; tap -> lightbox, same component as public); PDF: `<object type="application/pdf">` (blob: allowed) only when `navigator.pdfViewerEnabled` and >= 768, otherwise a PDF tile card + button "Отвори за преглед" (opens the blob URL in a new tab). Summary list: Файл (name, size), Дата (long), "Как ще го видят клиентите: на {date}" . Revoke the object URL on leave.
- **Step 4 — Публикувай:** summary card "Готово за качване" (file, date). Radio-like two options as large buttons: **"Публикувай"** (`.a-btn--primary`, 56px) and **"Запази като чернова (непубликувано)"** (`.a-btn--secondary`). Explanatory text under each: "Менюто веднага става видимо на {дата}." / "Менюто се записва, но клиентите няма да го виждат, докато не го публикувате." (for a future date the first reads "Ще се показва на сайта на {дата}." — for today: "Клиентите ще го видят веднага.").
- **Uploading:** both buttons disabled; B2.7 progress shown in the step; "Откажи качването".
- **Conflict (409 `date_exists`, and also pre-checked from the list before upload starts to avoid a wasted upload):** dialog title "Вече има меню за тази дата", body "За {дата} вече има качено меню ({Публикувано|Чернова}). Искате ли да го замените с новия файл? Старият файл ще бъде изтрит.", buttons "Избери друга дата" (secondary, goes to step 2), "Замени" (primary-danger look: `.a-btn--danger`). "Замени" resends with `replace=true` (progress shown again).
- **Success:** panel replaced by `.a-alert--success` "Менюто за {дата} е публикувано." (or "…е записано като чернова.") + if date is today & published "Клиентите вече го виждат." Buttons "Виж менютата" (primary, scrolls to list/ focuses it) and "Качи ново меню" (secondary, resets wizard to step 1 with date defaulting to today). Toast also fires.
- **Errors:** 413/415 inline at step 1 (wizard returns to step 1 with the message); 400 `fields.date` inline at step 2; network: `.a-alert--error` "Качването не успя. Проверете връзката и опитайте отново." + "Опитай отново".

### B6.2 List "Менюта"
- Sections by heading: **"Днес"** (if any), **"Предстоящи"** (date ascending), **"Минали"** (date descending; collapsed behind a button "Покажи минали менюта ({n})", `aria-expanded`). API gives date-desc; the client regroups.
- **Row** `.a-menu` (card): left 6px status stripe (**green** if live today, `--a-warn-line` if today but unpublished, `--a-line` otherwise — stripe is extra to the text badge). Content: thumbnail 72x72 (image) or PDF tile (file-pdf icon on `--a-neutral-tint`) · date long bold ("понеделник, 16 ноември 2026") · "{PDF|Снимка} · {name truncated} · {size}" 14px muted · badges · switch **"Публикувано"** (Вкл./Изкл.; `PATCH published`; spinner, revert + toast on error) · buttons "Преглед" (opens `fileUrl` in new tab, secondary), "Редактирай" (secondary), "Изтрий" (ghost-danger). Mobile: info block on top, switch row, then buttons in a 3-column grid (each >= 48px high, text + icon).
- **Live marker:** the row whose `date === today` and `published` has solid green badge **"На живо днес"** and a green stripe, and the card sits first in the list under "Днес". If today's menu exists but is unpublished: warn badge "Днес — не е публикувано" with line "Клиентите не го виждат." If no menu for today at the top of the list: `.a-alert--warning` "За днес няма публикувано меню." + "Качи меню" button.
- Other badges: "Утре" (info), "Предстоящо" (info), "Чернова" (neutral, when unpublished), "Публикувано" (soft green), "Минало" (neutral).
- **Редактирай dialog** (`.a-dialog` wide variant): fields "Дата" (date input) and an optional "Нов файл" upload component (replace; shows current file name). Buttons "Отказ" / "Запази". Progress when a file is sent. 409 `date_exists` -> inline "На тази дата вече има меню." Success toast "Менюто е обновено."
- **Delete confirm:** title "Изтриване на меню", body "Сигурни ли сте, че искате да изтриете менюто за {дата}? Файлът ще бъде изтрит. Това не може да бъде върнато." (if live today add bold: "Това меню се показва на клиентите сега."), buttons "Отказ" / "Изтрий менюто". Toast "Менюто е изтрито."
- Empty: "Още няма качени менюта." + button "Качи първото меню" (scrolls to wizard). Loading: 3 skeleton rows.

## B7. Regular menu `#/menu` ("Основно меню")
### B7.1 Top: "Какво виждат клиентите?" (live mode selector)
Card with two **radio cards** (`role="radiogroup"`, each a `<label>` block min-height 88px, 2px `--a-border`, radius 12px, padding 16px; selected: border `--a-primary`, bg `--a-primary-tint`, check icon, text `--a-text` 15.66:1; the text "Показва се на сайта" appears in the selected one):
- **"Структурирано меню"** — "Ястия по категории с цени. Лесно за редактиране и четене на телефон."
- **"Файл"** — "Качена снимка или PDF на цялото ви меню."
Under: `.a-alert--info` "Клиентите виждат само публикуваната версия. Промените в чернова не се показват, докато не натиснете „Публикувай“." Changing the selection opens a confirm dialog: title "Смяна на менюто на сайта", body "Клиентите ще започнат да виждат: {Структурирано меню|Файл}." buttons "Отказ" / "Покажи на сайта" (primary). `PUT /menu/mode`; `409 nothing_published` -> dialog closes and `.a-alert--error` "Не можете да превключите — няма публикувано {структурирано меню|файл}. Публикувайте първо." and selection stays unchanged.

### B7.2 Edit tabs
Below, a tab list "Редактиране": **"Структурирано меню"** and **"Файл"** (`role="tablist"`, 48px, selected has 3px `--a-primary` underline + bold). The tab of the live mode carries a green badge "На сайта". When the shown tab is not live: `.a-alert--warning` "Това меню не се показва на сайта в момента. Активно е: {другото}." with button "Покажи това на сайта" (same confirm as above). Default tab = live mode.

### B7.3 Structured editor
- **Status bar** (`.a-statusbar`, sticky `top: 56px` mobile / `top: 0` desktop, bg `--a-surface`, 1px bottom border, padding 12px 16px): left = badge:
  - `Публикувано` (soft green) + "от {дата, час}" — draft equals published and nothing unsaved.
  - `Чернова — не е публикувано` (warn badge, pencil glyph) — saved draft differs from published (`hasUnpublishedChanges`), or never published.
  - `Незапазени промени` (danger-tint badge, dot) — local edits not yet saved (takes precedence in the display; also `beforeunload` guard).
  Right/below on mobile = buttons: **"Запази чернова"** (secondary; enabled only when locally dirty), **"Публикувай"** (primary; enabled when dirty OR `hasUnpublishedChanges`; if locally dirty it first saves then publishes), **"Откажи промените"** (ghost-danger; enabled when dirty or `hasUnpublishedChanges`), and **"Преглед"** (secondary, eye icon, always). Mobile: status row, then 2x2 button grid (each 48px). If mode is `file`: helper under bar "Публикуването запазва версията, но клиентите виждат файла, докато не смените режима."
  - "Публикувай" confirm: title "Публикуване на менюто", body "Промените ще се покажат веднага на сайта." (if mode is file: "Менюто няма да се покаже на сайта, докато не изберете „Структурирано меню“ по-горе.") buttons "Отказ"/"Публикувай". Success toast "Менюто е публикувано." and badge flips to Публикувано.
  - "Откажи промените" confirm: title "Отказване на промените", body "Чернавата ще се върне към последно публикуваната версия. Всички промени след нея ще бъдат изгубени." (if never published: "…ще се изчисти напълно.") buttons "Отказ" / "Откажи промените" (danger). Calls discard endpoint, reloads draft.
  - "Запази чернова": PUT whole draft; success toast "Чернавата е запазена. Клиентите още виждат старата версия." (if the draft differs from published). Validation errors from server `fields` are mapped to items.
- **Editor body:** list of **category cards**.
  - Category header row: collapse toggle button (48x48, chevron, `aria-expanded`, `aria-controls`) · name input (label visually hidden "Име на категория", Oswald-styled 18px bold, placeholder "Име на категория, напр. Салати") · item count "(5 ястия)" · move buttons ↑ ↓ (`.a-btn--icon`, `aria-label` "Премести категорията нагоре/надолу", `disabled` at ends) · "Изтрий" icon button (`aria-label="Изтрий категорията"`). Mobile: name input full width on its own row, below it the row of buttons (collapse, ↑, ↓, delete) — all 48px with 8px gaps (fits 390).
  - Default expansion: first category expanded, others collapsed on mobile; all expanded >= 1024; newly added expanded and its name field focused.
  - **Dish card** (inside, `.a-dish`, bg `#fbf9f4`, 1px `--a-line`, radius 8px, padding 12px): fields stacked on mobile — "Име на ястието" *, "Цена" (money input, suffix = `currencySymbol`, helper "0 или празно = без цена"), "Описание" (textarea 2 rows, optional, counter shown from 400/500), switch "Налично" (Вкл./Изкл.; helper when off: "Показва се като „Няма в наличност“"); action row: ↑ ↓ (`aria-label` "Премести ястието нагоре/надолу") and "Изтрий" (icon+text ghost-danger). >= 768: grid — row 1: name (1fr) + price (140px); row 2: description; row 3: switch left, actions right.
  - Dish removal and category removal always use the confirm dialog (title "Изтриване на ястие" / "Изтриване на категория", body "Изтриване на „{name}“?" for categories: "…и всичките му {n} ястия?"). **Exception:** an untouched brand-new empty row can be removed without confirm.
  - Add buttons: "Добави ястие" (secondary, plus icon, full width at the end of each category) and "Добави категория" (primary-outline, full width at the bottom; also in the empty state).
  - **Reordering:** only up/down buttons (no drag). After a move, focus stays on the same moved item's same arrow button and a polite live region announces "Преместено: позиция {i} от {n}." Items scroll into view if offscreen.
  - Validation (inline, on blur/save): name empty "Въведете име."; > 100 "Максимум 100 знака."; price invalid "Въведете цена, например 12,50."; price > 100 000 "Цената е твърде висока."; description > 500 "Максимум 500 знака."; limits "Най-много 50 категории." / "Най-много 200 ястия в категория." (disable the add button with the message under it). Save is blocked while invalid and the error summary lists problems; the first invalid category is auto-expanded.
  - Empty state (no categories): `.a-empty` "Менюто е празно." / "Добавете първата категория, например „Салати“." / "Добави категория".
- **Preview dialog** "Преглед за клиенти": full-screen dialog on mobile, 960px wide >= 1024, with the banner "Това е преглед на {чернова|публикуваното меню}." (+ "Съдържа незапазени промени." when dirty) and the **public** menu markup (A6, using `public-theme` styles, current local draft, `currencySymbol` from settings, including the category chip nav and unavailable tags) inside `.preview-frame`; close button "Затвори" 48px. Width switch "Телефон / Компютър" like Events.

### B7.4 File mode
- Section "Файлове на менюто". **Upload** component (pdf, jpg, jpeg, png, webp, до 15 MB) -> after choosing: preview (image/PDF as in B6.1 step 3) + buttons "Качи" (primary) / "Отказ"; progress per B2.7. After upload: file appears as unpublished, toast "Файлът е качен. Все още не е публикуван.", and the row shows an inline primary "Публикувай".
- **File rows** (`.a-file`, card): thumbnail/PDF tile, original name (bold, truncate), "{Снимка|PDF} · {size} · качен на {дата}", badge **"Публикуван"** (green, with text "Виж се от клиентите" only if mode is file; otherwise "Публикуван — не се показва (активен е Структурираното меню)") or "Непубликуван" (neutral), buttons "Преглед" (new tab), **"Публикувай"** (primary on unpublished rows; if another file is published, confirm first: "Текущо публикуваният файл „{name}“ ще бъде заменен. Само един файл може да е публикуван.") , "Изтрий" (ghost-danger). Only one row ever shows "Публикуван". Unpublishing (`published:false`) is offered as "Скрий" ghost button on the published row only when mode is `structured`; in `file` mode it is hidden and a helper explains "За да скриете този файл, публикувайте друг или превключете към Структурирано меню."
- Delete confirm: title "Изтриване на файл", body "Сигурни ли сте, че искате да изтриете „{name}“? Това не може да бъде върнато."; `409 in_use` -> error toast + inline alert "Този файл се показва на клиентите. Първо публикувайте друг файл или превключете на Структурирано меню."
- Empty: "Още няма качени файлове." / "Качете снимка или PDF на менюто." with the upload area.

## B8. Settings `#/settings` ("Настройки")
Four cards, each with its own save/action button and busy/success/error states.
1. **Информация за сайта** (`PUT /settings`): "Телефон за резервации" (`type=tel`, `inputmode=tel`, max 30, allowed `+ 0-9 space ( ) -`; helper "Показва се най-горе на сайта и в „Контакти“. Оставете празно, за да го скриете."; error "Само цифри, интервали, +, ( ) и -."), "Адрес" (textarea 2 rows, max 200, counter, helper "Оставете празно, за да се скрие."), "Работно време" (textarea 5 rows, max 500, counter, helper "Всеки ред се показва на нов ред на сайта. Пример: Пон–Пет 11:00–23:00"), "Валутен символ" (text, max 5, width 120px, helper "Показва се след цената, например €."). Button "Запази". Toast "Настройките са запазени."
2. **Смяна на парола:** "Текуща парола", "Нова парола" (helper "Най-малко 12 знака. Подходяща е фраза от няколко думи."), "Повторете новата парола"; each with "Покажи/Скрий". Inline errors: "Паролата трябва да е най-малко 12 знака." (also live character hint "{n}/12" turning green text + ✓ when reached), "Паролите не съвпадат.", server 401/400 "Текущата парола е грешна." Button "Смени паролата". Success: fields cleared, toast "Паролата е сменена. Излязохте от другите устройства."
3. **Двуфакторна защита (2FA):** badge "Включена" (green) / "Изключена" (neutral) from `me.totpEnabled`. Explanation: "Освен паролата при вход се иска код от приложение в телефона ви. Така профилът е по-защитен."
   - *Off:* button "Включи 2FA" -> `POST /totp/setup`; panel shows numbered steps:
     1. "Инсталирайте приложение за удостоверяване, например Google Authenticator, Microsoft Authenticator или Aegis."
     2. "В приложението изберете „Добавяне на акаунт“ и „Въведете ключ ръчно“."
     3. "Въведете име „Kota1“, ключа по-долу и изберете тип „Базиран на време“."
     Secret box `.a-secret`: monospace 20px bold, `--a-text` on `--a-neutral-tint` (7.73:1 using neutral-ink variant; use `--a-text` on `#f6f2ea`... = 15.47:1), grouped in blocks of 4 with spaces (`user-select: all`), button "Копирай ключа" (secondary; toast "Ключът е копиран."), and on phones a link "Отвори в приложението за удостоверяване" (`href` = `otpauthUrl`). Warning alert: "Пазете ключа в тайна. Не го споделяйте."
     4. "Въведете 6-цифрения код от приложението:" field "Код" (numeric, 6) + "Потвърди и включи" (primary). Error "Невалиден код. Проверете часовника на телефона и опитайте отново." Success toast "2FA е включена." and panel collapses. "Откажи" closes the setup (pending secret stays unused).
   - *On:* "Изключване" section: fields "Парола", "Код от приложението", button "Изключи 2FA" (danger) -> confirm dialog "Изключване на 2FA" / "Профилът ви ще се защитава само с парола." buttons "Отказ" / "Изключи". Errors inline "Грешна парола или код."
4. **Профил и изход:** "Влезли сте като {username}." Button "Изход" (secondary, log-out icon) -> `POST /logout`, then login screen; toast not needed. (Also in top bar/sidebar.)

---

# PART C - ACCESSIBILITY AND CONTRAST

## C1. Checklist
- Heading order: public one h1 per page (hero sign is the index h1; daily page h1 = "Обедно меню"), h2 sections, h3 events/categories. Admin: h1 per route, h2 cards, h3 within.
- Landmarks: `<header>`, `<nav aria-label>`, `<main id="main">`, `<footer>`; admin `<nav aria-label="Основна навигация">`, `<main>`.
- Dialogs: native `<dialog>` + `showModal()`, `aria-labelledby`, focus management as specified. Toggles: `role="switch"` + `aria-checked`. Tabs: `role="tablist/tab/tabpanel"` with arrow-key support. Chips/segments: `aria-pressed` or `aria-current`.
- Live regions: toasts (status/alert), upload percent (polite), reorder announce (polite), login rate-limit (alert once).
- Images: event `alt` = event title; daily menu image `alt` = "Обедно меню за {дата}"; regular-menu file image `alt` = "Основно меню"; admin thumbnails `alt=""` (adjacent text names them); admin previews of uploaded files `alt="Преглед на избрания файл"`; decorative icons `aria-hidden="true"`.
- Keyboard: all functions reachable by keyboard; no drag-only interactions (reorder = buttons); Esc closes dialogs/lightbox/nav panel.
- Colour is never the only carrier (badges have text + glyph; unavailable has tag; switches have text).
- Zoom: layouts work at 200% text zoom and with `meta viewport` without scale lock; text min 14px (tab bar labels 12px bold are the only exception, supplemented by icons).
- Autocomplete tokens on login/password/TOTP fields as specified; `autocomplete="off"` on menu/event fields not needed.

## C2. Contrast (WCAG 2.x relative luminance, computed numerically; AA needs 4.5:1 text, 3:1 large text/UI components)
**Public (dark)**
| Pair (foreground on background) | Ratio |
|---|---|
| `--text` #f1e6d2 on `--bg` #121110 | 15.26 |
| `--text` on `--bg-2` #1b1917 | 14.18 |
| `--text` on `--bg-3` #262119 | 12.93 |
| `--glow` #f3d9a4 on `--bg` | 13.72 |
| `--glow` on `--bg-2` (prices, dates, event title) | 12.75 |
| `--accent` #d9a54a on `--bg` | 8.47 |
| `--accent` on `--bg-2` (category headings, ghost buttons, event date) | 7.87 |
| `--accent` on `--bg-3` | 7.18 |
| `--muted` #a39887 on `--bg` | 6.65 |
| `--muted` on `--bg-2` | 6.18 |
| `--muted` on `--bg-3` | 5.63 |
| `--muted` on hero glow mid-tone #3a2d1c (worst point of gradient, `.en` spans) | 4.71 |
| `--dim` #8c8173 on `--bg-2` (unavailable dish) | 4.59 |
| `--paper-ink` #1a1408 on `--accent` (buttons, top bar, event tag) | 8.22 |
| `--paper-ink` on `--glow` (btn-special, current chip hover) | 13.31 |
| `--paper-ink` on `--paper` #f1e6d2 (daily panel text) | 14.81 |
| `--paper-muted` #5a4f3f on `--paper` | 6.47 |
| `--paper-link` #7a4b00 on `--paper` | 6.00 |
| `--err` #ff9b8f on `--bg-2` / on `--bg` | 8.63 / 9.28 |
| Focus ring `--glow` on `--bg` / `--bg-3` | 13.72 / 11.62 |
| Focus ring `--paper-ink` on `--accent` | 8.22 |
| UI: `--accent` border on `--bg` (btn-special, event card border) | 8.47 |
| Decorative only: `--line` #3a342d on `--bg` | 1.53 (dividers; never the sole indicator of a control) |

**Admin (light + dark chrome)**
| Pair | Ratio |
|---|---|
| `--a-text` #1f1a14 on `--a-bg` #f6f2ea / on `--a-surface` #fff | 15.47 / 17.27 |
| `--a-muted` #5c5347 on `--a-bg` / on white | 6.76 / 7.54 |
| Placeholder #6b6154 on white | 6.06 |
| White on `--a-primary` #8a5300 / on hover #6e4200 | 6.33 / 8.60 |
| `--a-primary` text/links on white / on `--a-bg` | 6.33 / 5.67 |
| `--a-primary` on `--a-primary-tint` #fbf3e4 (selected border, UI) | 5.74 |
| `--a-text` on `--a-primary-tint` | 15.66 |
| White on `--a-danger` #b3261e / on hover #8f1d17 | 6.54 / 8.91 |
| `--a-danger` on white / on `--a-bg` / on `--a-danger-tint` #fdecea | 6.54 / 5.85 / 5.72 |
| `--a-ok` #1b6e3a on `--a-ok-tint` #e3f4e8 / on white / on `--a-bg` | 5.50 / 6.29 / 5.63 |
| White on `--a-ok` (solid live badge, stepper done) | 6.29 |
| `--a-warn-ink` #5c4400 on `--a-warn-tint` #fff1c2 / on `--a-bg` | 8.16 / 8.24 |
| `--a-info-ink` #1d4f7a on `--a-info-tint` #e4f0fa | 7.40 |
| `--a-neutral-ink` #4a4238 on `--a-neutral-tint` #e9e3d8 | 7.73 |
| White on `--a-toast-ok` #14532d / on `--a-toast-err` #8f1d17 | 9.11 / 8.91 |
| `--a-chrome-text` #f1e6d2 on `--a-chrome` #121110 | 15.26 |
| `--a-chrome-muted` #cfc5b3 on chrome (inactive tabs/nav) | 11.04 |
| `--a-chrome` on `--glow` (active sidebar item) | 13.72 |
| `--glow` on chrome (active tab, logo) | 13.72 |
| Login footnote `--a-chrome-muted` on chrome | 11.04 |
| **UI components (3:1):** `--a-border` #8a7f6f on white / on `--a-bg` (inputs, secondary buttons) | 3.93 / 3.52 |
| Switch OFF track #6f6659 on white / switch ON track `--a-ok` on white | 5.64 / 6.29 |
| Progress fill `--a-primary` on track `--a-neutral-tint` | 4.96 (track bounded by a 1px `--a-border` border, since track vs white is only 1.28) |
| Focus ring `--a-focus` #0b5fff on white / on `--a-bg` | 5.13 / 4.59 |
| Focus ring `--glow` on chrome (inside sidebar/tab bar/login) | 13.72 |
| Stepper todo outline `--a-neutral-ink`/`--a-muted` on white | 7.54 |
| Decorative only: `--a-line` #d8cfc0 on white | 1.54 (card borders; controls never rely on it) |

Scripts: values computed with the WCAG formula (sRGB linearisation, L = .2126R + .7152G + .0722B, ratio = (L1+.05)/(L2+.05)). Re-check any new colour pair before use.

## C3. Tap target inventory (>= 44px, designed at 48px)
Hamburger 48x48; hero buttons 56px; nav items 44-52px; category chips 44px; lightbox buttons 48px; top bar phone link 44px (padding); admin buttons/inputs/switches 48px; tab-bar tabs 78x64; sidebar items 52px; icon buttons 48x48; quick-action tiles >= 88px; toast close 44x44; segmented buttons 48px; filter chips 48px.

---

# PART D - IMPLEMENTATION NOTES FOR THE FRONTEND DEVELOPER
- Files: `public/css/tokens.css` (public tokens), `public/css/style.css` (existing + page layout), `public/css/components.css` (A8 components, class-only), `public/admin/admin.css` (admin tokens + components, `@import`/link both tokens.css and components.css for previews). `style.css` rules like `body`, `a`, `h2` must not leak into admin: admin does **not** load `style.css`; `.preview-frame.public-theme` re-declares body-like text colour/font (`color: var(--text); font-family: Source Sans 3`) and scopes h2/h3 styles used by previews via classes, not element selectors.
- Dynamic values without `style=""`: use `<progress>`, `<meter>`, attribute-driven state (`aria-*`, `data-*` + attribute selectors), and `hidden`. Widths for the preview switch use classes.
- Date helper (shared module): `formatDateLong('YYYY-MM-DD')` -> "понеделник, 16 ноември 2026"; `formatDateTime('YYYY-MM-DDTHH:mm')` -> "петък, 20 ноември 2026, 20:00"; `formatPrice(cents, symbol)` -> "12,50 €" with NBSP.
- Admin `fetch` must send `X-Requested-With: kota-admin` on every non-GET; progress uploads via `XMLHttpRequest` (same header).
- Open points for the PM are listed in the T-1 handoff report (timestamp format, unpublishing the live menu file, empty-price rule).

## D-addendum (PM, after design review T-9)
- **Preview frames must respond to the frame width, not the viewport (D-25).** `.preview-frame` gets `container-type: inline-size`; every responsive rule of the public components used in previews (event card two-column layout, menu `columns: 2`) must also exist as a container query (`@container (min-width: 768px)`) so a 390px "Телефон" frame shows the phone layout on a desktop screen. Public pages keep working (body/page wrapper can be the container, or keep the @media rules and add @container rules that apply only inside `.preview-frame`). The "Компютър" preview may scale down (CSS `zoom`/transform) or scroll horizontally inside the dialog; it must not be squeezed.
- Mobile public nav panel intentionally omits "Обедно меню" because the pill is always visible in the header (accepted, D-26). Logo link hit area ≥ 44px high.

---

# PART E - Gallery + About (D-51..D-53)

Existing tokens only (public `--*`, admin `--a-*`). No new colours, fonts or radii. Contrast values below were computed numerically (WCAG 2.x). Functional spec: `docs/ARCHITECTURE.md` "Gallery + editable About us".

## E1. Public nav change (every public page)
- Order: Меню (`/#menu`) · Обедно меню (`/daily-menu`) · Събитие (`/#event`, only when events exist) · **Галерия (`/gallery`)** · Контакти (`/#contact`). "Галерия" takes the slot of "За нас" (which is removed; `#about` section stays on index).
- Style = the other nav items (A2). On `/gallery` the item has `aria-current="page"` (glow + 2px `--accent` underline); on other pages it is a plain link. On `/gallery` the other items use `/#…` anchors and "Обедно меню" `/daily-menu`, as on the daily-menu page; the `Събитие` item is omitted there (same rule as daily-menu).
- Width check: same number of items as before ("Галерия" 7 letters vs "За нас" 6), so desktop/tablet (>= 768) inline nav and the mobile header row (logo + pill + burger, ~340px at 390) are unchanged. In the mobile panel the item is one more 52px row, left padding 16px; worst case 5 rows = 260px, fits one screen. No change to the always-visible "Обедно меню" pill.

## E2. Public page `/gallery` (`public/gallery.html`)
Header, top bar, skip link, footer identical to index/daily-menu. Page band as in A5 (`.page-band`, radial bg, padding 48px 16px 32px; mobile 32px 16px 24px, centered).
- **h1** "Галерия" + `<span class="en" lang="en">/ Gallery</span>` (eyebrow style from A5.1: Oswald 500, `.3em`, uppercase, `--muted`, 0.85rem... for the h1 use Oswald 700 uppercase `.06em`, `--glow`, clamp(1.75rem, 7vw, 3rem), glow text-shadow like `.logo`; `.en` per A1 rule).
- **Intro** (one line, `--muted`, 1.05rem/1.6, max-width 52ch, centered): "Снимки и видео от Kota1." (BG only; no extra EN line).
- **Grid** (`<ul class="gallery-grid">`, list semantics, inside `.section` max 960px, padding 0 16px 48px): CSS grid, gap 8px (mobile) / 16px (>= 600).
  | Width | Columns | Tile width (approx) |
  |---|---|---|
  | 390 (< 600) | 2 | ~171px |
  | 768 (600-1023) | 3 | ~230px |
  | 1280 (>= 1024) | 3 (container 960px) | ~299px |
  Use `grid-template-columns: repeat(auto-fill...)` is **not** used; explicit 2 / 3 columns at the breakpoints so rows stay aligned.
- **Item** `<li class="g-item">` = `<button type="button" class="g-tile">` + optional `<p class="g-cap">`. Tile: `aspect-ratio: 4 / 3`, `width:100%`, `overflow:hidden`, bg `--bg-3`, 1px `--line` border, radius `--radius-card` (4px), padding 0. Media (`img` / `video`): `width:100%; height:100%; object-fit: cover` (cropping is accepted in the grid; the lightbox always shows the whole picture, uncropped). Images `loading="lazy"`, `decoding="async"`, `alt=""` is wrong here since the button needs a name: the **button** gets `aria-label` = caption if present, else "Снимка {n} от {m}" / "Видео {n} от {m}", and the inner img has `alt=""`.
- **Video tile:** `<video muted playsinline preload="metadata" tabindex="-1" aria-hidden="true">` with `src` = `url + "#t=0.001"` so iOS paints the first frame; `pointer-events:none`. **Play badge** `.g-play` centered: 56px circle, bg `rgba(18,17,16,.78)`, 2px solid `--glow` border, glow-coloured triangle icon 24px (optically shifted 2px right). Glow on that bg 13.7:1. Not by colour alone: the badge shape plus a text chip bottom-left "Видео" (`--text` on `rgba(18,17,16,.78)`, Oswald 500 0.75rem uppercase `.1em`, padding 2px 8px, radius 2px; contrast >= 13:1). The accessible name already says "Видео".
- **Caption** `.g-cap`: under the tile, margin-top 8px, `--muted` (6.65:1 on `--bg`), Source Sans 3 400, 0.95rem/1.4, clamp to 2 lines (`-webkit-line-clamp: 2`), left aligned, `overflow-wrap:anywhere`. Items without a caption have no `<p>` (no empty space). Full caption is read in the lightbox.
- **States.** Hover (pointer only): border `--accent`; with `prefers-reduced-motion: no-preference` the media scales 1.03 in 200 ms, otherwise no transform. Focus-visible: `outline: 3px solid var(--glow); outline-offset: 3px` on the tile (not clipped: the `<li>` has no overflow hidden; keep the outline outside the tile's own overflow by putting it on the button, which is the overflow box, so use `outline-offset: 2px` and `z-index:1`). Active: `translateY(1px)`. Whole tile is the target (>= 171x128).
- **Loading:** 6 skeleton tiles (`.skeleton`, 4:3, bg `--bg-3` shimmer, no shimmer under reduced motion) with `role="status"` + visually hidden "Зареждане…".
- **Empty** (`items: []`): `.state-box` (A5.2) centered, title "Скоро ще добавим снимки." with `<span class="en" lang="en">/ Photos coming soon.</span>`, `role="status"`, button "Към началото" (`.btn`, `/`).
- **Error:** `.state-box` "Галерията не може да се зареди." / "The gallery could not be loaded." + "Опитай отново" (`.btn`), `role="alert"`.
- Heading order: h1 only in page band; no h2 needed. `<title>`: "Галерия — Kota1".

## E3. Lightbox for image and video (extend `public/js/lightbox.js`, A5.2 look kept)
Item shape gains `kind` (`image|video`), `caption`, `mime`. Dialog is a column: **bar (top) / media area (flex 1) / caption (bottom)**; `<dialog>` `display:flex; flex-direction:column; height:100dvh`.
- **Bar:** unchanged buttons (prev, counter, next, zoom, close; 48x48, `--bg-2` bg, `--text`, 1px `--accent` border). **Counter** `.lb-pos` text "3 / 12" (existing `page.of` string; `role="status" aria-live="polite"`; Oswald 500 1rem, `--text`; `n/m` always from the full visible list). Zoom button is **hidden** (`hidden`) for videos.
- **Image:** as today (fit to width/height, zoom toggle). Max height is the media area (`min-height:0; flex:1`), `object-fit: contain`, so portrait photos fit without scrolling until zoomed.
- **Video:** one reusable `<video class="lb-video" controls playsinline preload="metadata">` (no `autoplay`, no `muted` attribute, so the user presses play and gets sound; `controlslist="nodownload"` optional). Sized `max-width:100%; max-height:100%; width:auto; height:auto; object-fit:contain; background:#000`, centered in the media area (landscape fills the width on mobile; portrait iPhone video fills the height). Native controls only (accessible, supports fullscreen and seeking). Swap `img`/`video` by `hidden`; set `src` on show.
- **Pausing:** on prev/next, swipe, close, Escape, backdrop tap: `video.pause()`; on `close` also `removeAttribute('src')` + `video.load()` to stop network. Navigating to a video never autoplays. When the video element is the event target, **ArrowLeft/ArrowRight must not navigate** (they seek natively) and **horizontal swipe is ignored** (touch starting on `video`), so users can scrub; prev/next buttons stay the way to move. Esc still closes.
- **Caption** `.lb-cap`: below the media, centered, padding 12px 16px calc(12px + safe-area-inset-bottom), `--text` on `rgba(18,17,16,.96)` (>= 14:1), Source Sans 3 400 1rem/1.5, max-width 62ch, `max-height: 6.5rem; overflow:auto` (300 chars max), `overflow-wrap:anywhere`. Hidden when no caption (no empty bar). The same text is the image `alt` / video `aria-label`, so it is not read twice: caption element is `aria-hidden="true"` only if it duplicates the alt, otherwise leave it readable (simplest: image `alt=""` when a caption is shown, caption element readable).
- **Focus:** on open, focus goes to the close button as today; focus ring `3px --glow`. On close focus returns to the tile that opened it. Reduced motion: no transition on slide/fade (none are specified anyway).
- Buttons disabled at the ends keep the existing disabled look (opacity .4, still visible).
- Event/menu lightbox callers are unaffected (items without `kind` = image).

## E4. About section on the home page (owner-written text)
Section `#about` keeps its heading and place (A1). Body = one `<p>` per paragraph. **Split the text on blank lines (`\n{2,}`) into paragraphs; a single `\n` inside a paragraph is a line break (`white-space: pre-line` on the `<p>`).** Rendered with `textContent` only. Empty paragraphs are dropped.
- Typography: `--text`, Source Sans 3 400, 1.0625rem (17px) / 1.7, `max-width: 62ch` (existing `.about p` rule), left aligned (centered column only if the section is already centered; keep today's alignment). Paragraph spacing: `margin: 0 0 1.1em` (about 19px), last paragraph margin 0. `overflow-wrap:anywhere` for long words/URLs; no justify, no hyphen tricks.
- Long texts (up to 2000 chars, about 25 lines at 62ch) need no "read more": show everything.
- Fallback: when the API returns `about: null` show the built-in default i18n text unchanged.

## E5. Admin: sidebar/tab bar and Галерия section `#/gallery`
- **Navigation:** new item **Галерия** (icon `image`) between "Основно меню" and "Настройки". Route `#/gallery`, `document.title` "Галерия — Kota1 админ", focus to h1 (B1).
- **Bottom tab bar** with 6 tabs: each tab = 1/6 width (65px at 390, 60px at 360; target 65x64, still >= 44). To fit: tab padding 0 2px, labels 12px/700, `letter-spacing:0`, `line-height:1.1`, two-line wrap allowed ("Обедно меню", "Основно меню" wrap; "Настройки" ~56px bold at 12px fits in 61px). If "Настройки" would clip at 360px, apply `font-size: 11px` only below 380px (floor 11px). Active styling unchanged.
- **Sidebar** (>= 768): one extra 52px item; nothing else changes.
- **Dashboard:** summary card/line "Галерия: {count} / 25, видими: {visible}" (14px muted) with button "Управление на галерията" (secondary); out of detail scope otherwise.

### E5.1 Page layout
h1 "Галерия". Under it, `.page-head`-style row: counter chip + helper.
1. **Counter** `.a-count`: text "**N / 25**" (Source Sans 3 700 18px, `--a-text`) with label "снимки и видео" (14px `--a-muted`, 7.54:1 on white). At 25/25 an `.a-alert--warning` "Достигнахте максимума от 25. Изтрийте нещо, за да качите ново." (`role="status"`). The counter is `aria-live="polite"`.
2. **Upload card** (reuse `.a-upload` B2.7, idle look): dashed area, button "Избери снимки или видео" (primary), helper "JPG, PNG, WebP, MP4, MOV, WebM. До 50 MB на файл. Можете да изберете няколко." `<input type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm">`; drag-and-drop on >= 1024 as extra. **Disabled at 25/25**: button `disabled` (opacity .55) with the warning above (text carries the reason). If the selection would exceed the free slots, upload the first `free` files and show `.a-alert--warning` "Качени са само {k} от {n} файла — достигнат е максимумът от 25."
   - Client validation per file (before sending): type -> "„{име}“: този тип файл не се поддържа."; size > 50 MB -> "„{име}“: файлът е твърде голям ({size} MB). Максимум 50 MB." Invalid files are skipped with an inline `.a-alert--error` list (`role="alert"`); valid ones continue.
   - **Sequential upload queue** `<ul class="a-queue">` under the upload area: one row per file: name (truncate, `title`), `<progress>` (B2.7 style, 16px) + "Качване… 63%" / "Обработване…" / "Готово" (check icon, `--a-ok`) / "Грешка: {message}" (alert icon, `--a-danger`) + per-row "Опитай отново" / and one "Откажи" (aborts current and clears the rest) while running. Row text 15px; the queue has `aria-live="polite"` for "Качен е файл {k} от {n}". 409 `gallery_full` -> row error "Галерията е пълна (25)." and the rest of the queue is dropped. 413/415 messages as B2.7. Finished rows disappear 4 s after the list refreshes; errors stay until dismissed ("Затвори", 44px). Success toast after the batch: "Качени са {n} файла."
3. **List** `<ul class="a-gal-list">` of rows in position order, below the upload card; h2 "Качено" visible only when there are items.

### E5.2 List row `.a-gal` (card: `--a-surface`, 1px `--a-line`, radius 12px, padding 16px, margin-bottom 12px)
Layout >= 600: grid `96px 1fr auto`, gap 16px; mobile: stacked blocks.
- **Thumbnail** 96x96 (mobile 72x72, top-left, text block to its right), radius 8px, `object-fit:cover`, bg `--a-neutral-tint`. Image: `<img alt="">` (decorative, name is in the row heading text). Video: `<video muted playsinline preload="metadata" tabindex="-1" aria-hidden="true">` (src + `#t=0.001`) with a 28px play badge (white triangle on `rgba(31,26,20,.75)` circle, bottom-right 4px) so kind is shown by icon too. Thumbnail is a button "Преглед" opening `fileUrl` in a new tab (`rel=noopener`; target >= 72px).
- **Header line:** "№ {position}" bold + `.a-badge` kind: "Снимка" (neutral badge) / "Видео" (info badge) + size "{x.y} MB" 14px muted + badge visibility: **"Видимо"** (soft green, filled dot) / **"Скрито"** (neutral, hollow dot). 
- **Fields** (two stacked, labels 15px/700): "Надпис (български)" and "Надпис (English)" — text inputs 48px, max 300, helper none, counter "{n}/300" right aligned (B2.2, danger at limit), optional ("не е задължително" in the label's helper). Saved on **blur if changed** (`PATCH`), with a small inline status line under the field "Запазване…" -> "Запазено" (✓, `--a-ok`) -> fades out after 2 s (static text under reduced motion); error: inline alert icon + server message + field keeps value. No save button per row (fewer taps); the status text is `aria-live="polite"`. Keyboard: Enter in the field also commits.
- **Visible switch** (`.a-switch`, B2.2, label "Вкл."/"Изкл."), accessible name "Показвай в галерията (№ {n})"; `PATCH visible`; spinner while saving; revert + error toast on failure; toast not needed on success (badge changes). Hidden items: whole row thumbnail gets `opacity .6` **plus** the "Скрито" badge (never colour/opacity alone).
- **Reorder:** two icon buttons "Нагоре" (arrow-up) and "Надолу" (arrow-down), `.a-btn--icon` 48x48, `aria-label` "Премести № {n} нагоре/надолу"; disabled (opacity .55, `aria-disabled`) at the first/last row. Click -> `PUT /order`, optimistic swap, focus stays on the same button of the moved row (re-focus after re-render), live region announces "№ {n} е преместен на позиция {k}.". No drag-and-drop required.
- **Delete:** `.a-btn--ghost-danger` "Изтрий" with trash icon (48px) -> confirm dialog B2.6: title "Изтриване от галерията", body "Сигурни ли сте, че искате да изтриете този файл{ „надпис“}? Файлът ще бъде изтрит. Това не може да бъде върнато." buttons "Отказ" (focused) / "Изтрий файла" (danger). Toast "Файлът е изтрит." Focus then moves to the next row's heading, or the upload button if the list is empty.
- **Mobile layout (< 600):** row 1: thumbnail 72 + header line (№, badges) to the right; row 2: caption fields full width; row 3: switch (full row, 48px); row 4: buttons in one flex row: [Нагоре][Надолу] (48x48 each, gap 8px) and "Изтрий" pushed to the right. All gaps >= 8px.
- **Desktop >= 600:** column 3 (auto) holds, stacked: switch, then a row of [Нагоре][Надолу][Изтрий]; fields sit in column 2 under the header line.
- **Loading:** 3 skeleton rows (B2.8). **Empty:** `.a-empty` "Още няма качени снимки или видео." / "Качете първите файлове с бутона по-горе." (no extra button; the upload card is directly above). **Error:** `.a-alert--error` "Галерията не може да се зареди." + "Опитай отново".

## E6. Admin Настройки: card "Текст „За нас“" (new card, placed after "Информация за сайта", before "Смяна на парола")
Card title (h2 style, B1 card titles): **Текст „За нас“**. Helper (14px `--a-muted`): "Показва се в секция „За нас“ на началната страница. Оставете празно, за да се показва стандартният текст. Празен ред започва нов абзац."
- **Tabs** (reuse B7.2 tabs, `role="tablist"`, 48px, selected 3px `--a-primary` underline + bold): **Български** · **English**. Arrow-left/right move between tabs (roving tabindex), Home/End; each tab `aria-controls` its panel (`role="tabpanel"`, `aria-labelledby`). A tab whose text is filled carries a small "✓" glyph + visually hidden "(попълнен)"; an empty one shows nothing (so the owner sees at a glance which language has text).
- **Panel:** label (visible) "Текст на български" / "Text in English", textarea (B2.2; min 8 rows, about 200px; resize vertical; 16px), `maxlength` 2000, `aria-describedby` = counter. **Counter** `{n}/2000` right-aligned 14px `--a-muted`; at >= 1900 bold; at 2000 `--a-danger` bold + text "Достигнат е максимумът." (not colour alone). Live announcement only at 1900 and 2000 (`aria-live="polite"` on a separate hidden status node, not on every keystroke).
- **Fallback note** under the textarea of each tab (14px muted): "Ако оставите този език празен, ще се показва другият." (shown on both).
- **Save:** one button "Запази текста" (primary; both tabs saved in one `PUT /settings` with `aboutBg`/`aboutEn`; empty/whitespace-only -> `null`), busy "Запазване…", toast "Текстът е запазен." Mobile full width. Dirty state: unsaved-changes guard B2.10 applies to this card's textarea only through `beforeunload`. Optional link "Виж на сайта" (ghost, new tab `/#about`).
- Error: 400 `fields.aboutBg/aboutEn` -> inline error under the matching tab's textarea and a "!" icon on that tab (plus text in the error summary naming the language: "Текст „За нас“ (English): …"); if the failing tab is hidden, focus switches to it.

## E7. New strings (BG first)
Public: `nav.gallery` "Галерия" / "Gallery"; `gallery.title` "Галерия" / "Gallery"; `gallery.intro` "Снимки и видео от Kota1."; `gallery.empty` "Скоро ще добавим снимки." / "Photos coming soon."; `gallery.error` "Галерията не може да се зареди." / "The gallery could not be loaded."; `gallery.photoN` "Снимка {n} от {m}" / "Photo {n} of {m}"; `gallery.videoN` "Видео {n} от {m}" / "Video {n} of {m}"; `gallery.video` "Видео" / "Video". Lightbox counter reuses `page.of`.
Admin strings are inline above (BG only).

## E8. Accessibility check (Part E)
| Pair | Ratio |
|---|---|
| `--text` on `--bg-2` | 14.18 |
| `--muted` captions on `--bg` | 6.65 (on `--bg-3` 5.63) |
| `--glow` play icon on `--bg` | 13.72 |
| `--accent` hover border on `--bg` | 8.47 (UI >= 3) |
| admin `--a-muted` on white | 7.54 |
| admin `--a-primary` on white / on `--a-primary-tint` | 6.33 / 5.74 |
| admin `--a-ok` / `--a-danger` on white | 6.29 / 6.54 |
| admin `--a-border` on white (inputs, upload dashed) | 3.93 |
- Targets: public tile >= 171x128; lightbox buttons 48x48; admin tab bar tabs 60-65 x 64; icon buttons 48x48, gaps >= 8px.
- Focus rings per section 4 (public glow, admin blue). Reduced motion: no hover scale, no shimmer, no fade-out of status text; `scroll-behavior:auto`.
- Information never by colour alone: kind (icon + text), visibility (badge text + switch text), upload status (icon + text).
- Videos: native controls; no autoplay; muted only in decorative tiles (hidden from AT).
