# Security scanning

Two scanners look at every pull request, every push to `main` and, once a week, the unchanged tree (new
rules and new advisories appear without a commit). They complement CodeQL and the dependency review (see
[`dependency-policy.md`](./dependency-policy.md)); they are not a replacement for either.

| Scanner | Looks for | Command | CI job |
|---|---|---|---|
| [Semgrep](https://semgrep.dev/docs/) | Insecure code patterns and hard-coded secrets in the sources and workflows | `yarn semgrep` (`scripts/semgrep.sh`) | `semgrep` in [`security-scan.yml`](../.github/workflows/security-scan.yml) |
| [Trivy](https://trivy.dev/docs/) | Known vulnerabilities in `yarn.lock` and the CI tools' lockfiles, secrets, misconfigurations | `yarn trivy` (`scripts/trivy.sh`) | `trivy` in the same workflow |

Both fail on any finding (Semgrep) or any HIGH or CRITICAL finding (Trivy). The two jobs are **not** required
status checks yet; the repository owner decides when they become one. Neither needs a secret, a token or a
login, and neither sends anything from this repository anywhere.

A third analyser, [Qodana](#qodana), is different in kind: it needs a paid license and a repository secret
(`QODANA_TOKEN`) and it sends its report to Qodana Cloud. It is therefore optional and advisory, and its job is
skipped, not failed, when the secret is missing. It has its own section below.

## Semgrep

- **Rule sets** (from the public Semgrep registry): `p/typescript`, `p/javascript`, `p/react`,
  `p/nodejsscan`, `p/secrets`. `p/nodejs` adds no rule that these do not already have. `p/owasp-top-ten`
  was tried and left out: its seven findings are six nginx `request-host-used` hits (the `Host` header that
  `infra/nginx/` forwards on purpose, and its copy in `docs/nginx.md`) and one Yarn setting, none of them in
  the TypeScript code. Add a set to the `configs` array in
  `scripts/semgrep.sh` when it finds something these do not and the tree passes.
- **Scope:** the files git knows about (tracked, plus untracked files that are not ignored), so `.env`
  files and `node_modules` are never read. Also excluded: `dist`, `node_modules`, `.yarn`, generated code
  (`*.generated.ts`, `routeTree.gen.ts`). Semgrep's default ignore list also skips directories called
  `test` or `tests` (`infra/test/`, `apps/dashboard-web/src/test/`); `*.test.ts` files are scanned.
- **Flags:** `--metrics=off` (no telemetry), `--disable-version-check`, `--error` (exit 1 on a finding).
  There is no `semgrep login`. The only network access is fetching the rule sets.
- Partial-parse warnings (`importOriginal<typeof import('./x.js')>()` in four test files, one JSX line in
  `setup-snippets.tsx`) are Semgrep's TypeScript parser, not a failure: about 99.9 percent of the lines parse.

### Suppress a finding

First fix it. If it is a proven false positive, put a comment on the line above (or at the end of the same
line) with the full rule ID and the reason:

```ts
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password -- test input, not a credential
const password = 'throwaway-test-password';
```

A suppression without a reason, and a reason such as "false positive", do not pass review. Never suppress a
rule for a whole directory or with a `.semgrepignore` entry to make the scan green. Today there are eight
suppressions: six made-up values in test files, and two regular expressions in `scripts/add-spdx-headers.mjs`
that are built from `.gitignore` and `REUSE.toml` (maintainer-controlled files), matched against repository
paths. `semgrep --disable-nosem` lists them.

## Trivy

- **Scanners:** `vuln` (reads `yarn.lock`, `.github/ci-tools/package-lock.json` and the Semgrep lockfile),
  `secret` and `misconfig`. Yarn Berry lockfiles are supported: Trivy reads 550 packages from our `yarn.lock`
  (version 10 metadata), development dependencies included (`--include-dev-deps`). There is nothing for
  `misconfig` to read yet (no Dockerfile, Kubernetes or Terraform files); it is switched on so that one
  added later is checked.
- **Gate:** `--severity HIGH,CRITICAL --exit-code 1`. Lower severities are shown by
  `yarn trivy --severity UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL` but do not fail. They follow the response times in
  `dependency-policy.md`. Five MEDIUM advisories are open in the Semgrep lockfile: Semgrep pins `mcp==1.29.0`
  and `opentelemetry-*~=1.37`, so we cannot move them, and the code involved (an MCP server and an OTLP
  header parser) is not run by `semgrep scan`.
- **What it scans:** a copy of the tracked and untracked-but-not-ignored files in a temporary directory
  (removed afterwards), not the working directory. A developer's `.env`, `.yarnrc` and `node_modules` are
  therefore never read.
- **Network:** Trivy downloads its vulnerability database and checks bundle (OCI artifacts from
  `ghcr.io/aquasecurity`, falling back to `mirror.gcr.io`). The version check is off. The database is data
  read by the pinned binary; a poisoned one could hide a vulnerability but not run code. Do not point
  `--db-repository` or `--checks-bundle-repository` at a registry you do not run (GHSA-mcj4-mphf-j9ff,
  fixed in 0.71.1, wrote files outside the cache from such an artifact).

### Suppress a finding

First upgrade. Otherwise add one line to [`.trivyignore`](../.trivyignore): the ID, then `exp:YYYY-MM-DD`,
with a comment above it that says why we are not affected. The date is mandatory (`scripts/trivy.sh` refuses
a line without it) and should be at most 90 days away; when it passes, Trivy fails again and someone has to
decide. The file has the full rules. It ignores nothing today.

## Qodana

[Qodana](https://www.jetbrains.com/help/qodana/) runs the JetBrains IDE inspections (WebStorm, through the
`jetbrains/qodana-js` linter, Ultimate or Ultimate Plus license) without an IDE. It is an extra layer next to
Biome, ESLint, Semgrep, Trivy and CodeQL. It complements them more than it repeats them (type and data-flow
based inspections, duplicated code, framework checks), and it is **advisory**: nothing in the repository
depends on it passing.

**Status: never run with a token.** Nobody has scanned this repository with Qodana yet, so its first result is
unknown: how many problems, which ones, how long a run takes, and whether every setting below behaves as
written. What was checked without a token: the workflow with `actionlint`, `qodana.yaml` against the
SchemaStore schema and the key list of the Qodana CLI, the inputs of the action against its `action.yaml` at
the pinned commit, the image digest and the CLI checksum against Docker Hub and the GitHub release, the
`bootstrap` commands in the real linter image (Node 22, as a non-root user, a clean copy of the tree), and the
guards of `scripts/qodana.sh` with a stand-in CLI. The quality gate is a ceiling for that reason, not a
target. "The first run" below says what the maintainer does next.

### Where it runs

- **Workflow** [`qodana.yml`](../.github/workflows/qodana.yml): every push to `main`, every pull request,
  Tuesdays 05:13 UTC, and by hand (*Actions, Qodana, Run workflow*). Pull requests are analysed on the changed
  files only (`pr-mode`); every other event scans the whole tree.
- **Locally:** `yarn qodana` (`scripts/qodana.sh`), see "Run it locally".
- **Not a required status check**, and it should not become one: without the secret the job ends green with a
  notice "skipped: no QODANA_TOKEN" (the normal case for pull requests from forks and from Dependabot, which
  get no secrets), and a skipped scan cannot prove that a change was scanned. It is not in the pre-push hook
  either: a run takes minutes, needs Docker and pulls a 1.2 GB image, and a hook that needs a token would
  fail for everyone without one.

### What it needs

- A Qodana license (Ultimate or Ultimate Plus) and a **project token** from Qodana Cloud (create a project
  there and copy its token). The JS linter does not start without a valid token.
- In GitHub: a repository secret named `QODANA_TOKEN` (*Settings, Secrets and variables, Actions*).
- On a developer machine: `QODANA_TOKEN=...` in the dotenv file that Yarn loads (`env.example` has the line),
  Docker, and the Qodana CLI.

**One scan and one token for the whole repository.** consent-api, dashboard-api, dashboard-web and the
packages are all TypeScript, so one linter (`qodana-js`) covers them and one Qodana Cloud project holds the
results. Qodana's own advice for a monorepo is a separate Cloud project and token per sub-project only when
the parts need different linters (for example a JVM backend next to a JavaScript frontend); that is not the
case here. If a part ever needs another linter, give it its own `qodana.yaml`, its own workflow job and its
own token, and limit each scan to its directory (`--only-directory` in Qodana 2026.2, `--source-directory`
in 2025.x). See <https://www.jetbrains.com/help/qodana/2026.2/monorepo-project.html>.

### What leaves the repository

- **To Qodana Cloud:** the token (license check; the report is attached to the project the token belongs to)
  and the report: the problems with their locations, messages and the code around them, the revision and
  branch of the run, and `qodana.yaml` with its comments (nothing in it may be sensitive). The repository is
  public, so its code is not a secret; a local run goes to the same Cloud project as CI unless you use a
  token of another project.
- **Downloads:** the linter image from Docker Hub, the CLI from a GitHub release, Yarn (through Corepack) and
  the dependencies from the npm registry (the `bootstrap`).
- **Not published:** no GitHub artifact (the logs and the report are not checked for the token, and artifacts of
  a public repository can be downloaded by anyone who is signed in to GitHub), no pull request comment, no
  check run. The result is in the job summary, in the log (`--print-problems`) and in Qodana Cloud.
- **The token inside the run:** only the scan step has it in its environment (not the checkout, not the
  install step), and the CLI hands it to the linter container. The `bootstrap` runs `yarn install` in that
  container with dependency lifecycle scripts switched off, so no code of a dependency runs next to the token.
  Yarn and `tsc` do run there, as they do in every other job.

### Settings, and why

- **Linter image:** `jetbrains/qodana-js:2026.2`, pinned by the digest of its multi-architecture manifest in
  `qodana.yaml` (`image:`). JetBrains only publishes `major.minor` tags and moves them when it ships a fix, so a
  tag alone would change under us. `linter: qodana-js` stays as the fallback for a CLI that ignores `image:`.
- **Profile:** `qodana.recommended`, the one JetBrains documents for CI/CD (the default `qodana.starter` is a
  subset of it). A stricter profile is not justified before the first result is known. The ESLint inspection is
  off: `yarn lint:eslint` already gates the same rules at zero findings.
- **Excluded:** dependencies, build output, reports, lock files, generated code (`packages/db/drizzle`,
  `*.generated.ts`, `routeTree.gen.ts`) and the stand-in single-page app of `infra/test`. Test files are
  analysed. Git-ignored paths are skipped by the recommended profile anyway; the explicit list means the file
  does not depend on that.
- **`bootstrap`:** the image has Node 22 and Yarn 1, this repository needs Yarn 4. The bootstrap runs
  `corepack yarn install --immutable` and `corepack yarn typecheck` (which writes the `dist/*.d.ts` that the
  workspaces import each other through). Without them every import is "unresolved" and the result is noise.
  A failing typecheck is logged and does not stop the scan.
- **Quality gate:** `failureConditions.severityThresholds.any: 500` (the older `failThreshold` key does the same
  and is marked deprecated in the schema). A run above it exits with 255 and the job fails. 500 is high enough
  that a first run is unlikely to fail on volume, and low enough to catch a broken bootstrap, where every import
  is unresolved and the count is in the thousands. It is meant to be replaced, see below.
- **Workflow permissions:** `contents: read` only. `pull-requests: write` would let the action comment on the
  pull request, `checks: write` would let it create a check run with annotations, `contents: write` is for
  `push-fixes`; all three are off, and the action's attempts to add a reaction to the pull request are
  refused harmlessly.
- **No cache** (`use-caches: false`), as in every other workflow: slower, and no run reads state that another
  wrote.
- **The CLI is verified before it runs.** The workflow downloads the Qodana CLI 2026.2.2 archive and checks its
  SHA-256 in a step of its own, then tells the action to use that binary (`use-installed-cli`). The action can
  download the CLI itself with the same checksum, but in its code (`scan/src/utils.ts`, `installCli`) a
  mismatch only marks the step failed and the binary still runs, with the token in its environment. The
  release is not immutable, so its assets could be replaced.

### Run it locally

`yarn qodana` needs the CLI on `PATH`. Install the version CI uses (Linux, x86-64; the archive name and checksum of
other platforms are in `common/cli.json` of the pinned action) outside the repository:

```bash
curl -fsSLO https://github.com/JetBrains/qodana-cli/releases/download/v2026.2.2/qodana_linux_x86_64.tar.gz
echo "b1fc01fb5825f4c6382f9cedcfe97d4a8eeaaddc9f5384a3b5870ca63e231c6f  qodana_linux_x86_64.tar.gz" \
  | sha256sum --check --strict -
mkdir -p ~/.local/bin && tar -xzf qodana_linux_x86_64.tar.gz -C ~/.local/bin qodana

yarn qodana                  # scans, writes .qodana/results (git-ignored)
yarn qodana --show-report    # the same, then serves the HTML report on a local port
```

The script stops with a message and exit status 1 when `QODANA_TOKEN` is empty, Docker is not running or the
CLI is missing. It scans a **copy** of the files git knows about (tracked, plus untracked files that are not
ignored; your uncommitted changes are in it), as `scripts/trivy.sh` does: the linter container installs the
dependencies in that copy and reads every file it can see, so your dotenv file and your `node_modules` stay out of
it. The exit status is the CLI's: 0, 255 for the quality gate, anything else is an error. The first run pulls
the image (1.2 GB) and installs the dependencies, so it takes a while.

### The first run (what the maintainer does)

1. Add the repository secret `QODANA_TOKEN` and, for local runs, the line in your dotenv file.
2. Start the workflow by hand (*Actions, Qodana, Run workflow*) on `main`, or run `yarn qodana`.
3. Read the result before you trust it: the job summary, the log (`--print-problems` lists every finding), and
   the report in Qodana Cloud. First check that the scan was sound. Look for `qodana bootstrap:` in the log
   (the install or typecheck failed), for a mass of "unresolved" problems (the dependencies were not
   resolved), and for findings in paths that `exclude` should have removed (a glob that Qodana does not
   understand). Also check that WebStorm 2026.2 handles TypeScript 6.0.3, which this repository pins.
4. Then go through the findings: fix what is right, suppress what is wrong (below), and note what you disagree
   with. A profile that is too noisy is changed in `qodana.yaml`, not ignored.
5. Set the gate to what you accept: replace `any: 500` by the count that remains (or by per-severity limits,
   `critical`, `high`, ...), lower it when you fix things, and consider a baseline (`--baseline`, a SARIF
   file of the accepted problems) so that only new problems count. Remove `--print-problems` from the workflow
   once the findings are under control.
6. Only then decide whether Qodana should be a required check. The skipped-is-green property above is the
   reason not to.

### Suppress a finding

First fix it. If it is a proven false positive, put a `//noinspection <InspectionId>` comment on the line above
the code, with the reason, or add the inspection ID and the paths to `exclude` in `qodana.yaml` (a comment next
to it says why). The inspection ID is shown in the report. Do not exclude a whole directory with `name: All` to
make the scan pass.

## The Trivy supply-chain incident, and how we install it

On **19 March 2026** an attacker who still held credentials from a February breach (the first rotation was
not atomic) published a malicious **Trivy v0.69.4** (binary, deb and rpm packages, and the images on GHCR,
ECR Public and Docker Hub; live for about three hours), **force-pushed 76 of the 77 tags of
`aquasecurity/trivy-action`** and **all 7 tags of `aquasecurity/setup-trivy`** to commits that run an
infostealer before the real scan (it dumps the runner's process memory and sweeps for SSH keys, cloud
credentials and `.env` files), and on 22 March pushed malicious Docker Hub images `0.69.5` and `0.69.6`.
Advisory: [GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)
(CVE-2026-33634, critical). Not affected: Trivy up to 0.69.3, `trivy-action` v0.35.0 (the only tag that
survived, because releases were made immutable first), images referenced by digest, and builds from source.
Aqua has since enabled GitHub immutable releases; every release from v0.69.3 on is immutable.

What we do about it (the workflow explains the same in comments):

- **No Trivy action.** `security-scan.yml` has no `uses:` except `actions/checkout`. `trivy-action` and
  `setup-trivy` are not used, even pinned by SHA: a scanner's action runs with the job's token and
  environment, and a binary we can check ourselves needs no wrapper.
- **The release archive, by checksum.** The job downloads `trivy_0.76.1_Linux-64bit.tar.gz` from the
  GitHub release `v0.76.1` and checks it against a SHA-256 that is written in the workflow
  (`c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0`), never one fetched from the same
  place. v0.76.1 is an immutable release, so neither its tag nor its assets can be swapped, and the digest
  is the one GitHub's release attestation records (checked with `gh release verify` and
  `gh release verify-asset`). A new version is a deliberate
  change to the workflow, reviewed like code.
- **Semgrep the same way:** installed from `.github/ci-tools/semgrep/requirements.txt`, a lockfile with a
  SHA-256 for every wheel of Semgrep and of everything it depends on. pip runs with `--require-hashes`,
  `--only-binary :all:` and `--no-deps`, so it refuses a changed file, an extra package and a source build.
- **Least privilege:** `permissions: contents: read`, no secrets, no `id-token`, no caches, and
  `persist-credentials: false` on checkout.

## Run it locally

Both scripts print a message and exit 0 when the tool is missing and `CI` is unset (so `yarn semgrep` is safe
on any machine); with `CI` set a missing tool is a failure. Install the versions CI uses, outside the
repository:

```bash
# Semgrep (Python 3.10 to 3.14)
python3 -m venv ~/.local/share/c15t-semgrep
~/.local/share/c15t-semgrep/bin/python -m pip install --require-hashes --only-binary :all: --no-deps \
  --requirement .github/ci-tools/semgrep/requirements.txt
export PATH="$HOME/.local/share/c15t-semgrep/bin:$PATH"

# Trivy 0.76.1 (Linux, 64-bit; other platforms: take the archive and checksum from the same release)
curl -fsSLO https://github.com/aquasecurity/trivy/releases/download/v0.76.1/trivy_0.76.1_Linux-64bit.tar.gz
echo "c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0  trivy_0.76.1_Linux-64bit.tar.gz" \
  | sha256sum --check --strict -
mkdir -p ~/.local/bin && tar -xzf trivy_0.76.1_Linux-64bit.tar.gz -C ~/.local/bin trivy

yarn semgrep && yarn trivy
```

## Update the pins

Dependabot cannot update either pin, so a maintainer does it by hand, at most every few months and when a
new Trivy or Semgrep release fixes something that matters. (Qodana has its own paragraph at the end.) Use a release that is at least seven days old
(the repository's Dependabot cooldown).

**Semgrep.** From `.github/ci-tools/semgrep/`, with [`uv`](https://docs.astral.sh/uv/):

```bash
printf 'semgrep==<new version>\n' | uv pip compile - --generate-hashes --universal --python-version 3.12 \
  --only-binary :all: --exclude-newer <a date at least 7 days ago> -o requirements.txt
```

Then update the version in the "Install Semgrep" comment of `security-scan.yml`, run `yarn semgrep` and
`yarn trivy` (which also reads the new lockfile), and commit the file.

**Trivy.** Pick the release, then verify it before you write anything down:

```bash
gh release view --repo aquasecurity/trivy <tag> --json isImmutable --jq .isImmutable   # true
gh release verify --repo aquasecurity/trivy <tag>                          # GitHub's release attestation
gh release download --repo aquasecurity/trivy <tag> -p 'trivy_*_Linux-64bit.tar.gz' -p 'trivy_*_checksums.txt'
sha256sum trivy_*_Linux-64bit.tar.gz                                        # equals the line in checksums.txt
gh release verify-asset --repo aquasecurity/trivy <tag> trivy_*_Linux-64bit.tar.gz
```

Put the version and SHA-256 in the `env:` of the "Install Trivy" step and in the local-install block above,
read the release notes and the advisories of `aquasecurity/trivy`, and run `yarn trivy`.

**Qodana.** Three pins move together, and Dependabot updates none of them on its own (it is told to leave
`JetBrains/qodana-action` alone in `.github/dependabot.yml`: the Qodana job is skipped for its pull requests,
because they have no secret, so a bump of the action alone would merge untested). Choose an action release at
least seven days old, then:

```bash
# 1. The release, as a full commit SHA (the tags are annotated, so ask for the commit, not the tag object).
gh release list --repo JetBrains/qodana-action --limit 5
gh api repos/JetBrains/qodana-action/commits/<tag> --jq .sha

# 2. The CLI that this action version bundles, and its checksum for Linux x86-64.
gh api 'repos/JetBrains/qodana-action/contents/common/cli.json?ref=<sha>' --jq .content | base64 -d
#    GitHub records the same digest for the asset; the two must agree.
gh release view v<cli version> --repo JetBrains/qodana-cli --json assets \
  --jq '.assets[] | select(.name == "qodana_linux_x86_64.tar.gz") | .digest'

# 3. The linter image: the major.minor of the action (its default cache key reads qodana-2026.2) and the
#    digest of that tag.
docker buildx imagetools inspect jetbrains/qodana-js:<major.minor>      # the "Digest:" line
```

Put the SHA and its `# vX.Y.Z` comment on the `uses:` line of the Qodana step, the CLI version and SHA-256 in the
`env:` of "Install the Qodana CLI" (and in the local-install block above), and the tag and digest in the `image:`
line of `qodana.yaml` (also the comment that names the tag). Run `qodana pull` in a directory that holds
`qodana.yaml` (it pulls the digest and fails if it does not exist), `actionlint` on the workflow, then start the
workflow by hand and read the result before the change is merged. The image tag is moved by JetBrains when it
ships a fix, so look at the digest again about every quarter, as for the PostgreSQL image.
