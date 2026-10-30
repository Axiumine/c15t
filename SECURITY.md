# Security Policy

c15t Consent Platform stores consent records and runs an admin dashboard, so we treat security
reports seriously. This document says how to report a vulnerability, what you can expect from us,
and which versions receive fixes.

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub Security Advisories:

1. Open <https://github.com/Axiumine/c15t/security/advisories/new> (repository, Security tab,
   "Report a vulnerability").
2. Describe the problem, the affected component (consent-api, dashboard-api, dashboard-web,
   `infra/`), the version or commit, and how to reproduce it. A proof of concept helps.
3. Tell us if you want to be credited, and under which name.

Only the repository maintainers can read the report. We will use the same advisory to discuss the fix
with you in private. If GitHub's private reporting is unavailable to you, open a public issue that says
only "security contact needed" (no details), and a maintainer will start a private advisory with you.

## What you can expect

This is a small, volunteer-run project, so the times below are targets, not contractual guarantees.

| Step | Target |
|---|---|
| Acknowledge your report | within 3 business days |
| First assessment (accepted, need more information, or not a vulnerability) | within 7 days |
| Fix for a critical or high severity issue | within 30 days |
| Fix for a medium severity issue | within 60 days |
| Fix for a low severity issue | next regular release |
| Public disclosure | after the fix is released, at most 90 days after the report unless we agree otherwise |

We use [CVSS v3.1](https://www.first.org/cvss/) to rate severity. Once a fix is ready we publish a
GitHub Security Advisory (and request a CVE through GitHub), add a note to
[`CHANGELOG.md`](./CHANGELOG.md), and credit you unless you prefer to stay anonymous.

Vulnerabilities in our dependencies follow the (shorter) timelines in
[`docs/dependency-policy.md`](./docs/dependency-policy.md).

## Supported versions

The project is pre-release (0.x). Only the latest release and the `main` branch receive security
fixes. Older 0.x releases do not.

| Version | Supported |
|---|---|
| `main` and the latest `0.x` release | yes |
| anything older | no |

Once a 1.0 release exists, this table will list the supported release lines.

## Scope

In scope: the code in this repository, the default configuration, and the files in `infra/` (nginx,
systemd, PostgreSQL bootstrap, deployment script). Issues we care about most are tenant isolation
failures, authentication or authorization bypass, injection, secrets exposure, spoofable client IP or
geo data, and anything that lets a `user` read or change another site's data.

Out of scope: vulnerabilities in your own deployment (open ports, weak passwords you chose, a
misconfigured Cloudflare zone or firewall), denial of service by volume traffic, social engineering,
findings that need physical access or an already compromised server, and bugs in third-party software
(report those upstream, and tell us if the fix needs a change here). See
[`docs/security-model.md`](./docs/security-model.md) for what the platform does and does not protect.

## Safe harbor

If you act in good faith, avoid privacy violations and data destruction, test only against your own
deployment or a local copy (never against someone else's installation), and give us reasonable time to
fix the issue before you disclose it, we will not take legal action against you and we will work with you
on the fix.

## Verifying releases

A release `vX.Y.Z` contains the source and build tarballs (`c15t-platform-X.Y.Z-*.tar.gz`), one
CycloneDX SBOM per application (`c15t-platform-X.Y.Z-*.cdx.json`) and `SHA256SUMS`. Every one of these
files has a keyless [cosign](https://docs.sigstore.dev/) signature bundle next to it
(`<file>.sigstore.json`), and the release has SLSA provenance (`multiple.intoto.jsonl`). The signing
identity is the release workflow of this repository:

```bash
sha256sum --check SHA256SUMS
cosign verify-blob \
  --bundle <asset>.sigstore.json \
  --certificate-identity https://github.com/Axiumine/c15t/.github/workflows/release.yml@refs/tags/vX.Y.Z \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  <asset>
slsa-verifier verify-artifact <asset> \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/Axiumine/c15t --source-tag vX.Y.Z
```

Get [`slsa-verifier`](https://github.com/slsa-framework/slsa-verifier) from its own releases and verify it
before you use it. The release notes repeat these commands for the exact tag.
