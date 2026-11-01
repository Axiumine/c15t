#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Static analysis of the repository with Semgrep (docs/security-scanning.md). Any finding fails the
# run. Same command locally (`yarn semgrep`) and in .github/workflows/security-scan.yml.
#
#   scripts/semgrep.sh [extra semgrep arguments]
#
# Not installed and CI unset: prints how to install it and exits 0, so `yarn semgrep` does not break a
# machine without Python tooling. With CI set (GitHub Actions sets it) a missing tool is a failure:
# a skipped scan must never look like a clean one.
#
# No login, no token and no telemetry: `--metrics=off`, and the only network access is fetching the
# public rule sets named below from the Semgrep registry. Semgrep scans the files git knows about
# (tracked, plus untracked files that are not ignored), so .env files and node_modules are out already.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v semgrep >/dev/null 2>&1; then
  if [[ -n "${CI:-}" ]]; then
    echo "semgrep: not installed, and CI is set: refusing to skip the scan" >&2
    exit 1
  fi
  echo "semgrep: not installed, skipping (nothing was scanned)." >&2
  echo "  Install the version CI uses: see docs/security-scanning.md, section \"Run it locally\"." >&2
  echo "  Set CI=1 to turn this skip into a failure." >&2
  exit 0
fi

# Registry rule sets (https://semgrep.dev/explore). p/javascript and p/typescript overlap on purpose:
# each is named so that a rename on the registry side fails loudly instead of dropping coverage.
configs=(
  p/typescript
  p/javascript
  p/react
  p/nodejsscan
  p/secrets
)

# Build output, dependencies, Yarn's own files and generated code are not ours to fix.
excludes=(
  dist
  node_modules
  .yarn
  '*.generated.ts'
  routeTree.gen.ts
)

args=(scan --metrics=off --disable-version-check --error)
for config in "${configs[@]}"; do
  args+=(--config "$config")
done
for pattern in "${excludes[@]}"; do
  args+=(--exclude "$pattern")
done

echo "semgrep $(semgrep --version) (rule sets: ${configs[*]})"
exec semgrep "${args[@]}" "$@" .
