# Dependency policy

This policy says how third-party code gets into the project, how it is kept up to date, and how fast we
react to a vulnerability in it. It applies to npm packages, GitHub Actions, container images used in CI,
and the tools CI installs. Reporting a vulnerability in this project itself is covered by
[`SECURITY.md`](../SECURITY.md).

## Choosing a dependency

Before adding a dependency, ask whether Node.js, the platform or the existing stack already does the job.
A new dependency must meet all of these:

1. **Licence.** It is under a licence that is compatible with AGPL-3.0-or-later (MIT, BSD, ISC,
   Apache-2.0, Unlicense, 0BSD, CC0, MPL-2.0 and similar). GPL-2.0-only and proprietary or "source
   available" licences are not allowed. The `dependency-review` workflow enforces an allow-list on pull
   requests.
2. **Maintained.** It had a release or a maintainer response in the last 12 months, is not archived or
   deprecated, and has more than one maintainer or a credible organisation behind it, if possible.
3. **Reputation and provenance.** Prefer packages published with npm provenance, with a public source
   repository that matches the tarball, and with a security policy.
4. **Small and quiet.** Prefer few transitive dependencies, and no install scripts (`postinstall` and
   similar). If a package needs one, say why in the pull request.
5. **No open high-severity advisory** without a fix (check `yarn npm audit`, GitHub advisories and OSV).
6. **Fit for the layer.** `dashboard-web` must not pull server-only packages, and security-critical code
   (`authz`, request guard, validation) avoids dependencies that are not strictly needed. Cryptography is
   never hand-written: use `node:crypto` or the vetted library already in the stack (Better Auth).

The pull request that adds the dependency explains why it is needed and which alternatives were
considered. A maintainer approves it (CODEOWNERS covers `package.json` and `yarn.lock` through the
default owner).

## Pinning and reproducibility

- Every version in `package.json` is an **exact** version (no `^` or `~`), and `yarn.lock` is committed.
  CI, the release workflow and `infra/deploy.sh` install with `yarn install --immutable`, which fails when
  the lockfile does not match.
- The toolchain is pinned: Yarn through `packageManager` (Corepack), Node.js through `engines.node` and
  `.nvmrc`. Corepack itself, which Node 26 no longer bundles, is installed in CI from a small lockfile
  with integrity hashes (`.github/ci-tools/`).
- Every third-party GitHub Action is pinned by its full commit SHA, with a comment naming the version.
  This includes the action used by the composite action `.github/actions/setup`. There is **one
  exception**: the SLSA generator, a reusable workflow that `release.yml` calls by the tag `v2.1.0`. Its
  authors require a tag, because the builder resolves its own ref at run time and the provenance names
  that ref. Dependabot's `github-actions` ecosystem still updates that tag.
- The PostgreSQL service image in CI (`ci.yml`, `services: postgres`) is pinned by digest, and
  **Dependabot cannot update it**: it has no support for images in a workflow's `services:` or
  `container:`. A maintainer bumps the digest by hand about once per quarter and on every PostgreSQL
  security release: take the `Docker-Content-Digest` header of the registry manifest for the tag
  (`postgres:17`), put it after `@sha256:` and run CI. The test-only nginx container in
  `infra/test/compose.yaml` uses the floating tag `nginx:stable-alpine` and never ships to production, so
  there is nothing for Dependabot to bump.
- The security scanners of `security-scan.yml` have no action. Trivy is a release archive of a pinned
  version, checked against a SHA-256 written in the workflow; Semgrep comes from
  `.github/ci-tools/semgrep/requirements.txt`, a lockfile with a hash for every file, installed with
  `pip --require-hashes`. Dependabot cannot update either, so a maintainer bumps them by hand
  ([`security-scanning.md`](./security-scanning.md) has the steps and the reason Trivy is not installed
  through its action).
- Because of the SLSA exception, do not switch on the repository setting *Require actions to be pinned to
  a full-length commit SHA*: it rejects every `uses:` that is not a SHA, and `release.yml` would fail.
  Pinning is kept by review and by the Scorecard Pinned-Dependencies check instead.
- Nothing is installed with `curl | sh`, and no CI step runs an unpinned package.

## Updating

| What | How | When |
|---|---|---|
| npm packages and GitHub Actions (workflows and the composite action, SLSA generator tag included) | Dependabot opens grouped pull requests (minor and patch together, majors one by one) | weekly |
| PostgreSQL service image digest in `ci.yml` | A maintainer, by hand (see "Pinning and reproducibility") | about quarterly, and on a PostgreSQL security release |
| Trivy release and checksum, Semgrep lockfile (`security-scan.yml`) | A maintainer, by hand, with a release at least seven days old ([`security-scanning.md`](./security-scanning.md)) | about quarterly, and on a security release of either tool |
| Security updates | Dependabot security updates open a pull request as soon as an advisory exists, and are exempt from the cooldown | immediately |
| Node.js, Yarn | A maintainer updates `.nvmrc`, `engines` and `packageManager` together after reading the release notes | on each LTS or security release |
| c15t (`@c15t/*`) | A maintainer, because its API changed between major versions and the generated read types (`yarn db:pull-c15t`) must be regenerated | on each release |

Dependabot is configured with a **cooldown** so that a version published only hours ago is not proposed:
most malicious package versions are caught and removed within days. The cooldown does not apply to
security updates.

A dependency update is reviewed like any other change. The reviewer reads the changelog, looks at the
dependency-review summary for new transitive packages, install scripts and licence changes, and CI must
be green (typecheck, lint, unit and integration tests, build, CodeQL). A major upgrade of a security-relevant
package (Better Auth, Hono, the Postgres driver, zod) also needs the authorization tests to pass without
changes.

## Finding vulnerabilities

- GitHub Dependabot alerts and security updates, and OSV data through the OpenSSF Scorecard
  "Vulnerabilities" check.
- The `dependency-review` workflow blocks pull requests that introduce a dependency with a known
  vulnerability of high severity or worse.
- `yarn npm audit --all --recursive` (and `osv-scanner` on `yarn.lock`) before every release.
- CodeQL and Semgrep for the project's own code. Trivy scans `yarn.lock` (and the CI tools' lockfiles) on every
  pull request and every week, and fails on a HIGH or CRITICAL advisory
  ([`security-scanning.md`](./security-scanning.md)).

## Response times

These apply when an advisory affects a package we ship or use in CI. Severity is the advisory's CVSS
rating, adjusted down only when we can show that the vulnerable code path is not reachable in this
project.

| Severity | Target to release a fix (upgrade, override or mitigation) |
|---|---|
| Critical | 7 days |
| High | 14 days |
| Medium | 60 days |
| Low | next regular release |

If no patched version exists, we do one of these in the same time frame, and record the choice in the
pull request and in `CHANGELOG.md`: pin a patched fork or apply a Yarn `resolutions` override, change
the code so the vulnerable path is not used, add a configuration mitigation, or replace the dependency.
If the vulnerability changes the security of deployed instances, we also publish a GitHub Security
Advisory so that operators know to upgrade.

An advisory we judge not to affect us is not ignored silently: the pull request or issue says why, and
the note stays until the dependency is upgraded.

## Removing dependencies

Unused dependencies are removed as soon as they are noticed (`yarn why <name>` shows who needs a
package). A dependency that becomes unmaintained is replaced or vendored before it becomes a risk.

## Release artifacts

Each release publishes a CycloneDX SBOM next to the signed tarballs, so that operators can scan the exact
dependency set they deploy.
