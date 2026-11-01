# Governance

This document describes how the c15t Consent Platform project is run. It is deliberately simple,
because the project is small.

## Roles

**Maintainer.** A maintainer can merge pull requests, cut releases, manage issues and security
advisories, and change repository settings. Maintainers are responsible for the project's direction, for
reviewing contributions, for the security policy ([`SECURITY.md`](./SECURITY.md)) and for enforcing the
[Code of Conduct](./CODE_OF_CONDUCT.md).

Current maintainers:

| GitHub | Scope |
|---|---|
| [@giovannimanzoni](https://github.com/giovannimanzoni) | all areas (sole maintainer) |

**Contributor.** Anyone who opens an issue, a pull request or a review. Contributors do not need
permission to propose changes. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

**Owner of the repository.** The `Axiumine` GitHub organization owns the repository and holds the
copyright (see [`LICENSE`](./LICENSE) and the SPDX headers).

## How decisions are made

1. Small changes (bug fixes, docs, tests, dependency updates): a pull request reviewed by a maintainer.
2. Larger or risky changes (new component, database schema change, changes to the trust model, new
   dependency with a wide reach): open an issue first and describe the problem and the options. A
   maintainer decides after the discussion, aiming for consensus among those who took part. Disagreements
   are settled by the maintainers.
3. Architecture decisions are recorded in docs/decisions.md (D1 to D11) with the reasoning, and a
   superseded decision is amended there, not silently deleted.
4. Security fixes are developed in private advisories and are not subject to public discussion before
   release.

Changing the license needs the agreement of every copyright holder, so it is practically impossible
once outside contributions are merged. Contributions are accepted under the project license with a DCO
sign-off, and there is no contributor license agreement.

## Becoming a maintainer

A contributor who has made sustained, good-quality contributions (code, review, triage or
documentation) over several months can be invited by the existing maintainers. Maintainers must enable
two-factor authentication on their GitHub account. A maintainer who is inactive for 12 months or who
asks to step down is moved to emeritus status, and their repository access is removed.

## Honest status: bus factor of one

The project currently has **one maintainer**. That is a real risk to continuity, and we do not claim
otherwise:

- If the maintainer is unavailable, no second maintainer is designated to review, merge, release or answer security
  reports.
- Releases are produced by CI from tags, with no manual secrets, which makes a hand-over easier.
- The license is the AGPL-3.0-or-later and everything needed to build, test and run the software is in
  the repository, so anyone can fork the project and continue it.
- Adding a second maintainer is a goal, and the project welcomes reviewers and co-maintainers. Until then,
  a two-person review of every change is not possible, and the OpenSSF "gold" criteria that require it
  are marked as unmet in [`docs/openssf-best-practices.md`](./docs/openssf-best-practices.md).

## Changes to this document

Changes to this file are made by pull request and need maintainer approval.
