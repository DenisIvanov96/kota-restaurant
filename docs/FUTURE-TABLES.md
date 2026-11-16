# Future phase — Table management / Маси (NOT implemented)

Status: **planned, not started**. Do not build UI, APIs or tables for this until the user starts the phase.

## Planned functionality
- Visual floor plan of the restaurant with numbered tables.
- Admin marks each table available / booked; clear colour + text distinction (not colour alone).
- Interactive selection of a table.
- Later: customer reservations (date/time slots, party size, confirmation).

## Architectural notes (so today's design does not block it)
- Fits the existing stack: new `server/migrations/00N_tables.sql`, `server/src/routes/admin/tables.js`, an admin section "Маси", and optionally `/api/public/tables` for read-only availability.
- Suggested schema: `floor_tables(id, number UNIQUE, x, y, width, height, seats, shape, status, updated_at)`; reservations later as `reservations(id, table_id, starts_at, ends_at, name, phone, party_size, status, created_at)` with UTC instants and Sofia-local API strings, same as events.
- Floor plan rendering: inline SVG in the admin UI (no new dependency). Positions stored in a fixed coordinate space (e.g. 0–1000) so it scales to any screen.
- Reservations will hold customer personal data → needs a privacy notice, retention policy and rate-limited public endpoint before launch.
- Real-time status across several staff devices can start with polling; add WebSockets/SSE only if needed.
