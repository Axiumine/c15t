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

### Changed

- Test coverage of all hand-written source in `apps/*/src` and `packages/*/src` is now 100% (statements,
  branches, functions and lines), including the process entry points, and `vitest.config.ts` enforces it, so
  CI fails when a change leaves code untested. A few unreachable defensive branches were removed instead of
  being excluded; behaviour is unchanged. Two flaky tests (`admin-create`, `ddl`) are now deterministic.

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

[Unreleased]: https://github.com/Axiumine/c15t/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Axiumine/c15t/releases/tag/v0.1.0
