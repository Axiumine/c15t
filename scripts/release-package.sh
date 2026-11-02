#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine
#
# Builds the release files into OUT_DIR. Run it by the release workflow (and locally to
# check a release) from a checkout of the tag, after `yarn install --immutable` and
# `yarn build`:
#
#   scripts/release-package.sh vX.Y.Z OUT_DIR
#
# OUT_DIR receives, for version X.Y.Z:
#   c15t-platform-X.Y.Z-source.tar.gz         the tagged source tree (git archive)
#   c15t-platform-X.Y.Z-consent-api.tar.gz    built consent-api + the workspace packages it needs
#   c15t-platform-X.Y.Z-dashboard-api.tar.gz  built dashboard-api + the workspace packages it needs
#   c15t-platform-X.Y.Z-dashboard-web.tar.gz  the static dashboard (apps/dashboard-web/dist), with
#                                             dist/THIRD-PARTY-NOTICES.md: the license texts of the
#                                             dependencies inside the minified bundle
#   c15t-platform-X.Y.Z-<app>.cdx.json        CycloneDX 1.6 SBOM of each app's runtime dependencies
#   SHA256SUMS                                checksums of all of the above
#
# The built tarballs hold compiled output, the manifests and yarn.lock; install the runtime
# dependencies from the lockfile with `yarn workspaces focus --production <workspace>`.
# Production deployments build from the tagged source with infra/deploy.sh (docs/decisions.md D7).
#
# Needs: git, GNU tar, gzip, sha256sum, node, and `cyclonedx-yarn` (the pinned
# @cyclonedx/yarn-plugin-cyclonedx from .github/ci-tools) on PATH. The tarballs are
# reproducible: sorted entries, fixed owner, and the commit time as modification time.
set -euo pipefail

log() { printf '[release-package] %s\n' "$*"; }
die() { printf '[release-package] error: %s\n' "$*" >&2; exit 1; }

[[ $# -eq 2 ]] || die 'usage: release-package.sh vX.Y.Z OUT_DIR'
tag=$1
out=$2

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

# Release tags are semantic versions with a leading v: v1.2.3 or v1.2.3-rc.1.
semver='^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$'
[[ "$tag" =~ $semver ]] || die "tag '$tag' is not vMAJOR.MINOR.PATCH[-prerelease]"
version=${tag#v}

package_version=$(node -e "process.stdout.write(JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version)")
[[ "$package_version" == "$version" ]] ||
  die "tag $tag does not match the version in package.json ($package_version); bump it before tagging"

# The tag must point at the commit that is checked out, or the files would not match the tag.
head_commit=$(git rev-parse HEAD)
tag_commit=$(git rev-parse --verify "refs/tags/${tag}^{commit}") || die "tag $tag does not exist in this checkout"
[[ "$head_commit" == "$tag_commit" ]] || die "HEAD ($head_commit) is not the commit of $tag ($tag_commit)"

SOURCE_DATE_EPOCH=$(git log -1 --format=%ct HEAD)
export SOURCE_DATE_EPOCH

command -v cyclonedx-yarn > /dev/null 2>&1 || die 'cyclonedx-yarn is not on PATH (install .github/ci-tools first)'

mkdir -p "$out"
out=$(cd "$out" && pwd)
base="c15t-platform-${version}"

# Fixed order, owner and times; -n keeps the file name and time out of the gzip header.
pack() { # pack NAME PATH...  (paths relative to the repository root)
  local name=$1
  shift
  local top="${base}-${name}"
  local path
  for path in "$@"; do
    [[ -e "$path" ]] || die "missing $path (did 'yarn build' run?)"
  done
  tar --sort=name --format=gnu --owner=0 --group=0 --numeric-owner \
    --mtime="@${SOURCE_DATE_EPOCH}" --transform "s,^,${top}/," --exclude='*.tsbuildinfo' \
    -cf - -- "$@" | gzip -n -9 > "${out}/${top}.tar.gz"
  log "wrote ${top}.tar.gz"
}

# Files every built tarball carries: the lockfile pins the runtime dependencies, LICENSE and
# LICENSES are the license texts.
common=(package.json yarn.lock LICENSE)
for optional in .yarnrc.yml .nvmrc LICENSES; do
  if [[ -e "$optional" ]]; then common+=("$optional"); fi
done

log "source: git archive of ${tag}"
git archive --format=tar --prefix="${base}-source/" "$head_commit" | gzip -n -9 > "${out}/${base}-source.tar.gz"

pack consent-api "${common[@]}" \
  apps/consent-api/package.json apps/consent-api/dist \
  packages/db/package.json packages/db/dist packages/db/drizzle \
  packages/shared/package.json packages/shared/dist
pack dashboard-api "${common[@]}" \
  apps/dashboard-api/package.json apps/dashboard-api/dist \
  packages/db/package.json packages/db/dist packages/db/drizzle \
  packages/shared/package.json packages/shared/dist

# The minified bundle carries no license notices of its own. Vite writes them (`build.license` in
# apps/dashboard-web/vite.config.ts) as dist/THIRD-PARTY-NOTICES.md, which lands in the tarball and
# so is covered by its entry in SHA256SUMS, its signature and its provenance.
notices=apps/dashboard-web/dist/THIRD-PARTY-NOTICES.md
[[ -s "$notices" ]] || die "missing $notices (build.license in apps/dashboard-web/vite.config.ts; did 'yarn build' run?)"
grep -q '^## ' "$notices" || die "$notices lists no bundled dependency"
# A package without a LICENSE file gets only its SPDX identifier; say so in the build log.
unlicensed=$(awk '/^## /{ if (name != "" && !has) print name; name = substr($0, 4); has = 0; next }
                  NF { has = 1 }
                  END { if (name != "" && !has) print name }' "$notices")
if [[ -n "$unlicensed" ]]; then
  while IFS= read -r entry; do log "warning: no license text in the package of: ${entry}"; done <<< "$unlicensed"
fi

pack dashboard-web LICENSE apps/dashboard-web/dist
# A listing in a variable, not a pipe: `grep -q` closing early would fail tar under pipefail.
listing=$(tar -tzf "${out}/${base}-dashboard-web.tar.gz")
grep -Fxq "${base}-dashboard-web/${notices}" <<< "$listing" ||
  die "${base}-dashboard-web.tar.gz does not contain ${notices}"

# One SBOM per app: the root workspace depends on none of them, so the plugin has to run inside
# each. --production keeps build-only tooling out. The plugin names the main component after the
# workspace version (0.0.0 for private workspaces), so it is set to the release version.
for app in consent-api dashboard-api dashboard-web; do
  sbom="${out}/${base}-${app}.cdx.json"
  (
    cd "apps/${app}"
    cyclonedx-yarn --production --output-reproducible --output-format JSON \
      --spec-version 1.6 --mc-type application --output-file "$sbom"
  )
  # shellcheck disable=SC2016 # the template literals are JavaScript, not shell
  node -e '
    const fs = require("node:fs");
    const [file, version, app] = process.argv.slice(1);
    const bom = JSON.parse(fs.readFileSync(file, "utf8"));
    const component = bom.metadata.component;
    component.version = version;
    component.purl = `pkg:npm/%40consent/${app}@${version}`;
    fs.writeFileSync(file, `${JSON.stringify(bom, null, 2)}\n`);
  ' "$sbom" "$version" "$app"
  log "wrote $(basename "$sbom")"
done

(
  cd "$out"
  # LC_ALL=C: a locale-independent order, so the file is the same on every machine.
  LC_ALL=C sha256sum -- "${base}"-* > SHA256SUMS
)
log "wrote SHA256SUMS"
