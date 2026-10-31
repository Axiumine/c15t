## What and why

<!-- What does this change, and why is it needed? Link the issue: "Fixes #123". -->

## How was it tested

<!-- New functionality needs new tests, and a bug fix needs a test that fails without the fix. -->

## Checklist

- [ ] Every commit has a DCO sign-off (`git commit -s`, a `Signed-off-by:` line).
- [ ] `yarn typecheck && yarn lint && yarn test` pass locally (and the DB-backed suites, if I touched database code).
- [ ] New or changed behavior has tests, and the tests would fail without my change.
- [ ] New source files carry the SPDX header (`node scripts/add-spdx-headers.mjs`).
- [ ] Documentation is updated (README, `docs/`, `CLAUDE.md` where the rules changed).
- [ ] `CHANGELOG.md` has an entry under "Unreleased" for user-visible changes.
- [ ] I read my own diff against the "Code review" checklist in `CONTRIBUTING.md`.
- [ ] No secrets, tokens or personal data in the diff, and no new hard-coded addresses or ports.
- [ ] If I added or upgraded a dependency: the version is pinned exactly, the license is AGPL-compatible,
      and `yarn.lock` is committed.

## Security impact

<!-- Does this touch authentication, authorization, tenant isolation, trusted proxies or the database
roles? Say how it was kept safe, or write "none". -->
