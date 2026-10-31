<!--
SPDX-License-Identifier: AGPL-3.0-or-later
Copyright (C) 2026 Axiumine
-->

# Installation

How to install, upgrade, roll back and uninstall the platform on one Linux server, in the order you run the
commands. The reasoning behind the layout is in [README D7](../README.md#d7-hosting-cloudflare-then-nginx-then-systemd-no-docker)
and the [Production](../README.md#production) section of the README; this page is the install path, plus the
part the README does not cover: removing everything again. The nginx files and the firewall allowlist are in
[nginx.md](./nginx.md).

The convention is a signed source tarball plus one script, `infra/deploy.sh`, which has the sub-commands
`install`, a plain deploy, `rollback` and `uninstall`. Each one accepts `--dry-run`, which prints every step and
changes nothing. There is no Docker image and no distribution package: the platform runs as two systemd services
behind nginx (README D7).

## What goes where

| On the host | Created by | `uninstall` |
|---|---|---|
| `/opt/c15t-platform/` (`releases/`, `current`, `previous`, `deploy.log`, `.deploy.lock`) | `install` creates the directory, `deploy` fills it | removed |
| `/etc/systemd/system/` units: `c15t-consent-api.service`, `c15t-dashboard-api.service`, `cloudflare-ips.service`, `cloudflare-ips.timer` | `install` | stopped, disabled, removed |
| `/etc/systemd/system/c15t-cloudflare-nft.service` (loads the allowlist at boot) | `install` copies it, you enable it | **kept** while `c15t-cloudflare.nft` exists, removed with `--remove-cloudflare` |
| nginx `conf.d/c15t-upstreams.conf` and `snippets/c15t.conf`, `c15t-dashboard-headers.conf`, `c15t-dashboard-locations.conf` | `deploy` | removed |
| nginx `conf.d/cloudflare-realip.conf` | `cloudflare-ips.service` | **kept** (host-wide), removed with `--remove-cloudflare` |
| `/etc/nftables.d/c15t-cloudflare.nft`, the loaded table `inet c15t_cloudflare` and `/etc/c15t-platform/cloudflare-ufw.sh` | `cloudflare-ips.service` (with `CF_NFT_APPLY=1` or `CF_UFW=1`) | **kept** (host-wide), removed with `--remove-cloudflare` |
| nginx `sites-enabled/c15t-dashboard.conf` (link) | you | link removed |
| nginx `sites-available/c15t-dashboard.conf` | you (it holds your host names and certificates) | **kept**, you remove it |
| `/etc/c15t-platform/consent-api.env`, `dashboard-api.env`, `cloudflare-ips.env` (secrets) | `install` creates the first two empty, you fill them | **kept**, removed only with `--purge-config` |
| The system user `c15t` | `install` | **kept**, `sudo userdel c15t` |
| PostgreSQL: schemas `c15t` and `app`, roles `c15t_api` and `dashboard` | you ([database-setup.md](./database-setup.md)) | **never touched** |
| `include snippets/c15t.conf;` lines in your website vhosts | you | **you remove them first** (see "Uninstall") |

## Requirements

- A Linux server with systemd, nginx 1.25.1 or newer (the examples use the Debian and Ubuntu `/etc/nginx` layout; see "Then, once" below for others), `bash` 4.4 or newer, `flock`, `tar`, `curl`, `sudo` (or root).
- Node.js 26 at `/usr/bin/node`, and Yarn 4 through Corepack: `npm install -g corepack && corepack enable`.
  The build downloads the dependencies from the npm registry, pinned by `yarn.lock`.
- A PostgreSQL database prepared as described in [database-setup.md](./database-setup.md), reachable from the server.
- To verify a release: `cosign` 3.x, `sha256sum` (GNU coreutils), optionally `slsa-verifier`.

## Get and verify a release

Every release on [GitHub](https://github.com/Axiumine/c15t/releases) has these assets (for version `X.Y.Z`):

| Asset | What it is |
|---|---|
| `c15t-platform-X.Y.Z-source.tar.gz` | the tagged source tree. **This is what you install.** |
| `c15t-platform-X.Y.Z-consent-api.tar.gz`, `-dashboard-api.tar.gz`, `-dashboard-web.tar.gz` | compiled output of each app (for inspection; `deploy.sh` builds from the source) |
| `c15t-platform-X.Y.Z-<app>.cdx.json` | CycloneDX 1.6 SBOM of each app |
| `SHA256SUMS` | checksums of all the files above |
| `<asset>.sigstore.json` | the keyless cosign signature, certificate and transparency log entry of each asset |
| `multiple.intoto.jsonl` | SLSA provenance of all of them |

They are built by [`.github/workflows/release.yml`](../.github/workflows/release.yml) from a tag on `main` and signed
with the workflow's identity, so the signature proves which workflow and tag produced the file.

```bash
VERSION=0.2.0
BASE=https://github.com/Axiumine/c15t/releases/download/v$VERSION
mkdir c15t-release && cd c15t-release
for f in c15t-platform-$VERSION-source.tar.gz c15t-platform-$VERSION-source.tar.gz.sigstore.json SHA256SUMS multiple.intoto.jsonl; do
  curl -fsSLO "$BASE/$f"
done

# 1. The signature: made by release.yml, for exactly this tag, through GitHub's OIDC issuer.
cosign verify-blob \
  --bundle c15t-platform-$VERSION-source.tar.gz.sigstore.json \
  --certificate-identity "https://github.com/Axiumine/c15t/.github/workflows/release.yml@refs/tags/v$VERSION" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  c15t-platform-$VERSION-source.tar.gz
# Any release tag of this repository, instead of one exact version:
#   --certificate-identity-regexp '^https://github\.com/Axiumine/c15t/\.github/workflows/release\.yml@refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$'

# 2. The checksum (only the files you downloaded are checked).
sha256sum --check --ignore-missing SHA256SUMS

# 3. Optional: the SLSA provenance.
slsa-verifier verify-artifact c15t-platform-$VERSION-source.tar.gz \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/Axiumine/c15t --source-tag v$VERSION
```

`cosign verify-blob` prints `Verified OK`. Stop if any of the three commands fails. Then unpack:

```bash
tar -xzf c15t-platform-$VERSION-source.tar.gz
cd c15t-platform-$VERSION-source
```

You can also `git clone --branch vX.Y.Z https://github.com/Axiumine/c15t.git`; `deploy.sh` then deploys the
committed files of the checked-out ref. Only the tarball gives you a signature to check.

## Install

Run the following as a user with `sudo` rights (or as root), from the unpacked source tree. Use the same
`C15T_*` overrides (see the header of `infra/deploy.sh`) in every command if your layout differs from the default.

```bash
# 1. Host preparation: the c15t user, /etc/c15t-platform (0750) with two empty 0600 env files,
#    /opt/c15t-platform, the unit files, daemon-reload, enable. Safe to repeat. Starts no service (only the
#    weekly Cloudflare refresh timer is enabled and started; it has nothing to run before the first deploy).
#    It never overwrites an env file and never changes a directory that already exists.
infra/deploy.sh install --dry-run
infra/deploy.sh install

# 2. Fill in the two env files (README "Configuration"). Both must set the bind address and port.
sudoedit /etc/c15t-platform/consent-api.env      # CONSENT_API_HOST, CONSENT_API_PORT, DATABASE_URL_C15T, C15T_ADMIN_API_KEY, ...
sudoedit /etc/c15t-platform/dashboard-api.env    # DASHBOARD_API_HOST, DASHBOARD_API_PORT, DATABASE_URL_DASHBOARD, BETTER_AUTH_SECRET, BETTER_AUTH_URL, ...

# 3. The database: roles, schemas, grants (docs/database-setup.md). It must exist before the first deploy,
#    because the deploy runs the migrations.

# 4. First deploy: builds the release, runs the migrations, installs the nginx upstreams and snippets,
#    switches `current`, reloads nginx, starts both services and checks their health.
C15T_RELEASE_ID=$VERSION infra/deploy.sh --dry-run
C15T_RELEASE_ID=$VERSION infra/deploy.sh
```

`C15T_RELEASE_ID` names the release directory. Without it, a tree that is not a git checkout gets a UTC timestamp.

`install` refuses a `C15T_APP_DIR`, `C15T_ENV_DIR` or `C15T_SYSTEMD_DIR` that is relative, contains `..` or is only
one level deep, a `C15T_SERVICES` entry that does not start with `c15t-`, and a `DRY_RUN` other than `0` or `1`
(`DRY_RUN=true` would otherwise mean "not a dry run").

Then, once:

1. Create the first admin (README, "2. Database": `yarn admin:create --email you@example.com`, run from the source tree).
2. Add the dashboard vhost and test nginx ([nginx.md](./nginx.md)):
   ```bash
   sudo cp infra/nginx/dashboard.conf /etc/nginx/sites-available/c15t-dashboard.conf   # edit the per-host lines
   sudo ln -s ../sites-available/c15t-dashboard.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
   If your `/etc/nginx` has no `sites-available` and `sites-enabled` (they are a Debian and Ubuntu convention), copy
   the file to `/etc/nginx/conf.d/c15t-dashboard.conf` and skip the `ln`. First check that `nginx.conf` contains
   `include /etc/nginx/conf.d/*.conf;`: `deploy.sh` needs that directory loaded for `c15t-upstreams.conf` too. (The
   RHEL family and Fedora ship it; if your nginx uses another directory, add the include.) `uninstall` does not
   remove that copy; delete it before you run `uninstall` (step 2 of "Uninstall"), or `nginx -t` fails and it puts
   everything back.
3. Add each website (README, "Adding a website"): its vhost gets `set $c15t_site <siteKey>;` and `include snippets/c15t.conf;`.
4. Optional but recommended: the Cloudflare firewall allowlist and its boot unit ([nginx.md](./nginx.md)).

## Setting up by hand

`infra/deploy.sh install` (step 1 of "Install") runs steps 1 to 3 of the list below for you. The same commands by hand:

One-time setup on the server (files are in `infra/`):

```bash
# 1. User and directories
sudo useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin c15t
sudo install -d -o c15t -g c15t -m 0750 /etc/c15t-platform
sudo install -d -o "$USER" -m 0755 /opt/c15t-platform          # deploy.sh writes releases/ and current here

# 2. Service env files (README "Configuration"). Both MUST set the bind address and port explicitly:
#    consent-api.env:   CONSENT_API_HOST, CONSENT_API_PORT, DATABASE_URL_C15T, C15T_ADMIN_API_KEY, ...
#    dashboard-api.env: DASHBOARD_API_HOST, DASHBOARD_API_PORT, DATABASE_URL_DASHBOARD, BETTER_AUTH_SECRET, BETTER_AUTH_URL, ...
#    (C15T_ADMIN_API_KEY and CONSENT_API_URL: leave them out of dashboard-api.env, they are reserved and unused today)
sudo install -m 0600 -o c15t -g c15t /dev/null /etc/c15t-platform/consent-api.env     # then edit
sudo install -m 0600 -o c15t -g c15t /dev/null /etc/c15t-platform/dashboard-api.env   # then edit

# 3. systemd units (re-copy them when infra/systemd changes; deploy.sh warns about drift)
sudo cp infra/systemd/*.service infra/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable c15t-consent-api c15t-dashboard-api
sudo systemctl enable --now cloudflare-ips.timer

# 4. First deploy. It installs the nginx upstreams and snippets, migrates, switches `current`,
#    reloads nginx and starts both services.
infra/deploy.sh
```

The first `infra/deploy.sh` also starts `cloudflare-ips.service` once, because the real_ip file `cloudflare-realip.conf` is still missing and the unit runs its script from `current/`, which only exists after the first switch. So do not start that unit by hand before the first deploy. The unit creates `/etc/nftables.d` itself. After the first deploy, install the dashboard vhost and test nginx (see [nginx.md](./nginx.md)), and read there how to keep the firewall allowlist across reboots.

The database must already exist (README, "2. Database") when you run the first deploy, because it runs the migrations. The first admin is created like in README, "2. Database", from a checkout, with `DATABASE_URL_DASHBOARD`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` exported (the CLI needs only these three).

## Upgrade

```bash
# Verify and unpack the new release as above, then, from the new source tree:
NEW_VERSION=X.Y.Z
infra/deploy.sh install                         # only matters when infra/systemd changed; it copies the changed units
C15T_RELEASE_ID=$NEW_VERSION infra/deploy.sh --dry-run
C15T_RELEASE_ID=$NEW_VERSION infra/deploy.sh    # build, migrate, switch, reload, restart, health check
```

`deploy.sh` also warns about a unit file that differs from `infra/systemd`. `install` replaces such a unit, with a
warning, and keeps the previous copy as `<unit>.c15t-saved` so an edit of yours is not lost; put local changes in a
drop-in (`systemctl edit <unit>`), which `install` and `uninstall` never touch. Migrations run before the switch and
are **not** reverted by a rollback, so the release notes of a version say whether it needs anything special. A
failed build, migration or `nginx -t` changes nothing that is running; a failed health check puts the previous
release and nginx files back. The newest 5 releases are kept (`C15T_KEEP_RELEASES`).

## Roll back

```bash
ls /opt/c15t-platform/releases        # the releases that are kept
infra/deploy.sh rollback              # switch back to the previous release
infra/deploy.sh rollback 0.1.0        # or to a named one
```

## What a deploy does

Every later deploy is `infra/deploy.sh`, run by a user with sudo rights (or root):

```bash
infra/deploy.sh                 # build + migrate + switch + reload + restart + health check
infra/deploy.sh --dry-run       # print every step and the rendered nginx upstreams, change nothing
infra/deploy.sh --plan-only     # build, show `yarn c15t:plan`, stop. Review it, then run a normal deploy
infra/deploy.sh rollback        # switch back to the previous release (or: rollback <release id>)
```

- **Source:** `git archive` of `C15T_REF` (default `HEAD`), so only committed files are deployed. The release is named after the short sha (a UTC timestamp when the tree is not a git repository).
- **Order:** `yarn install --immutable`, `yarn build`, a check that the three build outputs exist, then `yarn c15t:plan` (shown), `yarn c15t:migrate` and `yarn db:migrate` against the primary. Only after that does it install the nginx files, run `nginx -t`, switch `current` atomically, reload nginx, restart both services and health-check them (`/status` on consent-api, `/api/health` on dashboard-api, each for up to 45 s).
- **Failure handling:** a failed build, migration or `nginx -t` changes nothing that is running. A failed health check puts the previous `current` and the previous nginx files back and restarts the services. Database migrations are **not** reverted, so write them to work with the release that is still running (add first, remove in a later release).
- **Secrets:** the `0600` env files are read through `sudo` and parsed, never executed. Their variables are exported only into the migration commands, and nothing secret is printed. Host and port for nginx and the health checks come from these files too, and `deploy.sh` refuses to guess them.
- **Keeps** the 5 newest releases (`C15T_KEEP_RELEASES`), and always `current` and `previous`.
- Other layouts, and testing: `C15T_ROOT`, `C15T_APP_DIR`, `C15T_ENV_DIR`, `C15T_NGINX_DIR`, `C15T_SRC_DIR`, `C15T_SUDO`, `C15T_SERVICES`, `CONSENT_API_HEALTH_PATH`, `DASHBOARD_API_HEALTH_PATH`. See the header of `infra/deploy.sh`.
- The units are hardened (no capabilities, `ProtectSystem=strict`, a system call filter) and run with `TZ=UTC`, because c15t stores timestamps without a time zone. Each service hides `/etc/c15t-platform` from itself, so keep a database CA bundle elsewhere (for example `/etc/ssl/c15t/`). Check a unit with `systemd-analyze security c15t-consent-api`. The `cloudflare-ips` unit runs as root with the same kind of sandbox, but `/run` is writable for it, because `nginx -t` opens `/run/nginx.pid` read-write even in test mode.

## Uninstall

Uninstalling removes the application, its services and the nginx files the platform added. It **never touches
PostgreSQL**: consent records are legal proof, so removing them is a separate decision (below). It also **keeps the
Cloudflare real_ip file and the nftables allowlist** unless you ask for `--remove-cloudflare`, because they are
host-wide: other websites on the same server may rely on them.

1. **Back up first.** The cluster's backups should already cover the database (README D9). For a dump you control:
   ```bash
   pg_dump --format=custom --schema=c15t --schema=app --file=c15t-platform-$(date +%F).dump "$PRIMARY_ADMIN_URL"
   ```
2. **Take the platform out of your own nginx files.** Delete the `include snippets/c15t.conf;` and
   `set $c15t_site ...;` lines from every website vhost, and disable the dashboard vhost if you did not use
   `sites-enabled/c15t-dashboard.conf`. Find them with `grep -rn 'snippets/c15t' /etc/nginx`. `uninstall` deletes
   the snippets, tests nginx and, if a vhost still includes one, puts everything back and lists the files to fix.
3. **See what will happen**, then run it:
   ```bash
   infra/deploy.sh uninstall --dry-run
   infra/deploy.sh uninstall
   ```
   The order is: nginx files (moved away, `nginx -t`, deleted and reloaded only if the test passes), then the
   services and timer (stopped, disabled, unit files deleted, `daemon-reload`), with `--remove-cloudflare` the
   nftables table and its file, `/opt/c15t-platform`, and with `--purge-config` the env files. It checks first and
   changes nothing when a check fails: it refuses to run while a deploy holds the lock, when a c15t service runs
   without a unit file in the systemd directory (it would delete `/opt` under it), when a path setting
   (`C15T_APP_DIR`, `C15T_ENV_DIR`, `C15T_NGINX_DIR`, `C15T_SYSTEMD_DIR`, `C15T_NFT_DIR`) is relative, contains `..`
   or is only one level deep, when `C15T_SERVICES` names anything but `c15t-*` units, and when `DRY_RUN` is
   neither `0` nor `1`. It deletes inside `/opt/c15t-platform` only what `deploy.sh` makes (and only if
   `.deploy.lock`, `deploy.log` or a `releases/*/.release-ok` proves that it made the directory), never follows a
   symlink out of it, and never deletes a dashboard vhost that is a regular file in `sites-enabled` (it stops at
   `nginx -t` and tells you). If it is interrupted, or killed and run again, the nginx files are put back. It can
   be run again after any failure: a second run finds nothing and changes nothing.

   | Option | Effect |
   |---|---|
   | `--dry-run` | print every step, change nothing |
   | `--purge-config` | also delete `consent-api.env`, `dashboard-api.env` and `cloudflare-ips.env` in `/etc/c15t-platform`. They hold secrets. Keep them if you will reinstall against the same database |
   | `--remove-cloudflare` | also remove the `cloudflare-realip.conf` file, unload the nftables table `inet c15t_cloudflare` and delete its file, `c15t-cloudflare-nft.service` and `cloudflare-ufw.sh`. **Effect on the whole host:** ports 80 and 443 are no longer limited to Cloudflare (anyone can reach the origin directly), and nginx no longer restores the visitor IP from `CF-Connecting-IP`, so every site's logs and rate limits see a Cloudflare address. Use it only when no other site relies on them. Without this flag the files stay, and `uninstall` lists them at the end |

   Without `--remove-cloudflare` the refresh timer is still removed (it runs a script from `/opt/c15t-platform/current`),
   so the kept Cloudflare lists are no longer updated. Cloudflare adds ranges now and then, and a range missing from
   the allowlist blocks real visitors: keep the lists current yourself, or run `infra/deploy.sh uninstall
   --remove-cloudflare` later, from the same source tree, when no site needs them.

4. **Clean up what `uninstall` leaves on purpose.** It prints this list at the end:
   ```bash
   sudo userdel c15t                                          # the service user (and its group)
   sudo rm /etc/nginx/sites-available/c15t-dashboard.conf     # your per-host copy of the dashboard vhost
   sudo rm -r /etc/c15t-platform                              # if you did not use --purge-config and no longer need the secrets
   ```
   A unit you edited and `install` replaced is left as `/etc/systemd/system/<unit>.c15t-saved`; delete it when you
   no longer need it.
   Also remove the `include "/etc/nftables.d/*.nft"` line from `/etc/nftables.conf` if you added it, and any `ufw`
   rules you created from `cloudflare-ufw.sh` (`ufw status numbered`, then `ufw delete <n>`).

### Removing the data (optional, irreversible)

Only when you are sure the consent records are no longer needed, for example because they are exported and
archived for their retention period. As a PostgreSQL administrator, on the primary:

```sql
-- A database that held only this platform:
DROP DATABASE consent_dev;                 -- use the name you gave init.sql
DROP ROLE c15t_api, dashboard;

-- Or, in a shared database, connected to it:
DROP SCHEMA c15t CASCADE;
DROP SCHEMA app CASCADE;
DROP OWNED BY c15t_api, dashboard;         -- their remaining grants and default privileges
DROP ROLE c15t_api, dashboard;
```

Also delete the `pg_hba` entries for the two roles from the Patroni configuration.

## If something goes wrong

| Symptom | Fix |
|---|---|
| `install` or `uninstall`: `cannot run privileged commands` | Run as root, or make `sudo` work for your user. |
| `uninstall`: `nginx -t rejects the configuration without the c15t files` | A vhost still includes a c15t snippet. The message lists the files. Remove those lines and run `uninstall` again. Nothing was changed. |
| `uninstall`: `nginx -t already fails before uninstall changed anything` | Your nginx configuration is broken independently of this platform. Fix it, then run `uninstall` again. |
| `uninstall`: `a deploy ... is running and holds .../.deploy.lock` | Wait for the deploy to finish, then run it again. |
| `uninstall`: `<unit> is running, but its unit file is not in ...` | The service was started from a unit file somewhere else. Stop it (`systemctl stop <unit>`) or point `C15T_SYSTEMD_DIR` at the directory that holds its unit file, then run `uninstall` again. Nothing was changed. |
| `uninstall`: `<path> is a regular file, not a link to sites-available` | You copied the dashboard vhost into `sites-enabled` instead of linking it. `uninstall` never deletes it, because it may be your only copy: move or remove it yourself, then run `uninstall` again. |
| `uninstall`: `kept the contents of ...` | `C15T_APP_DIR` holds none of the files `deploy.sh` creates, so it was left alone. Use the same value you used for the deploy. |
| `DRY_RUN must be 0 or 1` | Use `--dry-run`, or `DRY_RUN=1`. Words such as `true` are refused on purpose: they would run the command for real. |
| `uninstall`: `could not stop and disable <unit>` | `/opt` and the unit files are still in place. Look at `systemctl status <unit>`, fix it, run `uninstall` again (the nginx files are already gone; that step is skipped). |
| `refusing to uninstall: C15T_APP_DIR ... ` | The variable points at a path that is too short or relative. Use the same value you used for the deploy. |
| First deploy: `CONSENT_API_HOST is not set in ...` | The env file is still empty. Fill it in (step 2 of "Install"). |
