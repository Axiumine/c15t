# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0.0, minor versions may
contain breaking changes.

Release process: set `version` in the root `package.json` to `x.y.z`, move the entries from "Unreleased"
to a new `## [x.y.z] - YYYY-MM-DD` section, update the compare links at the bottom, merge that to `main`,
and push a `vX.Y.Z` tag on the merged commit. The release workflow refuses a tag that differs from the
`package.json` version, so bump it first (a pushed tag cannot be moved when the recommended tag ruleset is
on: see `docs/scorecard.md`). It then builds, signs and publishes the assets (the dashboard-web tarball must contain `THIRD-PARTY-NOTICES.md`; `scripts/release-package.sh` refuses to pack without it) and uses the section for that
version as the release notes. Security fixes get
their own "Security" heading and name the advisory.

## [Unreleased]

### Added

- Mutation testing with StrykerJS 10.1.1 (exact pins, Apache-2.0; the vitest runner and the TypeScript checker):
  `yarn mutation` runs incrementally on the logic files of `packages/shared`, `packages/db`, consent-api and
  dashboard-api, on PGlite only (`stryker.config.mjs` removes the database variables), and fails below a score of
  90 (`thresholds.break`). `.github/workflows/mutation.yml` runs it weekly (Mondays) and on demand on the
  self-hosted runners, with the incremental file in `actions/cache` and the HTML report as an artifact. It is not a
  pull request check. New tests pin what the surviving mutants had shown to be unpinned: the zod contracts, the
  environment messages, the request guard, the registry bookkeeping, the failover classification, audit, validation
  and range handling. Measured scores and what still survives: `docs/quality-gates.md`.
- Vitest snapshots of the dashboard API's JSON shapes and of the CSV export bytes
  (`apps/dashboard-api/src/api-snapshots.test.ts`, run on PGlite and on a real database; volatile values are
  replaced by labels in `src/testing/normalize.ts`). A changed snapshot is a contract change.
- `docs/local-database.md`: a PostgreSQL for development, the tests and the e2e suite. It lists which suites need a
  real database and what happens when the variables are missing, how to run a throwaway server without root, how to
  create the roles and a separate test database, the connection URLs, every environment variable (dotenv file versus
  shell, and Yarn's precedence rules, including the nested-checkout trap), the commands for the tests and Playwright,
  the CI equivalent, safety rules and a troubleshooting table.
- Quality gates beyond Biome and `tsc`, all passing with zero findings and documented in `docs/quality-gates.md`: ESLint
  (typescript-eslint `strictTypeChecked`, sonarjs, security, no-unsanitized, complexity and size rules), knip,
  type-coverage (100%), FTA, a code-caps ratchet (`scripts/check-code-caps.ts`), Semgrep and Trivy (`docs/security-scanning.md`).
  CI has a new "Static analysis" job and a "Security scan" workflow.
- JetBrains Qodana (`jetbrains/qodana-js`) as an advisory static-analysis layer: `qodana.yaml`, a token-guarded workflow
  (`.github/workflows/qodana.yml`: push to `main`, pull requests, weekly, manual; skipped with a notice when the
  `QODANA_TOKEN` repository secret is missing, so it is not a required check) and `yarn qodana` (`scripts/qodana.sh`).
  It has never run with a token: its quality gate is a placeholder ceiling until the first real result is read
  (`docs/security-scanning.md`, "Qodana").
- Git hooks with lefthook, installed by `yarn install`: pre-commit (Biome, SPDX, code caps, shellcheck), commit-msg
  (DCO sign-off), pre-push (typecheck, analysers, tests at 100% coverage, scans).

### Changed

- The FTA maintainability cap is now 50 (was 65): 39 source files in consent-api, dashboard-api, dashboard-web and
  `packages/*` were split into smaller modules, with the same behaviour and the same tests. The size-cap ratchet
  (`.code-caps-baseline.json`) is down to three remaining violations. Source pointers in the documentation follow
  the moved symbols.
- The README is a front page again (about 125 lines). The text moved unchanged into `docs/decisions.md` (D1 to D11),
  `docs/dashboard.md` (roles, data model, screens, API), `docs/configuration.md`, `docs/getting-started.md`,
  `docs/adding-a-website.md` and `docs/status.md` (status and open questions). The "Security notes" bullets were
  already in `docs/security-model.md`; its two missing sentences were added there. Every pointer follows the move:
  "README D9" in code comments is now "docs/decisions.md D9", and the links in `docs/`, `CLAUDE.md`,
  `CONTRIBUTING.md`, `SUPPORT.md` and the OpenSSF evidence file were updated. `GOVERNANCE.md` now says that
  architecture decisions are recorded in `docs/decisions.md`.

### Fixed

- The message of the consent-api integration tests for a missing database variable (`apps/consent-api/src/testing/db.ts`)
  named `yarn workspace @consent/consent-api test`, which fails with `command not found: vitest`. It now names
  `yarn vitest run --project consent-api`.
- The comments in `infra/postgres/init.sql` and `scripts/ci-bootstrap-db.sh`, and `docs/database-setup.md`, said that a
  role with `CREATEROLE` and `CREATEDB` can run the bootstrap. On PostgreSQL 16 and newer only a superuser can (the
  `ALTER ROLE ... NOSUPERUSER` statements stop with `permission denied to alter role`).

### Security

- Resolved every `minimatch` in the tree to 11.0.1, not only the one under `@ts-morph/common`
  ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), fixed only in 11.x). The quality-gate
  tools added in 0.2.0 (ESLint, `@eslint/config-array`, typescript-eslint, eslint-plugin-sonarjs, type-coverage) had
  brought back 10.2.6. All of them are development tools and none ships in a release asset. They call only
  `minimatch()` and `Minimatch#match()`, which 11.x keeps; 11.x drops `makeRe`, `AST` and `matchOne`, which none of
  them uses.

## [0.2.0] - 2026-11-01

Adds `deploy.sh install` and `uninstall`, the security and cryptography documentation, a reproducible-build check and
a 100% coverage gate. There is no intended change in the behaviour of consent-api, dashboard-api or dashboard-web:
the code changes are test-driven clean-ups, with the same behaviour.

### Added

- `infra/deploy.sh install` and `uninstall` (both with `--dry-run`; `--purge-config` and `--remove-cloudflare` for uninstall;
  uninstall keeps the host-wide Cloudflare real_ip file and nftables allowlist unless `--remove-cloudflare` is given),
  tested by `infra/test/uninstall.test.sh` in CI, and `docs/installation.md` with the install, upgrade, rollback, uninstall
  and release-verification steps.
- `docs/assurance-case.md` (threat model, trust boundaries, design principles and common weaknesses, each tied to code and a
  test, with the known gaps) and `docs/cryptography.md` (where each algorithm is chosen and who can change it).
  `docs/security-model.md` now records that c15t 3.1.0 `GET` and `PATCH /subjects/:id` need no key.
- `scripts/verify-reproducible-build.sh` and the CI job "Reproducible build": two clean builds of the same commit,
  from different directories, time zones and file times, must give byte-identical `dist/` trees and release files
  (tarballs, SBOMs, `SHA256SUMS`). `CONTRIBUTING.md` documents it.
- `CONTRIBUTING.md`: a "Code review" section (how a review is done, what is checked, what makes a change
  acceptable, who reviews) and a "Where to start" section for new contributors.

### Changed

- The README is shorter. The production steps and the nginx listings moved to `docs/installation.md` ("Setting up by hand",
  "What a deploy does") and the new `docs/nginx.md`, and the license explanation moved to the new `docs/licensing.md`; the content
  is the same. The README keeps short "Production" and "License" sections and a "Documentation" index.
- Test coverage of all hand-written source in `apps/*/src` and `packages/*/src` is now 100% (statements,
  branches, functions and lines), including the process entry points, and `vitest.config.ts` enforces it, so
  CI fails when a change leaves code untested. A few unreachable defensive branches were removed instead of
  being excluded; behaviour is unchanged. Two flaky tests (`admin-create`, `ddl`) are now deterministic.

### Security

- Resolved `minimatch` to 11.0.1 for the `@ts-morph/common` that `@c15t/cli` pulls in
  ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), a denial of service through glob
  parts amplification; fixed only in 11.x). The affected code is the migration CLI, a development tool: it is
  not part of any release asset. Dependabot cannot open this update itself because the dependency is transitive.

## [0.1.0] - 2026-10-30

First release. The project is pre-1.0: minor versions may contain breaking changes.

### Added

- The platform itself: consent-api (one c15t instance per registered site), dashboard-api (Hono and Better
  Auth, admin and read-only user roles), dashboard-web (React single-page app), the shared packages, the
  PostgreSQL layer (`app` and `c15t` schemas) and `infra/` (nginx, systemd, `deploy.sh` with rollback).
- Licensed under AGPL-3.0-or-later, with an SPDX header in every source file and `REUSE.toml` for the
  rest (`scripts/add-spdx-headers.mjs`).
- Community and project-health files: `SECURITY.md`, `CONTRIBUTING.md` (DCO sign-off), `CODE_OF_CONDUCT.md`,
  `GOVERNANCE.md`, `SUPPORT.md`, `CODEOWNERS`, issue and pull-request templates.
- GitHub Actions: CI (typecheck, lint, unit tests, build, integration tests against PostgreSQL,
  coverage), CodeQL, dependency review, OpenSSF Scorecard, and a release workflow that signs release
  assets with cosign, attaches SLSA provenance and a CycloneDX SBOM.
- Dependabot configuration for GitHub Actions and npm.
- Property-based (fuzz) tests with fast-check for the security-sensitive parsing and validation code.
- Documentation: `docs/architecture.md`, `docs/security-model.md`, `docs/dependency-policy.md`,
  `docs/database-setup.md`, `docs/scorecard.md`, `docs/openssf-best-practices.md`.

### Changed

- The coverage report counts every source file under `apps/*/src` and `packages/*/src`. Entry points that no
  test imports (the servers, `admin-create`, `migrate`, `main.tsx`) now show up at 0% instead of being left
  out.
- README: the getting-started steps begin with `git clone`.

### Fixed

- Code scanning alerts in scripts and tests: a file-system race in `scripts/add-spdx-headers.mjs`, biased
  random subject ids in the end-to-end helpers, a script end-tag pattern in an end-to-end spec that
  HTML parsers accept more loosely, an incomplete path sanitization in the route coverage test, and an
  absolute checkout path reaching a shell command in `scripts/check-dco.test.mjs`.
- The cursor pagination fuzz test no longer times out on a loaded CI runner.

[Unreleased]: https://github.com/Axiumine/c15t/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Axiumine/c15t/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Axiumine/c15t/releases/tag/v0.1.0
