# Design specification

Owned by the UI/UX Designer. Current state reflects the existing site; the designer refines it on the next design task.

## Brand
Based on the backlit **KOTA 1** sign: condensed bold capitals, thick underline under "KOTA", taller "1", warm cream glow on a dark wall.

## Tokens (in `css/style.css` `:root`)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#121110` | page background |
| `--text` | `#f1e6d2` | body text |
| `--glow` | `#f3d9a4` | logo, headings |
| `--accent` | `#d9a54a` | top bar, buttons |
| `--muted` | `#a39887` | secondary text |
| `--line` | `#3a342d` | dividers |
Fonts: Oswald 500/700 (display), Lato 400/700 (body).

## Breakpoints
Mobile < 600px · Tablet 600–1024px · Desktop > 1024px. Content max width 960px.

## Page structure (index)
Top bar (reservation phone) → header (logo, nav) → hero (sign logo, "Restaurant", tagline, Book a table) → Menu → About → Contact → footer.
