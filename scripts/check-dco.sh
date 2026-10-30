#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Developer Certificate of Origin check (CONTRIBUTING.md): every non-merge commit in BASE..HEAD must
# carry a "Signed-off-by: Name <email>" trailer whose email is the author's or the committer's.
# Only two bots are exempt, and only with their own GitHub noreply address: dependabot[bot] and
# github-actions[bot] (see `is_exempt_bot`). A name that merely ends in "[bot]" is not enough. Git
# author fields can be set to anything, so this narrows the exemption to what GitHub itself
# creates; the sign-off of every human commit is still required.
#
#   BASE_SHA=<sha> HEAD_SHA=<sha> scripts/check-dco.sh
#
# Commit messages are untrusted input: they are only ever read into variables and compared as
# data, never evaluated.
set -euo pipefail

base="${BASE_SHA:?BASE_SHA is required}"
head="${HEAD_SHA:?HEAD_SHA is required}"
failed=0

# is_exempt_bot NAME EMAIL: true for the known bot logins with their GitHub noreply address
# (`<account id>+<login>@users.noreply.github.com`). Both must match exactly (the email ignoring case).
is_exempt_bot() {
  local name="$1" email="${2,,}"
  case "$name" in
    'dependabot[bot]') [[ "$email" == '49699333+dependabot[bot]@users.noreply.github.com' ]] ;;
    'github-actions[bot]') [[ "$email" == '41898282+github-actions[bot]@users.noreply.github.com' ]] ;;
    *) return 1 ;;
  esac
}

while IFS= read -r sha; do
  author_name="$(git log -1 --format=%an "$sha")"
  author_email="$(git log -1 --format=%ae "$sha")"
  committer_email="$(git log -1 --format=%ce "$sha")"
  subject="$(git log -1 --format=%s "$sha")"

  if is_exempt_bot "$author_name" "$author_email"; then
    continue
  fi

  ok=0
  while IFS= read -r email; do
    if [[ "${email,,}" == "${author_email,,}" || "${email,,}" == "${committer_email,,}" ]]; then
      ok=1
      break
    fi
  done < <(git log -1 --format=%B "$sha" | sed -n 's/^Signed-off-by:[[:space:]].*<\([^>]*\)>[[:space:]]*$/\1/p')

  if [[ "$ok" -ne 1 ]]; then
    printf 'Missing or mismatched Signed-off-by: %s %s\n' "${sha:0:12}" "$subject"
    failed=1
  fi
done < <(git rev-list --no-merges "${base}..${head}")

if [[ "$failed" -ne 0 ]]; then
  printf '\nSign off with: git commit -s (or, for existing commits: git rebase --signoff BASE).\n'
  printf 'See CONTRIBUTING.md (Developer Certificate of Origin).\n'
  exit 1
fi
printf 'All commits are signed off.\n'
