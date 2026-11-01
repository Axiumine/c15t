#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# JetBrains Qodana on this repository, the same linter and configuration as .github/workflows/qodana.yml
# (qodana.yaml; docs/security-scanning.md, section "Qodana"). Run it as `yarn qodana`.
#
#   yarn qodana [extra `qodana scan` arguments, e.g. --show-report]
#
# Needs, and refuses to run (exit 1, nothing scanned) without:
#   QODANA_TOKEN  a Qodana Cloud project token for an Ultimate or Ultimate Plus license. Yarn puts the
#                 variables of the dotenv file (see env.example) into the environment of every `yarn <script>`,
#                 so it is enough to have it there; exporting it in the shell works too.
#   docker        a running Docker daemon: the linter is the image named in qodana.yaml.
#   qodana        the Qodana CLI, version 2026.2.2 like CI (docs/security-scanning.md says how to install it).
#   git, tar      to copy the tree (below).
#
# What it does:
#   - Copies the files git knows about (tracked, plus untracked files that are not ignored) into a temporary
#     directory and scans that copy. The linter container runs `yarn install` there (the `bootstrap` of
#     qodana.yaml) and reads every file it can see, so your dotenv file, node_modules and build output stay
#     out of it, and the container does not rewrite your node_modules. Your uncommitted changes are included.
#     Same idea as scripts/trivy.sh. The copy has no .git, so the report does not carry a commit or branch.
#   - Writes the result under .qodana/results (git-ignored): qodana.sarif.json, and report/ (HTML; open it with
#     `yarn qodana --show-report`, which serves it on a local port, or read the SARIF file).
#   - Exits with the status of the Qodana CLI: 0 when the quality gate of qodana.yaml holds, 255 when the number
#     of problems is above it, anything else for an error.
#
# What leaves the machine: the Qodana CLI sends the token to Qodana Cloud (license check, and the report is
# attached to the project that the token belongs to), and the report goes there too: the findings with the
# code around them, and qodana.yaml. A local run lands in the same Qodana Cloud project as the CI runs; use a
# token of a different project if you do not want that. The linter image comes from Docker Hub.
#
# The token is only read from the environment: it is never printed, never put on a command line and never
# written to a file by this script.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

# Collect every missing prerequisite first, so that one run tells you everything that has to be fixed.
problems=()
token="${QODANA_TOKEN:-}"
if [[ -z "${token//[[:space:]]/}" ]]; then
  problems+=("QODANA_TOKEN is empty or not set. Put QODANA_TOKEN=<Qodana Cloud project token> into the dotenv file that Yarn loads (see env.example), or export it in this shell. The Qodana JS linter needs a license token to run at all.")
fi
unset token
if ! command -v docker >/dev/null 2>&1; then
  problems+=("docker is not installed. The linter runs as a Docker image.")
elif ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  problems+=("the Docker daemon is not running, or this user may not use it.")
fi
if ! command -v qodana >/dev/null 2>&1; then
  problems+=("the qodana CLI is not on PATH. Install version 2026.2.2 as described in docs/security-scanning.md (section \"Qodana\", run it locally).")
fi
for tool in git tar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    problems+=("$tool is not installed (the tree is copied with it).")
  fi
done

if ((${#problems[@]} > 0)); then
  echo "qodana: not run, nothing was scanned:" >&2
  for problem in "${problems[@]}"; do
    echo "  - $problem" >&2
  done
  exit 1
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/c15t-qodana.XXXXXX")"
trap 'rm -rf "$work" 2>/dev/null || echo "qodana: could not remove $work, delete it by hand." >&2' EXIT

results="$root/.qodana/results"
rm -rf "$results"
mkdir -p "$results"

# Tracked files and untracked files that are not ignored. A file deleted in the working tree but still in
# the index is listed too, so tar's "No such file" for it is not an error here.
git ls-files -z --cached --others --exclude-standard --deduplicate \
  | tar --null --files-from=- --ignore-failed-read -cf - 2>/dev/null \
  | tar -xf - -C "$work"

echo "qodana: scanning a copy of the tree with the CLI ($(qodana --version 2>/dev/null | head -n 1)), result in .qodana/results"

# NONINTERACTIVE: never wait for a prompt. The CLI reads QODANA_TOKEN from this environment itself.
status=0
NONINTERACTIVE=1 qodana scan --project-dir "$work" --results-dir "$results" "$@" || status=$?

case "$status" in
  0) echo "qodana: done, the quality gate holds. Result: .qodana/results" ;;
  255) echo "qodana: the number of problems is above the failureConditions of qodana.yaml. Result: .qodana/results" >&2 ;;
  *) echo "qodana: the Qodana CLI exited with status $status. Result, if any: .qodana/results" >&2 ;;
esac
exit "$status"
