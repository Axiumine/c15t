# Contributing

Thank you for helping with the c15t Consent Platform. This guide explains how to report problems, propose
changes, build and test the code, and what a pull request needs to be merged. By taking part you agree to
follow the [Code of Conduct](./CODE_OF_CONDUCT.md). How the project is run is described in
[`GOVERNANCE.md`](./GOVERNANCE.md).

## Quick links

- Found a vulnerability? Do **not** open an issue. Follow [`SECURITY.md`](./SECURITY.md).
- Need help using it? See [`SUPPORT.md`](./SUPPORT.md).
- Design decisions (D1 to D11): [`README.md`](./README.md). Engineering rules: [`CLAUDE.md`](./CLAUDE.md).

## Reporting a bug

1. Search the [existing issues](https://github.com/Axiumine/c15t/issues) first.
2. Open a new issue with the **Bug report** form. Give the version or commit, the component, the exact
   steps to reproduce (a failing test is ideal), what you expected and what happened, your environment
   (Node.js, Yarn, PostgreSQL, operating system, how the services run) and the relevant log lines.
3. Remove passwords, API keys, database URLs and personal data from everything you paste.

## Proposing a change

- Small fixes (a bug, a typo, a missing test) can go straight to a pull request.
- For anything larger, open a **Feature request** issue first, so that the approach can be agreed before
  you invest time. The README decisions (D1 to D11) explain why the design is the way it is. If your idea
  conflicts with one of them, say which and why.
- Keep a pull request focused on one change. Unrelated clean-ups belong in a separate pull request.

## Development setup

Prerequisites: Node.js 26 (see `.nvmrc`), Corepack, and a PostgreSQL 16+ instance for the database-backed
tests.

```bash
npm install -g corepack   # Node 26 does not bundle Corepack
corepack enable           # once per machine; Yarn 4 comes from "packageManager" in package.json
yarn install              # the repository's .yarnrc.yml sets nodeLinker: node-modules
```

The repository uses Yarn 4 workspaces (`apps/*`, `packages/*`). Do not use npm, pnpm or Bun to install,
and do not switch to Plug'n'Play: Vite, drizzle-kit and the c15t CLI need `node_modules`.

| Command | What it does |
|---|---|
| `yarn typecheck` | `tsc -b` over every project reference (sources and tests) |
| `yarn lint` | `biome check .` (formatting, lint rules and import order) |
| `yarn format` | `biome check --write .` fixes what can be fixed automatically |
| `yarn test` | `vitest run` over every workspace |
| `yarn build` | builds every workspace to `dist/` |
| `yarn dev` | consent-api, dashboard-api and the Vite dev server |
| `yarn test:e2e` | Playwright end-to-end tests |
| `yarn spdx` | adds the SPDX header to new source files (`yarn spdx:check` only verifies) |

**Run `yarn typecheck && yarn lint && yarn test` before you open a pull request.**

### Testing changes to `infra/`

The nginx snippets, `update-cloudflare-ips.sh` and `deploy.sh` are shell and nginx configuration, so
`yarn test` does not cover them. Run the matching script when you change them (they are plain scripts, not
yarn commands):

- `infra/test/update-cloudflare-ips.test.sh` runs `infra/nginx/update-cloudflare-ips.sh` against fixtures
  and stand-ins for `curl`, `nginx`, `systemctl` and `nft`. It needs no Docker, no root and no network.
- `infra/test/uninstall.test.sh` runs `infra/deploy.sh install` and `uninstall` against a temporary directory
  tree, with stand-ins for `systemctl`, `nginx`, `nft` and `useradd`. It needs no Docker, no root and no
  network. CI runs it and the previous script.
- `infra/test/nginx-snippet.test.sh` checks the real nginx snippets (`c15t.conf`, the dashboard locations
  and headers) against a throwaway nginx container. It needs Docker Compose, `curl` and `ss`. The container
  is test-only: production has no Docker.
- `infra/deploy.sh --dry-run` prints every deploy step without changing anything.

### Database-backed tests

Most tests need no database server: pure code, the web app with jsdom, the migration tests and the
dashboard-api integration suites against an in-process PGlite database. Two groups use a real
PostgreSQL and never skip silently (a green run must mean the database was exercised, so a missing
variable is an error):

- the consent-api integration tests (`apps/consent-api/src/integration.test.ts`);
- the `postgres` variant of the dashboard-api integration suites (each suite runs once on `pglite` and
  once on `postgres`).

They read this environment contract (Yarn injects it from your local env file; in CI the
`scripts/ci-bootstrap-db.sh` script sets it up):

| Variable | Meaning |
|---|---|
| `DATABASE_URL_C15T` | PostgreSQL URL of role `c15t_api` (owns schema `c15t`), the primary |
| `DATABASE_URL_DASHBOARD` | PostgreSQL URL of role `dashboard` (owns schema `app`, `SELECT` on `c15t.*`), the primary |
| `C15T_ADMIN_API_KEY` | a random string of at least 16 characters, used by the consent-api tests |

Set up a local database with [`docs/database-setup.md`](./docs/database-setup.md) (roles and schemas come
from `infra/postgres/init.sql`), then run `yarn c15t:migrate` and `yarn db:migrate`, and finally
`yarn workspace @consent/consent-api test` (the same for `@consent/dashboard-api`).
Tests only touch rows they created, marked with a run prefix, and clean up after themselves. Use a
disposable database, never a production one.

## Coding standards

- **TypeScript, strict, ESM only.** The base `tsconfig` (`packages/config/tsconfig.base.json`) turns on
  `strict` and the extra safety flags. No `any`, no non-null assertions, `import type` for types.
- **Biome** is the formatter and linter (2 spaces, single quotes, semicolons, trailing commas, 100
  columns). `yarn lint` must pass with no errors.
- **Validate every boundary with zod** (environment, request bodies, params, queries, forms), and return
  errors as `{ error: { code, message } }` without leaking SQL or stack traces.
- **Read the environment in one place per app** (`src/env.ts`). Do not read `process.env` elsewhere and do
  not hard-code addresses or ports.
- **Authorization lives in `apps/dashboard-api/src/authz.ts`.** Every new route needs a guard, and the
  route coverage test fails until it has one. Every query on the `c15t` schema filters by the tenant IDs
  of the session.
- Name things by the domain (`site`, `siteKey`, `member`, `consent`, `subject`).
- Every new hand-written source file starts with the SPDX header. Run
  `yarn spdx` and it adds the header for you:

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 Axiumine
  ```

- More rules, with the reasoning, are in [`CLAUDE.md`](./CLAUDE.md). When your change makes a rule
  obsolete, update the rule in the same pull request.

## Test policy

- **New functionality needs tests**, in the same pull request. A **bug fix needs a regression test** that
  fails without the fix.
- Tests use Vitest (`import { test, expect } from 'vitest'`). Prefer real collaborators over mocks; the
  database layer is tested against a real PostgreSQL or PGlite.
- Every authorization rule needs a test that proves a `user` cannot read another site's data.
- Parsers and validators of untrusted input (hosts, CIDRs, site keys, paths, headers, CSV, cursors) also get
  property-based tests with [fast-check](https://fast-check.dev/) in `*.fuzz.test.ts` files.
- Coverage of the hand-written source is 100% (statements, branches, functions and lines), and CI fails below that
  (`coverage.thresholds` in `vitest.config.ts`). Cover new code with a test that asserts its behaviour. A
  `/* v8 ignore */` is allowed only for a guard the type system rules out, with the reason next to it. Do not
  skip or delete a test to make CI pass.

## Commits and the Developer Certificate of Origin (DCO)

Every commit must be signed off, which certifies that you wrote the change or have the right to submit it
under the project license ([AGPL-3.0-or-later](./LICENSE)). Add the sign-off with `git commit -s`, which
appends this line using your Git name and email:

```
Signed-off-by: Your Name <you@example.com>
```

The sign-off means you agree to the [Developer Certificate of Origin 1.1](https://developercertificate.org/):

> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the right to submit it under the
> open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my knowledge, is covered under an
> appropriate open source license and I have the right under that license to submit that work with
> modifications, whether created in whole or in part by me, under the same open source license (unless I
> am permitted to submit under a different license), as indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person who certified (a), (b) or (c) and I
> have not modified it.
>
> (d) I understand and agree that this project and the contribution are public and that a record of the
> contribution (including all personal information I submit with it, including my sign-off) is maintained
> indefinitely and may be redistributed consistently with this project or the open source license(s)
> involved.

A CI check (`.github/workflows/dco.yml`) fails a pull request that has a commit without a matching
`Signed-off-by:` line whose email is the commit's author or committer. Only `dependabot[bot]` and `github-actions[bot]`, matched by their exact GitHub noreply address (`scripts/check-dco.sh`, tested by `scripts/check-dco.test.mjs`), are exempt; an author name that merely ends in `[bot]` is not. To fix missing sign-offs: `git rebase --signoff origin/main` and force-push your
branch.

Write commit messages in the imperative mood, with a short summary line (about 72 characters) and a body that
explains why the change is needed. Conventional Commits prefixes (`fix:`, `feat:`, `docs:`, `chore:`) are
welcome but not required.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make the change, with tests and documentation, and run `yarn typecheck && yarn lint && yarn test`.
3. Add a line under "Unreleased" in [`CHANGELOG.md`](./CHANGELOG.md) for user-visible changes.
4. Open the pull request and fill in the template. CI must pass: typecheck, lint, tests (including the
   PostgreSQL integration job), build, CodeQL and dependency review.
5. A code owner (see [`.github/CODEOWNERS`](./.github/CODEOWNERS)) reviews the change. Address the
   comments by pushing new commits. We may ask you to rebase.

Changes to authentication, authorization, the trusted-proxy handling, database grants, the release
workflow or the dependencies are reviewed with extra care and may take longer.

## Dependencies

Add a dependency only when it is needed, and follow [`docs/dependency-policy.md`](./docs/dependency-policy.md):
exact version pins, an AGPL-compatible license, and a maintained package. Commit the updated `yarn.lock`.

A new GitHub Action is pinned by its full commit SHA, with a `# vX.Y.Z` comment. The only exception is the
SLSA generator in `release.yml`, which its authors require to be referenced by tag. For that reason the
repository setting "Require actions to be pinned to a full-length commit SHA" must stay off. Dependabot
updates the actions, but not the digest of the PostgreSQL image in `ci.yml`: that is bumped by hand (see
[`docs/dependency-policy.md`](./docs/dependency-policy.md)).

## Releases

Maintainers release in this order:

1. Set `version` in the root `package.json` to `X.Y.Z` (only the root one is read; the workspace packages are private and stay at `0.0.0`).
2. Move the "Unreleased" section of [`CHANGELOG.md`](./CHANGELOG.md) to `## [X.Y.Z] - <date>`.
3. Merge both changes to `main` through a pull request and wait for CI to pass on `main`.
4. Tag that commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The release workflow refuses a tag that differs from the `package.json` version, and a tagged commit that
is not on `main`. If the recommended tag ruleset for `v*` is on (see
[`docs/scorecard.md`](./docs/scorecard.md)), a pushed tag cannot be moved or deleted, so a failed release is
fixed on `main` and released as the next patch version. Do the version bump first.

The release workflow builds the assets, signs them with Sigstore, attaches provenance and an SBOM, and
publishes the GitHub release. The dashboard-web tarball contains `apps/dashboard-web/dist/THIRD-PARTY-NOTICES.md`,
which Vite generates (`build.license`); `scripts/release-package.sh` refuses to pack without it. See [`SECURITY.md`](./SECURITY.md) for how to verify them.

## License of contributions

Your contribution is licensed under the same terms as the project, AGPL-3.0-or-later. There is no
contributor license agreement.
