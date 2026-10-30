#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine
#
# Prints the CHANGELOG.md section of a release (the body of `## [X.Y.Z] - date`, without the
# heading) to stdout:
#
#   scripts/release-notes.sh vX.Y.Z [CHANGELOG.md]
#
# Exit status: 0 when a non-empty section was printed, 3 when CHANGELOG.md has no such section
# (the release workflow then falls back to GitHub's generated notes), 1 on a usage error.
set -euo pipefail

[[ $# -ge 1 && $# -le 2 ]] || { echo 'usage: release-notes.sh vX.Y.Z [CHANGELOG.md]' >&2; exit 1; }
tag=$1
changelog=${2:-CHANGELOG.md}

semver='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'
[[ "$tag" =~ $semver ]] || { echo "tag '$tag' is not vMAJOR.MINOR.PATCH[-prerelease]" >&2; exit 1; }
version=${tag#v}

[[ -f "$changelog" ]] || exit 3

# Keep a Changelog headings: `## [1.2.3] - 2026-01-31`. The heading is matched as plain text, not
# as a regular expression, so the dots in the version cannot match anything else.
notes=$(awk -v version="$version" '
  BEGIN { head = "## [" version "]" }
  !capture && substr($0, 1, length(head)) == head &&
    (length($0) == length(head) || substr($0, length(head) + 1, 1) == " ") { capture = 1; next }
  capture && /^## / { exit }
  capture && /^\[[^]]+\]: / { next }  # link definitions at the end of the file
  capture {
    # Drop leading and trailing blank lines, keep the ones in between.
    if ($0 ~ /^[[:space:]]*$/) { blank++; next }
    if (started) for (i = 0; i < blank; i++) print ""
    blank = 0; started = 1; print
  }
' "$changelog")

[[ -n "$notes" ]] || exit 3
printf '%s\n' "$notes"
