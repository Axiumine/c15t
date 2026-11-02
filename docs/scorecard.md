# OpenSSF Scorecard

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Axiumine/c15t/badge)](https://scorecard.dev/viewer/?uri=github.com/Axiumine/c15t)

[Scorecard](https://scorecard.dev) grades a public repository on supply-chain security practices. This
page lists every check, what the repository does for it, the score we honestly expect, what is gated by
time or by people, and the manual steps (repository settings and optional token) that only the repository
owner can do. The OpenSSF Best Practices badge (project 16093) is documented in
[`openssf-best-practices.md`](./openssf-best-practices.md).

Scores below are estimates written before the first Scorecard run. Check the real values at
<https://scorecard.dev/viewer/?uri=github.com/Axiumine/c15t> and correct this page when they differ.
Scorecard re-checks the definitions regularly (the `SBOM` check, for example, is newer than many guides),
so read [the current check documentation](https://github.com/ossf/scorecard/blob/main/docs/checks.md)
before you chase a number.

## How the score is produced

`.github/workflows/scorecard.yml` runs `ossf/scorecard-action` on every push to `main`, weekly, and when
a branch-protection rule changes. It publishes the result to the Scorecard API (this is what the badge
reads) and uploads a SARIF report to code scanning. The action is pinned by commit SHA and the job has
only the permissions it needs (`security-events: write` and `id-token: write`, the minimum for publishing).

## Check by check

Legend for "Time/people gate": **time** means the repository must age, **people** means more than one
maintainer or contributor is needed, **settings** means a repository setting that only an owner can change
(see "Manual steps").

| Check | What we do | Expected now | Achievable | Gate |
|---|---|---|---|---|
| Binary-Artifacts | No binaries are committed. `.gitignore` excludes build output, and a scan of the tree before publishing found no executables, archives, images or fonts. The only non-text asset is an SVG favicon. | 10 | 10 | none |
| Branch-Protection | A repository ruleset on `main` (see step 2). Without any ruleset the score is 0. | 3 to 8 | 8, or 9 to 10 with two maintainers | settings, people |
| CI-Tests | `ci.yml` runs typecheck, lint, unit and PostgreSQL integration tests and the build on every pull request. | 5 to 10 | 10 | time (the last ~30 commits must have passing check runs) |
| CII-Best-Practices | Project 16093 holds the `passing` badge (awarded 2026-10-30; the live form shows silver at 98% and gold at 74%); the evidence is in `openssf-best-practices.md`. | 5 | 5 now, 7 with silver (the one open silver MUST criterion is `access_continuity`, which needs a second person). Gold needs two unassociated contributors. | people for silver/gold |
| Code-Review | Pull requests are required, but with one maintainer nobody else can approve. Scorecard counts a change as reviewed when someone other than the author approved it or merged it. | 0 | 10 only when a second human reviews every change | people |
| Contributors | Needs recent contributors from at least 3 different organisations (profile "Company" field), each with 5 or more of the last 30 commits. | 0 | not realistic for a small project | people |
| Dangerous-Workflow | No `pull_request_target`, no untrusted input in `run:` (event data goes through `env:`), no write tokens on pull request workflows. | 10 | 10 | none |
| Dependency-Update-Tool | `.github/dependabot.yml` covers GitHub Actions (the workflows and the composite action in `.github/actions/setup`) and npm (the workspaces and `.github/ci-tools`) weekly, grouped, with a cooldown. It cannot update the CI PostgreSQL image digest, which is bumped by hand. | 10 | 10 | none |
| Fuzzing | Property-based tests with `fast-check` (`*.fuzz.test.ts`) for the parsers and validators of untrusted input. Scorecard recognises `fast-check` for JavaScript and TypeScript. | 10 | 10 | none |
| License | `LICENSE` in the root, the exact AGPL-3.0 text (detected by GitHub), and `LICENSES/AGPL-3.0-or-later.txt`. | 10 | 10 | none |
| Maintained | Needs more than 90 days of repository age, then at least one commit per week. Before that the check reports that the project is too new. | 0 | 10 | time |
| Packaging | Not done on purpose. Scorecard looks for publishing workflows (npm, GitHub Packages, a container registry). The workspace packages are private (`"private": true`), and the platform is deployed from release tarballs with systemd. Publishing them to npm or building a container image to raise this score would be dishonest or contradict the "no Docker" decision (decisions.md D7). | 0 | 0 (accepted) | none |
| Pinned-Dependencies | Every action is pinned by commit SHA, the CI PostgreSQL image by digest (updated by hand, Dependabot cannot do it), Corepack and Yarn through lockfiles (`yarn install --immutable`), no `curl \| sh`. The one exception is the SLSA generator reusable workflow in `release.yml`, which its authors require to be referenced by tag. | 9 to 10 | 9 to 10, because of that exception | none |
| SAST | CodeQL (`codeql.yml`) on pull requests, pushes and weekly. | 8 to 10 | 10 | time (needs merged pull requests that ran CodeQL) |
| SBOM | The release workflow publishes a CycloneDX file named `*.cdx.json` as a release asset. | 0 until the first release | 10 | time (first release) |
| Security-Policy | `SECURITY.md` with a reporting URL, free-form text, disclosure timelines and the word "vulnerability". | 10 | 10 | none |
| Signed-Releases | Release assets are signed with keyless cosign (`.sigstore.json`) and come with SLSA provenance (`.intoto.jsonl`). | not scored before a release | 10 | time (first release) |
| Token-Permissions | Top-level `permissions: contents: read` in every workflow, with write access granted only on the jobs that need it. | 10 | 10 | none |
| Vulnerabilities | `yarn.lock` has no known vulnerability (checked with `yarn npm audit` and `osv-scanner` before publishing). Dependabot keeps it that way. | 10 | 10, but it can drop at any time when a new advisory appears | none |
| Webhooks | No webhooks are configured. | 10 | 10 | none |

### Estimated aggregate

Scorecard weights the checks by risk (critical 10, high 7.5, medium 5, low 2.5) and ignores checks it
cannot evaluate. With the numbers above, this is our rough estimate, not a promise:

| Moment | Estimate |
|---|---|
| First week, ruleset applied, `passing` badge awarded, no release yet | about 6.8 |
| After 90 days of weekly commits and a first signed release | about 8.2 to 8.5 |
| Same, plus a second human reviewing every change | about 9.2 |

The checks that stay low for a one-person project are Code-Review, Contributors, Packaging and (in part)
Branch-Protection. We do not game them. In particular we do not create sock-puppet accounts to approve
our own pull requests, and we do not publish packages we do not intend people to install.

## Manual steps for the repository owner

Everything below needs owner rights on <https://github.com/Axiumine/c15t>. None of it is done by the
files in the repository.

### 1. Repository settings

- **Settings, Code security**: enable *Private vulnerability reporting* (`SECURITY.md` points to it),
  *Dependabot alerts*, *Dependabot security updates*, *Secret scanning* and *Push protection*. Leave
  CodeQL "default setup" off, because `codeql.yml` is the advanced setup.
- **Settings, Actions, General**: set *Workflow permissions* to **Read repository contents and packages
  permissions**, and untick *Allow GitHub Actions to create and approve pull requests* unless you need
  it. Set *Fork pull request workflows* to require approval for first-time contributors (or all outside
  collaborators). Leave *Require actions to be pinned to a full-length commit SHA* **off**: it rejects
  every `uses:` that is not a SHA, and `release.yml` calls the SLSA generator by the tag `v2.1.0`, which is
  the only form its authors support. The release would fail at the `provenance` job. Pinning is kept by
  review and by the Scorecard Pinned-Dependencies check instead.
- **Settings, General**: tick *Always suggest updating pull request branches*, allow only the merge
  methods you want, tick *Automatically delete head branches*. If available, enable *release
  immutability* so that published release assets and tags cannot be changed afterwards.
- **Organisation or account**: require two-factor authentication.
- **Webhooks**: add none. If you add one later, give it a secret (the Webhooks check looks for it).

### 2. Branch ruleset for `main` (Branch-Protection and Code-Review)

Use a *repository ruleset* (Settings, Rules, Rulesets, New branch ruleset), not the classic branch
protection page: Scorecard can read rulesets with the default workflow token, so no personal access token
is needed. The live ruleset is named `main protection`, targets the default branch, has no bypass
actors, and enables:

- Restrict deletions, and Block force pushes (tier 1).
- Require a pull request before merging, with required approvals **0** (see below). Dismiss stale
  approvals on new commits.
- Require status checks to pass, with *Require branches to be up to date before merging*. Add these
  checks (use the exact names shown in a recent pull request run): `Verify (typecheck, lint, build)`,
  `Test (PostgreSQL 17, coverage)`, `DCO sign-off`, `Analyze (javascript-typescript)`,
  `Analyze (actions)` and `Dependency review`.
- Required approvals: this is a real decision. With **one maintainer** you cannot approve your own pull
  request, so a rule of "1 approval" blocks every merge unless you add yourself as a bypass actor, which
  makes the rule ceremonial and lowers the Scorecard "include administrators" points. Our recommendation
  is: set required approvals to **0** while the project has one maintainer (the pull request, status
  check and force-push rules still give tiers 1 and 3), and raise it to **1** (then 2) as soon as a second
  maintainer joins. Setting it to 1 with a bypass for yourself would score higher on Branch-Protection
  but would claim a review that does not happen, which we choose not to do.

The live ruleset deliberately does **not** enable *Require review from code owners*
(`require_code_owner_review`, see `.github/CODEOWNERS`) or *Require approval of the most recent
reviewable push* (`require_last_push_approval`). With one maintainer, who is also the only code owner and
the author of every pull request, GitHub would wait for an approval that nobody else can give, and every
merge would be blocked. Enable both, and raise the required approvals, when a second maintainer joins.
`.github/CODEOWNERS` still requests the owner's review on every pull request; the ruleset just does not
enforce it.

A second ruleset, named `release tags immutable`, targets tags matching `v*` and restricts updates and
deletions, so a release tag cannot be moved. It does not restrict creations, or nobody could push a release
tag. Because a pushed tag can then neither be moved nor deleted, check everything in step 6 *before* you
push it. A tag pushed too early (for example before the version bump is merged) makes `release.yml` fail,
and the only fix is a new version, not a retag.

### 3. Optional: `SCORECARD_TOKEN`

The default `GITHUB_TOKEN` is enough for everything above when you use rulesets. A personal access token
is only needed to read **classic** branch protection or webhooks. If you use one:

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   named `OpenSSF Scorecard Action - Axiumine/c15t`, expiry one year, resource owner `Axiumine`, repository
   access *Only select repositories* then `Axiumine/c15t`.
2. Repository permissions: **Administration: Read-only** (Metadata: Read-only is added automatically), and
   optionally **Webhooks: Read-only**. Nothing else.
3. Add it as the repository secret `SCORECARD_TOKEN` (Settings, Secrets and variables, Actions). The
   workflow already reads `secrets.SCORECARD_TOKEN` and falls back to `GITHUB_TOKEN`.
4. Put a reminder in your calendar: the token expires after a year, and a lapsed token makes the
   Branch-Protection result disappear. The token can read many repository settings, so keep it scoped to
   this repository.

Do not use a classic token with the `repo` scope.

### 4. First run and the badge

1. Push to `main`. The Scorecard workflow runs on push. You can start it again with the *Run workflow*
   button if you enabled it, or wait for the weekly schedule.
2. After a successful run with `publish_results: true`, the badge and the viewer page start working
   (it can take some minutes). Results also appear under Security, Code scanning.
3. If publishing is rejected, open the step log: the usual cause is a workflow that does not satisfy the
   [workflow restrictions](https://github.com/ossf/scorecard-action#workflow-restrictions).

### 5. Best Practices badge

Fill in the form at <https://www.bestpractices.dev/projects/16093/edit> with the text from
[`openssf-best-practices.md`](./openssf-best-practices.md). Some answers there (two-factor
authentication, private vulnerability reporting, branch protection) are true only after you completed
steps 1 and 2 above.

### 6. Releases

A release (`v0.1.0` is the first) takes these steps, in this order:

1. Set `version` in the root `package.json` to `X.Y.Z`. The release workflow refuses a tag that differs
   from that version. Only the root `package.json` is read: the workspace packages are private and stay
   at `0.0.0`.
2. Move the "Unreleased" changelog entries to `## [X.Y.Z] - <date>` and update the compare links.
3. Merge both changes to `main` through a pull request, and wait for CI to pass on `main`. The workflow also
   refuses a tagged commit that is not reachable from `main`.
4. Tag that exact commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The dashboard-web tarball contains `apps/dashboard-web/dist/THIRD-PARTY-NOTICES.md` (generated by Vite `build.license`), and `scripts/release-package.sh` refuses to pack without it.

The release workflow then creates the signed assets, the provenance file and the SBOM, which unlocks the
Signed-Releases and SBOM checks. Scorecard looks at the last five releases, so every release must keep
producing them. If the workflow fails because the version or the commit was wrong, the `v*` tag ruleset
from step 2 stops you from moving or deleting the tag: fix the cause on `main` and release the next patch
version (for example `v0.1.1` after a failed `v0.1.0`).

## Time-gated and people-gated items

| Item | Why | When |
|---|---|---|
| Maintained | The repository must be older than 90 days | about 90 days after the first push, with a commit every week |
| CI-Tests, SAST | Look at the last ~30 commits and merged pull requests | after about 30 commits go through pull requests |
| Code-Review | Needs approval by someone other than the author | when a second maintainer joins |
| Contributors | Needs 3 organisations | probably never for this project |
| Silver and gold badge | Silver needs a second person with admin access (`access_continuity`); gold needs two unassociated contributors and two-person review | see `openssf-best-practices.md` |

## Keeping the score

- Never remove the top-level `permissions:` block from a workflow, and never use `pull_request_target`.
- Pin every new action by SHA (Dependabot keeps the pins fresh, including the composite action under `.github/actions`). The SLSA generator tag in `release.yml` is the only exception. Bump the CI PostgreSQL image digest by hand (Dependabot cannot). Keep Corepack and Yarn behind lockfiles.
- Run `yarn npm audit --all --recursive` before each release, and merge Dependabot security pull requests promptly.
- Commit regularly: Maintained looks for activity every week.
