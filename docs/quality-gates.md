<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Quality gates

What checks a change, where each one runs and in what order. Every gate is a yarn script that works the same
on a laptop and in CI; the Git hooks are lefthook running those scripts earlier, so a failure shows up in
seconds instead of after a push. **CI is the authority.** A hook can be skipped (see below), CI cannot.

## The pipeline, in order

| Stage | Runs | What | Typical time |
|---|---|---|---|
| `git commit` → **pre-commit** (parallel) | on the staged change | `biome check` of the staged files, `spdx:check`, `code-caps`, `shellcheck` of staged `*.sh` (when installed), and an advisory GitNexus `detect-changes` (when the optional index exists; it never blocks) | 2 s |
| `git commit` → **commit-msg** | on the message | DCO sign-off: a `Signed-off-by: Name <email>` line (`scripts/git-hooks.mjs commit-msg`) | instant |
| `git push` → **pre-push** (piped: stops at the first failure) | on the whole tree | 1. `typecheck` (`tsc -b`, also writes the declarations the type-aware ESLint rules read) 2. in parallel: `lint` (Biome), `lint:eslint`, `knip`, `type-coverage`, `fta`, `code-caps`, `spdx:check` 3. `test:coverage` (Vitest, 100% statements, branches, functions and lines) 4. `test:scripts-coverage` (the `node:test` suites of `scripts/`, 100%) 5. in parallel: `semgrep`, `trivy` (skipped with a message when the tool is not installed) | 30 s warm, a few minutes cold |
| `git merge`, `git checkout` → **post-merge**, **post-checkout** | after the fact | a reminder to run `yarn install` when `yarn.lock` changed | instant |
| **Pull request** (CI) | on the merge result | the same checks as workflow jobs: *Verify* (typecheck, Biome, SPDX, build, infra script tests), *Static analysis* (ESLint, knip, type coverage, FTA, code caps, scripts coverage), *Test* (PostgreSQL 17, 100% coverage), *Reproducible build*, *Security scan* (Semgrep, Trivy), CodeQL, dependency review, DCO | 5 min |
| **Schedule** (CI) | weekly | *Security scan* again (rules and advisories change without a commit), OpenSSF Scorecard |  |

The required status checks of the `main` ruleset are listed in `docs/scorecard.md`. *Static analysis*,
*Reproducible build* and *Security scan* run on every pull request but are not required checks until the
maintainer adds them to the ruleset.

## The gates

| Gate | Tool | Script | What it enforces |
|---|---|---|---|
| Format and fast lint | Biome | `yarn lint`, `yarn format` | formatting, import order, lint rules, `noExcessiveCognitiveComplexity` (15) |
| Types | `tsc -b`, strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature` | `yarn typecheck` | no type errors in sources and tests |
| Type coverage | type-coverage `--strict --at-least 100` | `yarn type-coverage` | no `any`, no unsafe assertions in hand-written code |
| Typed lint | ESLint, typescript-eslint `strictTypeChecked`, sonarjs, security, no-unsanitized | `yarn lint:eslint` | zero findings (`--max-warnings 0`); `complexity` 10, `max-lines` 500, `max-lines-per-function` 50, `max-params` 4, `max-depth` 4 |
| Unused code | knip | `yarn knip` | no unused files, exports, types or dependencies |
| Maintainability | FTA | `yarn fta` | no file above `score_cap` in `fta.json` (lower score is better) |
| Size caps, ratchet | `scripts/check-code-caps.ts` (the parts are in `scripts/code-caps/`) | `yarn code-caps` | file 500, function 50, class 300 lines, 4 parameters, nesting 4; no new or grown violation against `.code-caps-baseline.json` |
| Unit and integration tests | Vitest, `@vitest/coverage-v8` | `yarn test`, `yarn test:coverage` | 100% statements, branches, functions and lines of `apps/*/src` and `packages/*/src` |
| Script tests | `node:test` | `yarn test:scripts-coverage` | 100% of `scripts/check-code-caps.ts`, `scripts/code-caps/` and `scripts/git-hooks.mjs` |
| End to end | Playwright | `yarn test:e2e` | the dashboard and the consent flow in a real browser (needs the dev database; see `docs/e2e.md`) |
| SAST | Semgrep (`p/typescript`, `p/javascript`, `p/react`, `p/nodejsscan`, `p/secrets`) | `yarn semgrep` | zero findings; CI uses a hash-pinned install |
| Vulnerabilities, secrets, misconfiguration | Trivy `fs` | `yarn trivy` | no HIGH or CRITICAL finding in `yarn.lock` and the CI tool lockfiles; no committed secret |
| Reproducible build | `scripts/verify-reproducible-build.sh` | CI job | two clean builds are byte-identical |
| Licenses and headers | `spdx:check`, dependency review | `yarn spdx:check` | SPDX header on every file; allowed dependency licenses |
| DCO | `scripts/git-hooks.mjs`, `scripts/check-dco.sh` | commit-msg hook, CI | a sign-off on every commit |

How to fix a failure of each analyser, and the reasons for its settings, are in `CONTRIBUTING.md`
("Static analysers", "ESLint") and `docs/security-scanning.md`.

## Hooks: install, skip, change

- `yarn install` installs them (the root `postinstall` runs `node scripts/git-hooks.mjs install`). It does
  nothing, and never fails the install, in CI, in a source tree without `.git` (a release tarball or a
  `git archive`), when the repository sets `core.hooksPath`, or when the lefthook binary is missing.
  `C15T_SKIP_HOOKS=1 yarn install` skips it on purpose.
- Skip once: `git commit --no-verify`, `git push --no-verify`, `LEFTHOOK=0 git push`, or one job with
  `LEFTHOOK_EXCLUDE=tests git push`. Run a stage by hand: `yarn lefthook run pre-push --force`.
- The configuration is `lefthook.yml`. When you add a gate, add its script to `package.json`, to the
  pre-push stage (in dependency order) and to a CI job in the same change, and list it in the table above.
- A Node version manager is optional: fnm and mise both read `.nvmrc` (`fnm use`, `mise install`), and
  Corepack provides Yarn 4.

## Decisions and what is not here

| Item | Decision |
|---|---|
| Node.js 24 | Not used. The runtime is Node 26 LTS, pinned by `.nvmrc`, `engines.node` and `packageManager` (README D8); `scripts/check-code-caps.ts` and the other tools run on it. |
| Qodana (`jetbrains/qodana-js`) | Not added. The JS/TS linter needs a paid license token, which only the maintainer can create and store as a repository secret; the project has no repository secrets today (releases are keyless). It overlaps CodeQL, Semgrep and ESLint. It can be added when there is a token and a reason. |
| FTA `score_cap` | **50**, the upper end of the "OK" band. When the check was added the cap was 65 (36 files scored between 50 and 65); those files were split into smaller modules and the cap was lowered to 50 (CONTRIBUTING.md, "Static analysers"). The worst file now scores about 49, so a change that makes a file worse than 50 must split it. |
| gitnexus | Stays optional (`.gitnexus/` is not in a clone). The pre-commit hook runs `detect-changes` for the staged change when the index exists and never blocks. |
| Rules relaxed in ESLint | Listed with their finding counts in `eslint.config.mjs`; none for security rules. Per-line disables carry a reason. |
