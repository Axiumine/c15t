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

[Unreleased]: https://github.com/Axiumine/c15t/commits/main
