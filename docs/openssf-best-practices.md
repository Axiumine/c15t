# OpenSSF Best Practices evidence

Evidence and copy-ready answers for the OpenSSF Best Practices badge of this project.

| Item | Value |
|---|---|
| Project id | 16093 |
| Badge | `https://www.bestpractices.dev/projects/16093/badge` |
| Edit form | https://www.bestpractices.dev/projects/16093/edit |
| Repository | https://github.com/Axiumine/c15t |
| License | AGPL-3.0-or-later |
| Prepared | 2026-10-30, against the criteria in `criteria/criteria.yml` and `config/locales/en.yml` of https://github.com/coreinfrastructure/best-practices-badge (main) |

The criteria are numbered by the site itself: 67 for passing, 55 for silver (the criteria that silver adds or tightens), 23 for gold. Silver and gold repeat some passing ids (for example `contribution_requirements`) with stricter wording, so each is answered again at its own level.

## How to use this document

1. Do the manual actions in section 1 that apply, in order. Several answers are only true after them. After the first push, also check that the workflow runs on `main` are green (M10): the CI, CodeQL and release answers describe workflows that have to run.
2. Open the edit form, go level by level and section by section. The sections below follow the order of the form.
3. For each criterion select the status named in the heading and paste the text from the code block into the justification box. Where the criterion needs a URL (`URL required: yes`), the URL is already inside the text.
4. Statuses use the form vocabulary: **Met**, **Unmet**, **N/A**. `Met [M3]` means: Met only after manual action M3 has been done. The texts describe the state the repository is in after those actions.
5. Nothing here is a claim that cannot be backed by a file in the repository, a workflow, or a repository setting. Where a figure has not been measured, the criterion is Unmet and says what is needed. When the repository changes, update this file and the form together.

## 1. Manual actions before pasting

| ID | What to do | Where | Criteria that depend on it |
|---|---|---|---|
| M0 | Silver and gold only: earn the passing badge first (every passing criterion Met or N/A). Silver needs passing, gold needs silver. | bestpractices.dev project 16093 | `s:achieve_passing` |
| M1 | Make the repository public with the full commit history on default branch `main`, and push it (not a single squashed snapshot). The working tree this document was checked against has no `.git` directory, so nothing about the history is verified here: the git and `commits/main` statements are true only once the history is pushed. Check the repository description and topics. | GitHub, Axiumine/c15t | `p:maintained`, `p:repo_public`, `p:repo_track`, `p:repo_interim`, `p:repo_distributed`, `g:repo_distributed` |
| M2 | Enable private vulnerability reporting. Without it the link in SECURITY.md (`/security/advisories/new`) is a 404 for reporters. | Settings, Code security, Private vulnerability reporting | `p:vulnerability_report_private` |
| M3 | Turn on two-factor authentication for the maintainer account `giovannimanzoni` with a TOTP app, passkey or hardware key (not SMS), and require 2FA for all members of the Axiumine organization. | Account Settings, Password and authentication; Organization Settings, Authentication security | `g:require_2FA`, `g:secure_2FA` |
| M4 | Recommended, no criterion depends on it directly: protect `main` with a ruleset (pull request required, required status checks `Verify (typecheck, lint, build)`, `Test (PostgreSQL 17, coverage)`, `DCO sign-off`, `Analyze (javascript-typescript)`, `Analyze (actions)` and `Dependency review`, no force push, no deletion). With one maintainer do not require an approving review, review from code owners (`require_code_owner_review`) or approval of the most recent push (`require_last_push_approval`), or the maintainer cannot approve their own pull request and no merge goes through: the live `main protection` ruleset has required approvals 0 and both options off, and they are enabled when a second maintainer joins. Add a second ruleset (live name `release tags immutable`) for tags matching `v*` that restricts updates and deletions (do not restrict creations, or nobody can push a release tag); see M6 for what that means for a tag pushed too early. The check names above are the `name:` of the jobs in `.github/workflows`; `DCO sign-off` and `Dependency review` run on pull requests only, so they are not shown on `main` pushes. | Settings, Rules, Rulesets | none directly |
| M5 | Enable Dependency graph, Dependabot alerts, Dependabot security updates, Secret scanning and Push protection. Do not also switch on CodeQL "default setup": the workflow `codeql.yml` already provides code scanning. Keep the setting "Require actions to be pinned to a full-length commit SHA" (Settings, Actions, General) **off**: it is incompatible with this repository, because `release.yml` must call the SLSA generator reusable workflow by the tag `v2.1.0` (its authors do not support a commit SHA), so the `provenance` job, and with it every release, would fail. Pinning of every other action is kept by review and by the Scorecard Pinned-Dependencies check (docs/dependency-policy.md). | Settings, Code security; Settings, Actions, General | `p:vulnerabilities_fixed_60_days`, `p:no_leaked_credentials`, `s:dependency_monitoring` |
| M6 | Cut the first release, in this order. (1) Set `version` in the root package.json to `0.1.0` (it is `0.0.0` today). (2) Move the "Unreleased" entries of CHANGELOG.md to `## [0.1.0] - <date>` and update the compare links. (3) Merge both changes to `main` through a pull request and wait for CI to pass on `main`. (4) Only then tag that exact commit `v0.1.0` and push the tag. `release.yml` (the first job and `scripts/release-package.sh`) aborts when the tag is not a semantic version, when the tag differs from the package.json `version`, or when the tagged commit is not reachable from `main`. If the recommended `v*` tag ruleset (M4) is on, a pushed tag can be neither moved nor deleted, so a tag pushed before the version bump was merged cannot be repaired by re-tagging: fix the cause on `main` and release the next patch version (`v0.1.1`). Then wait for `release.yml`, and check the release page lists the tarballs, `SHA256SUMS`, the `.sigstore.json` bundles, the `.intoto.jsonl` provenance and the CycloneDX SBOMs. Run the `cosign verify-blob` command from SECURITY.md once against a real asset. | git tag, GitHub Releases | `p:version_unique`, `p:version_semver`, `p:version_tags`, `p:release_notes`, `p:delivery_mitm`, `p:delivery_unsigned`, `s:signed_releases` |
| M7 | Enable Issues, and confirm that the issue forms (bug report, feature request) show up under "New issue". Discussions are optional. | Settings, General, Features | `p:discussion`, `p:report_process`, `p:report_tracker`, `p:report_archive`, `s:report_tracker` |
| M8 | Before the first push scan the tree (and the history if you push existing history) for secrets, for example with gitleaks. What is published is decided by `.gitignore`, which keeps these local: the real environment files (`.env`, `.env.*`), editor and agent tooling (`.idea`, `.vscode`, `.claude/`, `.gitnexus`, `AGENTS.md`) and personal scratch notes (`/db-setup.md`, `/todo.md`; the published setup guide is `docs/database-setup.md`). `CLAUDE.md` is committed on purpose: it holds the engineering rules that CONTRIBUTING.md links to. `.gitignore` only affects files that were never committed, so if you push existing history, scan it for any of these paths as well. | local shell | `p:no_leaked_credentials` |
| M9 | On the day you paste, open the issue list and the security advisories: every bug report and enhancement request of the last 12 months must have a maintainer reply, and any vulnerability report must have been answered within 14 days. If not, answer them, or change the status and text of the criteria marked M9. | GitHub, Issues and Security tabs | `p:report_responses`, `p:enhancement_responses`, `p:vulnerability_report_response`, `s:regression_tests_added50` |
| M10 | After the first push wait for the workflows `CI`, `CodeQL` and `Scorecard supply-chain security` to run on `main` and make sure they are green (`Dependency review` and `DCO` run on pull requests only: open one pull request to see them pass). Read the real figure from the CI run: the `Test` job log prints the text summary and the artifact `coverage` holds `lcov.info` and `coverage-summary.json`. Only if statement coverage is at least 80% switch `test_statement_coverage80` to Met (and paste the measured figure and the run URL); never paste a figure that was not measured. Confirm that code scanning shows no open medium or higher alert. | GitHub, Actions and Security tabs | `p:test_most`, `p:static_analysis_fixed`, `s:test_statement_coverage80`, `g:test_statement_coverage90`, `g:test_branch_coverage80`, `g:dynamic_analysis` |

The prefix of a criterion above is its level: `p` passing, `s` silver, `g` gold.

## 2. Summary

### Passing

| Section | Criteria | Met | Met after manual action | Unmet | N/A |
|---|---|---|---|---|---|
| Basics: Basic project website content | 4 | 4 | 0 | 0 | 0 |
| Basics: FLOSS license | 3 | 3 | 0 | 0 | 0 |
| Basics: Documentation | 2 | 2 | 0 | 0 | 0 |
| Basics: Other | 4 | 2 | 2 | 0 | 0 |
| Change Control: Public version-controlled source repository | 4 | 0 | 4 | 0 | 0 |
| Change Control: Unique version numbering | 3 | 0 | 3 | 0 | 0 |
| Change Control: Release notes | 2 | 0 | 1 | 0 | 1 |
| Reporting: Bug-reporting process | 5 | 0 | 5 | 0 | 0 |
| Reporting: Vulnerability report process | 3 | 1 | 1 | 0 | 1 |
| Quality: Working build system | 3 | 3 | 0 | 0 | 0 |
| Quality: Automated test suite | 4 | 3 | 0 | 1 | 0 |
| Quality: New functionality testing | 3 | 3 | 0 | 0 | 0 |
| Quality: Warning flags | 3 | 3 | 0 | 0 | 0 |
| Security: Secure development knowledge | 2 | 2 | 0 | 0 | 0 |
| Security: Use basic good cryptographic practices | 9 | 7 | 0 | 0 | 2 |
| Security: Secured delivery against man-in-the-middle (MITM) attacks | 2 | 0 | 2 | 0 | 0 |
| Security: Publicly known vulnerabilities fixed | 2 | 1 | 1 | 0 | 0 |
| Security: Other security issues | 1 | 0 | 1 | 0 | 0 |
| Analysis: Static code analysis | 4 | 3 | 1 | 0 | 0 |
| Analysis: Dynamic code analysis | 4 | 2 | 0 | 0 | 2 |
| **Total Passing** | **67** | **39** | **21** | **1** | **6** |

### Silver

| Section | Criteria | Met | Met after manual action | Unmet | N/A |
|---|---|---|---|---|---|
| Basics: Prerequisites | 1 | 0 | 1 | 0 | 0 |
| Basics: Basic project website content | 1 | 1 | 0 | 0 | 0 |
| Basics: Project oversight | 6 | 4 | 0 | 2 | 0 |
| Basics: Documentation | 6 | 6 | 0 | 0 | 0 |
| Basics: Accessibility and internationalization | 2 | 1 | 0 | 1 | 0 |
| Basics: Other | 1 | 1 | 0 | 0 | 0 |
| Change Control: Previous versions | 1 | 1 | 0 | 0 | 0 |
| Reporting: Bug-reporting process | 1 | 0 | 1 | 0 | 0 |
| Reporting: Vulnerability report process | 2 | 1 | 0 | 0 | 1 |
| Quality: Coding standards | 2 | 2 | 0 | 0 | 0 |
| Quality: Working build system | 4 | 3 | 0 | 0 | 1 |
| Quality: Installation system | 3 | 1 | 0 | 1 | 1 |
| Quality: Externally-maintained components | 4 | 3 | 1 | 0 | 0 |
| Quality: Automated test suite | 3 | 1 | 0 | 1 | 1 |
| Quality: New functionality testing | 2 | 2 | 0 | 0 | 0 |
| Quality: Warning flags | 1 | 1 | 0 | 0 | 0 |
| Security: Secure development knowledge | 1 | 1 | 0 | 0 | 0 |
| Security: Use basic good cryptographic practices | 7 | 5 | 0 | 2 | 0 |
| Security: Secure release | 2 | 0 | 1 | 1 | 0 |
| Security: Other security issues | 3 | 2 | 0 | 1 | 0 |
| Analysis: Static code analysis | 1 | 1 | 0 | 0 | 0 |
| Analysis: Dynamic code analysis | 1 | 0 | 0 | 0 | 1 |
| **Total Silver** | **55** | **37** | **4** | **9** | **5** |

### Gold

| Section | Criteria | Met | Met after manual action | Unmet | N/A |
|---|---|---|---|---|---|
| Basics: Prerequisites | 1 | 0 | 0 | 1 | 0 |
| Basics: Project oversight | 2 | 0 | 0 | 2 | 0 |
| Basics: Other | 2 | 2 | 0 | 0 | 0 |
| Change Control: Public version-controlled source repository | 4 | 0 | 3 | 1 | 0 |
| Quality: Coding standards | 2 | 0 | 0 | 2 | 0 |
| Quality: Working build system | 1 | 0 | 0 | 1 | 0 |
| Quality: Automated test suite | 4 | 2 | 0 | 2 | 0 |
| Security: Use basic good cryptographic practices | 2 | 1 | 0 | 1 | 0 |
| Security: Secured delivery against man-in-the-middle (MITM) attacks | 1 | 1 | 0 | 0 | 0 |
| Security: Other security issues | 2 | 1 | 0 | 1 | 0 |
| Analysis: Dynamic code analysis | 2 | 0 | 1 | 1 | 0 |
| **Total Gold** | **23** | **7** | **4** | **12** | **0** |

Columns: **Met** = Met as soon as the files in the repository exist. **Met after manual action** = Met only once a step from section 1 is done (the step is named in the criterion). Unmet and N/A as in the form.

Where this leaves the badges:

- **Passing**: attainable. 60 criteria Met (21 of them after manual actions), 6 N/A, 1 Unmet. Every Unmet passing criterion is SUGGESTED or SHOULD level, so none blocks the badge.
- **Silver**: not attainable yet. 9 criteria are Unmet; the blocking ones are `access_continuity` (one maintainer), `test_statement_coverage80` (no figure read from a CI run yet), `assurance_case` (the section is not written yet) and `installation_common`. The rest are SHOULD or SUGGESTED.
- **Gold**: not attainable for now. 12 of 23 criteria are Unmet, among them `bus_factor` (needs 2 people), `contributors_unassociated` (needs 2 significant contributors from different organizations), `two_person_review` (needs a second reviewer), `build_reproducible`, `test_statement_coverage90`, `test_branch_coverage80` and `security_review`.

## 3. Identification (project fields, not criteria)

Paste these into the identification part of the Basics tab.

| Field | Value |
|---|---|
| Project name | c15t Consent Platform |
| Project homepage URL | https://github.com/Axiumine/c15t |
| Repository URL | https://github.com/Axiumine/c15t |
| Implementation languages | TypeScript |
| Description | Self-hosted, multi-tenant cookie-consent platform: one internal consent-api runs a c15t backend for every registered website, and a private dashboard (React single-page app plus Hono API with Better Auth) shows consent data to admins and read-only users. PostgreSQL, Node.js, nginx and systemd; no Docker. |
| License | AGPL-3.0-or-later |

## 4. Passing level

All 67 criteria of the passing level, in the order of the form.

### Passing: Basics

#### Identification

See section 3.

#### Prerequisites

None: passing is the first level.

#### Basic project website content

##### `description_good` (MUST): Met

> The project website MUST succinctly describe what the software does (what problem does it solve?).

Select: **Met** | URL required: no

Justification to paste:

```text
The project home page is the GitHub repository https://github.com/Axiumine/c15t ; its README opens with a plain-language description: a self-hosted, multi-tenant cookie-consent backend (one c15t instance per website) plus a private dashboard where admins and read-only users view consent records for websites hosted on the same server.
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md)

##### `interact` (MUST): Met

> The project website MUST provide information on how to: obtain, provide feedback (as bug reports or enhancements), and contribute to the software.

Select: **Met** | URL required: no

Justification to paste:

```text
The README https://github.com/Axiumine/c15t#readme explains how to obtain the software (clone the repository, see Getting started), how to give feedback (GitHub Issues with bug and feature forms, see SUPPORT.md) and how to contribute (CONTRIBUTING.md).
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md), [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md)

##### `contribution` (MUST): Met

> The information on how to contribute MUST explain the contribution process (e.g., are pull requests used?)

Select: **Met** | URL required: yes

Justification to paste:

```text
CONTRIBUTING.md explains the contribution process: pull requests against main on GitHub, issues for larger changes, DCO sign-off on every commit, CI must pass, review by a maintainer. https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

##### `contribution_requirements` (SHOULD): Met

> The information on how to contribute SHOULD include the requirements for acceptable contributions (e.g., a reference to any required coding standard).

Select: **Met** | URL required: yes

Justification to paste:

```text
CONTRIBUTING.md lists the requirements for acceptable contributions: yarn typecheck, yarn lint (Biome) and yarn test must pass, new behavior needs tests, new files need the SPDX header, commits need a DCO sign-off; the coding standard is the strict TypeScript and Biome configuration in packages/config. https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json), [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json)

#### FLOSS license

##### `floss_license` (MUST): Met

> The software produced by the project MUST be released as FLOSS.

Select: **Met** | URL required: no

Justification to paste:

```text
The software is released under the GNU Affero General Public License v3.0 or later (SPDX: AGPL-3.0-or-later), an OSI-approved and FSF-approved free license. https://github.com/Axiumine/c15t/blob/main/LICENSE
```

Evidence: [LICENSE](https://github.com/Axiumine/c15t/blob/main/LICENSE)

##### `floss_license_osi` (SUGGESTED): Met

> It is SUGGESTED that any required license(s) for the software produced by the project be approved by the Open Source Initiative (OSI).

Select: **Met** | URL required: no

Justification to paste:

```text
AGPL-3.0-or-later is approved by the Open Source Initiative. https://github.com/Axiumine/c15t/blob/main/LICENSE
```

Evidence: [LICENSE](https://github.com/Axiumine/c15t/blob/main/LICENSE)

##### `license_location` (MUST): Met

> The project MUST post the license(s) of its results in a standard location in their source repository.

Select: **Met** | URL required: yes

Justification to paste:

```text
The license text is the top-level file LICENSE (a copy for the REUSE convention is in LICENSES/AGPL-3.0-or-later.txt). https://github.com/Axiumine/c15t/blob/main/LICENSE
```

Evidence: [LICENSE](https://github.com/Axiumine/c15t/blob/main/LICENSE), [LICENSES/AGPL-3.0-or-later.txt](https://github.com/Axiumine/c15t/blob/main/LICENSES/AGPL-3.0-or-later.txt)

#### Documentation

##### `documentation_basics` (MUST): Met

> The project MUST provide basic documentation for the software produced by the project.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
README.md documents how to install (Getting started, prerequisites, yarn install), start (yarn dev; systemd units for production), use (Dashboard screens, Adding a website) and use it securely (Security notes and docs/security-model.md). https://github.com/Axiumine/c15t/blob/main/README.md
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

##### `documentation_interface` (MUST): Met

> The project MUST provide reference documentation that describes the external interface (both input and output) of the software produced by the project.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
README.md documents the external interface: the dashboard-api route table (method, path, guard, purpose), the consent-api URL layout /s/<siteKey>/* that serves the documented c15t HTTP endpoints, and every configuration variable (README Configuration and env.example). https://github.com/Axiumine/c15t/blob/main/README.md
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [env.example](https://github.com/Axiumine/c15t/blob/main/env.example)

#### Other

##### `sites_https` (MUST): Met

> The project sites (website, repository, and download URLs) MUST support HTTPS using TLS.

Select: **Met** | URL required: no

Justification to paste:

```text
The project site, repository and downloads are served by GitHub over HTTPS only: https://github.com/Axiumine/c15t and https://github.com/Axiumine/c15t/releases
```

##### `discussion` (MUST): Met [M7]

> The project MUST have one or more mechanisms for discussion (including proposed changes and issues) that are searchable, allow messages and topics to be addressed by URL, enable new people to participate in some of the discussions, and do not require client-side installation of proprietary software.

Select: **Met** | URL required: no

Justification to paste:

```text
GitHub Issues and pull request discussions are used: they are searchable, every thread has a URL, anyone with a GitHub account can take part, and no proprietary client is needed. https://github.com/Axiumine/c15t/issues
```

Evidence: [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md)

Depends on: M7 (section 1).

##### `english` (SHOULD): Met

> The project SHOULD provide documentation in English and be able to accept bug reports and comments about code in English.

Select: **Met** | URL required: no

Justification to paste:

```text
All documentation, issue templates and code comments are in English, and issues and pull requests are accepted in English.
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md)

##### `maintained` (MUST): Met [M1]

> The project MUST be maintained.

Select: **Met** | URL required: no

Justification to paste:

```text
The project is actively maintained: the maintainer commits regularly, CI, CodeQL and Dependabot run on the repository, and reports are handled as described in SUPPORT.md and SECURITY.md. https://github.com/Axiumine/c15t/commits/main
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md), [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md)

Depends on: M1 (section 1).

### Passing: Change Control

#### Public version-controlled source repository

##### `repo_public` (MUST): Met [M1]

> The project MUST have a version-controlled source repository that is publicly readable and has a URL.

Select: **Met** | URL required: no

Justification to paste:

```text
The source repository is public on GitHub: https://github.com/Axiumine/c15t
```

Depends on: M1 (section 1).

##### `repo_track` (MUST): Met [M1]

> The project's source repository MUST track what changes were made, who made the changes, and when the changes were made.

Select: **Met** | URL required: no

Justification to paste:

```text
The repository is a git repository, which records what changed, who made the change and when; GitHub shows it at https://github.com/Axiumine/c15t/commits/main
```

Depends on: M1 (section 1).

##### `repo_interim` (MUST): Met [M1]

> To enable collaborative review, the project's source repository MUST include interim versions for review between releases; it MUST NOT include only final releases.

Select: **Met** | URL required: no

Justification to paste:

```text
Development happens in the public repository: every commit and every pull request branch is visible, not only releases. https://github.com/Axiumine/c15t/commits/main
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md)

Depends on: M1 (section 1).

##### `repo_distributed` (SUGGESTED): Met [M1]

> It is SUGGESTED that common distributed version control software be used (e.g., git) for the project's source repository.

Select: **Met** | URL required: no

Justification to paste:

```text
The project uses git, hosted on GitHub.
```

Depends on: M1 (section 1).

#### Unique version numbering

##### `version_unique` (MUST): Met [M6]

> The project results MUST have a unique version identifier for each release intended to be used by users.

Select: **Met** | URL required: no

Justification to paste:

```text
Each release has a unique SemVer tag vMAJOR.MINOR.PATCH; the release workflow (.github/workflows/release.yml, scripts/release-package.sh) refuses a tag that is not a semantic version, does not match the version in package.json, or points at a commit that is not on main. A deployment is additionally identified by its git commit SHA (infra/deploy.sh builds releases/<git sha>).
```

Evidence: [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml), [scripts/release-package.sh](https://github.com/Axiumine/c15t/blob/main/scripts/release-package.sh), [infra/deploy.sh](https://github.com/Axiumine/c15t/blob/main/infra/deploy.sh), [CHANGELOG.md](https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md)

Depends on: M6 (section 1).

##### `version_semver` (SUGGESTED): Met [M6]

> It is SUGGESTED that the Semantic Versioning (SemVer) or Calendar Versioning (CalVer) version numbering format be used for releases. It is SUGGESTED that those who use CalVer include a micro level value.

Select: **Met** | URL required: no

Justification to paste:

```text
Releases use Semantic Versioning (vMAJOR.MINOR.PATCH); CHANGELOG.md states that the project adheres to SemVer. https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md
```

Evidence: [CHANGELOG.md](https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md)

Depends on: M6 (section 1).

##### `version_tags` (SUGGESTED): Met [M6]

> It is SUGGESTED that projects identify each release within their version control system. For example, it is SUGGESTED that those using git identify each release using git tags.

Select: **Met** | URL required: no

Justification to paste:

```text
Every release is a git tag v<MAJOR>.<MINOR>.<PATCH> on a commit of main whose package.json version matches; pushing the tag starts the release workflow. https://github.com/Axiumine/c15t/tags
```

Evidence: [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml), [CHANGELOG.md](https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md)

Depends on: M6 (section 1).

#### Release notes

##### `release_notes` (MUST): Met [M6]

> The project MUST provide, in each release, release notes that are a human-readable summary of major changes in that release to help users determine if they should upgrade and what the upgrade impact will be. The release notes MUST NOT be the raw output of a version control log (e.g., the "git log" command results are not release notes). Projects whose results are not intended for reuse in multiple locations (such ...

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
Each release has human-written release notes: CHANGELOG.md (Keep a Changelog format, one section per version) and the GitHub Release page, which the release workflow fills from the version section of CHANGELOG.md (scripts/release-notes.sh), followed by instructions to verify the assets. https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md
```

Evidence: [CHANGELOG.md](https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md), [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml), [scripts/release-notes.sh](https://github.com/Axiumine/c15t/blob/main/scripts/release-notes.sh)

Depends on: M6 (section 1).

##### `release_notes_vulns` (MUST): N/A

> The release notes MUST identify every publicly known run-time vulnerability fixed in this release that already had a CVE assignment or similar when the release was created. This criterion may be marked as not applicable (N/A) if users typically cannot practically update the software themselves (e.g., as is often true for kernel updates). This criterion applies only to the project results, not to its dependencies. ...

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
No publicly known run-time vulnerability with a CVE has been fixed in any release so far. A security fix gets its own Security heading in CHANGELOG.md that names the advisory and CVE (see SECURITY.md).
```

Evidence: [CHANGELOG.md](https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md), [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md)

### Passing: Reporting

#### Bug-reporting process

##### `report_process` (MUST): Met [M7]

> The project MUST provide a process for users to submit bug reports (e.g., using an issue tracker or a mailing list).

Select: **Met** | URL required: yes

Justification to paste:

```text
Bugs are reported through GitHub Issues with a bug report form: https://github.com/Axiumine/c15t/issues/new/choose ; the process is described in SUPPORT.md and CONTRIBUTING.md.
```

Evidence: [.github/ISSUE_TEMPLATE/bug_report.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/bug_report.yml), [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md), [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md)

Depends on: M7 (section 1).

##### `report_tracker` (SHOULD): Met [M7]

> The project SHOULD use an issue tracker for tracking individual issues.

Select: **Met** | URL required: no

Justification to paste:

```text
GitHub Issues is the issue tracker: https://github.com/Axiumine/c15t/issues
```

Evidence: [.github/ISSUE_TEMPLATE/config.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/config.yml)

Depends on: M7 (section 1).

##### `report_responses` (MUST): Met [M9]

> The project MUST acknowledge a majority of bug reports submitted in the last 2-12 months (inclusive); the response need not include a fix.

Select: **Met** | URL required: no

Justification to paste:

```text
The maintainer acknowledges every bug report (SUPPORT.md: new issues are looked at within a week); at the time of writing no bug report from the last 12 months is unanswered. https://github.com/Axiumine/c15t/issues?q=is%3Aissue
```

Evidence: [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md)

Depends on: M9 (section 1).

##### `enhancement_responses` (SHOULD): Met [M9]

> The project SHOULD respond to a majority (&gt;50%) of enhancement requests in the last 2-12 months (inclusive).

Select: **Met** | URL required: no

Justification to paste:

```text
The maintainer responds to enhancement requests (accept, decline or discuss); at the time of writing no enhancement request from the last 12 months is unanswered. https://github.com/Axiumine/c15t/issues?q=is%3Aissue
```

Evidence: [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md), [.github/ISSUE_TEMPLATE/feature_request.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/feature_request.yml)

Depends on: M9 (section 1).

##### `report_archive` (MUST): Met [M7]

> The project MUST have a publicly available archive for reports and responses for later searching.

Select: **Met** | URL required: yes

Justification to paste:

```text
GitHub Issues keeps a public, searchable archive of all reports and responses, closed ones included: https://github.com/Axiumine/c15t/issues?q=is%3Aissue
```

Depends on: M7 (section 1).

#### Vulnerability report process

##### `vulnerability_report_process` (MUST): Met

> The project MUST publish the process for reporting vulnerabilities on the project site.

Select: **Met** | URL required: yes

Justification to paste:

```text
SECURITY.md publishes the process: report privately through GitHub Security Advisories, with response and fix targets and supported versions. https://github.com/Axiumine/c15t/blob/main/SECURITY.md
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md)

##### `vulnerability_report_private` (MUST): Met [M2]

> If private vulnerability reports are supported, the project MUST include how to send the information in a way that is kept private.

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
Private reports go through GitHub private vulnerability reporting over HTTPS at https://github.com/Axiumine/c15t/security/advisories/new , as described in https://github.com/Axiumine/c15t/blob/main/SECURITY.md ; only the maintainers can read them.
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md), [.github/ISSUE_TEMPLATE/config.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/config.yml)

Depends on: M2 (section 1).

##### `vulnerability_report_response` (MUST): N/A [M9]

> The project's initial response time for any vulnerability report received in the last 6 months MUST be less than or equal to 14 days.

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
No vulnerability report has been received in the last 6 months. SECURITY.md commits to acknowledging a report within 3 business days and giving a first assessment within 7 days, both inside the 14-day limit.
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md)

Depends on: M9 (section 1).

### Passing: Quality

#### Working build system

##### `build` (MUST): Met

> If the software produced by the project requires building for use, the project MUST provide a working build system that can automatically rebuild the software from source code.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
yarn build (yarn workspaces foreach -Apt run build: tsc -b project references plus a Vite build for the dashboard) rebuilds every component from source; the CI workflow runs it on every pull request and every push to main. https://github.com/Axiumine/c15t/blob/main/package.json
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

##### `build_common_tools` (SUGGESTED): Met

> It is SUGGESTED that common tools be used for building the software.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The build uses the standard JavaScript tooling: Yarn 4 workspaces, the TypeScript compiler (tsc -b) and Vite.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [tsconfig.json](https://github.com/Axiumine/c15t/blob/main/tsconfig.json)

##### `build_floss_tools` (SHOULD): Met

> The project SHOULD be buildable using only FLOSS tools.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Node.js, Yarn, TypeScript, Vite, Vitest and Biome are all FLOSS; nothing proprietary is needed to build or test the project.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json)

#### Automated test suite

##### `test` (MUST): Met

> The project MUST use at least one automated test suite that is publicly released as FLOSS (this test suite may be maintained as a separate FLOSS project). The project MUST clearly show or document how to run the test suite(s) (e.g., via a continuous integration (CI) script or via documentation in files such as BUILD.md, README.md, or CONTRIBUTING.md).

Select: **Met** | URL required: no

Justification to paste:

```text
The automated test suite is Vitest (unit tests, component tests, property-based tests, and integration tests on PGlite and on a real PostgreSQL), stored next to the code as *.test.ts / *.test.tsx. It is run with yarn test, documented in the README (Getting started) and CONTRIBUTING.md, and run by CI. https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [vitest.config.ts](https://github.com/Axiumine/c15t/blob/main/vitest.config.ts), [apps/dashboard-api/src/authz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/authz.test.ts)

##### `test_invocation` (SHOULD): Met

> A test suite SHOULD be invocable in a standard way for that language.

Select: **Met** | URL required: no

Justification to paste:

```text
The suite is invoked with yarn test (which runs vitest run), the standard script name in a Yarn/Node project.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json)

##### `test_most` (SUGGESTED): Unmet [M10]

> It is SUGGESTED that the test suite cover most (or ideally all) the code branches, input fields, and functionality.

Select: **Unmet** | URL required: no

Justification to paste (optional for Unmet):

```text
The suite targets the security-critical paths (authorization, tenant isolation, env validation, failover handling, migrations, every API route) but no coverage figure has been read from a CI run yet (CI produces the coverage report on every run, artifact "coverage"), so this is not claimed as Met.
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

Depends on: M10 (section 1).

To reach Met: SUGGESTED, so it does not block the badge. @vitest/coverage-v8 is a pinned devDependency (5.0.5) and ci.yml always produces the coverage report, so nothing needs to be added. After the first CI run on main, read the real statement and branch percentages from the `coverage` artifact (see silver test_statement_coverage80); flip to Met only if they show that most statements and branches are covered, and never claim a figure that was not measured.

##### `test_continuous_integration` (SUGGESTED): Met

> It is SUGGESTED that the project implement continuous integration (where new or changed code is frequently integrated into a central code repository and automated tests are run on the result).

Select: **Met** | URL required: no

Justification to paste:

```text
GitHub Actions (.github/workflows/ci.yml) runs typecheck, lint, the SPDX header check, the test suites (with a PostgreSQL service container, with coverage) and the build on every pull request and every push to main. https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

#### New functionality testing

##### `test_policy` (MUST): Met

> The project MUST have a general policy (formal or not) that as major new functionality is added to the software produced by the project, tests of that functionality should be added to an automated test suite.

Select: **Met** | URL required: no

Justification to paste:

```text
CONTRIBUTING.md states the policy: new functionality and bug fixes must come with automated tests; the pull request template has a checklist item for it. https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [.github/PULL_REQUEST_TEMPLATE.md](https://github.com/Axiumine/c15t/blob/main/.github/PULL_REQUEST_TEMPLATE.md)

##### `tests_are_added` (MUST): Met

> The project MUST have evidence that the test_policy for adding tests has been adhered to in the most recent major changes to the software produced by the project.

Select: **Met** | URL required: no

Justification to paste:

```text
The major features each have their own tests: authorization and tenant isolation (apps/dashboard-api/src/authz.test.ts, route-coverage.test.ts), the consent-api request guard and registry (apps/consent-api/src/*.test.ts, integration.test.ts), Patroni failover handling (packages/db/src/failover.test.ts) and the dashboard screens (apps/dashboard-web/src/*.test.tsx).
```

Evidence: [apps/dashboard-api/src/authz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/authz.test.ts), [apps/dashboard-api/src/route-coverage.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/route-coverage.test.ts), [apps/consent-api/src/integration.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/integration.test.ts), [packages/db/src/failover.test.ts](https://github.com/Axiumine/c15t/blob/main/packages/db/src/failover.test.ts)

##### `tests_documented_added` (SUGGESTED): Met

> It is SUGGESTED that this policy on adding tests (see test_policy) be documented in the instructions for change proposals.

Select: **Met** | URL required: no

Justification to paste:

```text
The test policy is part of the instructions for change proposals: CONTRIBUTING.md and the pull request template (.github/PULL_REQUEST_TEMPLATE.md) both require tests for new behavior.
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [.github/PULL_REQUEST_TEMPLATE.md](https://github.com/Axiumine/c15t/blob/main/.github/PULL_REQUEST_TEMPLATE.md)

#### Warning flags

##### `warnings` (MUST): Met

> The project MUST enable one or more compiler warning flags, a "safe" language mode, or use a separate "linter" tool to look for code quality errors or common simple mistakes, if there is at least one FLOSS tool that can implement this criterion in the selected language.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
TypeScript runs in strict mode with extra checks (noUncheckedIndexedAccess, exactOptionalPropertyTypes, noUnusedLocals, noUnusedParameters, noImplicitReturns, noImplicitOverride) from packages/config/tsconfig.base.json, and the Biome linter (yarn lint) runs its recommended rules with no-explicit-any, no-unused-variables and no-non-null-assertion as errors; both run in CI. https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json
```

Evidence: [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json), [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json), [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

##### `warnings_fixed` (MUST): Met

> The project MUST address warnings.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
yarn lint (biome check on 265 files when last run, 2026-10-30) reports no errors and no warnings, and the TypeScript build has noEmitOnError set; CI fails on any compiler or linter error, so code is not merged with open diagnostics.
```

Evidence: [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json), [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

##### `warnings_strict` (SUGGESTED): Met

> It is SUGGESTED that projects be maximally strict with warnings in the software produced by the project, where practical.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The project is maximally strict where practical: TypeScript strict plus noUncheckedIndexedAccess, exactOptionalPropertyTypes, noPropertyAccessFromIndexSignature, noUnused* and erasableSyntaxOnly, and Biome rules for any, unused code and non-null assertions at error level. https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json
```

Evidence: [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json), [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json)

### Passing: Security

#### Secure development knowledge

##### `know_secure_design` (MUST): Met

> The project MUST have at least one primary developer who knows how to design secure software. (See 'details' for the exact requirements.)

Select: **Met** | URL required: no

Justification to paste:

```text
The primary developer designed the platform around the secure design principles: deny-by-default authorization with every check in one module (authz.ts) and a route-coverage test (complete mediation), least-privilege database roles and hardened systemd units, zod allowlist validation at every boundary, loopback/private-only bind addresses (limited attack surface). See https://github.com/Axiumine/c15t/blob/main/docs/security-model.md
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md), [apps/dashboard-api/src/authz.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/authz.ts), [apps/dashboard-api/src/route-coverage.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/route-coverage.test.ts)

Note: Self-attestation by the primary developer: the maintainer must be comfortable with this statement before pasting.

##### `know_common_errors` (MUST): Met

> At least one of the project's primary developers MUST know of common kinds of errors that lead to vulnerabilities in this kind of software, as well as at least one method to counter or mitigate each of them.

Select: **Met** | URL required: no

Justification to paste:

```text
The primary developer knows the common vulnerability classes (OWASP Top 10) and the project counters them: injection (Drizzle/postgres.js parameterized queries, zod validation), broken access control (authz.ts plus tests that a user cannot read another site), XSS (React escaping, strict CSP), CSRF (Better Auth origin check, SameSite=Lax), CSV formula injection (neutralized cells), spoofed proxy headers (trusted-proxy stripping). https://github.com/Axiumine/c15t/blob/main/docs/security-model.md
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md), [apps/dashboard-api/src/csv.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/csv.ts), [apps/consent-api/src/request-guard.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/request-guard.ts)

Note: Self-attestation by the primary developer.

#### Use basic good cryptographic practices

##### `crypto_published` (MUST): Met

> The software produced by the project MUST use, by default, only cryptographic protocols and algorithms that are publicly published and reviewed by experts (if cryptographic protocols and algorithms are used).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Only published, expert-reviewed algorithms are used, always through libraries: scrypt for password hashing (Better Auth via node:crypto), a CSPRNG (node:crypto randomInt) for generated passwords, and TLS 1.2/1.3 at nginx/Cloudflare. The repository contains no custom cryptography.
```

Evidence: [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts), [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts), [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

##### `crypto_call` (SHOULD): Met

> If the software produced by the project is an application or library, and its primary purpose is not to implement cryptography, then it SHOULD only call on software specifically designed to implement cryptographic functions; it SHOULD NOT re-implement its own.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The software calls specialized cryptographic software and implements none itself: node:crypto (apps/dashboard-api/src/password.ts) and Better Auth (auth.ts) for hashing, sessions and tokens, and nginx for TLS.
```

Evidence: [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts), [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts)

##### `crypto_floss` (MUST): Met

> All functionality in the software produced by the project that depends on cryptography MUST be implementable using FLOSS.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
All functionality that depends on cryptography is implemented with FLOSS: Node.js/OpenSSL (node:crypto), Better Auth and nginx.
```

Evidence: [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts)

##### `crypto_keylength` (MUST): N/A

> The security mechanisms within the software produced by the project MUST use default keylengths that at least meet the NIST minimum requirements through the year 2030 (as stated in 2012). It MUST be possible to configure the software so that smaller keylengths are completely disabled.

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The software does not generate keys or choose key lengths itself: password hashing is Better Auth (scrypt, 64-byte derived key, 128-bit salt) and TLS is terminated by nginx/Cloudflare outside the project code. The only operator-supplied secret, BETTER_AUTH_SECRET, must be at least 32 characters (env.ts).
```

Evidence: [apps/dashboard-api/src/env.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/env.ts), [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts)

##### `crypto_working` (MUST): Met

> The default security mechanisms within the software produced by the project MUST NOT depend on broken cryptographic algorithms (e.g., MD4, MD5, single DES, RC4, Dual_EC_DRBG), or use cipher modes that are inappropriate to the context, unless they are necessary to implement an interoperable protocol (where the protocol implemented is the most recent version of that standard broadly supported by the network ecosyste...

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
No broken algorithm or mode is used: the source contains no MD4/MD5/SHA-1/DES/RC4/ECB (no createHash or createCipher calls), passwords use scrypt, and the reference nginx config allows only TLS 1.2 and 1.3 (infra/nginx/dashboard.conf).
```

Evidence: [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts), [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf)

##### `crypto_weaknesses` (SHOULD): Met

> The default security mechanisms within the software produced by the project SHOULD NOT depend on cryptographic algorithms or modes with known serious weaknesses (e.g., the SHA-1 cryptographic hash algorithm or the CBC mode in SSH).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The default security mechanisms do not depend on algorithms with known serious weaknesses (no SHA-1, no CBC-mode ciphers in the code); password hashing is scrypt and TLS is limited to 1.2/1.3 in the reference nginx config.
```

Evidence: [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts), [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf)

##### `crypto_pfs` (SHOULD): N/A

> The security mechanisms within the software produced by the project SHOULD implement perfect forward secrecy for key agreement protocols so a session key derived from a set of long-term keys cannot be compromised if one of the long-term keys is compromised in the future.

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The software implements no key-agreement protocol. TLS is terminated by nginx/Cloudflare, outside the project code; the reference nginx configuration (infra/nginx/dashboard.conf) allows only TLS 1.2 and 1.3.
```

Evidence: [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf)

##### `crypto_password_storage` (MUST): Met

> If the software produced by the project causes the storing of passwords for authentication of external users, the passwords MUST be stored as iterated hashes with a per-user salt by using a key stretching (iterated) algorithm (e.g., Argon2id, Bcrypt, Scrypt, or PBKDF2). See also OWASP Password Storage Cheat Sheet.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Dashboard passwords are stored by Better Auth as scrypt hashes (node:crypto scrypt, N=16384, r=16, p=1, 64-byte key) with a random per-password salt; plaintext passwords are never stored or logged (generated passwords are shown once).
```

Evidence: [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts), [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts), [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

##### `crypto_random` (MUST): Met

> The security mechanisms within the software produced by the project MUST generate all cryptographic keys and nonces using a cryptographically secure random number generator, and MUST NOT do so using generators that are cryptographically insecure.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Generated passwords use node:crypto randomInt (CSPRNG) and Better Auth creates session tokens and IDs with crypto.getRandomValues. The only Math.random use is jitter for reconnect backoff in apps/consent-api/src/listener.ts, which is not a key or a nonce.
```

Evidence: [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts), [apps/consent-api/src/listener.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/listener.ts)

#### Secured delivery against man-in-the-middle (MITM) attacks

##### `delivery_mitm` (MUST): Met [M6]

> The project MUST use a delivery mechanism that counters MITM attacks. Using https or ssh+scp is acceptable.

Select: **Met** | URL required: no

Justification to paste:

```text
Source and release assets are delivered only over HTTPS from github.com (https://github.com/Axiumine/c15t/releases); release assets are additionally signed with Sigstore cosign and carry SLSA provenance, so tampering is detectable.
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md), [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml)

Depends on: M6 (section 1).

##### `delivery_unsigned` (MUST): Met [M6]

> A cryptographic hash (e.g., a sha1sum) MUST NOT be retrieved over http and used without checking for a cryptographic signature.

Select: **Met** | URL required: no

Justification to paste:

```text
No hash is retrieved over HTTP. SHA256SUMS is published on the HTTPS GitHub Release page together with a cosign signature bundle; the verification steps are in SECURITY.md (Verifying releases).
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md), [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml)

Depends on: M6 (section 1).

#### Publicly known vulnerabilities fixed

##### `vulnerabilities_fixed_60_days` (MUST): Met [M5]

> There MUST be no unpatched vulnerabilities of medium or higher severity that have been publicly known for more than 60 days.

Select: **Met** | URL required: no

Justification to paste:

```text
There is no known unpatched vulnerability of medium or higher severity. SECURITY.md sets 60 days (30 for critical and high) as the fix target, and docs/dependency-policy.md sets 7 days (critical), 14 days (high) and 60 days (medium) for vulnerable dependencies. https://github.com/Axiumine/c15t/security
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md), [docs/dependency-policy.md](https://github.com/Axiumine/c15t/blob/main/docs/dependency-policy.md)

Depends on: M5 (section 1).

##### `vulnerabilities_critical_fixed` (SHOULD): Met

> Projects SHOULD fix all critical vulnerabilities rapidly after they are reported.

Select: **Met** | URL required: no

Justification to paste:

```text
SECURITY.md targets a fix within 30 days for critical and high severity issues, and docs/dependency-policy.md within 7 days for a critical dependency advisory; no critical vulnerability is currently known.
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md), [docs/dependency-policy.md](https://github.com/Axiumine/c15t/blob/main/docs/dependency-policy.md)

#### Other security issues

##### `no_leaked_credentials` (MUST): Met [M5, M8]

> The public repositories MUST NOT leak a valid private credential (e.g., a working password or private key) that is intended to limit public access.

Select: **Met** | URL required: no

Justification to paste:

```text
The repository holds no valid private credential: the real environment files are git-ignored, env.example contains only empty placeholders and commented defaults, production secrets live in /etc/c15t-platform/*.env outside the tree, and the tests generate throwaway values at run time (the only fixed password, in ci.yml, belongs to a PostgreSQL service container that exists for the duration of one CI job). GitHub secret scanning with push protection is enabled.
```

Evidence: [.gitignore](https://github.com/Axiumine/c15t/blob/main/.gitignore), [env.example](https://github.com/Axiumine/c15t/blob/main/env.example), [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

Depends on: M5, M8 (section 1).

### Passing: Analysis

#### Static code analysis

##### `static_analysis` (MUST): Met

> At least one static code analysis tool (beyond compiler warnings and "safe" language modes) MUST be applied to any proposed major production release of the software before its release, if there is at least one FLOSS tool that implements this criterion in the selected language.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
CodeQL (JavaScript/TypeScript and GitHub Actions workflows, security-extended queries, GitHub code scanning) runs on every pull request to main, on every push to main and weekly (.github/workflows/codeql.yml), so before any release (releases are cut from main); Biome and the strict TypeScript compiler also run in CI. https://github.com/Axiumine/c15t/blob/main/.github/workflows/codeql.yml
```

Evidence: [.github/workflows/codeql.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/codeql.yml), [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

##### `static_analysis_common_vulnerabilities` (SUGGESTED): Met

> It is SUGGESTED that at least one of the static analysis tools used for the static_analysis criterion include rules or approaches to look for common vulnerabilities in the analyzed language or environment.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
CodeQL runs its security-extended query suite for JavaScript/TypeScript (injection, XSS, path traversal, insecure randomness, hard-coded credentials) and for GitHub Actions workflows (script injection); see .github/workflows/codeql.yml.
```

Evidence: [.github/workflows/codeql.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/codeql.yml)

##### `static_analysis_fixed` (MUST): Met [M10]

> All medium and higher severity exploitable vulnerabilities discovered with static code analysis MUST be fixed in a timely way after they are confirmed.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
No medium or higher severity finding is open in code scanning at the time of writing; SECURITY.md sets 60 days (30 for critical and high) as the maximum time to fix a confirmed vulnerability. https://github.com/Axiumine/c15t/security/code-scanning
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md)

Depends on: M10 (section 1).

##### `static_analysis_often` (SUGGESTED): Met

> It is SUGGESTED that static source code analysis occur on every commit or at least daily.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
CodeQL runs on every pull request to main and every push to main, plus a weekly schedule; Biome and tsc run in CI on every pull request and every push to main.
```

Evidence: [.github/workflows/codeql.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/codeql.yml), [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

#### Dynamic code analysis

##### `dynamic_analysis` (SUGGESTED): Met

> It is SUGGESTED that at least one dynamic analysis tool be applied to any proposed major production release of the software before its release.

Select: **Met** | URL required: no

Justification to paste:

```text
Property-based tests with fast-check (13 files named *.fuzz.test.ts, hundreds of random inputs per property) attack the parsers and validators that face untrusted input: request guard, site keys, CIDR and host parsing, CSV export, pagination cursors, password generation. They run with yarn test in CI on every pull request and every push to main, and a release can only be cut from a commit on main, so they run before every release. This varies inputs but is not a coverage-guided fuzzer or a web scanner.
```

Evidence: [apps/consent-api/src/request-guard.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/request-guard.fuzz.test.ts), [packages/shared/src/network.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/packages/shared/src/network.fuzz.test.ts), [apps/dashboard-api/src/csv.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/csv.fuzz.test.ts), [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

##### `dynamic_analysis_unsafe` (SUGGESTED): N/A

> It is SUGGESTED that if the software produced by the project includes software written using a memory-unsafe language (e.g., C or C++), then at least one dynamic tool (e.g., a fuzzer or web application scanner) be routinely used in combination with a mechanism to detect memory safety problems such as buffer overwrites. If the project does not produce software written in a memory-unsafe language, choose "not applic...

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The project is written in TypeScript and runs on Node.js, which are memory-safe; there is no C or C++ code and no native addon of its own.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json)

##### `dynamic_analysis_enable_assertions` (SUGGESTED): Met

> It is SUGGESTED that the project use a configuration for at least some dynamic analysis (such as testing or fuzzing) which enables many assertions. In many cases these assertions should not be enabled in production builds.

Select: **Met** | URL required: no

Justification to paste:

```text
Every test run, including the property-based tests, executes with assertions on: the Vitest suites assert behavior throughout, and production invariants (zod boundary validation, the registry re-check that trustedOrigins is non-empty) are always active because JavaScript has no assertion-stripping build mode.
```

Evidence: [apps/dashboard-api/src/route-coverage.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/route-coverage.test.ts), [apps/consent-api/src/registry.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/registry.ts)

##### `dynamic_analysis_fixed` (MUST): N/A

> All medium and higher severity exploitable vulnerabilities discovered with dynamic code analysis MUST be fixed in a timely way after they are confirmed.

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
No medium or higher severity exploitable vulnerability has been found by dynamic analysis so far; any finding would be handled under SECURITY.md.
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md)

## 5. Silver level

All 55 silver criteria, in the order of the form. Silver needs the passing badge first (`achieve_passing`). For SHOULD and SUGGESTED criteria "Unmet" does not block the badge, but the form wants a justification.

### Silver: Basics

#### Prerequisites

##### `achieve_passing` (MUST): Met [M0]

> The project MUST achieve a passing level badge.

Select: **Met** | URL required: no

Justification to paste:

```text
The project holds the passing badge (computed automatically by the site).
```

Depends on: M0 (section 1).

Note: Computed by bestpractices.dev: it turns Met when every passing criterion above is satisfied.

#### Basic project website content

##### `contribution_requirements` (MUST): Met

> The information on how to contribute MUST include the requirements for acceptable contributions (e.g., a reference to any required coding standard).

Select: **Met** | URL required: yes

Justification to paste:

```text
CONTRIBUTING.md states what an acceptable contribution is: it follows the strict TypeScript and Biome configuration (packages/config), passes yarn typecheck, yarn lint and yarn test, adds tests, carries the SPDX header and a DCO sign-off. https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json)

#### Project oversight

##### `dco` (SHOULD): Met

> The project SHOULD have a legal mechanism where all developers of non-trivial amounts of project software assert that they are legally authorized to make these contributions. The most common and easily-implemented approach for doing this is by using a Developer Certificate of Origin (DCO), where users add "signed-off-by" in their commits and the project links to the DCO website. However, this MAY be implemented as...

Select: **Met** | URL required: yes

Justification to paste:

```text
Contributors assert the right to contribute with a Developer Certificate of Origin: every commit needs a Signed-off-by line (git commit -s), explained in CONTRIBUTING.md with a link to https://developercertificate.org ; a CI check (.github/workflows/dco.yml) fails a pull request with an unsigned commit; there is no CLA. https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [.github/workflows/dco.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/dco.yml), [scripts/check-dco.sh](https://github.com/Axiumine/c15t/blob/main/scripts/check-dco.sh), [.github/PULL_REQUEST_TEMPLATE.md](https://github.com/Axiumine/c15t/blob/main/.github/PULL_REQUEST_TEMPLATE.md)

##### `governance` (MUST): Met

> The project MUST clearly define and document its project governance model (the way it makes decisions, including key roles).

Select: **Met** | URL required: yes

Justification to paste:

```text
GOVERNANCE.md documents the governance model: roles, how decisions are made, how to become a maintainer, and the current bus-factor-of-one status. https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

##### `code_of_conduct` (MUST): Met

> The project MUST adopt a code of conduct and post it in a standard location.

Select: **Met** | URL required: yes

Justification to paste:

```text
The project adopted the Contributor Covenant as CODE_OF_CONDUCT.md in the repository root. https://github.com/Axiumine/c15t/blob/main/CODE_OF_CONDUCT.md
```

Evidence: [CODE_OF_CONDUCT.md](https://github.com/Axiumine/c15t/blob/main/CODE_OF_CONDUCT.md)

##### `roles_responsibilities` (MUST): Met

> The project MUST clearly define and publicly document the key roles in the project and their responsibilities, including any tasks those roles must perform. It MUST be clear who has which role(s), though this might not be documented in the same way.

Select: **Met** | URL required: yes

Justification to paste:

```text
GOVERNANCE.md defines the roles (maintainer, contributor, repository owner) with their responsibilities and names who holds them (@giovannimanzoni is the sole maintainer; the Axiumine organization owns the repository). https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md), [.github/CODEOWNERS](https://github.com/Axiumine/c15t/blob/main/.github/CODEOWNERS)

##### `access_continuity` (MUST): Unmet

> The project MUST be able to continue with minimal interruption if any one person dies, is incapacitated, or is otherwise unable or unwilling to continue support of the project. In particular, the project MUST be able to create and close issues, accept proposed changes, and release versions of software, within a week of confirmation of the loss of support from any one individual. This MAY be done by ensuring someon...

Select: **Unmet** | URL required: yes

Justification to paste (optional for Unmet):

```text
The project has a single maintainer. If that person were unavailable, nobody else could merge changes, cut a release or answer security reports within a week. GOVERNANCE.md says so openly. https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

To reach Met: Needs a second trusted person with admin access to the repository and the Axiumine organization (second organization owner), able to create and close issues, merge and tag a release (releases are built by CI from tags, with no manual signing key). Document it in GOVERNANCE.md.

##### `bus_factor` (SHOULD): Unmet

> The project SHOULD have a "bus factor" of 2 or more.

Select: **Unmet** | URL required: yes

Justification to paste (optional for Unmet):

```text
The bus factor is 1: there is one maintainer. GOVERNANCE.md states this and lists adding a second maintainer as a goal. https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

To reach Met: SHOULD criterion, so it does not block silver, but access_continuity does. Needs a second active maintainer.

#### Documentation

##### `documentation_roadmap` (MUST): Met

> The project MUST have a documented roadmap that describes what the project intends to do and not do for at least the next year.

Select: **Met** | URL required: yes

Justification to paste:

```text
The README section "Status and what is next" lists what is done (foundation, access control, consent views, hardening) and what is still open (the first release 0.1.0, a retention job for consent records, monitoring and cluster backups, calling the c15t admin endpoints through the node-sdk), the "Open questions" section lists the undecided points, and the design decisions D1 to D11 state what the project deliberately does not do (no Docker, no SSR, no SEO, no deletion of consent records). https://github.com/Axiumine/c15t/blob/main/README.md
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md)

Note: Be honest about this one. Phases 1 to 4 in the README are done, so the forward-looking part is the "Still open" list and the Open questions. Before pasting, check that those two lists really say what the project intends to do over the next 12 months and what it will not do (the D1 to D11 non-goals cover the second part). If they are too thin, add one sentence per item to the README, or switch this answer to Unmet (silver MUST); the summary tables then change by one criterion.

##### `documentation_architecture` (MUST): Met

> The project MUST include documentation of the architecture (aka high-level design) of the software produced by the project. If the project does not produce software, select "not applicable" (N/A).

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
The architecture (components, request flow, data model, decisions D1 to D11) is documented in the README Architecture and Decisions sections and mapped in docs/architecture.md. https://github.com/Axiumine/c15t/blob/main/docs/architecture.md
```

Evidence: [docs/architecture.md](https://github.com/Axiumine/c15t/blob/main/docs/architecture.md), [README.md](https://github.com/Axiumine/c15t/blob/main/README.md)

##### `documentation_security` (MUST): Met

> The project MUST document what the user can and cannot expect in terms of security from the software produced by the project (its "security requirements").

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
docs/security-model.md documents what users can and cannot expect: assets, actors and trust boundaries, what is protected and how, and an explicit list of what is NOT protected. https://github.com/Axiumine/c15t/blob/main/docs/security-model.md
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

##### `documentation_quick_start` (MUST): Met

> The project MUST provide a "quick start" guide for new users to help them quickly do something with the software.

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
The README Getting started section is the quick start: install with Yarn, prepare PostgreSQL, create the first admin and run yarn dev. https://github.com/Axiumine/c15t/blob/main/README.md
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md)

##### `documentation_current` (MUST): Met

> The project MUST make an effort to keep the documentation consistent with the current version of the project results (including software produced by the project). Any known documentation defects making it inconsistent MUST be fixed. If the documentation is generally current, but erroneously includes some older information that is no longer true, just treat that as a defect, then track and fix as usual.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The documentation is kept in step with the code: the pull request template asks for README/docs updates and CHANGELOG entries, and documentation defects are tracked as issues and fixed.
```

Evidence: [.github/PULL_REQUEST_TEMPLATE.md](https://github.com/Axiumine/c15t/blob/main/.github/PULL_REQUEST_TEMPLATE.md), [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md)

Note: This answer describes a process, so it holds only while the documentation really is kept current. Before pasting, spot-check the README commands, variable names and route table against the scripts in package.json, env.example and the code, and fix any difference as a documentation defect.

##### `documentation_achievements` (MUST): Met

> The project repository front page and/or website MUST identify and hyperlink to any achievements, including this best practices badge, within 48 hours of public recognition that the achievement has been attained.

Select: **Met** | URL required: yes

Justification to paste:

```text
The README front page shows and links the OpenSSF Best Practices badge (https://www.bestpractices.dev/projects/16093), the OpenSSF Scorecard badge and the CI badge. https://github.com/Axiumine/c15t/blob/main/README.md
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md)

Note: The badge is already in the first lines of README.md; its image turns to passing/silver by itself when the level is awarded.

#### Accessibility and internationalization

##### `accessibility_best_practices` (SHOULD): Met

> The project (both project sites and project results) SHOULD follow accessibility best practices so that persons with disabilities can still participate in the project and use the project results where it is reasonable to do so.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The dashboard follows accessibility practice: Radix UI primitives (via shadcn/ui), labels bound to every control, aria-invalid and aria-describedby on fields, role=alert for errors, lang set on the page; the project sites are on GitHub. No formal WCAG audit has been done.
```

Evidence: [apps/dashboard-web/src/components/form-field.tsx](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-web/src/components/form-field.tsx), [apps/dashboard-web/index.html](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-web/index.html)

##### `internationalization` (SHOULD): Unmet

> The software produced by the project SHOULD be internationalized to enable easy localization for the target audience's culture, region, or language. If internationalization (i18n) does not apply (e.g., the software doesn't generate text intended for end-users and doesn't sort human-readable text), select "not applicable" (N/A).

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
The dashboard UI text is English only and hard-coded; there is no message catalog. Dates and numbers are formatted with Intl using a fixed en-GB locale (apps/dashboard-web/src/lib/format.ts).
```

Evidence: [apps/dashboard-web/src/lib/format.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-web/src/lib/format.ts)

To reach Met: SHOULD criterion. Needs an i18n layer (for example a message catalog with locale selection) for the dashboard; consent banner texts are c15t's own translations.

#### Other

##### `sites_password_security` (MUST): Met

> If the project sites (website, repository, and download URLs) store passwords for authentication of external users, the passwords MUST be stored as iterated hashes with a per-user salt by using a key stretching (iterated) algorithm (e.g., Argon2id, Bcrypt, Scrypt, or PBKDF2). If the project sites do not store passwords for this purpose, select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The project sites are on GitHub, which stores passwords as salted, iterated hashes; the project runs no site of its own that stores external users' passwords.
```

### Silver: Change Control

#### Previous versions

##### `maintenance_or_update` (MUST): Met

> The project MUST maintain the most often used older versions of the product or provide an upgrade path to newer versions. If the upgrade path is difficult, the project MUST document how to perform the upgrade (e.g., the interfaces that have changed and detailed suggested steps to help upgrade).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Only the latest release line is supported (SECURITY.md, Supported versions). The upgrade path is documented: infra/deploy.sh builds a release, runs forward migrations and switches the current symlink (a rollback command re-activates the previous release; database migrations are not reverted), and CHANGELOG.md is where breaking changes are listed per version (there is no release yet; before 1.0.0 minor versions may contain breaking changes).
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md), [infra/deploy.sh](https://github.com/Axiumine/c15t/blob/main/infra/deploy.sh), [CHANGELOG.md](https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md)

### Silver: Reporting

#### Bug-reporting process

##### `report_tracker` (MUST): Met [M7]

> The project MUST use an issue tracker for tracking individual issues.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
GitHub Issues is the issue tracker for individual issues: https://github.com/Axiumine/c15t/issues
```

Evidence: [.github/ISSUE_TEMPLATE/bug_report.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/bug_report.yml)

Depends on: M7 (section 1).

#### Vulnerability report process

##### `vulnerability_report_credit` (MUST): N/A

> The project MUST give credit to the reporter(s) of all vulnerability reports resolved in the last 12 months, except for the reporter(s) who request anonymity. If there have been no vulnerabilities resolved in the last 12 months, select "not applicable" (N/A).

Select: **N/A** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
No vulnerability report has been resolved in the last 12 months. SECURITY.md promises credit to the reporter in the advisory and the changelog unless they prefer anonymity. https://github.com/Axiumine/c15t/blob/main/SECURITY.md
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md)

##### `vulnerability_response_process` (MUST): Met

> The project MUST have a documented process for responding to vulnerability reports.

Select: **Met** | URL required: yes

Justification to paste:

```text
SECURITY.md documents the response process: private advisory, acknowledgement within 3 business days, assessment within 7 days, CVSS rating, fix targets by severity, advisory and CVE, changelog note and reporter credit. https://github.com/Axiumine/c15t/blob/main/SECURITY.md
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md)

### Silver: Quality

#### Coding standards

##### `coding_standards` (MUST): Met

> The project MUST identify the specific coding style guides for the primary languages it uses, and require that contributions generally comply with it.

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
The coding standard is the checked-in Biome configuration (formatting and lint rules) and the strict TypeScript configuration; CONTRIBUTING.md requires contributions to comply. https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json
```

Evidence: [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json), [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json), [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md)

##### `coding_standards_enforced` (MUST): Met

> The project MUST automatically enforce its selected coding style(s) if there is at least one FLOSS tool that can do so in the selected language(s).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Biome (formatter and linter) and tsc run in CI on every pull request and every push to main (yarn lint, yarn typecheck) and fail the build on violations; exceptions would be inline and reviewable.
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml), [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json)

#### Working build system

##### `build_standard_variables` (MUST): N/A

> Build systems for native binaries MUST honor the relevant compiler and linker (environment) variables passed in to them (e.g., CC, CFLAGS, CXX, CXXFLAGS, and LDFLAGS) and pass them to compiler and linker invocations. A build system MAY extend them with additional flags; it MUST NOT simply replace provided values with its own. If no native binaries are being generated, select "not applicable" (N/A).

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The build produces no native binaries (TypeScript compiled to JavaScript plus a Vite bundle).
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json)

##### `build_preserve_debug` (SHOULD): Met

> The build and installation system SHOULD preserve debugging information if they are requested in the relevant flags (e.g., "install -s" is not used). If there is no build or installation system (e.g., typical JavaScript libraries), select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The build keeps debugging information: sourceMap and declarationMap are enabled in packages/config/tsconfig.base.json and nothing strips them.
```

Evidence: [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json)

##### `build_non_recursive` (MUST): Met

> The build system for the software produced by the project MUST NOT recursively build subdirectories if there are cross-dependencies in the subdirectories. If there is no build or installation system (e.g., typical JavaScript libraries), select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The build is not a recursive make-style build: tsc -b follows the explicit TypeScript project references in the root tsconfig.json, and Yarn builds workspaces in topological order (foreach -t), so cross-dependencies are tracked accurately.
```

Evidence: [tsconfig.json](https://github.com/Axiumine/c15t/blob/main/tsconfig.json), [package.json](https://github.com/Axiumine/c15t/blob/main/package.json)

##### `build_repeatable` (MUST): Met

> The project MUST be able to repeat the process of generating information from source files and get exactly the same bit-for-bit result. If no building occurs (e.g., scripting languages where the source code is used directly instead of being compiled), select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Two clean builds of the same commit (tsc -b for all workspaces plus the Vite build) produce byte-identical output: the SHA-256 sums of every file under dist/ matched (266 files when checked), also from two different checkout directories. Versions are pinned (exact versions, yarn.lock, Node 26 via .nvmrc).
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [yarn.lock](https://github.com/Axiumine/c15t/blob/main/yarn.lock), [.nvmrc](https://github.com/Axiumine/c15t/blob/main/.nvmrc)

Note: Verified once by hand on 2026-10-30 with Node v26.13.0 (clean copy, build twice, compare sha256sum; also built from a second directory). The source tree has changed since, and the check was not repeated when this document was last edited, so repeat it once before pasting. No CI job repeats the check; adding one (build twice, diff) would make the claim durable and is the first step toward the gold build_reproducible.

#### Installation system

##### `installation_common` (MUST): Unmet

> The project MUST provide a way to easily install and uninstall the software produced by the project using a commonly-used convention.

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
The project is installed from a source checkout with Yarn (yarn install --immutable, yarn build) and infra/deploy.sh plus systemd units; there is no distribution package, container image or npm package, and uninstalling is not scripted.
```

Evidence: [infra/deploy.sh](https://github.com/Axiumine/c15t/blob/main/infra/deploy.sh), [README.md](https://github.com/Axiumine/c15t/blob/main/README.md)

To reach Met: Needs a common install/uninstall convention: for example an install and uninstall target in infra/deploy.sh, or an OS package or container image published with each release.

##### `installation_standard_variables` (MUST): N/A

> The installation system for end-users MUST honor standard conventions for selecting the location where built artifacts are written to at installation time. For example, if it installs files on a POSIX system it MUST honor the DESTDIR environment variable. If there is no installation system or no standard convention, select "not applicable" (N/A).

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
There is no DESTDIR-style installation system: Node applications are deployed by infra/deploy.sh into a configurable prefix (C15T_ROOT, C15T_APP_DIR) and no standard convention applies.
```

Evidence: [infra/deploy.sh](https://github.com/Axiumine/c15t/blob/main/infra/deploy.sh)

##### `installation_development_quick` (MUST): Met

> The project MUST provide a way for potential developers to quickly install all the project results and support environment necessary to make changes, including the tests and test environment. This MUST be performed with a commonly-used convention.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
A developer installs everything with corepack enable and yarn install, then runs yarn typecheck && yarn lint && yarn test. Most suites need no server (PGlite runs in process); the consent-api integration tests and the PostgreSQL variants need a disposable PostgreSQL, set up as described in CONTRIBUTING.md and docs/database-setup.md (scripts/ci-bootstrap-db.sh does it in CI).
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [scripts/ci-bootstrap-db.sh](https://github.com/Axiumine/c15t/blob/main/scripts/ci-bootstrap-db.sh)

#### Externally-maintained components

##### `external_dependencies` (MUST): Met

> The project MUST list external dependencies in a computer-processable way.

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
External dependencies are listed in a computer-processable way: exact versions in each package.json and the committed yarn.lock (Yarn 4 workspaces). https://github.com/Axiumine/c15t/blob/main/package.json and https://github.com/Axiumine/c15t/blob/main/yarn.lock
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [yarn.lock](https://github.com/Axiumine/c15t/blob/main/yarn.lock)

##### `dependency_monitoring` (MUST): Met [M5]

> Projects MUST monitor or periodically check their external dependencies (including convenience copies) to detect known vulnerabilities, and fix exploitable vulnerabilities or verify them as unexploitable.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Dependencies are monitored for known vulnerabilities by Dependabot alerts and security updates, the dependency-review workflow on pull requests, OpenSSF Scorecard and yarn npm audit before releases (docs/dependency-policy.md). Dependabot version updates cover the npm workspaces, the CI tooling in .github/ci-tools and the GitHub Actions (workflows and the composite action); the digest of the PostgreSQL service image in ci.yml is bumped by hand, because Dependabot cannot update images in workflow service containers.
```

Evidence: [docs/dependency-policy.md](https://github.com/Axiumine/c15t/blob/main/docs/dependency-policy.md), [.github/dependabot.yml](https://github.com/Axiumine/c15t/blob/main/.github/dependabot.yml), [.github/workflows/dependency-review.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/dependency-review.yml)

Depends on: M5 (section 1).

##### `updateable_reused_components` (MUST): Met

> The project MUST either: make it easy to identify and update reused externally-maintained components; or use the standard components provided by the system or programming language. Then, if a vulnerability is found in a reused component, it will be easy to update that component.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
All reused components come from the npm registry through Yarn with exact versions and a committed lockfile; no third-party code is copied into the tree, so any component can be updated by changing its version.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [yarn.lock](https://github.com/Axiumine/c15t/blob/main/yarn.lock), [docs/dependency-policy.md](https://github.com/Axiumine/c15t/blob/main/docs/dependency-policy.md)

##### `interfaces_current` (SHOULD): Met

> The project SHOULD avoid using deprecated or obsolete functions and APIs where FLOSS alternatives are available in the set of technology it uses (its "technology stack") and to a supermajority of the users the project supports (so that users have ready access to the alternative).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The project targets current releases of its stack (Node.js 26 LTS, ESM only, current majors of TypeScript, React, Vite and Hono) and Dependabot keeps libraries current; no use of deprecated APIs is known.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [.github/dependabot.yml](https://github.com/Axiumine/c15t/blob/main/.github/dependabot.yml)

#### Automated test suite

##### `automated_integration_testing` (MUST): Met

> An automated test suite MUST be applied on each check-in to a shared repository for at least one branch. This test suite MUST produce a report on test success or failure.

Select: **Met** | URL required: no

Justification to paste:

```text
The automated test suite runs on every pull request and every push to main (.github/workflows/ci.yml) and reports success or failure as a GitHub check on the commit or pull request. https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

##### `regression_tests_added50` (MUST): N/A [M9]

> The project MUST add regression tests to an automated test suite for at least 50% of the bugs fixed within the last six months.

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
No bug has been fixed in a published release yet, so there is nothing to measure. CONTRIBUTING.md and the pull request template require a failing-then-passing test with every bug fix.
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [.github/PULL_REQUEST_TEMPLATE.md](https://github.com/Axiumine/c15t/blob/main/.github/PULL_REQUEST_TEMPLATE.md)

Depends on: M9 (section 1).

Note: Time-dependent: once bug fixes are released, at least 50% of them in the previous six months need a regression test, then switch to Met.

##### `test_statement_coverage80` (MUST): Unmet [M10]

> The project MUST have FLOSS automated test suite(s) that provide at least 80% statement coverage if there is at least one FLOSS tool that can measure this criterion in the selected language.

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
No statement coverage figure has been read from a CI run yet. CI produces a V8 coverage report on every run (artifact "coverage": lcov and json-summary), and this will be marked Met only after the measured figure is at least 80%.
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

Depends on: M10 (section 1).

To reach Met: MUST for silver. Do not claim a figure that has not been measured. The tooling is in place: @vitest/coverage-v8 is a pinned devDependency (5.0.5) and the `Test (PostgreSQL 17, coverage)` job always runs `yarn test` with coverage and uploads the artifact "coverage" (`lcov.info`, `coverage-summary.json`; there is no fallback run without coverage). The remaining step is to read the real percentage from that artifact (or the text summary in the job log) after the first CI run on main: if statements are at least 80%, switch to Met and paste the number and the run URL; if not, add tests. For orientation only, this is not a coverage figure: on 2026-10-30, 33 of 121 hand-written .ts/.tsx source files under apps/*/src and packages/*/src (test helpers and generated files excluded) had a sibling `<name>.test.ts(x)`; UI components and route handlers are mostly covered indirectly.

#### New functionality testing

##### `test_policy_mandated` (MUST): Met

> The project MUST have a formal written policy that as major new functionality is added, tests for the new functionality MUST be added to an automated test suite.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
CONTRIBUTING.md is a formal written policy: as major new functionality is added, tests for it MUST be added to the automated test suite. https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md)

##### `tests_documented_added` (MUST): Met

> The project MUST include, in its documented instructions for change proposals, the policy that tests are to be added for major new functionality.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The instructions for change proposals (CONTRIBUTING.md and .github/PULL_REQUEST_TEMPLATE.md) state that tests must be added for major new functionality.
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [.github/PULL_REQUEST_TEMPLATE.md](https://github.com/Axiumine/c15t/blob/main/.github/PULL_REQUEST_TEMPLATE.md)

#### Warning flags

##### `warnings_strict` (MUST): Met

> Projects MUST be maximally strict with warnings in the software produced by the project, where practical.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Warnings are maximally strict where practical: TypeScript strict with noUncheckedIndexedAccess, exactOptionalPropertyTypes, noPropertyAccessFromIndexSignature, noUnused*, noImplicitReturns and erasableSyntaxOnly, and Biome rules for any, unused code and non-null assertions at error level. https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json
```

Evidence: [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json), [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json)

### Silver: Security

#### Secure development knowledge

##### `implement_secure_design` (MUST): Met

> The project MUST implement secure design principles (from "know_secure_design"), where applicable. If the project is not producing software, select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Secure design principles are implemented: fail-safe defaults (no public sign-up, unknown or disabled site returns 404, requireTenantId), complete mediation (all checks in authz.ts, route-coverage test), least privilege (read-only database role for dashboard-api, hardened systemd units), limited attack surface (services bind to loopback or private addresses only), allowlist input validation (zod). https://github.com/Axiumine/c15t/blob/main/docs/security-model.md
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md), [apps/dashboard-api/src/authz.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/authz.ts), [infra/systemd/c15t-consent-api.service](https://github.com/Axiumine/c15t/blob/main/infra/systemd/c15t-consent-api.service)

#### Use basic good cryptographic practices

##### `crypto_weaknesses` (MUST): Met

> The default security mechanisms within the software produced by the project MUST NOT depend on cryptographic algorithms or modes with known serious weaknesses (e.g., the SHA-1 cryptographic hash algorithm or the CBC mode in SSH).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The default security mechanisms do not use algorithms or modes with known serious weaknesses: no SHA-1 or CBC in the code, scrypt for passwords, TLS limited to 1.2/1.3 in the reference nginx config.
```

Evidence: [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts), [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf)

##### `crypto_algorithm_agility` (SHOULD): Unmet

> The project SHOULD support multiple cryptographic algorithms, so users can quickly switch if one is broken. Common symmetric key algorithms include AES, Twofish, and Serpent. Common cryptographic hash algorithm alternatives include SHA-2 (including SHA-224, SHA-256, SHA-384 AND SHA-512) and SHA-3.

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
The project does not offer a choice of cryptographic algorithms: password hashing is Better Auth's fixed scrypt, and TLS algorithms are configured in nginx/Cloudflare by the operator.
```

Evidence: [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts)

To reach Met: SHOULD criterion, does not block silver.

##### `crypto_credential_agility` (MUST): Met

> The project MUST support storing authentication credentials (such as passwords and dynamic tokens) and private cryptographic keys in files that are separate from other information (such as configuration files, databases, and logs), and permit users to update and replace them without code recompilation. If the project never processes authentication credentials and private cryptographic keys, select "not applicable"...

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Credentials and keys (database URLs, C15T_ADMIN_API_KEY, BETTER_AUTH_SECRET) are kept in separate environment files outside the code, configuration and logs (/etc/c15t-platform/*.env, mode 0600, loaded by systemd) and can be replaced without rebuilding.
```

Evidence: [env.example](https://github.com/Axiumine/c15t/blob/main/env.example), [infra/systemd/c15t-consent-api.service](https://github.com/Axiumine/c15t/blob/main/infra/systemd/c15t-consent-api.service), [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

##### `crypto_used_network` (SHOULD): Unmet

> The software produced by the project SHOULD support secure protocols for all of its network communications, such as SSHv2 or later, TLS1.2 or later (HTTPS), IPsec, SFTP, and SNMPv3. Insecure protocols such as FTP, HTTP, telnet, SSLv3 or earlier, and SSHv1 SHOULD be disabled by default, and only enabled if the user specifically configures it. If the software produced by the project does not support network communic...

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
The public edge is HTTPS only (nginx with TLS 1.2/1.3 behind Cloudflare, Secure cookies), but the hops between nginx and the services are plain HTTP on loopback or a private address by design (the bind address is validated), and the PostgreSQL link depends on the sslmode the operator sets.
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md), [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf)

To reach Met: SHOULD criterion (MUST at gold). Would need TLS for the internal hops and a required sslmode for PostgreSQL, or a documented exemption for loopback.

##### `crypto_tls12` (SHOULD): Met

> The software produced by the project SHOULD, if it supports or uses TLS, support at least TLS version 1.2. Note that the predecessor of TLS was called SSL. If the software does not use TLS, select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Where the project configures TLS it supports at least TLS 1.2: the reference nginx vhost sets ssl_protocols TLSv1.2 TLSv1.3. https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf
```

Evidence: [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf)

##### `crypto_certificate_verification` (MUST): Met

> The software produced by the project MUST, if it supports TLS, perform TLS certificate verification by default when using TLS, including on subresources. If the software does not use TLS, select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The software never disables TLS certificate verification: there is no rejectUnauthorized:false or NODE_TLS_REJECT_UNAUTHORIZED in the code, Node and curl verify by default, and the README tells operators to use sslmode=verify-full for PostgreSQL across hosts.
```

Evidence: [README.md](https://github.com/Axiumine/c15t/blob/main/README.md), [infra/nginx/update-cloudflare-ips.sh](https://github.com/Axiumine/c15t/blob/main/infra/nginx/update-cloudflare-ips.sh)

##### `crypto_verification_private` (MUST): Met

> The software produced by the project MUST, if it supports TLS, perform certificate verification before sending HTTP headers with private information (such as secure cookies). If the software does not use TLS, select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Certificate verification happens during the TLS handshake in Node and curl, before any HTTP request, header or cookie is sent; nothing in the code bypasses it.
```

Evidence: [infra/nginx/update-cloudflare-ips.sh](https://github.com/Axiumine/c15t/blob/main/infra/nginx/update-cloudflare-ips.sh)

#### Secure release

##### `signed_releases` (MUST): Met [M6]

> The project MUST cryptographically sign releases of the project results intended for widespread use, and there MUST be a documented process explaining to users how they can obtain the public signing keys and verify the signature(s). The private key for these signature(s) MUST NOT be on site(s) used to directly distribute the software to the public. If releases are not intended for widespread use, select "not appli...

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Every release asset (source tarball, CycloneDX SBOMs and SHA256SUMS) is signed with keyless cosign by the release workflow (a .sigstore.json bundle next to each file) and the release has SLSA provenance; there is no long-lived private key. SECURITY.md (Verifying releases) gives the cosign verify-blob command with the certificate identity and OIDC issuer. https://github.com/Axiumine/c15t/blob/main/SECURITY.md
```

Evidence: [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md), [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml), [scripts/release-package.sh](https://github.com/Axiumine/c15t/blob/main/scripts/release-package.sh)

Depends on: M6 (section 1).

##### `version_tags_signed` (SUGGESTED): Unmet

> It is SUGGESTED that in the version control system, each important version tag (a tag that is part of a major release, minor release, or fixes publicly noted vulnerabilities) be cryptographically signed and verifiable as described in signed_releases.

Select: **Unmet** | URL required: no

Justification to paste (optional for Unmet):

```text
Version tags are not GPG- or SSH-signed; the release assets are signed with cosign by the release workflow instead.
```

Evidence: [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml)

To reach Met: SUGGESTED. Would need the maintainer to create tags with git tag -s and publish the verifying key.

#### Other security issues

##### `input_validation` (MUST): Met

> The project results MUST check all inputs from potentially untrusted sources to ensure they are valid (an *allowlist*), and reject invalid inputs, if there are any restrictions on the data at all.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Inputs from untrusted sources are checked against allowlists with zod at every boundary (environment, request bodies, route params, query strings, forms), and invalid input is rejected with a JSON error; for example siteKey must match ^[a-z0-9-]{3,40}$ and bind addresses must be loopback or private. https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/validate.ts
```

Evidence: [apps/dashboard-api/src/validate.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/validate.ts), [packages/shared/src/site.ts](https://github.com/Axiumine/c15t/blob/main/packages/shared/src/site.ts), [packages/shared/src/network.ts](https://github.com/Axiumine/c15t/blob/main/packages/shared/src/network.ts), [apps/consent-api/src/request-guard.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/request-guard.ts)

##### `hardening` (SHOULD): Met

> Hardening mechanisms SHOULD be used in the software produced by the project so that software defects are less likely to result in security vulnerabilities.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Hardening is used: a strict Content-Security-Policy with frame-ancestors none, X-Content-Type-Options nosniff and Referrer-Policy on every dashboard response (infra/nginx/dashboard-headers.conf), httpOnly Secure SameSite=Lax cookies, and hardened systemd units (NoNewPrivileges, ProtectSystem=strict, SystemCallFilter). https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard-headers.conf
```

Evidence: [infra/nginx/dashboard-headers.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard-headers.conf), [infra/systemd/c15t-consent-api.service](https://github.com/Axiumine/c15t/blob/main/infra/systemd/c15t-consent-api.service), [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts)

##### `assurance_case` (MUST): Unmet

> The project MUST provide an assurance case that justifies why its security requirements are met. The assurance case MUST include: a description of the threat model, clear identification of trust boundaries, an argument that secure design principles have been applied, and an argument that common implementation security weaknesses have been countered.

Select: **Unmet** | URL required: yes

Justification to paste (optional for Unmet):

```text
docs/security-model.md covers assets, actors, trust boundaries and what is and is not protected, but it does not yet contain an explicit assurance case with the four required parts.
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

To reach Met: Add an "Assurance case" section to docs/security-model.md with: (1) the threat model (attackers, entry points, threats), (2) the trust boundaries (already there, reference them), (3) an argument per secure design principle (economy of mechanism, fail-safe defaults, complete mediation, open design, separation of privilege, least privilege, least common mechanism, psychological acceptability, limited attack surface, input validation with allowlists) pointing to code and tests, and (4) an argument that the common weaknesses (OWASP Top 10 or CWE Top 25) are countered, each with the code and the test. Then switch to Met and paste the URL of that section.

### Silver: Analysis

#### Static code analysis

##### `static_analysis_common_vulnerabilities` (MUST): Met

> The project MUST use at least one static analysis tool with rules or approaches to look for common vulnerabilities in the analyzed language or environment, if there is at least one FLOSS tool that can implement this criterion in the selected language.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
CodeQL with its security queries for JavaScript/TypeScript (injection, XSS, path traversal, insecure randomness, hard-coded credentials) runs in .github/workflows/codeql.yml.
```

Evidence: [.github/workflows/codeql.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/codeql.yml)

#### Dynamic code analysis

##### `dynamic_analysis_unsafe` (MUST): N/A

> If the software produced by the project includes software written using a memory-unsafe language (e.g., C or C++), then at least one dynamic tool (e.g., a fuzzer or web application scanner) MUST be routinely used in combination with a mechanism to detect memory safety problems such as buffer overwrites. If the project does not produce software written in a memory-unsafe language, choose "not applicable" (N/A).

Select: **N/A** | URL required: no | N/A allowed: yes

Justification to paste:

```text
The project is written in TypeScript on Node.js, which are memory-safe; it contains no C or C++ code.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json)

## 6. Gold level

**Gold is not attainable for now, and this document does not pretend otherwise.** The gold level requires, among other things: a silver badge, a bus factor of 2 or more, at least two unassociated significant contributors, review of at least 50% of all changes by a person other than the author, two-factor authentication for every developer, a reproducible build, 90% statement and 80% branch coverage, a security review within the last 5 years, and a dynamic analysis tool applied to every major release. The project has one maintainer and has not measured coverage yet. The answers below say what is Met today and what each Unmet criterion would need. Nothing here should be pasted as a request for the gold badge until the Unmet MUST criteria are resolved.

### Gold: Basics

#### Prerequisites

##### `achieve_silver` (MUST): Unmet

> The project MUST achieve a silver level badge.

Select: **Unmet** | URL required: no

Justification to paste (optional for Unmet):

```text
The project does not hold a silver badge yet: access_continuity and, depending on measurement, test_statement_coverage80 and assurance_case are unmet.
```

To reach Met: Blocked by the silver MUST criteria listed above.

#### Project oversight

##### `bus_factor` (MUST): Unmet

> The project MUST have a "bus factor" of 2 or more.

Select: **Unmet** | URL required: yes

Justification to paste (optional for Unmet):

```text
The bus factor is 1 (one maintainer); see GOVERNANCE.md.
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

To reach Met: Needs at least two people who know and can maintain the project.

##### `contributors_unassociated` (MUST): Unmet

> The project MUST have at least two unassociated significant contributors.

Select: **Unmet** | URL required: yes

Justification to paste (optional for Unmet):

```text
The project has one significant contributor; there are not yet two unassociated significant contributors.
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

To reach Met: Needs a second significant contributor who is not paid by the same organization.

#### Other

##### `copyright_per_file` (MUST): Met

> The project MUST include a copyright statement in each source file, identifying the copyright holder (e.g., the [project name] contributors).

Select: **Met** | URL required: no

Justification to paste:

```text
Every hand-written source file starts with "Copyright (C) 2026 Axiumine" and an SPDX header, added by scripts/add-spdx-headers.mjs (its --check mode passes and runs in CI as yarn spdx:check); REUSE.toml states the same copyright holder for files that cannot carry a comment (JSON, Markdown, YAML, generated files). https://github.com/Axiumine/c15t/blob/main/REUSE.toml
```

Evidence: [REUSE.toml](https://github.com/Axiumine/c15t/blob/main/REUSE.toml), [scripts/add-spdx-headers.mjs](https://github.com/Axiumine/c15t/blob/main/scripts/add-spdx-headers.mjs)

##### `license_per_file` (MUST): Met

> The project MUST include a license statement in each source file. This MAY be done by including the following inside a comment near the beginning of each file: SPDX-License-Identifier: [SPDX license expression for project].

Select: **Met** | URL required: no

Justification to paste:

```text
Every hand-written source file carries SPDX-License-Identifier: AGPL-3.0-or-later (scripts/add-spdx-headers.mjs --check passes), and REUSE.toml assigns the license to all remaining files. https://github.com/Axiumine/c15t/blob/main/REUSE.toml
```

Evidence: [REUSE.toml](https://github.com/Axiumine/c15t/blob/main/REUSE.toml), [scripts/add-spdx-headers.mjs](https://github.com/Axiumine/c15t/blob/main/scripts/add-spdx-headers.mjs), [LICENSES/AGPL-3.0-or-later.txt](https://github.com/Axiumine/c15t/blob/main/LICENSES/AGPL-3.0-or-later.txt)

### Gold: Change Control

#### Public version-controlled source repository

##### `repo_distributed` (MUST): Met [M1]

> The project's source repository MUST use a common distributed version control software (e.g., git or mercurial).

Select: **Met** | URL required: no

Justification to paste:

```text
The source repository uses git, hosted on GitHub: https://github.com/Axiumine/c15t
```

Depends on: M1 (section 1).

##### `small_tasks` (MUST): Unmet

> The project MUST clearly identify small tasks that can be performed by new or casual contributors.

Select: **Unmet** | URL required: yes

Justification to paste (optional for Unmet):

```text
No issues are labelled as small tasks for new contributors yet.
```

To reach Met: Create issues for small tasks and label them (for example "good first issue"), then link the label filter URL.

##### `require_2FA` (MUST): Met [M3]

> The project MUST require two-factor authentication (2FA) for developers for changing a central repository or accessing sensitive data (such as private vulnerability reports). This 2FA mechanism MAY use mechanisms without cryptographic mechanisms such as SMS, though that is not recommended.

Select: **Met** | URL required: no

Justification to paste:

```text
Two-factor authentication is required for the maintainer account and, through the organization setting, for every member of the Axiumine organization.
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

Depends on: M3 (section 1).

##### `secure_2FA` (SHOULD): Met [M3]

> The project's two-factor authentication (2FA) SHOULD use cryptographic mechanisms to prevent impersonation. Short Message Service (SMS) based 2FA, by itself, does NOT meet this criterion, since it is not encrypted.

Select: **Met** | URL required: no

Justification to paste:

```text
The maintainer account uses a cryptographic second factor (TOTP app, passkey or hardware security key), not SMS.
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md)

Depends on: M3 (section 1).

### Gold: Quality

#### Coding standards

##### `code_review_standards` (MUST): Unmet

> The project MUST document its code review requirements, including how code review is conducted, what must be checked, and what is required to be acceptable.

Select: **Unmet** | URL required: yes | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
Code review requirements are not documented in detail yet (what must be checked, what makes a change acceptable).
```

Evidence: [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md), [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

To reach Met: Add a Code review section to CONTRIBUTING.md (how review is done, checklist, security questions from docs/security-model.md, approval rules) and link it.

##### `two_person_review` (MUST): Unmet

> The project MUST have at least 50% of all proposed modifications reviewed before release by a person other than the author, to determine if it is a worthwhile modification and free of known issues which would argue against its inclusion

Select: **Unmet** | URL required: no

Justification to paste (optional for Unmet):

```text
With one maintainer, proposed changes by that maintainer are not reviewed by another person; at least 50% of modifications reviewed by someone other than the author is not achievable yet. GOVERNANCE.md says so.
```

Evidence: [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md), [.github/CODEOWNERS](https://github.com/Axiumine/c15t/blob/main/.github/CODEOWNERS)

To reach Met: Needs a second reviewer.

#### Working build system

##### `build_reproducible` (MUST): Unmet

> The project MUST have a reproducible build. If no building occurs (e.g., scripting languages where the source code is used directly instead of being compiled), select "not applicable" (N/A).

Select: **Unmet** | URL required: yes | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
Builds were checked to be repeatable on one machine (see silver build_repeatable), but there is no documented, CI-checked reproducible build that independent parties can redo.
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json), [yarn.lock](https://github.com/Axiumine/c15t/blob/main/yarn.lock)

To reach Met: Add scripts/verify-reproducible-build.sh (it does not exist yet) and a CI job that builds twice (and from a second directory), compares sha256sum of every dist/ file, and document it in CONTRIBUTING.md; also verify the release tarball. scripts/release-package.sh already normalizes the tarballs (sorted entries, fixed owner, commit time as modification time) but nothing checks that two runs agree. Then switch to Met and paste the URL.

#### Automated test suite

##### `test_invocation` (MUST): Met

> A test suite MUST be invocable in a standard way for that language.

Select: **Met** | URL required: yes

Justification to paste:

```text
The test suite is invoked in the standard way for a Yarn/Node project: yarn test. https://github.com/Axiumine/c15t/blob/main/package.json
```

Evidence: [package.json](https://github.com/Axiumine/c15t/blob/main/package.json)

##### `test_continuous_integration` (MUST): Met

> The project MUST implement continuous integration, where new or changed code is frequently integrated into a central code repository and automated tests are run on the result.

Select: **Met** | URL required: yes

Justification to paste:

```text
Continuous integration runs typecheck, lint, tests and the build on every pull request and every push to main of a central repository. https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

##### `test_statement_coverage90` (MUST): Unmet [M10]

> The project MUST have FLOSS automated test suite(s) that provide at least 90% statement coverage if there is at least one FLOSS tool that can measure this criterion in the selected language.

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
Statement coverage has not been measured and is not claimed to be 90% or more.
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

Depends on: M10 (section 1).

To reach Met: Needs measured statement coverage of at least 90%.

##### `test_branch_coverage80` (MUST): Unmet [M10]

> The project MUST have FLOSS automated test suite(s) that provide at least 80% branch coverage if there is at least one FLOSS tool that can measure this criterion in the selected language.

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
Branch coverage has not been measured and is not claimed to be 80% or more.
```

Evidence: [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml)

Depends on: M10 (section 1).

To reach Met: Needs measured branch coverage of at least 80%.

### Gold: Security

#### Use basic good cryptographic practices

##### `crypto_used_network` (MUST): Unmet

> The software produced by the project MUST support secure protocols for all of its network communications, such as SSHv2 or later, TLS1.2 or later (HTTPS), IPsec, SFTP, and SNMPv3. Insecure protocols such as FTP, HTTP, telnet, SSLv3 or earlier, and SSHv1 MUST be disabled by default, and only enabled if the user specifically configures it. If the software produced by the project does not support network communicatio...

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
The hops between nginx and the services are plain HTTP on loopback or private addresses by design, and PostgreSQL TLS depends on operator configuration; see the silver answer.
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

To reach Met: Needs TLS (or a justified loopback exemption accepted by the criterion) for every network link, and a required sslmode for PostgreSQL.

##### `crypto_tls12` (MUST): Met

> The software produced by the project MUST, if it supports or uses TLS, support at least TLS version 1.2. Note that the predecessor of TLS was called SSL. If the software does not use TLS, select "not applicable" (N/A).

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Where the project configures TLS it requires at least TLS 1.2: ssl_protocols TLSv1.2 TLSv1.3 in the reference nginx vhost. https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf
```

Evidence: [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf)

#### Secured delivery against man-in-the-middle (MITM) attacks

##### `hardened_site` (MUST): Met

> The project website, repository (if accessible via the web), and download site (if separate) MUST include key hardening headers with nonpermissive values.

Select: **Met** | URL required: yes

Justification to paste:

```text
The project website, repository and download site are on github.com, which sends Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options: nosniff and X-Frame-Options: deny with non-permissive values (checked with curl on 2026-10-30). https://github.com/Axiumine/c15t
```

#### Other security issues

##### `security_review` (MUST): Unmet

> The project MUST have performed a security review within the last 5 years. This review MUST consider the security requirements and security boundary.

Select: **Unmet** | URL required: no

Justification to paste (optional for Unmet):

```text
No dedicated, documented security review against the security requirements and security boundary has been recorded yet.
```

Evidence: [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md)

To reach Met: Needs a human review of docs/security-model.md against the code (ideally by someone besides the author), recorded in a dated document or advisory, within the last 5 years.

##### `hardening` (MUST): Met

> Hardening mechanisms MUST be used in the software produced by the project so that software defects are less likely to result in security vulnerabilities.

Select: **Met** | URL required: yes | N/A allowed: yes

Justification to paste:

```text
Hardening mechanisms are used so that defects are less likely to become vulnerabilities: strict CSP, nosniff, frame-ancestors none and Referrer-Policy on every dashboard response, httpOnly Secure SameSite cookies, and hardened systemd units. https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard-headers.conf
```

Evidence: [infra/nginx/dashboard-headers.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard-headers.conf), [infra/systemd/c15t-consent-api.service](https://github.com/Axiumine/c15t/blob/main/infra/systemd/c15t-consent-api.service)

### Gold: Analysis

#### Dynamic code analysis

##### `dynamic_analysis` (MUST): Met [M10]

> The project MUST apply at least one dynamic analysis tool to any proposed major production release of the software produced by the project before its release.

Select: **Met** | URL required: no | N/A allowed: yes

Justification to paste:

```text
Property-based tests with fast-check (13 *.fuzz.test.ts files) vary the inputs of the parsers and validators that face untrusted data, together with the PostgreSQL integration tests; they run with yarn test in CI on every pull request and every push to main, and releases are cut from main. This is input-varying testing, not a coverage-guided fuzzer or a web scanner.
```

Evidence: [apps/consent-api/src/request-guard.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/request-guard.fuzz.test.ts), [packages/shared/src/network.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/packages/shared/src/network.fuzz.test.ts), [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml), [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml)

Depends on: M10 (section 1).

Note: Meets the criterion's own definition (a tool that varies inputs). release.yml only accepts a tag on a commit reachable from main (so a commit that went through CI) but does not run the tests itself; a coverage-guided fuzzer (for example Jazzer.js) or an OWASP ZAP baseline run inside the release workflow would be stronger evidence.

##### `dynamic_analysis_enable_assertions` (SHOULD): Unmet

> The project SHOULD include many run-time assertions in the software it produces and check those assertions during dynamic analysis.

Select: **Unmet** | URL required: no | N/A allowed: yes

Justification to paste (optional for Unmet):

```text
Production code validates inputs with zod and explicit checks but contains no assert statements; the property-based tests rely on test-side expectations.
```

To reach Met: SHOULD criterion. Add invariant checks (assert from node:assert) in the parsers and registry and run the fuzz tests with them.

## 7. Evidence file index

Every file referenced above, with its link. "Present" is checked against the working tree when this document was generated.

| File | Present |
|---|---|
| [.github/CODEOWNERS](https://github.com/Axiumine/c15t/blob/main/.github/CODEOWNERS) | yes |
| [.github/ISSUE_TEMPLATE/bug_report.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/bug_report.yml) | yes |
| [.github/ISSUE_TEMPLATE/config.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/config.yml) | yes |
| [.github/ISSUE_TEMPLATE/feature_request.yml](https://github.com/Axiumine/c15t/blob/main/.github/ISSUE_TEMPLATE/feature_request.yml) | yes |
| [.github/PULL_REQUEST_TEMPLATE.md](https://github.com/Axiumine/c15t/blob/main/.github/PULL_REQUEST_TEMPLATE.md) | yes |
| [.github/dependabot.yml](https://github.com/Axiumine/c15t/blob/main/.github/dependabot.yml) | yes |
| [.github/workflows/ci.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/ci.yml) | yes |
| [.github/workflows/codeql.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/codeql.yml) | yes |
| [.github/workflows/dco.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/dco.yml) | yes |
| [.github/workflows/dependency-review.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/dependency-review.yml) | yes |
| [.github/workflows/release.yml](https://github.com/Axiumine/c15t/blob/main/.github/workflows/release.yml) | yes |
| [.gitignore](https://github.com/Axiumine/c15t/blob/main/.gitignore) | yes |
| [.nvmrc](https://github.com/Axiumine/c15t/blob/main/.nvmrc) | yes |
| [CHANGELOG.md](https://github.com/Axiumine/c15t/blob/main/CHANGELOG.md) | yes |
| [CODE_OF_CONDUCT.md](https://github.com/Axiumine/c15t/blob/main/CODE_OF_CONDUCT.md) | yes |
| [CONTRIBUTING.md](https://github.com/Axiumine/c15t/blob/main/CONTRIBUTING.md) | yes |
| [GOVERNANCE.md](https://github.com/Axiumine/c15t/blob/main/GOVERNANCE.md) | yes |
| [LICENSE](https://github.com/Axiumine/c15t/blob/main/LICENSE) | yes |
| [LICENSES/AGPL-3.0-or-later.txt](https://github.com/Axiumine/c15t/blob/main/LICENSES/AGPL-3.0-or-later.txt) | yes |
| [README.md](https://github.com/Axiumine/c15t/blob/main/README.md) | yes |
| [REUSE.toml](https://github.com/Axiumine/c15t/blob/main/REUSE.toml) | yes |
| [SECURITY.md](https://github.com/Axiumine/c15t/blob/main/SECURITY.md) | yes |
| [SUPPORT.md](https://github.com/Axiumine/c15t/blob/main/SUPPORT.md) | yes |
| [apps/consent-api/src/integration.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/integration.test.ts) | yes |
| [apps/consent-api/src/listener.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/listener.ts) | yes |
| [apps/consent-api/src/registry.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/registry.ts) | yes |
| [apps/consent-api/src/request-guard.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/request-guard.fuzz.test.ts) | yes |
| [apps/consent-api/src/request-guard.ts](https://github.com/Axiumine/c15t/blob/main/apps/consent-api/src/request-guard.ts) | yes |
| [apps/dashboard-api/src/auth.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/auth.ts) | yes |
| [apps/dashboard-api/src/authz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/authz.test.ts) | yes |
| [apps/dashboard-api/src/authz.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/authz.ts) | yes |
| [apps/dashboard-api/src/csv.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/csv.fuzz.test.ts) | yes |
| [apps/dashboard-api/src/csv.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/csv.ts) | yes |
| [apps/dashboard-api/src/env.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/env.ts) | yes |
| [apps/dashboard-api/src/password.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/password.ts) | yes |
| [apps/dashboard-api/src/route-coverage.test.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/route-coverage.test.ts) | yes |
| [apps/dashboard-api/src/validate.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-api/src/validate.ts) | yes |
| [apps/dashboard-web/index.html](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-web/index.html) | yes |
| [apps/dashboard-web/src/components/form-field.tsx](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-web/src/components/form-field.tsx) | yes |
| [apps/dashboard-web/src/lib/format.ts](https://github.com/Axiumine/c15t/blob/main/apps/dashboard-web/src/lib/format.ts) | yes |
| [docs/architecture.md](https://github.com/Axiumine/c15t/blob/main/docs/architecture.md) | yes |
| [docs/dependency-policy.md](https://github.com/Axiumine/c15t/blob/main/docs/dependency-policy.md) | yes |
| [docs/security-model.md](https://github.com/Axiumine/c15t/blob/main/docs/security-model.md) | yes |
| [env.example](https://github.com/Axiumine/c15t/blob/main/env.example) | yes |
| [infra/deploy.sh](https://github.com/Axiumine/c15t/blob/main/infra/deploy.sh) | yes |
| [infra/nginx/dashboard-headers.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard-headers.conf) | yes |
| [infra/nginx/dashboard.conf](https://github.com/Axiumine/c15t/blob/main/infra/nginx/dashboard.conf) | yes |
| [infra/nginx/update-cloudflare-ips.sh](https://github.com/Axiumine/c15t/blob/main/infra/nginx/update-cloudflare-ips.sh) | yes |
| [infra/systemd/c15t-consent-api.service](https://github.com/Axiumine/c15t/blob/main/infra/systemd/c15t-consent-api.service) | yes |
| [package.json](https://github.com/Axiumine/c15t/blob/main/package.json) | yes |
| [packages/config/biome.json](https://github.com/Axiumine/c15t/blob/main/packages/config/biome.json) | yes |
| [packages/config/tsconfig.base.json](https://github.com/Axiumine/c15t/blob/main/packages/config/tsconfig.base.json) | yes |
| [packages/db/src/failover.test.ts](https://github.com/Axiumine/c15t/blob/main/packages/db/src/failover.test.ts) | yes |
| [packages/shared/src/network.fuzz.test.ts](https://github.com/Axiumine/c15t/blob/main/packages/shared/src/network.fuzz.test.ts) | yes |
| [packages/shared/src/network.ts](https://github.com/Axiumine/c15t/blob/main/packages/shared/src/network.ts) | yes |
| [packages/shared/src/site.ts](https://github.com/Axiumine/c15t/blob/main/packages/shared/src/site.ts) | yes |
| [scripts/add-spdx-headers.mjs](https://github.com/Axiumine/c15t/blob/main/scripts/add-spdx-headers.mjs) | yes |
| [scripts/check-dco.sh](https://github.com/Axiumine/c15t/blob/main/scripts/check-dco.sh) | yes |
| [scripts/ci-bootstrap-db.sh](https://github.com/Axiumine/c15t/blob/main/scripts/ci-bootstrap-db.sh) | yes |
| [scripts/release-notes.sh](https://github.com/Axiumine/c15t/blob/main/scripts/release-notes.sh) | yes |
| [scripts/release-package.sh](https://github.com/Axiumine/c15t/blob/main/scripts/release-package.sh) | yes |
| [tsconfig.json](https://github.com/Axiumine/c15t/blob/main/tsconfig.json) | yes |
| [vitest.config.ts](https://github.com/Axiumine/c15t/blob/main/vitest.config.ts) | yes |
| [yarn.lock](https://github.com/Axiumine/c15t/blob/main/yarn.lock) | yes |

## 8. What was verified when this document was written

- `yarn lint` (`biome check .`) reported no diagnostics on 265 files on 2026-10-30 (so `warnings_fixed`).
- Two clean builds (`tsc -b` for every workspace plus `vite build`) of a copy of the tree gave identical SHA-256 sums for all 266 files under `dist/`, also when built from a different directory (Node v26.13.0, Yarn 4.18.1). This backs silver `build_repeatable`. It is a one-off manual check, not a CI job, and it was done before later changes to the source tree: repeat it once before pasting.
- `scrypt` parameters and the random per-password salt were read in `@better-auth/utils` 0.5.1 (`password.node.mjs`), used by `better-auth` 1.7.14. The source tree has no `createHash`, `createCipher`, `rejectUnauthorized` or `NODE_TLS_REJECT_UNAUTHORIZED`. The only `Math.random` call is reconnect jitter in `apps/consent-api/src/listener.ts`.
- `https://github.com/Axiumine/c15t` answered over HTTP/2 with `strict-transport-security`, `x-frame-options: deny`, `x-content-type-options: nosniff` and a `content-security-policy` header (checked with `curl -I` on 2026-10-30), which is what gold `hardened_site` asks for.
- `node scripts/add-spdx-headers.mjs --check` reports that every file has an SPDX header or is covered by `REUSE.toml`. The only `.ts`, `.tsx`, `.sh`, `.mjs` and `.sql` files without the copyright line are generated (`routeTree.gen.ts`, `c15t.generated.ts` and the Drizzle migrations), and all of them are listed in `REUSE.toml`; CI runs the same check as `yarn spdx:check`.
- Checked against the repository on 2026-10-30: the names and triggers of the jobs in `.github/workflows` (the required status checks in M4), the scripts in the root `package.json`, what `.github/dependabot.yml` covers, the root `.gitignore`, the wording of `SECURITY.md`, `SUPPORT.md`, `CONTRIBUTING.md` and `GOVERNANCE.md`, the number of `*.fuzz.test.ts` files (13), and that every file linked in this document exists (section 7).
- Not verified, and therefore not claimed: code coverage figures (the tooling exists, no figure has been read from a CI run), the outcome of any workflow run, the state of GitHub repository settings, whether the git history exists (the working tree has no `.git` directory) and whether that history is free of secrets. Those are the manual actions M1, M5, M8 and M10.

## 9. Keeping this document current

Re-check it when a workflow, `SECURITY.md`, `CONTRIBUTING.md`, `GOVERNANCE.md` or `docs/security-model.md` changes, and before every release. The criteria change over time: compare with https://www.bestpractices.dev/en/criteria/0 (1 for silver, 2 for gold).
