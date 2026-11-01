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

`yarn install` also installs the Git hooks (lefthook: Biome, SPDX and size caps before a commit, the DCO sign-off
check on the message, the full gate set before a push). They are optional and CI runs the same checks: see
[`docs/quality-gates.md`](./docs/quality-gates.md) for the order and how to skip one run. fnm and mise read
`.nvmrc` if you want a Node version manager.

The repository uses Yarn 4 workspaces (`apps/*`, `packages/*`). Do not use npm, pnpm or Bun to install,
and do not switch to Plug'n'Play: Vite, drizzle-kit and the c15t CLI need `node_modules`.

| Command | What it does |
|---|---|
| `yarn typecheck` | `tsc -b` over every project reference (sources and tests) |
| `yarn lint` | `biome check .` (formatting, lint rules and import order) |
| `yarn lint:eslint` | ESLint, the zero-findings gate next to Biome (type-aware, security and complexity rules); run `yarn typecheck` first |
| `yarn format` | `biome check --write .` fixes what can be fixed automatically |
| `yarn test` | `vitest run` over every workspace |
| `yarn test:coverage` | the same with the 100% coverage gate (what CI and the pre-push hook run) |
| `yarn build` | builds every workspace to `dist/` |
| `yarn dev` | consent-api, dashboard-api and the Vite dev server |
| `yarn test:e2e` | Playwright end-to-end tests |
| `yarn spdx` | adds the SPDX header to new source files (`yarn spdx:check` only verifies) |
| `yarn semgrep` | Semgrep static analysis with the registry rule sets (needs `semgrep`, see [`docs/security-scanning.md`](./docs/security-scanning.md); skipped with a message when it is not installed) |
| `yarn trivy` | Trivy scan of the lockfiles, secrets and misconfigurations (needs `trivy`, same document and same skip rule) |
| `yarn qodana` | JetBrains Qodana (advisory; needs `QODANA_TOKEN`, Docker and the Qodana CLI, otherwise it refuses to run; see the paragraph on `yarn qodana` below) |
| `yarn knip` | unused files, exports, types and dependencies |
| `yarn type-coverage` | `any` and unsafe type assertions, per tsconfig project |
| `yarn fta` | maintainability score of each source file |
| `yarn code-caps` | size and shape caps with a ratchet baseline |
| `yarn test:scripts-coverage` | the `node:test` suites of `scripts/check-code-caps.ts` (with `scripts/code-caps/`) and `scripts/git-hooks.mjs`, with a 100% coverage gate |
| `yarn mutation` | StrykerJS mutation testing, incremental, no database (PGlite only); weekly in CI on the self-hosted runners, not a pull-request check or a pre-push step (see [`docs/quality-gates.md`](./docs/quality-gates.md#mutation-testing-strykerjs)) |

**Run `yarn typecheck && yarn lint && yarn lint:eslint && yarn test` before you open a pull request.** ESLint and the
four analysers below are part of the same gate: they all pass on the current code, so a failure is yours.
CI also runs the "Security scan" workflow (Semgrep and Trivy, `yarn semgrep` and `yarn trivy` locally); a finding needs a fix
or a documented suppression, see [`docs/security-scanning.md`](./docs/security-scanning.md).

### ESLint

Biome formats the code and runs the fast lint rules; ESLint (`eslint.config.mjs`) adds what Biome cannot do:
typescript-eslint `strictTypeChecked` (it uses the type information of each workspace, tests included),
`eslint-plugin-sonarjs`, `eslint-plugin-security` and `eslint-plugin-no-unsanitized`, plus size caps
(cyclomatic complexity 10, 50 lines per function, 500 lines per file, 4 parameters, depth 4). The React hooks
rules are not duplicated: Biome already checks them. `yarn lint:eslint` runs with `--max-warnings 0` and keeps its
cache in `node_modules/.cache/eslint/`; it needs the declaration files of the other workspaces, so run
`yarn typecheck` (or `yarn build`) first in a fresh checkout. Every rule is an error, so a finding is either
fixed or, only when the rule is a proven false positive, silenced on that line with
`// eslint-disable-next-line <rule> -- <reason>`. There are no file-wide or rule-wide disables, and the
security rules stay on in tests. Test files may exceed the length caps and use async mocks without `await`
(see the test override in `eslint.config.mjs`).

### Static analysers

**`yarn knip`** ([knip](https://knip.dev/), `knip.json`) fails for a file, export, exported type or
dependency that nothing uses. It finds the entry points itself (`package.json` scripts, `exports`, the Vite,
Vitest, Playwright and drizzle configs, test files, the TanStack route files); `knip.json` lists only the
few it cannot see (files started by path from a script or a test). Fix a failure by deleting the dead code or
dependency, or by dropping the `export` when the symbol is only used in its own file. Do not export a symbol
just for a test, and do not add an ignore: if knip is wrong, add the entry file to `knip.json`.

**`yarn type-coverage`** ([type-coverage](https://github.com/plantain-00/type-coverage), threshold and ignored
generated files in the `typeCoverage` field of `package.json`, run by `scripts/type-coverage.mjs`) needs 100%
of the expressions in every tsconfig project to have a type that is not `any`, in strict mode (also `any` in
type arguments, `Object`, `{}`, and `as` / `!` assertions). Fix a failure with a real type, a type guard or
`fieldOf` from `@consent/shared`, not with a cast. If a library types something as `any`, wrap it once in a
small typed function. There are two documented relaxations, both in `scripts/type-coverage.mjs`: test and
tooling projects may use assertions to build test doubles, and dashboard-web and the Playwright specs ignore
`any` in type arguments (TanStack Router and `APIResponse` default some to `any`).

**`yarn fta`** ([FTA](https://ftaproject.dev/), `fta.json`) scores every source file; a higher score is worse
(50 and below is "OK", 50 to 60 "Could be better", above 60 "Needs improvement"). It exits non-zero and names
the first file above `score_cap`. The cap is 50, the upper end of the "OK" band: no hand-written file may score
higher, and a change that pushes a file over it must split that file. Tests, generated files and build output are excluded. The score falls with fewer lines and
less Halstead volume, so the fix is to split a file into smaller modules, not to compress it. Run
`yarn fta --score-cap 1000` to see the whole table (the worst file scores about 49).

**`yarn code-caps`** (`scripts/check-code-caps.ts`, whose parts are in `scripts/code-caps/`) caps a file at 500 lines, a function at 50, a class at 300,
a function at 4 parameters and control-flow nesting at depth 4, for the TypeScript under `apps/*/src`,
`packages/*/src` and `scripts/`. Test files (and `src/test`, `src/testing`) only count towards the file cap,
because their bodies are nested `describe`/`test` callbacks. The code that is over a cap today is recorded in
`.code-caps-baseline.json` as `{ path, kind, name, value }`. The check fails for a violation that is not in
the baseline and for one whose value grew, and only reports a violation that shrank or is gone. Fix a failure
by splitting the function or file. When you reduced a violation, run `node scripts/check-code-caps.ts --update`
and commit the lowered baseline: `--update` writes the baseline only if nothing is new or worse, and refuses
otherwise. The baseline never needs to go up. Its own test, `yarn test:scripts-coverage`, uses `node:test` and
must keep the script and `scripts/code-caps/` at 100% lines, branches and functions.

**`yarn qodana`** (`scripts/qodana.sh`, `qodana.yaml`) runs the JetBrains inspections of the `jetbrains/qodana-js` linter
on a copy of your working tree, with the same configuration as the "Qodana" workflow. It needs a Qodana license token in
`QODANA_TOKEN` (the dotenv file that Yarn loads; `env.example` has the line), a running Docker and the Qodana CLI
(`docs/security-scanning.md`, "Qodana"), and it stops with a message when one is missing. The workflow reads the
repository secret of the same name and is skipped, not failed, without it, so a pull request from a fork is never
blocked by it. The results are advisory: nobody has run the first scan with a token yet, so its quality gate is a
placeholder (500 problems) until a maintainer has read the first report and set the real one. Do not fix or
suppress Qodana findings in an unrelated change. It is not part of the pre-push hook (minutes of Docker time and a
token). Results go to `.qodana/` (ignored by Git) and to Qodana Cloud.

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

### Reproducible build

A build of the same commit must give the same bytes, wherever and whenever it is made.
`scripts/verify-reproducible-build.sh` checks this: it clones `HEAD` twice into two directories with
different names and lengths, builds each clone (`yarn install --immutable`, `yarn build`,
`scripts/release-package.sh`) with a different time zone and different file times, and compares the SHA-256
of every file under `dist/` and of every release file (the tarballs, the SBOMs and `SHA256SUMS`). It takes
about a minute, needs network access for `yarn install`, and builds only the committed state. The CI job
"Reproducible build" runs it on every pull request and every push to `main`.

```bash
npm ci --prefix .github/ci-tools --ignore-scripts          # once: provides cyclonedx-yarn
PATH="$PWD/.github/ci-tools/node_modules/.bin:$PATH" scripts/verify-reproducible-build.sh
```

What the check varies is the checkout path, the time zone and the file times. What both builds share is
what the project pins: Node.js 26 and Yarn from `packageManager`, the lockfile and the operating system, so
a different Node.js version or CPU architecture is not covered by it. If a change makes the build depend on
one of those inputs (a timestamp, an absolute path, an unsorted directory listing, a random value), the
check fails and prints the files that differ; run it with `--keep` to inspect the two trees.

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

Set up a local database with [`docs/local-database.md`](./docs/local-database.md), which takes you from no
PostgreSQL at all to a running test suite: a throwaway server without root, a separate test database, every
environment variable and the e2e suite. The roles and schemas come from `infra/postgres/init.sql`
([`docs/database-setup.md`](./docs/database-setup.md) explains them and has the production notes). Then run
`yarn c15t:migrate` and `yarn db:migrate`, and finally `yarn test` (or `yarn vitest run --project consent-api` for
one workspace; the consent-api workspace does not list `vitest`, so `yarn workspace @consent/consent-api test`
fails with `command not found: vitest`).
Tests only touch rows they created, marked with a run prefix, and clean up after themselves. Use a
disposable database, never a production one. In a git worktree below another checkout, Yarn also injects the outer
checkout's env file: read rule 5 of section 5.1 in that guide first. `yarn mutation` is the exception: it removes the
database variables and the admin key from its own environment and runs the suites on PGlite only
(`stryker.config.mjs`), so it never touches a database, whatever Yarn injected.

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

## Code review

Every change reaches `main` through a pull request. The ruleset on `main` forbids a direct push, a force
push and deleting the branch, with no bypass for anyone, and requires the CI checks below (except the
reproducible-build check). It requires no approving review and no code-owner review, because a sole
maintainer cannot approve their own pull request. The review rules below are therefore project policy
that GitHub does not enforce.

**How a review is done.** The reviewer reads the whole diff (not only the lines that changed), reads the
tests before the code, and runs the change when behaviour is not obvious from the diff. They leave comments
on the lines concerned and say what is wrong and why. The author answers each comment with a new commit or
a reason. A review ends with an approval or with a list of changes that are needed. The first answer to a
pull request usually comes within a week, as for issues ([`SUPPORT.md`](./SUPPORT.md)), but there is no
guaranteed time. Vulnerability reports follow the response targets in [`SECURITY.md`](./SECURITY.md).

**What the reviewer checks.**

1. *Scope.* The change does one thing, and the description says what and why. Unrelated clean-ups are in
   another pull request.
2. *Correctness and tests.* New behaviour has a test, and a bug fix has a regression test that fails without
   the fix. The tests assert behaviour, not implementation. Coverage stays at 100%, and no test is skipped
   or deleted to make CI pass (see "Test policy").
3. *Security.* The questions from [`docs/security-model.md`](./docs/security-model.md) ("Reviewing a change
   for security"): does it add a route (is it guarded in `authz.ts` and does the route coverage test pass)?
   Does it read the `c15t` schema (is every query filtered by the tenant IDs of the session)? Does it take a
   tenant from request data (it must not)? Does it read the client IP or geo data (only from the sanitised
   headers)? Does it add a dependency (the [dependency policy](./docs/dependency-policy.md))? Does it change
   a database grant, a trusted-proxy rule or the release workflow?
4. *Input and errors.* Every boundary is validated with zod, errors are `{ error: { code, message } }`, and
   neither SQL nor a stack trace nor a secret reaches a response or a log.
5. *Conventions.* The rules in "Coding standards" hold: strict TypeScript without `any`, the environment read
   only in `src/env.ts`, no hard-coded address or port, the SPDX header on new files, domain names
   (`site`, `siteKey`, `member`, `consent`, `subject`).
6. *Infrastructure.* A change in `infra/` ran the matching script from "Testing changes to `infra/`", and a
   change in `deploy.sh install` or `uninstall` keeps `infra/test/uninstall.test.sh` in step.
7. *Dependencies and workflows.* A new dependency has an exact version pin, an AGPL-compatible license and an
   updated `yarn.lock`. A new GitHub Action is pinned by its full commit SHA, and a workflow asks for the
   least permissions that it needs.
8. *Documentation.* The README, `docs/`, `CLAUDE.md` and `CHANGELOG.md` say what is now true, and a
   superseded decision is amended, not deleted.

**What makes a change acceptable.** All of these hold:

- Every required check is green: Verify (typecheck, lint, build), Test (PostgreSQL 17, coverage), CodeQL
  (both analyses), DCO sign-off and Dependency review. The "Reproducible build" check passes too.
- Every commit has a DCO sign-off, and the history is readable (a squash on merge is fine).
- A maintainer reviewed the change (for the maintainer's own pull requests that is the self-review
  described under "Who reviews"), and every comment is answered.
- A change to a path in [`.github/CODEOWNERS`](./.github/CODEOWNERS) (authorization, trusted proxies, the
  `infra/` scripts, the workflows) was read line by line, and the reviewer wrote down in the pull request
  what they checked.

**Who reviews.** A code owner is asked to review every pull request. Today there is one maintainer
([`GOVERNANCE.md`](./GOVERNANCE.md)), so a pull request from the maintainer is self-reviewed against this
checklist and checked by CI, and is not seen by a second person. The author ticks the review box of the
pull request template and, for a path in `CODEOWNERS`, writes down in the description what they checked.
This is a known gap, and we say so rather than count it as a two-person review. A pull request from anyone
else is reviewed by the maintainer before it is merged, and anyone is welcome to review any open pull
request: comment on it, even if you cannot approve it.

## Where to start

Issues that suit a first contribution carry the label
[`good first issue`](https://github.com/Axiumine/c15t/labels/good%20first%20issue). Each has a clear goal and
says which files to look at. Larger tasks that need help are labelled
[`help wanted`](https://github.com/Axiumine/c15t/labels/help%20wanted). Comment on an issue before you start,
so that two people do not do the same work. Reading the code, running the checks from "Testing changes to
`infra/`" on your own system, and reporting what differs are all useful contributions too.

## Dependencies

Add a dependency only when it is needed, and follow [`docs/dependency-policy.md`](./docs/dependency-policy.md):
exact version pins, an AGPL-compatible license, and a maintained package. Commit the updated `yarn.lock`.

A new GitHub Action is pinned by its full commit SHA, with a `# vX.Y.Z` comment. The only exception is the
SLSA generator in `release.yml`, which its authors require to be referenced by tag. For that reason the
repository setting "Require actions to be pinned to a full-length commit SHA" must stay off. Dependabot
updates the actions, but not the digest of the PostgreSQL image in `ci.yml`: that is bumped by hand (see
[`docs/dependency-policy.md`](./docs/dependency-policy.md)). The same goes for the Trivy release and the
Semgrep lockfile used by the "Security scan" workflow ([`docs/security-scanning.md`](./docs/security-scanning.md)
explains why Trivy is never installed through its action).

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
