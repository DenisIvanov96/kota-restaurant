# Kota1 Restaurant

Website for the Kota1 restaurant (Sofia): public pages (menu, daily menu, events, contact) and an
admin area at `/admin` where the restaurant staff update the content. It is a small Node.js
server that serves the static site in `public/`, a JSON API and the admin pages, with SQLite for
storage.

The site can not run on GitHub Pages (it needs a server). See `docs/DEPLOYMENT.md` for hosting,
backups, release and rollback.

## Requirements

- Node.js 22.13 or newer (uses the built-in `node:sqlite`)
- npm

## Local development

```bash
npm ci                                   # install dependencies from package-lock.json
npm run admin:create -- --username NAME  # create an admin (you are asked for a password)
npm start                                # http://localhost:3000  (PORT=3000 by default)
npm test                                 # run the test suite
```

- Public site: `http://localhost:3000/`
- Admin: `http://localhost:3000/admin/`
- Data (SQLite database and uploaded files) goes to `./data` by default (git-ignored).
  Use `DATA_DIR=/some/path npm start` to change it.
- Forgotten password: `npm run admin:reset-password -- --username NAME`.
- Configuration variables are listed in `.env.example` and in `docs/ARCHITECTURE.md`.

## Project layout

```
server/        Node.js server, database migrations, admin CLI scripts, tests
public/        everything the browser can download (the only folder served as files)
ops/           deployment artefacts: systemd units, Caddyfile, backup and smoke-check scripts
docs/          project documentation (see below)
```

## Documentation

- `docs/DEPLOYMENT.md`: hosting recommendation, production setup, backups, release, rollback
- `docs/ARCHITECTURE.md`: structure, API contract, configuration
- `docs/DECISIONS.md`: decisions log
- `docs/TESTING.md`: test plan and results
- `docs/DESIGN.md`: design specification
- `CLAUDE.md`: how the development team works together
