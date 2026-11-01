# End-to-end tests (Playwright)

The suite in `e2e/` runs the real stack in Chromium: the built dashboard-web (`vite preview`),
dashboard-api, consent-api, the real database, and, for the website scenario, the nginx test container
from `infra/test`. It is part of the hardening phase in README "Status and what is next".

## What it covers

| File | Scenario |
|---|---|
| `e2e/auth-roles.spec.ts` | Admin bootstrap with the `yarn admin:create` code path. Forced password change blocks every other screen (UI and API). The admin creates two sites and two users, and each one-time password is shown once. User A sees site 1 only: site 2 and `/admin/*` are not found or forbidden in the UI and return 404 or 403 from the API. Banning user A ends their access at the next call. The audit log shows the actions. Sign-out invalidates the session on the server. |
| `e2e/consent-flow.spec.ts` | A test website behind an nginx vhost (site key set by nginx, README D1). The banner appears, "Accept All" and "Reject All" return 2xx through nginx, and the rows exist for the right tenant. Each assigned user sees only their own list, stats and CSV. A direct request with spoofed `X-Forwarded-For` or `CF-IPCountry` from an untrusted peer is ignored, and the same headers through nginx are honoured. A wrong `Host`, an unknown site and a path traversal are refused. Disabling a site stops its banner at once and keeps its records. |
| `e2e/headers-robots.spec.ts` | `robots.txt`, the robots meta tag, `X-Robots-Tag` and `Cache-Control` on every API answer, no inline script, a strict CSP, and the app running under it without a violation. It includes a negative control that proves the violation watcher works. |
| `e2e/a11y.spec.ts` | axe-core (WCAG 2.0 to 2.2 A and AA plus best practices) on 9 screens: login, sites list, site overview, admin users, consent records, site setup, manage sites, audit log, account. Each runs in light, dark, phone light and phone dark (390 px). It asserts zero serious or critical violations and no sideways page scroll. |

Every browser context also runs the **hygiene watcher** (`e2e/support/instrument.ts`). It applies the
CSP from `infra/nginx/dashboard-headers.conf` to the dashboard's HTML (`vite preview` sends none), and
it fails the test on a CSP violation, an inline `<script>` or an uncaught exception on any screen the
test visited.

## Prerequisites

- Node 26 and Yarn 4 (see the README), and `yarn install`.
- The Chromium that matches the pinned Playwright: `yarn playwright install chromium`. Browser binaries
  are never committed.
- A migrated PostgreSQL: the root env file must define `DATABASE_URL_DASHBOARD` (role `dashboard`),
  `DATABASE_URL_C15T` (role `c15t_api`), `BETTER_AUTH_SECRET` and `C15T_ADMIN_API_KEY`. Run
  `yarn db:migrate` and `yarn c15t:migrate` once. The roles do not need to create schemas.
- Docker with Compose, for the website scenario only. It uses `infra/test/compose.yaml` (the only Docker
  in the repo) and the `nginx:stable-alpine` image.

## Running

```bash
yarn test:e2e                                   # everything
yarn test:e2e e2e/consent-flow.spec.ts          # one scenario (a file)
yarn test:e2e -g "banning user A"               # one test, by title
yarn test:e2e --headed --workers=1              # watch it
yarn playwright show-trace test-results/artifacts/<test>/trace.zip   # after a retry
```

Always start it with `yarn` (`yarn test:e2e` or `yarn playwright ...`): Yarn injects the root env file
(`injectEnvironmentFiles`) and the config stops at once, naming the missing variable, when it is not
there. Nothing prints an environment value.

Without Docker, run the other three files: `yarn test:e2e e2e/auth-roles.spec.ts e2e/headers-robots.spec.ts e2e/a11y.spec.ts`.

## How a run is isolated

- **Run id.** `playwright.config.ts` makes one id, `e2e-<8 hex>`, in the runner process and passes it to
  workers and servers through `E2E_RUN_ID`. Every site key, hostname, email and tenant id a run creates
  starts with `<run id>-` (and then a scenario tag and the worker index, so parallel workers never clash).
- **Ports.** The runner picks four free ports (consent-api, dashboard-api, `vite preview`, nginx) between
  20000 and 32000 and proves each free by binding it. They reach the servers as `CONSENT_API_PORT`,
  `DASHBOARD_API_PORT`, `DASHBOARD_WEB_DEV_PORT` and `NGINX_TEST_PORT`. Addresses come from the loopback
  interface; no port or address is written in the code. The servers are started with their binaries, not
  through `yarn run`, because Yarn's injected env file would override these values.
- **Dashboard origin.** `BETTER_AUTH_URL` is set to the origin the browser uses (the preview server).
- **Trusted proxy.** consent-api trusts only a second loopback address, which the test nginx binds as its
  source address (`proxy_bind`). The test client connects from the first one, so it is an untrusted peer.
- **Cleanup.** The global teardown removes the nginx container, then deletes the rows of this run id (users
  with their sessions and memberships, sites, and the c15t rows of those tenants), using `starts_with` on
  the full run id inside one transaction. It never truncates or drops. `app.admin_audit` is append-only by
  design, so a run's audit rows (which hold only run-prefixed names) stay.
- **Sign-in rate limit.** Better Auth limits sign-ins per client address, and the database remembers the
  counters. Each browser context therefore sends its own random `X-Forwarded-For` (198.18.0.0/15), as nginx
  does in production. The addresses are recorded and their counters deleted in the teardown.
- **Scratch files.** `test-results/runtime/<run id>/` (the built SPA, the test site, the compose env file).
  It is git-ignored and removed by the teardown. Failure artifacts go to `test-results/artifacts/`.

If a run is killed (SIGKILL) its teardown does not run. Remove its container with
`docker compose -p c15t-<run id> -f infra/test/compose.yaml down` (set the variables the compose file
requires, for example from `test-results/runtime/<run id>/nginx.env`), and delete its rows by that run id.

## The nginx test container

`infra/test/compose.yaml` has two additions for this suite, inert for manual use: the template
`infra/test/nginx/templates/c15t-e2e-sites.conf.template` defines two website vhosts whose hostname and site
key come from `NGINX_TEST_SITE_A_HOST/KEY` and `NGINX_TEST_SITE_B_HOST/KEY`, serving the static directory
`NGINX_TEST_SITE_DIR`. `NGINX_TEST_PROXY_BIND` sets nginx's source address towards consent-api. The vhosts
use the real `infra/nginx/c15t.conf` snippet (`set $c15t_site <key>; include snippets/c15t.conf;`).

The compose project is named `c15t-<run id>`, so two runs, or someone's manual `docker compose up`,
never collide. Chromium resolves `*.test` to the loopback address with `--host-resolver-rules`.

## Writing tests

- Use roles and labels only. No sleeps: wait for a locator or poll with `expect.poll`.
- Import `test` and `expect` from `e2e/support/fixtures.ts`. It adds `rt` (the run), `scope(label)`
  (this worker's names), `openVisitor()` (another instrumented browser context) and the automatic
  `hygiene` check.
- Shared state means `test.describe.serial`. Create contexts that must outlive one test in `beforeAll`
  with `openVisitorContext` and close them with `closeVisitor`.
- New data must come from `scope(...)` so the teardown can find it. Never write a literal key or email.
- Each new `.ts` file starts with the SPDX header. `yarn biome check e2e playwright.config.ts` and
  `yarn tsc -b tsconfig.tools.json` must stay clean.

## Findings the suite caught

All three were fixed. The tests that found them stay as regression tests.

- The setup code blocks (`<pre>`) scrolled sideways at phone width with no keyboard access. They are now
  focusable regions (`copy-button.tsx`).
- The "Show" link in the audit log used `text-primary` on the dark card (about 3.2:1). It uses the
  `--link` token now (`audit-table.tsx`, `styles.css`).
- A page with no declared categories records only `necessary`, because c15t v3 infers categories from
  the page's scripts. The Setup screen's script tag and the README now carry
  `data-categories="measurement,marketing"`. The test website page is built from that very tag
  (`GET /api/sites/:siteKey`, `setup.scriptTag`), and the consent test asserts that "Accept All" stores
  `measurement` and `marketing`.
