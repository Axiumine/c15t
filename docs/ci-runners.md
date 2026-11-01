<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# CI runners

Where each workflow runs, what a runner host needs, and why CI of a public repository on self-hosted runners
is gated by a maintainer's approval.

## Where each workflow runs

| Workflow | Runner |
|---|---|
| `ci.yml` (all four jobs), `codeql.yml`, `dco.yml`, `dependency-review.yml`, `security-scan.yml` (Semgrep, Trivy), `qodana.yml` | The organisation's self-hosted runners (`[self-hosted, Linux, X64]`). A pull request from a fork, or one whose head repository cannot be read, runs on `ubuntu-24.04` instead. |
| `release.yml`, `scorecard.yml` | GitHub-hosted, always. |

Why those two stay hosted:

- **Scorecard.** The action's README says the job that publishes results "should run on one of the Ubuntu
  hosted runners", and its API may reject results from anything else (the step then only logs a warning).
- **Release.** The SLSA generator is a reusable workflow that picks its own runner, so it cannot move. The
  build, signing and release jobs stay next to it because the signature and the provenance are meant to
  describe a build on a fresh VM. Releases only run on tags, so this costs little.

## The trust model

The self-hosted runners are persistent, and they are shared with the organisation's other repositories (the
`Default` runner group allows public repositories). GitHub advises using self-hosted runners with private
repositories only, because the code of a pull request from a fork can run on them. This repository accepts that
risk on one condition:

- **Fork pull requests need a maintainer's approval.** Settings, Actions, General, "Fork pull request
  workflows from outside collaborators" is set to "Require approval for all external contributors". Nothing
  from a fork runs on any runner until a maintainer approves the run.
- **The `runs-on` expression is not a security boundary.** On a `pull_request` event GitHub uses the workflow
  file of the pull request, so a fork can change `runs-on`. The expression only keeps an *unchanged* workflow
  of a fork on a GitHub-hosted VM, and it fails safe (hosted) when the head repository is unknown.
- **Before you approve a run, read the whole diff**, not only `.github/`. CI executes `package.json`
  scripts and dependency lifecycle scripts (`yarn install`), `yarn.lock` and `.yarnrc.yml`, `scripts/**` and
  `infra/test/**`. If you are not sure, do not approve.
- Workflows ask for `contents: read` only, check out with `persist-credentials: false`, and pull requests
  from forks never receive secrets (Qodana is skipped without its token).
- A compromised runner reaches the other jobs on that host, with their secrets. That is the residual risk.
  The way to remove it is a runner that only this repository can use: a repository-level ephemeral runner on
  its own VM with its own label, and `allows_public_repositories` switched off on the `Default` group.

## What a runner host needs

| Tool | Used by |
|---|---|
| Docker (the runner user can reach the daemon) | the test job's PostgreSQL container (`scripts/ci-start-postgres.sh`), Qodana |
| `git` | every checkout |
| `curl`, `tar`, `sha256sum` | the Trivy install in `security-scan.yml` |
| `python3` and `python3-venv` | Semgrep (`python3 -m venv`) |
| `psql` (`postgresql-client`) | `scripts/ci-bootstrap-db.sh` |
| `ss` (`iproute2`) | `scripts/ci-start-postgres.sh` and `infra/test/nginx-snippet.test.sh` pick a port nobody listens on |

Node.js is not installed on the hosts and is not needed: every job that runs `node` gets the version in `.nvmrc`
from `actions/setup-node`, the CodeQL JavaScript analysis included (its extractor starts `node`). On Debian and Ubuntu the two
packages that are usually missing are installed with:

```bash
sudo apt-get install -y python3-venv postgresql-client
```

Checked on 2026-11-01 with a throwaway workflow on a branch: six jobs of 40 seconds each, so that every runner
took at least one, each printing the version of the tools above. The branch, the run and its logs were
deleted afterwards. Repeat that when a runner is added or rebuilt.

## Ports

CI never uses a fixed port, because jobs of several repositories share a host, and a fixed port (5432 for
PostgreSQL) would meet another job or a PostgreSQL that runs on the host.

- The test job's PostgreSQL container gets a random free port from 50001 to 65535, published on `127.0.0.1`
  only (`scripts/ci-start-postgres.sh`). `scripts/ci-bootstrap-db.sh` requires `PGPORT` and has no default.
- The Playwright stack (`e2e/support/ports.ts`) and `infra/test/nginx-snippet.test.sh` pick from the same
  range, and prove each port free first.
- The consent-api integration test binds port 0, so the operating system picks the port.
