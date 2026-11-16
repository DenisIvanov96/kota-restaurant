# Deployment

Owned by the DevOps Engineer. Status: **prepared, not deployed.** Nothing in this document has been
run against a real server. Every step that touches an external account, money, DNS or production
is marked **[APPROVAL]** and needs the user's explicit go-ahead.

## 1. What the app needs

Kota1 is a Node.js server (Node ≥ 22.13, Express 5, SQLite via built-in `node:sqlite`). It serves
the public site, `/admin` and the JSON API from one process. All state is in one folder, `DATA_DIR`
(`kota.db` plus `uploads/`).

| Need | Why |
|---|---|
| A long-running Node process | It is a server, not static files. Cannot run on GitHub Pages, Netlify or Cloudflare Pages without a rewrite. |
| Persistent disk for `DATA_DIR` | SQLite file and uploaded menus/photos live there. A platform that wipes disks on redeploy or sleep loses all content. |
| HTTPS | The admin session cookie is `Secure` in production. Admin passwords travel over the wire. |
| A reverse proxy | Only needed for HTTPS and the upload size limit; the app itself speaks plain HTTP. |
| Correct client IPs | Login rate limiting is per IP; `TRUST_PROXY=1` makes it see the real client behind the proxy. |

Traffic is low (a single restaurant), so one small server is enough.

## 2. Hosting options compared

Prices are **approximate ranges from general knowledge, not checked against current price lists.
Re-check every price on the provider's website at signup.** VAT, currency and domain costs
(about €10–20 per year, all options) are not included.

| | **A. VPS + Caddy + systemd (recommended)** | **B. PaaS with a persistent volume** (Fly.io, Render, Railway) | **C. Free VM** (Oracle Cloud "Always Free") |
|---|---|---|---|
| Approx. monthly cost | Smallest 1–2 GB plan from a major EU-region provider (e.g. Hetzner Cloud, DigitalOcean, Vultr): roughly €4–8. Optional provider backup add-on: roughly +20%. | Usage-based. Persistent disk needs a paid tier. Expect roughly $5–15 for this app, and bills drift with usage. | €0 while inside the free limits. Free limits and terms have changed before. |
| Persistent storage | Yes: the VPS disk. Survives reboots and restarts. | Yes, via volumes. Volumes are tied to one machine and region. Render's free tier has **no** persistent disk. | Yes: block volume (limits apply). |
| HTTPS | Caddy gets and renews Let's Encrypt certificates automatically. Needs a DNS record pointing at the server. | Automatic. | Same as A (Caddy). |
| Effort for the owner | None day to day: the owner only uses `/admin`. The **operator** needs SSH and basic Linux once, then about 15 min per release. | Lowest for deploys (dashboard or `git push`). Billing and platform changes are the owner's to watch. | Highest: account verification, possible capacity shortage for ARM machines, and the account can be suspended or the idle VM reclaimed with little warning. |
| Backups | Our `ops/backup.sh` every night, plus an encrypted off-site copy. Provider snapshots optional. | Volume snapshots (limited retention) and/or our script run from a scheduled job. More moving parts. | Same as A, but snapshot quotas are tight. |
| Control and lock-in | Full control; standard Linux; moving provider is easy. | Platform-specific configuration. | Full control, but the provider can end the free plan. |

### Not viable for this app (free or otherwise)
- **GitHub Pages**: static files only. It cannot run the server, the API or the database.
- **Netlify, Cloudflare Pages**: static hosting. Their server functions would need the database to be rewritten (not SQLite).
- **Render free web service**: no persistent disk, and it sleeps when idle. Content would be lost on restart.

### Recommendation: Option A (small EU VPS, Caddy, systemd)
- Cheapest predictable cost, with a persistent local disk included.
- Runs exactly the stack the code expects: one Node process behind one proxy. No platform-specific
  changes and no per-GB or per-request surprises.
- The owner needs no server skills. The operator does the one-off setup and the releases.
- Trade-off: someone must keep the OS patched (`unattended-upgrades` covers security updates) and
  must set up off-site backups. Both are covered below.

**[APPROVAL]** Choosing the provider, creating the account, paying, and adding the domain and DNS
record are the user's decisions. Recommended: create the account in the owner's name, with the
billing contact of the restaurant.

Data protection note: the database holds admin usernames, password hashes and TOTP secrets, and the
access log holds visitor IP addresses. Choose a provider with an EU data centre and a data processing
agreement. Confirm this with the user.

## 3. Production setup (Option A)

### 3.1 Server
Debian 12 or Ubuntu 24.04 LTS, 1–2 GB RAM, 20 GB disk, SSH key login only.

```bash
# Packages: git, Caddy (official repo: https://caddyserver.com/docs/install), unattended security updates
sudo apt update && sudo apt install -y git unattended-upgrades ufw
sudo dpkg-reconfigure -plow unattended-upgrades

# Firewall: allow SSH FIRST, then web. Port 3000 (the app) must stay closed.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

The app listens on all interfaces (port 3000). The firewall must block it from the internet, because
a client that reaches the app directly could forge its IP through `X-Forwarded-For`. Check with
`ss -ltn` (3000 should appear) and an external port scan (3000 closed).

**Node.js 22.13 or newer.** Install the official Node 22 LTS Linux build and make sure the path used in
the unit file exists: `command -v node` and `node -v`. If it is not `/usr/bin/node`, edit
`ExecStart` in `ops/kota-restaurant.service`.

### 3.2 Users, folders, code
```bash
sudo useradd --system --home /var/lib/kota-restaurant --shell /usr/sbin/nologin kota
sudo install -d -o kota -g kota -m 750 /var/lib/kota-restaurant /var/lib/kota-restaurant/data
sudo install -d -o kota -g kota -m 700 /var/backups/kota-restaurant
sudo install -d -o root -g kota -m 750 /etc/kota-restaurant

# Code: owned by root, read-only for the app user.
sudo git clone --branch <release-tag> <repo-url> /opt/kota-restaurant      # [APPROVAL] if the repo is private (deploy key)
cd /opt/kota-restaurant && sudo npm ci --omit=dev
```

### 3.3 Environment file
```bash
sudo cp /opt/kota-restaurant/ops/production.env.example /etc/kota-restaurant/kota.env
sudo chown root:kota /etc/kota-restaurant/kota.env && sudo chmod 640 /etc/kota-restaurant/kota.env
```
Only the values in section 3.5 are needed. No secrets are stored in this file.

### 3.4 Service (process manager)
```bash
sudo cp /opt/kota-restaurant/ops/kota-restaurant.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kota-restaurant
systemctl status kota-restaurant --no-pager
journalctl -u kota-restaurant -n 50 --no-pager     # logs
```
The unit restarts the app on crash and on reboot, and runs it as the `kota` user with restricted
file access.

### 3.5 Environment variables

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables the secure cookie default and disables test hooks. |
| `PORT` | `3000` | Local only, behind Caddy. Keep closed in the firewall. |
| `DATA_DIR` | `/var/lib/kota-restaurant/data` | **Must be absolute** and on persistent disk. |
| `COOKIE_SECURE` | `true` | Session cookie gets `Secure`. Keep `true` for HTTPS. |
| `TRUST_PROXY` | `1` | Exactly one proxy (Caddy) in front of the app. |
| `KOTA_NOW` | *(unset)* | Test hook. Ignored in production; do not set it. |
| `ADMIN_PASSWORD` | *(never in the env file)* | Only for a one-off CLI run, if no terminal is available. |
| `BACKUP_DIR` | `/var/backups/kota-restaurant` | Set in the backup unit. |
| `BACKUP_KEEP_DAYS` | `30` | Set in the backup unit. |
| `BACKUP_AGE_RECIPIENT` | age public key | Optional but recommended. See section 5. |

### 3.6 Reverse proxy with HTTPS (Caddy)
```bash
sudo cp /opt/kota-restaurant/ops/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile          # replace kota.example.com with the real domain
sudo install -d -o caddy -g caddy /var/log/caddy
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
- **Before** starting Caddy, the domain's A (and AAAA) record must point at the server
  **[APPROVAL] DNS change**. Otherwise certificate issuance fails. Caddy retries automatically.
- Upload limit at the proxy is `request_body max_size 20MB`. The app's own limits are 5–15 MB per
  file, so 20 MB covers the largest file plus form overhead.
- Caddy sends `X-Forwarded-For`; `TRUST_PROXY=1` trusts exactly that one hop.

### 3.7 First-time admin account and owner checklist
**Operator** (creates the account; the password is typed on the server, never sent in chat or saved):
```bash
sudo -u kota bash -c 'set -a; . /etc/kota-restaurant/kota.env; set +a; cd /opt/kota-restaurant && npm run admin:create -- --username OWNER_USERNAME'
```
It asks for the password twice (at least 12 characters). The owner then:
1. Opens `https://<domain>/admin/` and logs in. Confirm the padlock is shown.
2. Changes the password from the admin area. If the admin screen does not offer this yet, the
   operator runs the reset command in section 6 with the owner's chosen password.
3. Turns on 2FA (authenticator app, setup key entered manually). Keep the recovery steps in section 6
   in mind.
4. Fills in phone, address, opening hours and currency in the settings.
5. Uploads or publishes the menu and today's daily menu, then checks the public site on a phone.
6. Optionally creates a second admin for backup access (same command, another username).

Checks that need the admin UI (`public/admin/`) to be deployed; the smoke check warns until then.

## 4. Release, smoke check and rollback

### 4.1 Release
Releases are **git tags** on the release commit (`vX.Y.Z`), made only after QA passes.

1. QA verdict PASS on the release commit (`docs/TESTING.md`).
2. **[APPROVAL]** The user approves the release and the deploy.
3. Tag and push the tag (e.g. `git tag -a v1.0.0 -m "..." && git push origin v1.0.0`). Pushing a tag does not change
   the running site. Deploying does.
4. On the server, record the current version (rollback target) and take a backup:
   ```bash
   git -C /opt/kota-restaurant describe --tags --always     # e.g. v0.9.0  <- rollback target
   sudo systemctl start kota-backup.service && journalctl -u kota-backup.service -n 20 --no-pager
   ```
   Do not continue unless the backup log says `backup: done`.
5. Deploy the new tag:
   ```bash
   cd /opt/kota-restaurant && sudo git fetch --tags && sudo git checkout v1.0.0
   sudo npm ci --omit=dev
   git diff --stat v0.9.0 v1.0.0 -- server/migrations       # any new migration? see rollback
   sudo systemctl restart kota-restaurant
   ```
6. Run the smoke check (4.2), then check the site on a phone-width screen (390 px) and desktop (1280 px).

**Database migrations are forward-only.** The app runs new migrations on start. Before every release
make a backup (step 4): it is the only way back if a migration breaks things.

### 4.2 Smoke check
```bash
/opt/kota-restaurant/ops/smoke-check.sh https://<domain>
```
It makes read-only GET requests: the home page, public API (including `Cache-Control: no-store`
and security headers), admin API auth (401 without login), that source files, `.env`, the database
and docs return 404, and that `http://` redirects to `https://`. It exits non-zero on any failure.
Warnings (no favicon yet, `/admin/` missing) do not fail the run.

Also log in to `/admin/` once with a test or the owner's account after each release that touches
the admin.

### 4.3 Rollback
- **Code-only release** (no new migration in the `git diff --stat` output):
  ```bash
  cd /opt/kota-restaurant && sudo git checkout <previous-tag> && sudo npm ci --omit=dev
  sudo systemctl restart kota-restaurant && /opt/kota-restaurant/ops/smoke-check.sh https://<domain>
  ```
- **Release with a migration**: stop the service, restore the backup taken in step 4 (section 5.4),
  then check out the previous tag and start again. Do not rely on an old version running against a
  newer database.
- **Git-history rollback** (if the bad commit is already on `main`): `git revert <bad commit>`, tag a new
  patch version, and deploy it as a new release. History is not rewritten.
  **[APPROVAL]** for any change to `main` or any force-push. Force-pushes are not used.

Rollback is verified by the smoke check, not assumed.

## 5. Backups

`ops/backup.sh` takes a consistent snapshot of the database while the server runs (SQLite
`VACUUM INTO`, checked with `PRAGMA integrity_check`), adds `uploads/`, writes one archive
`kota-<UTC time>.tar.gz` (owner-only permissions), and deletes archives older than `BACKUP_KEEP_DAYS`.

### 5.1 Schedule
```bash
sudo cp /opt/kota-restaurant/ops/kota-backup.service /opt/kota-restaurant/ops/kota-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now kota-backup.timer
systemctl list-timers kota-backup.timer --no-pager     # next run: 03:15 Sofia time
```

### 5.2 Off-site copy (required for real protection)
A backup on the same disk does not protect against a disk failure or a deleted server.
- **Option 1 (zero cost):** the operator downloads the newest archive weekly to a computer
  (`scp`), and deletes old copies when they are no longer needed.
- **Option 2:** copy to a cloud storage account (e.g. rclone). **[APPROVAL]**: a new third-party
  service and possibly a cost.

Encrypt before anything leaves the server (the archive holds TOTP secrets and admin usernames):
```bash
sudo apt install -y age                       # on the server and on the operator's computer
age-keygen -o kota-backup-key.txt             # run on the OPERATOR'S computer, never on the server
# Put the PUBLIC key (the line starting with age1...) into the backup unit:
sudo systemctl edit kota-backup.service       # add: [Service] / Environment=BACKUP_AGE_RECIPIENT=age1...
```
Keep `kota-backup-key.txt` (the private key) somewhere safe off the server, e.g. in a password manager.
Without it the encrypted backups cannot be opened.

### 5.3 Check that backups work (do this once after setup, then monthly)
```bash
sudo systemctl start kota-backup.service
sudo ls -la /var/backups/kota-restaurant
```
Tested locally against the current working tree (not yet on a server): the archive opens, the database passes the integrity
check, and the admin and the `uploads/` folder are present.

### 5.4 Restore
Restoring replaces the live data. Do this only when needed, and keep the broken copy.
```bash
sudo systemctl stop kota-restaurant
# (only if encrypted) on the operator's computer or the server, using the private key:
#   age -d -i kota-backup-key.txt -o kota-restore.tar.gz kota-<stamp>.tar.gz.age
sudo mv /var/lib/kota-restaurant/data /var/lib/kota-restaurant/data.broken-$(date +%Y%m%d%H%M)
sudo install -d -o kota -g kota -m 750 /var/lib/kota-restaurant/data
sudo tar -xzf /var/backups/kota-restaurant/kota-<stamp>.tar.gz -C /var/lib/kota-restaurant/data
sudo chown -R kota:kota /var/lib/kota-restaurant/data
sudo systemctl start kota-restaurant
/opt/kota-restaurant/ops/smoke-check.sh https://<domain>
```
The archive contains `kota.db` and `uploads/` at its top level. Restore also works on a fresh
server: install (section 3), then run the steps above with `data/` created empty.

Restore was tested locally on a copy: the restored database opened, the app started and served the
public API, and an admin login attempt was processed.

## 6. Password reset and 2FA recovery

### 6.1 Forgotten password
Run on the server, as the app user, with the same environment (password typed at the prompt):
```bash
sudo -u kota bash -c 'set -a; . /etc/kota-restaurant/kota.env; set +a; cd /opt/kota-restaurant && npm run admin:reset-password -- --username OWNER_USERNAME'
```
This sets the new password and logs out all existing sessions for that admin. It does **not** change
2FA settings. Tell the owner to log in again.

### 6.2 Lost phone with 2FA (no password reset cures this)
The app has no command to turn 2FA off. Last resort, after a backup:
```bash
sudo systemctl stop kota-restaurant
sudo -u kota node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.argv[1]);
const r = db.prepare("UPDATE admins SET totp_secret = NULL, totp_pending_secret = NULL, updated_at = ? WHERE username = ? COLLATE NOCASE").run(Date.now(), process.argv[2]);
console.log("rows changed:", r.changes);' /var/lib/kota-restaurant/data/kota.db OWNER_USERNAME
sudo systemctl start kota-restaurant
```
Then the owner logs in with the password and sets up 2FA again. Expect `rows changed: 1`. Anything else
means the username was wrong: check it and do not repeat the step blindly.

## 7. Approval checklist (the user must approve each of these)
| # | Step | Why it needs approval |
|---|---|---|
| 1 | Choose the hosting provider and create the account; pay | External account and money |
| 2 | Buy or confirm the domain; create the DNS A/AAAA record | DNS and money |
| 3 | Give the server read access to the repository (deploy key or token) | Repository settings and secrets (only if the repo is private) |
| 4 | Choose and set up off-site backup storage | New third-party service, possible cost |
| 5 | Push the release tag and deploy to production | Production deploy |
| 6 | Merge to `main` (this is a production deploy for the static Pages setup) | Production deploy and repository history |
| 7 | Enable or disable GitHub Pages settings (the old Pages plan is **not** used) | Repository settings |
| 8 | Retention for Caddy access logs (they contain visitor IP addresses) | Personal data policy |

Nothing above has been done.

## 8. Known gaps (for the PM)
- `public/index.html` has no favicon link (`rel="icon"`). The smoke check warns.
- `/admin/` (`public/admin/index.html`) and `daily-menu.html` now exist in the working tree but
  were **not** present when the local smoke run was done. Re-run `ops/smoke-check.sh` against a
  started server before any release; the smoke script does not yet check `/daily-menu` or `/admin/` content.
- The app listens on all interfaces. Only the firewall protects port 3000 (see section 3.1).
- There is no CLI to turn off 2FA; section 6.2 is the manual procedure.
- The public site contains a placeholder phone number (`+1234`).
- The server runs one process; there is no horizontal scaling. This is fine for this traffic.
