#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Dependency vulnerabilities (yarn.lock, including the CI tools' package-lock.json), secrets and
# misconfigurations of the repository, with Trivy (docs/security-scanning.md). A HIGH or CRITICAL
# finding fails the run. Same command locally (`yarn trivy`) and in .github/workflows/security-scan.yml.
#
#   scripts/trivy.sh [extra trivy arguments]
#
# Not installed and CI unset: prints how to install it and exits 0, so `yarn trivy` does not break a
# machine without it. With CI set (GitHub Actions sets it) a missing tool is a failure: a skipped scan
# must never look like a clean one.
#
# Trivy scans a copy of the files git knows about (tracked, plus untracked files that are not
# ignored), not the working directory. That keeps node_modules, build output and local secrets such as
# .env files out of the scan and out of its report, and it is exactly what a checkout in CI contains.
#
# The only network access is Trivy's download of its public vulnerability database and checks bundle
# (ghcr.io/aquasecurity); nothing from this repository is sent anywhere. The version check is off.
# Ignored findings live in .trivyignore, each with a reason and an expiry date.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if ! command -v trivy >/dev/null 2>&1; then
  if [[ -n "${CI:-}" ]]; then
    echo "trivy: not installed, and CI is set: refusing to skip the scan" >&2
    exit 1
  fi
  echo "trivy: not installed, skipping (nothing was scanned)." >&2
  echo "  Install the version CI uses: see docs/security-scanning.md, section \"Run it locally\"." >&2
  echo "  Set CI=1 to turn this skip into a failure." >&2
  exit 0
fi

# Every ignore line needs an expiry date, so that an ignored finding cannot outlive its reason. (Trivy
# itself stops ignoring a line after its date; it does not insist on one being there.)
unexpiring="$(
  grep -Ev '^[[:space:]]*(#|$)' "$root/.trivyignore" \
    | grep -Ev '[[:space:]]exp:[0-9]{4}-[0-9]{2}-[0-9]{2}[[:space:]]*$' || true
)"
if [[ -n "$unexpiring" ]]; then
  echo "trivy: .trivyignore lines without an 'exp:YYYY-MM-DD' expiry:" >&2
  echo "$unexpiring" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Tracked files and untracked files that are not ignored. A file deleted in the working tree but still
# in the index is listed too, so tar's "No such file" for it is not an error here.
git ls-files -z --cached --others --exclude-standard --deduplicate \
  | tar --null --files-from=- --ignore-failed-read -cf - 2>/dev/null \
  | tar -xf - -C "$work"

version="$(trivy --version)"
echo "${version%%$'\n'*} (vuln, secret, misconfig; HIGH and CRITICAL fail)"
trivy fs \
  --scanners vuln,secret,misconfig \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --include-dev-deps \
  --ignorefile "$root/.trivyignore" \
  --skip-version-check \
  --no-progress \
  "$@" \
  "$work"
