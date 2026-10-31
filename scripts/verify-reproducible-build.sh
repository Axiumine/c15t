#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine
#
# Proves that the build of the current commit is reproducible: the commit is cloned twice into
# two directories that differ in name and length, each clone installs its dependencies from the
# lockfile and runs `yarn build` and `scripts/release-package.sh`, and every file that comes out
# must have the same SHA-256 in both: the compiled `dist/` trees of all workspaces and every
# release file (the tarballs, the SBOMs and SHA256SUMS).
#
#   scripts/verify-reproducible-build.sh [--keep]
#
# Only the committed state of HEAD is built; uncommitted changes are ignored. The two builds are
# made to differ on purpose in what a build should not depend on: the checkout path (and its
# length), the time zone and the modification times of the sources. What they share is what the
# project pins: the Node.js and Yarn versions, the lockfile and the operating system. Another
# Node.js version or CPU architecture is not tested here.
#
# Needs: git, GNU tar, gzip, sha256sum, node 26 with Corepack/Yarn, network access for
# `yarn install`, and `cyclonedx-yarn` on PATH (`npm ci --prefix .github/ci-tools`, then add
# .github/ci-tools/node_modules/.bin to PATH). CI runs it as the "Reproducible build" job.
# With --keep the work directory is not deleted, so a difference can be inspected.
set -euo pipefail

log() { printf '[verify-reproducible-build] %s\n' "$*"; }
die() { printf '[verify-reproducible-build] error: %s\n' "$*" >&2; exit 1; }

keep=0
case "${1:-}" in
  '') ;;
  --keep) keep=1 ;;
  *) die 'usage: verify-reproducible-build.sh [--keep]' ;;
esac
[[ $# -le 1 ]] || die 'usage: verify-reproducible-build.sh [--keep]'

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

command -v cyclonedx-yarn > /dev/null 2>&1 ||
  die 'cyclonedx-yarn is not on PATH (npm ci --prefix .github/ci-tools; add its node_modules/.bin to PATH)'

commit=$(git rev-parse --verify HEAD)
version=$(node -e "process.stdout.write(JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version)")
tag="v${version}"
log "commit ${commit}, release files for ${tag}"

work=$(mktemp -d "${TMPDIR:-/tmp}/c15t-repro.XXXXXXXX")
cleanup() {
  if [[ $keep -eq 1 ]]; then
    log "kept ${work}"
  else
    rm -rf -- "$work"
  fi
}
trap cleanup EXIT

# Same lockfile, same tools. Telemetry and the Yarn cache location do not influence the output.
export YARN_NODE_LINKER=node-modules
export YARN_ENABLE_TELEMETRY=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# build NAME DIRECTORY TIMEZONE MTIME
#   A clone of the commit in DIRECTORY, built with that time zone and with the modification time
#   of every tracked file set to MTIME. The result is left in DIRECTORY/release-out.
build() {
  local name=$1 dir=$2 zone=$3 mtime=$4
  mkdir -p -- "$(dirname -- "$dir")"
  git clone --quiet --no-local --no-checkout -- "$repo_root" "$dir"
  git -C "$dir" -c advice.detachedHead=false checkout --quiet "$commit"
  [[ "$(git -C "$dir" rev-parse HEAD)" == "$commit" ]] || die "build ${name}: wrong commit in ${dir}"
  # release-package.sh insists on the tag of the version in package.json at HEAD. It is set in the
  # clone only (the clone has its own repository), and replaces the tag of an earlier release
  # that the clone copied when this commit is not the tagged one.
  # update-ref, not `git tag`: a tag.gpgSign setting must not make the script ask for a signature.
  git -C "$dir" update-ref "refs/tags/${tag}" "$commit"
  git -C "$dir" ls-files -z | (cd "$dir" && xargs -0 touch -h -d "$mtime" --)
  (
    cd "$dir"
    export TZ="$zone"
    log "build ${name}: yarn install (TZ=${zone}, ${dir})"
    yarn install --immutable > /dev/null
    log "build ${name}: yarn build"
    yarn build > /dev/null
    log "build ${name}: release-package.sh"
    bash scripts/release-package.sh "$tag" release-out > /dev/null
  )
}

# Checksums of the build output, with paths relative to DIRECTORY, in a fixed order.
digest() { # digest DIRECTORY OUTFILE
  (
    cd "$1"
    {
      find apps packages -path '*/node_modules' -prune -o -path '*/dist/*' -type f -print0
      find release-out -type f -print0
    } | LC_ALL=C sort -z | xargs -0 sha256sum --
  ) > "$2"
}

# Different path, path length, time zone and file times on purpose.
build first "${work}/a/c15t" UTC '2001-02-03 04:05:06 UTC'
build second "${work}/second-checkout-with-a-much-longer-name/b/repo" Pacific/Kiritimati '2030-12-31 23:59:59 UTC'

digest "${work}/a/c15t" "${work}/first.sha256"
digest "${work}/second-checkout-with-a-much-longer-name/b/repo" "${work}/second.sha256"

files=$(wc -l < "${work}/first.sha256")
dist_files=$(grep -c ' [a-z]*/[^/]*/dist/' "${work}/first.sha256" || true)
release_files=$(grep -c ' release-out/' "${work}/first.sha256" || true)
[[ "$dist_files" -gt 0 && "$release_files" -gt 0 ]] ||
  die "nothing to compare (${dist_files} dist files, ${release_files} release files)"

if ! diff -u "${work}/first.sha256" "${work}/second.sha256" > "${work}/diff.txt"; then
  cat "${work}/diff.txt" >&2
  keep=1
  die 'the two builds differ (lines starting with - are the first build, + the second)'
fi

log "reproducible: ${files} files identical (${dist_files} under dist/, ${release_files} release files)"
