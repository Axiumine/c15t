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
  `setup.tsx`) are Semgrep's TypeScript parser, not a failure: about 99.9 percent of the lines parse.

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
new Trivy or Semgrep release fixes something that matters. Use a release that is at least seven days old
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
