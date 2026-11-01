<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Quality gates

What checks a change, where each one runs and in what order. Every gate is a yarn script that works the same
on a laptop and in CI; the Git hooks are lefthook running those scripts earlier, so a failure shows up in
seconds instead of after a push. **CI is the authority.** A hook can be skipped (see below), CI cannot. Where CI runs and what its runners need: [`ci-runners.md`](./ci-runners.md).

## The pipeline, in order

| Stage | Runs | What | Typical time |
|---|---|---|---|
| `git commit` → **pre-commit** (parallel) | on the staged change | `biome check` of the staged files, `spdx:check`, `code-caps`, `shellcheck` of staged `*.sh` (when installed), and an advisory GitNexus `detect-changes` (when the optional index exists; it never blocks) | 2 s |
| `git commit` → **commit-msg** | on the message | DCO sign-off: a `Signed-off-by: Name <email>` line (`scripts/git-hooks.mjs commit-msg`) | instant |
| `git push` → **pre-push** (piped: stops at the first failure) | on the whole tree | 1. `typecheck` (`tsc -b`, also writes the declarations the type-aware ESLint rules read) 2. in parallel: `lint` (Biome), `lint:eslint`, `knip`, `type-coverage`, `fta`, `code-caps`, `spdx:check` 3. `test:coverage` (Vitest, 100% statements, branches, functions and lines) 4. `test:scripts-coverage` (the `node:test` suites of `scripts/`, 100%) 5. in parallel: `semgrep`, `trivy` (skipped with a message when the tool is not installed) | 30 s warm, a few minutes cold |
| `git merge`, `git checkout` → **post-merge**, **post-checkout** | after the fact | a reminder to run `yarn install` when `yarn.lock` changed | instant |
| **Pull request** (CI) | on the merge result | the same checks as workflow jobs: *Verify* (typecheck, Biome, SPDX, build, infra script tests), *Static analysis* (ESLint, knip, type coverage, FTA, code caps, scripts coverage), *Test* (PostgreSQL 17, 100% coverage), *Reproducible build*, *Security scan* (Semgrep, Trivy), CodeQL, dependency review, DCO, and *Qodana* when the `QODANA_TOKEN` secret exists (a notice "skipped" otherwise) | 5 min, Qodana longer |
| **Schedule** (CI) | weekly | *Security scan* again (rules and advisories change without a commit), *Qodana* (Tuesdays, same reason), OpenSSF Scorecard, *Mutation testing* (Mondays, [below](#mutation-testing-strykerjs), self-hosted runners) |  |

The required status checks of the `main` ruleset are listed in `docs/scorecard.md`. *Static analysis*,
*Reproducible build* and *Security scan* run on every pull request but are not required checks until the
maintainer adds them to the ruleset. *Qodana* is not one either and should not become one: without the secret it
is skipped and green, which proves nothing (`docs/security-scanning.md`, "Qodana").

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
| Mutation testing (weekly, not per pull request) | StrykerJS | `yarn mutation` | mutation score of the chosen scope at least 90 (`thresholds.break`); PGlite only, no database |
| API snapshots | Vitest snapshots | `yarn test` | the dashboard API's JSON shapes and the CSV export bytes (`apps/dashboard-api/src/api-snapshots.test.ts`) |
| End to end | Playwright | `yarn test:e2e` | the dashboard and the consent flow in a real browser (needs the dev database; see `docs/e2e.md`) |
| Static analysis, JetBrains inspections (advisory) | Qodana (`jetbrains/qodana-js`, profile `qodana.recommended`), needs a license token and Docker | `yarn qodana` | `failureConditions` of `qodana.yaml`: at most 500 problems, a ceiling to be replaced after the first real run; CI job `qodana.yml` runs only with the `QODANA_TOKEN` secret |
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
  The two exceptions are Qodana, which needs a token and minutes of Docker time, and mutation testing, which takes
  minutes on many cores and must not block a push or a pull request (see "Decisions" below).
- A Node version manager is optional: fnm and mise both read `.nvmrc` (`fnm use`, `mise install`), and
  Corepack provides Yarn 4.

## Decisions and what is not here

| Item | Decision |
|---|---|
| Node.js 24 | Not used. The runtime is Node 26 LTS, pinned by `.nvmrc`, `engines.node` and `packageManager` (README D8); `scripts/check-code-caps.ts` and the other tools run on it. |
| Qodana (`jetbrains/qodana-js`) | **Added, advisory, never run with a token.** `qodana.yaml`, `.github/workflows/qodana.yml` (push to `main`, pull requests, weekly, manual) and `yarn qodana`. The job needs the `QODANA_TOKEN` repository secret (a Qodana Cloud project token) and is skipped with a notice when it is missing, so it is not a required check. Its first result is unknown until the maintainer runs it with the token; the gate is a placeholder ceiling of 500 problems until then (`docs/security-scanning.md`, "The first run"). It is not in the pre-push hook: a run takes minutes, needs Docker and a 1.2 GB image, and a hook that needs a token would fail for everyone without one. It overlaps CodeQL, Semgrep and ESLint only in part. |
| Mutation testing (`yarn mutation`) | **Weekly and by hand, not in the pre-push hook and not a pull-request check.** `.github/workflows/mutation.yml` runs it on the self-hosted runners ([`ci-runners.md`](./ci-runners.md)) on Mondays and on demand. A cold run took about 8 minutes on 32 cores and takes longer on the 8 to 12 CPU runners, so it must not block a push or a pull request. It is still a gate: the run fails when the score drops below `thresholds.break` ([below](#the-score-gate)). |
| FTA `score_cap` | **50**, the upper end of the "OK" band. When the check was added the cap was 65 (36 files scored between 50 and 65); those files were split into smaller modules and the cap was lowered to 50 (CONTRIBUTING.md, "Static analysers"). The worst file now scores about 49, so a change that makes a file worse than 50 must split it. |
| gitnexus | Stays optional (`.gitnexus/` is not in a clone). The pre-commit hook runs `detect-changes` for the staged change when the index exists and never blocks. |
| Rules relaxed in ESLint | Listed with their finding counts in `eslint.config.mjs`; none for security rules. Per-line disables carry a reason. |

## Mutation testing and snapshots

### Mutation testing (StrykerJS)

A mutation tester changes the code in small ways (flips a `<` to `<=`, deletes a condition, empties a
string) and runs the tests again. A mutant that no test notices *survived*: the tests execute that line
but would not tell if it were wrong. Line coverage cannot show this, and this repository already
requires 100% coverage.

| Item | Value |
|---|---|
| Tool | StrykerJS `@stryker-mutator/core`, `vitest-runner`, `typescript-checker`, all exactly `10.1.1` (Apache-2.0) |
| Run | `yarn mutation` (`stryker run --incremental`) |
| Config | `stryker.config.mjs`, `vitest.mutation.config.ts`, `tsconfig.mutation.json` |
| Report | `reports/mutation/mutation.html` (open in a browser), `mutation.json` (both git-ignored) |
| CI | `.github/workflows/mutation.yml`, "Mutation testing": Mondays 03:17 UTC and on demand, on the self-hosted runners ([`ci-runners.md`](./ci-runners.md)). Not a pull-request check |
| Coverage analysis | `perTest`: a mutant runs only the tests that executed its line |
| Type checker | A mutant that does not compile is discarded instead of being "killed" by a crash |

**No database.** The mutation suites never touch the shared development database. `stryker.config.mjs`
removes `DATABASE_URL_C15T`, `DATABASE_URL_DASHBOARD`, `DATABASE_URL_DASHBOARD_REPLICA` and
`C15T_ADMIN_API_KEY` from the environment before any worker starts, and sets `C15T_TEST_ENVIRONMENTS=pglite`.
The dashboard-api suites then run on PGlite (Postgres compiled to WebAssembly, in process) only, and the
consent-api integration test, which needs a server, is excluded in `vitest.mutation.config.ts`. This
matters: Yarn injects the root env file into every `yarn run`, and it does so also for a Git worktree
that sits *inside* the main checkout (it merges the parent's `.yarnrc.yml`), so a plain `yarn test` or
`yarn mutation` started in such a worktree would otherwise use the main checkout's database settings. A
probe test inside a Stryker worker confirmed that the variables are gone there. The measured run below was
started with a dotenv file that defines all of them.

#### Scope

The chosen scope is the code whose wrong behaviour is a security or data-correctness bug and whose tests
need no browser and no real server: the shared zod contracts, the database failover and migration code,
consent-api (request guard, registry, listener, instance factory, env) and the dashboard-api logic files
(`audit*`, `authz*`, `session`, `site-access`, `c15t-read`, `consent-*`, `csv`, `errors`, `error-handler`,
`error-response`, `pagination`, `password`, `range`, `site-mapping`, `users`, `validate`). The dashboard-api
wiring (routes, Better Auth setup, `app.ts`, `env.ts`, `server.ts`) and dashboard-web are left out: every
mutant re-creates a PGlite database, so wiring costs most of the run time, and the Playwright suite covers it
end to end. Widen the scope on the command line, for example
`yarn mutation --mutate 'apps/dashboard-api/src/routes/*.ts'` (the script already passes `--incremental`).

#### Measured run

One cold run (no incremental file, no database, `perTest`), Debian 13, 32 cores, Stryker's default worker count,
started from a shell where Yarn injected a dotenv file with all four database variables:

| Item | Value |
|---|---|
| Files mutated | 94 |
| Mutants | 2620: 928 did not compile (discarded), 1548 killed, 44 killed by a time-out, 100 survived |
| Score | **94.09%** (1592 of 1692 valid mutants detected) |
| By package | consent-api 90.12%, dashboard-api (logic files) 98.43%, `packages/db` 97.28%, `packages/shared` 96.45% |
| Time | 8 minutes 19 seconds |

An earlier port of the same work on another base measured 93.4% to 93.8%, and 93.36% on 4 cores, so expect a
point of variation.

Stryker warns that module-level code (the zod schemas, the regexes and the message tables) is *static*:
each such mutant needs the whole suite to be loaded again, which is most of the run time. `ignoreStatic: true`
would cut the run to a fraction. It is **not** enabled: those are the mutants that found the unpinned response
contracts, the validation messages and the policy presets.

Runner load: the weekly workflow passes `--concurrency 4` and has a 90 minute limit. It keeps
`reports/mutation/stryker-incremental.json` in `actions/cache`, so later runs only test the mutants whose code
or tests changed. The workflow itself cannot be run from a laptop: the first scheduled run on the runners is
the first real measurement there.

#### The score gate

`thresholds.break` in `stryker.config.mjs` is **90**. The run fails (exit code 1) when the score is lower.
It is the cold score of 94.09% minus a margin of about 4 points, so that a new mutant, a small refactor or the
time-out kills that move the score by about a point between runs do not fail the weekly run, while a real
regression (a deleted test file, a new untested module) does. consent-api alone scores 90.12%, so a drop in that
package is the first thing to watch. Both sides of the gate: the run above finished with exit code 0 ("Final
mutation score of 94.09 is greater than or equal to break threshold 90"). `high` (95) and `low` (90) only colour the report. Raise `break` when the score rises, never lower it to
make a run pass.

The score moves by up to about a point between runs: a few mutants are counted as killed by a time-out on one
run and survive on another (a time-out kill depends on how loaded the machine is), and the 13 `*.fuzz.test.ts`
files run inside the mutation run with random inputs. That is part of why `break` has a margin.

#### What still survives

Survivors are listed in the HTML report. Many are equivalent mutants (no test can tell them apart), for example
the hour-only `+02` offset form of the date regex (V8's `Date` parser rejects it anyway), or adding `forwarded`
to the client-IP header list that c15t already has in its default list.

These are the 100 survivors of the run above, by area:

| Area | Survivors | Why they are left |
|---|---|---|
| consent-api `listener*.ts` (`listener-watch`, `listener`, `listener-notify`, `listener-timing`, `listener-config`, `listener-driver`, `listener-types`) | 29 | Reconnect back-off, ping and connect time-outs of the `LISTEN` connection. Needs a fake Postgres connection with timing |
| consent-api `site-routes.ts`, `site-server.ts`, `site-attempt.ts`, `app.ts`, `status-routes.ts`, `server-shutdown.ts` | 18 | Log message text and fields, the 500/503 retry guard, a `HEAD` branch, the `unref()` of the shutdown timers |
| consent-api `registry*.ts`, `instance*.ts` | 15 | Bookkeeping that no public method shows: `retiring.delete`, the `disposals` set, the sign of the epoch and id counters, the text fields of the dispose warning |
| consent-api request handling (`database-failure`, `request-host`, `request-path`, `override-headers`, `forwarding-headers`, `env`) | 14 | Equivalent or not observable: headers already in c15t's default list, a loop bound where `charCodeAt` returns `NaN`, an anchor of the unsafe-path regex |
| `packages/shared` (`ip-v6`, `cidr`, `ip`, `origin`) | 14 | Guard clauses in the IPv6 and CIDR parser whose later code rejects the same input (equivalent mutants) |
| `packages/db` (`migrator`, `failover`) | 4 | The advisory lock text, the `>=` that skips applied migrations, `typeof x === 'object'` guards where `null` and primitives reach the same result |
| dashboard-api (`consent-purposes`, `error-handler`, `users`, `pagination`, `consent-cursor`, `range`) | 6 | Single mutants: equivalent, or needing a database-level test that was not worth it (the advisory lock of `users.ts`, an `?? ''` of a value that is never undefined there) |

### Vitest snapshots: API shapes and the CSV export

`apps/dashboard-api/src/api-snapshots.test.ts` pins the stable JSON shapes of the dashboard API and the
exact bytes of the CSV export. It runs on PGlite and on a real database with a fixed clock
(`2026-03-15T12:00:00.000Z`) and fixed seeded records, so nothing in the output is volatile: the run prefix,
random ids, client addresses and "created now" time stamps are replaced by fixed labels in
`apps/dashboard-api/src/testing/normalize.ts` (`<run>`, `<timestamp>` and similar). Everything else is kept as
it is, so a new field, a renamed field or a changed message shows up in the diff.

| File | What it pins |
|---|---|
| `src/__snapshots__/api-snapshots.test.ts.snap` | `GET /api/me` for each role; sites list and detail with the setup text; stats; a page of consent records with its cursor; one admin site row and one admin user row; the error envelope for unauthenticated, forbidden, unknown site and invalid input |
| `src/__snapshots__/consents-export.csv.txt` | The CSV export: header row, quoting of commas, quotes and newlines, the `'` guard in front of cells that start with `=`, `+`, `-` or `@`, CRLF line ends. `<CRLF>` and `<LF>` are made visible so a diff shows them |

A changed snapshot is a change of the API contract: read the diff before you accept it. Update with
`yarn vitest run -u apps/dashboard-api/src/api-snapshots.test.ts` and commit the changed files with the code
change that caused them. In CI (`CI` set) Vitest never writes a missing snapshot, so a lost file fails the run.
