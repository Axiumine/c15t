#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Deploys the platform: build a release, migrate, switch `current`, reload nginx, restart, check health.
#
#   infra/deploy.sh [--dry-run] [--plan-only] [--skip-migrate]    build and activate the commit at C15T_REF (HEAD)
#   infra/deploy.sh rollback [RELEASE_ID]                         activate the previous (or the named) release
#   infra/deploy.sh -h | --help
#
# Steps (README D7, CLAUDE.md "Hosting"):
#   1. copy the source into releases/<git sha, or a UTC timestamp when the tree is not a git repo>
#      (a git tree is exported with `git archive`, so only committed files are deployed)
#   2. yarn install --immutable, yarn build, check that the build outputs exist
#   3. yarn c15t:plan (shown), yarn c15t:migrate, yarn db:migrate, against the primary, with the
#      variables of the service env files. Migrations run BEFORE the switch, so they must stay
#      compatible with the release that is still running (add first, remove in a later release).
#   4. render the nginx upstreams from the env files, install them and the three snippets, nginx -t
#   5. switch the `current` symlink atomically (ln -sfn + mv -T), reload nginx, restart the services
#   6. health checks; on failure everything from step 4 and 5 is reverted to the previous release
#   7. keep the newest C15T_KEEP_RELEASES releases (always including current and previous)
# The database migrations of step 3 are NOT reverted by a rollback.
#
# Run as the deploy user with sudo rights, or as root. Privileged steps (reading the 0600 env files,
# writing /etc/nginx, nginx -t, systemctl) go through sudo; the build runs as the invoking user.
# /opt/c15t-platform must be writable by that user and traversable by user c15t and by nginx.
#
# Environment (all optional):
#   DRY_RUN=1                 print what would happen, change nothing (same as --dry-run)
#   C15T_ROOT                 prefix for the three directories below (tests); default empty
#   C15T_APP_DIR              default $C15T_ROOT/opt/c15t-platform   (releases/, current)
#   C15T_ENV_DIR              default $C15T_ROOT/etc/c15t-platform   (consent-api.env, dashboard-api.env)
#   C15T_NGINX_DIR            default $C15T_ROOT/etc/nginx           (conf.d/, snippets/)
#   C15T_SYSTEMD_DIR          default $C15T_ROOT/etc/systemd/system  (only compared with infra/systemd)
#   C15T_SRC_DIR              source tree, default: the repository this script is in
#   C15T_REF                  git ref to deploy, default HEAD
#   C15T_RELEASE_ID           release directory name, default: short git sha or timestamp
#   C15T_KEEP_RELEASES        default 5
#   C15T_SERVICES             default "c15t-consent-api c15t-dashboard-api"
#   C15T_HEALTH_TIMEOUT       seconds to wait per health check, default 45
#   CONSENT_API_HEALTH_PATH   default /status        DASHBOARD_API_HEALTH_PATH   default /api/health
#   C15T_SUDO                 command prefix for privileged steps; "" for none (default: none as root, else sudo)
#   C15T_NODE_BIN             the node the services run, default /usr/bin/node (its major version is checked)
#   YARN_BIN, NGINX_BIN, SYSTEMCTL_BIN, CURL_BIN, GIT_BIN   tool names or paths
#
# Host and port are read from the env files and never guessed: CONSENT_API_HOST and CONSENT_API_PORT
# from consent-api.env, DASHBOARD_API_HOST and DASHBOARD_API_PORT from dashboard-api.env. Both files
# must set them explicitly. Secrets from the files are only exported to the migration commands and
# are never printed.
set -euo pipefail
shopt -s inherit_errexit 2>/dev/null || true
shopt -u patsub_replacement 2>/dev/null || true
umask 022

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

DRY_RUN=${DRY_RUN:-0}
C15T_ROOT=${C15T_ROOT:-}
C15T_APP_DIR=${C15T_APP_DIR:-$C15T_ROOT/opt/c15t-platform}
C15T_ENV_DIR=${C15T_ENV_DIR:-$C15T_ROOT/etc/c15t-platform}
C15T_NGINX_DIR=${C15T_NGINX_DIR:-$C15T_ROOT/etc/nginx}
C15T_SYSTEMD_DIR=${C15T_SYSTEMD_DIR:-$C15T_ROOT/etc/systemd/system}
C15T_SRC_DIR=${C15T_SRC_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}
C15T_REF=${C15T_REF:-HEAD}
C15T_RELEASE_ID=${C15T_RELEASE_ID:-}
C15T_KEEP_RELEASES=${C15T_KEEP_RELEASES:-5}
C15T_SERVICES=${C15T_SERVICES:-"c15t-consent-api c15t-dashboard-api"}
C15T_HEALTH_TIMEOUT=${C15T_HEALTH_TIMEOUT:-45}
CONSENT_API_HEALTH_PATH=${CONSENT_API_HEALTH_PATH:-/status}
DASHBOARD_API_HEALTH_PATH=${DASHBOARD_API_HEALTH_PATH:-/api/health}
C15T_NODE_BIN=${C15T_NODE_BIN:-/usr/bin/node}
YARN_BIN=${YARN_BIN:-yarn}
NGINX_BIN=${NGINX_BIN:-nginx}
SYSTEMCTL_BIN=${SYSTEMCTL_BIN:-systemctl}
CURL_BIN=${CURL_BIN:-curl}
GIT_BIN=${GIT_BIN:-git}
PLAN_ONLY=0
SKIP_MIGRATE=0
COMMAND=deploy
ROLLBACK_TARGET=""
PREVIOUS_TARGET=""

if [[ -v C15T_SUDO ]]; then
  read -r -a SUDO <<<"$C15T_SUDO"
elif ((EUID == 0)); then
  SUDO=()
else
  SUDO=(sudo)
fi

APP_DIR=$C15T_APP_DIR
RELEASES_DIR=$APP_DIR/releases
CURRENT=$APP_DIR/current
PREVIOUS_LINK=$APP_DIR/previous   # the release that was current before the last switch (target of `rollback`)
ENV_CONSENT=$C15T_ENV_DIR/consent-api.env
ENV_DASHBOARD=$C15T_ENV_DIR/dashboard-api.env
MARKER=.release-ok

# Build tools: no prompts, no telemetry, no progress bars in the log.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 YARN_ENABLE_TELEMETRY=0 YARN_ENABLE_PROGRESS_BARS=0 CI=1
# Migrations and builds run in UTC like the services do (c15t stores timestamps without a time zone).
export TZ=UTC

# ---- helpers ----------------------------------------------------------------------------------

log() { printf '%s deploy: %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { log "WARNING: $*"; }
die() { log "ERROR: $*" >&2; exit 1; }

usage() { sed -n '2,/^set -euo/{/^set -euo/!s/^# \{0,1\}//p}' "${BASH_SOURCE[0]}"; }

# run CMD...: execute, or only print under --dry-run.
run() {
  if ((DRY_RUN)); then log "[dry-run] $(printf '%q ' "$@")"; return 0; fi
  "$@"
}

priv() { run "${SUDO[@]}" "$@"; }

WORK=""
PARTIAL_REL=""
cleanup() {
  [[ -n $WORK && -d $WORK ]] && rm -rf "$WORK"
  if [[ -n $PARTIAL_REL && -d $PARTIAL_REL ]]; then
    warn "removing the unfinished release $PARTIAL_REL"
    rm -rf "$PARTIAL_REL"
  fi
  return 0
}
trap cleanup EXIT

while (($#)); do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --plan-only) PLAN_ONLY=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    rollback) COMMAND=rollback; if [[ ${2-} != "" && $2 != -* ]]; then ROLLBACK_TARGET=$2; shift; fi ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done
((PLAN_ONLY && SKIP_MIGRATE)) && die "--plan-only and --skip-migrate cannot be combined"
[[ $C15T_KEEP_RELEASES =~ ^[1-9][0-9]*$ ]] || die "C15T_KEEP_RELEASES must be a positive integer"
[[ $C15T_HEALTH_TIMEOUT =~ ^[0-9]+$ ]] || die "C15T_HEALTH_TIMEOUT must be an integer"
WORK=$(mktemp -d)

# ---- env files --------------------------------------------------------------------------------

# read_env_file FILE ASSOC_ARRAY_NAME: parse a systemd EnvironmentFile (KEY=VALUE, # and ; comments,
# optional quotes) without evaluating it as shell. Read through sudo, because the file is 0600.
read_env_file() {
  local file=$1
  local -n _vars=$2
  local content line key val
  content=$("${SUDO[@]}" cat -- "$file") || die "cannot read $file"
  while IFS= read -r line || [[ -n $line ]]; do
    line=${line#"${line%%[![:space:]]*}"}
    case $line in '' | '#'* | ';'*) continue ;; esac
    [[ $line == *=* ]] || continue
    key=${line%%=*}
    key=${key%"${key##*[![:space:]]}"}
    [[ $key =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    val=${line#*=}
    val=${val#"${val%%[![:space:]]*}"}
    val=${val%"${val##*[![:space:]]}"}
    if ((${#val} >= 2)) && [[ ${val:0:1} == "${val: -1}" && ( ${val:0:1} == '"' || ${val:0:1} == "'" ) ]]; then
      val=${val:1:${#val}-2}
    fi
    # shellcheck disable=SC2004
    _vars[$key]=$val
  done <<<"$content"
}

# require_setting ASSOC_ARRAY KEY FILE: print the value, or stop with a clear message.
require_setting() {
  local -n _src=$1
  local key=$2 file=$3
  [[ -n ${_src[$key]-} ]] || die "$key is not set in $file. deploy.sh never guesses addresses or ports; set it explicitly."
  printf '%s' "${_src[$key]}"
}

valid_host() { [[ $1 =~ ^[A-Za-z0-9._:-]+$ && $1 != 0.0.0.0 && $1 != :: ]]; }
valid_port() { [[ $1 =~ ^[0-9]+$ ]] && ((10#$1 >= 1024 && 10#$1 <= 65535)); }
unbracket_host() { local h=${1#\[}; printf '%s' "${h%\]}"; }
bracket_host() { # IPv6 literals need brackets in nginx and in URLs
  if [[ $1 == *:* ]]; then printf '[%s]' "$1"; else printf '%s' "$1"; fi
}

# in_release_with_env ENVFILE RELEASE_DIR CMD...: run CMD in RELEASE_DIR, in a subshell in which every
# variable of ENVFILE is exported. The secrets exist only in that subshell and are never printed.
in_release_with_env() {
  local file=$1 dir=$2
  shift 2
  if ((DRY_RUN)); then log "[dry-run] (cd ${dir##*/}; variables of ${file##*/}) $*"; return 0; fi
  local -A vars=()
  read_env_file "$file" vars
  (
    for k in "${!vars[@]}"; do export "$k=${vars[$k]}"; done
    cd "$dir" && "$@"
  )
}

load_endpoints() {
  # shellcheck disable=SC2034  # filled by read_env_file through a nameref, read by require_setting
  local -A consent=() dash=()
  read_env_file "$ENV_CONSENT" consent
  read_env_file "$ENV_DASHBOARD" dash
  # `|| exit 1`: a die inside $( ) only ends the subshell, and callers may run with errexit off.
  CONSENT_HOST=$(require_setting consent CONSENT_API_HOST "$ENV_CONSENT") || exit 1
  CONSENT_PORT=$(require_setting consent CONSENT_API_PORT "$ENV_CONSENT") || exit 1
  DASHBOARD_HOST=$(require_setting dash DASHBOARD_API_HOST "$ENV_DASHBOARD") || exit 1
  DASHBOARD_PORT=$(require_setting dash DASHBOARD_API_PORT "$ENV_DASHBOARD") || exit 1
  CONSENT_HOST=$(unbracket_host "$CONSENT_HOST")
  DASHBOARD_HOST=$(unbracket_host "$DASHBOARD_HOST")
  valid_host "$CONSENT_HOST" || die "CONSENT_API_HOST in $ENV_CONSENT is not a usable bind address"
  valid_host "$DASHBOARD_HOST" || die "DASHBOARD_API_HOST in $ENV_DASHBOARD is not a usable bind address"
  valid_port "$CONSENT_PORT" || die "CONSENT_API_PORT in $ENV_CONSENT must be an integer from 1024 to 65535"
  valid_port "$DASHBOARD_PORT" || die "DASHBOARD_API_PORT in $ENV_DASHBOARD must be an integer from 1024 to 65535"
  CONSENT_HOST=$(bracket_host "$CONSENT_HOST")
  DASHBOARD_HOST=$(bracket_host "$DASHBOARD_HOST")
}

# render_upstreams TEMPLATE OUTFILE: fill the four placeholders of infra/nginx/upstreams.conf.tmpl.
# shellcheck disable=SC2016  # the placeholders are literal text, not expansions
render_upstreams() {
  local text
  text=$(<"$1")
  text=${text//'${CONSENT_API_HOST}'/$CONSENT_HOST}
  text=${text//'${CONSENT_API_PORT}'/$CONSENT_PORT}
  text=${text//'${DASHBOARD_API_HOST}'/$DASHBOARD_HOST}
  text=${text//'${DASHBOARD_API_PORT}'/$DASHBOARD_PORT}
  if [[ $text == *'${'* ]]; then die "unfilled placeholder left in $1"; fi
  printf '%s\n' "$text" >"$2"
}

# ---- releases ---------------------------------------------------------------------------------

release_complete() { [[ -f $RELEASES_DIR/$1/$MARKER ]]; }

current_id() {
  local target
  target=$(readlink "$CURRENT" 2>/dev/null) || return 0
  basename "$target"
}

# list_releases: complete releases, newest first (by the mtime of the marker file).
list_releases() {
  local d
  [[ -d $RELEASES_DIR ]] || return 0
  for d in "$RELEASES_DIR"/*/; do
    [[ -f ${d}$MARKER ]] || continue
    printf '%s\t%s\n' "$(stat -c %Y "${d}$MARKER")" "$(basename "$d")"
  done | sort -t$'\t' -k1,1nr -k2,2r | cut -f2
}

resolve_release_id() {
  local id=$C15T_RELEASE_ID
  if [[ -z $id ]]; then
    if is_git_tree; then
      id=$("$GIT_BIN" -C "$C15T_SRC_DIR" rev-parse --short=12 "$C15T_REF^{commit}") || die "git ref $C15T_REF not found"
    else
      id=$(date -u +%Y%m%dT%H%M%SZ)
    fi
  fi
  [[ $id =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || die "invalid release id: $id"
  printf '%s' "$id"
}

is_git_tree() {
  command -v "$GIT_BIN" >/dev/null 2>&1 && "$GIT_BIN" -C "$C15T_SRC_DIR" rev-parse --git-dir >/dev/null 2>&1
}

preflight() {
  local want node node_major
  ((BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4))) || die "bash 4.4 or newer is required"
  local tool
  for tool in tar flock "$CURL_BIN" "$YARN_BIN"; do
    command -v "$tool" >/dev/null 2>&1 || die "missing tool: $tool"
  done
  [[ -d $C15T_SRC_DIR ]] || die "source directory not found: $C15T_SRC_DIR"
  [[ -d $C15T_NGINX_DIR/conf.d ]] || die "$C15T_NGINX_DIR/conf.d does not exist (is nginx installed?)"
  [[ -d $C15T_NGINX_DIR/snippets ]] || priv mkdir -p -- "$C15T_NGINX_DIR/snippets"
  [[ ! -e $CURRENT || -L $CURRENT ]] || die "$CURRENT exists and is not a symlink"

  # The node the services run must be the major version the repo pins (.nvmrc, engines.node).
  want=$(tr -d 'v \n' <"$C15T_SRC_DIR/.nvmrc" 2>/dev/null || true)
  want=${want%%.*}
  if [[ -n $want ]]; then
    for node in "$C15T_NODE_BIN" "$(command -v node || true)"; do
      [[ -n $node && -x $node ]] || die "node not found ($node)"
      node_major=$("$node" -p 'process.versions.node.split(".")[0]')
      [[ $node_major == "$want" ]] || die "$node is Node $node_major but this repo pins Node $want (.nvmrc)"
    done
  fi
  log "node ${want:-unchecked (no .nvmrc)}; source $C15T_SRC_DIR; app dir $APP_DIR"
  load_endpoints   # fail before building anything if an address or port is missing or invalid
  [[ -e $C15T_NGINX_DIR/conf.d/cloudflare-realip.conf ]] ||
    log "$C15T_NGINX_DIR/conf.d/cloudflare-realip.conf is missing: cloudflare-ips.service writes it after the switch (it runs from current/)"
}

# bootstrap_realip: the first deploy has no conf.d/cloudflare-realip.conf yet. cloudflare-ips.service
# runs update-cloudflare-ips.sh from `current`, so it can only start once the switch has happened.
# Without the file the visitor IP is a Cloudflare edge address (rate limits, consent records), so a
# failure here is a loud warning, but it does not revert a release that is healthy.
bootstrap_realip() {
  [[ -e $C15T_NGINX_DIR/conf.d/cloudflare-realip.conf ]] && return 0
  log "starting cloudflare-ips.service once: cloudflare-realip.conf is missing"
  priv "$SYSTEMCTL_BIN" start cloudflare-ips.service ||
    warn "cloudflare-ips.service failed (journalctl -u cloudflare-ips -n 30). Until it succeeds nginx has no real_ip config and the visitor IP is wrong. Is the unit installed (README: Production, step 3)?"
}

stage_source() { # stage_source ID: copy the source tree into releases/<id>
  local id=$1 rel=$RELEASES_DIR/$1
  PARTIAL_REL=$rel
  run mkdir -p "$rel"
  if is_git_tree; then
    if [[ -n $("$GIT_BIN" -C "$C15T_SRC_DIR" status --porcelain 2>/dev/null) ]]; then
      warn "the working tree has uncommitted changes. Only the committed files of $C15T_REF are deployed."
    fi
    log "exporting $C15T_REF from git into $rel"
    if ((DRY_RUN)); then
      log "[dry-run] git archive $C15T_REF | tar -x -C $rel"
    else
      "$GIT_BIN" -C "$C15T_SRC_DIR" archive --format=tar "$C15T_REF" | tar -x -C "$rel"
    fi
  else
    log "not a git repository: copying the tree into $rel (release id is a timestamp)"
    if ((DRY_RUN)); then
      log "[dry-run] tar -c (without node_modules, dist, .env*, .git, ...) | tar -x -C $rel"
    else
      tar -C "$C15T_SRC_DIR" -cf - \
        --exclude=node_modules --exclude=dist --exclude=.git --exclude='.env*' --exclude=.tsbuild \
        --exclude='*.tsbuildinfo' --exclude=coverage --exclude=.vite --exclude=playwright-report \
        --exclude=test-results --exclude=blob-report --exclude=.idea --exclude='*.log' \
        --exclude=.yarn/install-state.gz --exclude=.yarn/cache . | tar -x -C "$rel"
    fi
  fi
}

build_release() { # build_release ID
  local id=$1 rel=$RELEASES_DIR/$1 f
  stage_source "$id"
  log "yarn install --immutable"
  if ((DRY_RUN)); then
    log "[dry-run] (cd $rel && $YARN_BIN install --immutable)"
    log "[dry-run] (cd $rel && $YARN_BIN build)"
    log "[dry-run] check apps/consent-api/dist/server.js, apps/dashboard-api/dist/server.js, apps/dashboard-web/dist/index.html"
    PARTIAL_REL=""
    return 0
  fi
  (cd "$rel" && "$YARN_BIN" install --immutable)
  log "yarn build"
  (cd "$rel" && "$YARN_BIN" build)
  for f in apps/consent-api/dist/server.js apps/dashboard-api/dist/server.js apps/dashboard-web/dist/index.html; do
    [[ -s $rel/$f ]] || die "the build did not produce $f"
  done
  touch "$rel/$MARKER"
  PARTIAL_REL=""
  log "release $id built"
}

migrate() { # migrate ID
  local rel=$RELEASES_DIR/$1
  if ((SKIP_MIGRATE)); then warn "migrations skipped (--skip-migrate)"; return 0; fi
  log "c15t migration plan (consent-api.env):"
  in_release_with_env "$ENV_CONSENT" "$rel" "$YARN_BIN" c15t:plan ||
    warn "yarn c15t:plan failed; the migration below decides"
  if ((PLAN_ONLY)); then
    log "--plan-only: stopping before any migration or switch. The built release $1 is kept and reused by the next deploy of the same commit."
    return 3
  fi
  log "yarn c15t:migrate"
  in_release_with_env "$ENV_CONSENT" "$rel" "$YARN_BIN" c15t:migrate || return 2
  log "yarn db:migrate (app schema)"
  in_release_with_env "$ENV_DASHBOARD" "$rel" "$YARN_BIN" db:migrate || return 2
}

# ---- nginx files ------------------------------------------------------------------------------

declare -a NGINX_CHANGED=()   # destination files this run replaced
declare -A NGINX_BACKUP=()    # destination -> copy of the previous content ("" = the file did not exist)

# stage_nginx_file SRC DEST: back up DEST and replace it atomically; unchanged files are skipped.
stage_nginx_file() {
  local src=$1 dest=$2 tmp
  if [[ -f $dest ]] && cmp -s "$src" "$dest"; then
    log "unchanged: $dest"
    return 0
  fi
  if ((DRY_RUN)); then log "[dry-run] install $src -> $dest"; return 0; fi
  local backup=""
  if [[ -f $dest ]]; then
    backup=$WORK/backup.$(printf '%s' "$dest" | tr '/' '_')
    "${SUDO[@]}" cat -- "$dest" >"$backup" || return 1
  fi
  tmp=$(dirname "$dest")/.$(basename "$dest").c15t-new
  "${SUDO[@]}" install -m 0644 -- "$src" "$tmp" || return 1
  "${SUDO[@]}" mv -f -- "$tmp" "$dest" || return 1
  NGINX_CHANGED+=("$dest")
  NGINX_BACKUP[$dest]=$backup
  log "installed $dest"
}

restore_nginx_files() {
  local dest
  for dest in "${NGINX_CHANGED[@]}"; do
    if [[ -n ${NGINX_BACKUP[$dest]} ]]; then
      "${SUDO[@]}" install -m 0644 -- "${NGINX_BACKUP[$dest]}" "$(dirname "$dest")/.$(basename "$dest").c15t-new"
      "${SUDO[@]}" mv -f -- "$(dirname "$dest")/.$(basename "$dest").c15t-new" "$dest"
    else
      "${SUDO[@]}" rm -f -- "$dest"
    fi
    log "restored $dest"
  done
  NGINX_CHANGED=()
}

nginx_test() { "${SUDO[@]}" "$NGINX_BIN" -t; }

# stage_nginx REL: install the snippets and the rendered upstreams of release REL; test the config.
stage_nginx() {
  local rel=$1 conf=$C15T_NGINX_DIR f infra=$1
  # A dry run has not created the release directory, so read the files from the source tree.
  if ((DRY_RUN)) && [[ ! -d $rel/infra ]]; then infra=$C15T_SRC_DIR; fi
  log "nginx upstreams: consent-api ${CONSENT_HOST}:${CONSENT_PORT}, dashboard-api ${DASHBOARD_HOST}:${DASHBOARD_PORT}"
  render_upstreams "$infra/infra/nginx/upstreams.conf.tmpl" "$WORK/c15t-upstreams.conf"
  for f in c15t.conf:c15t.conf dashboard-headers.conf:c15t-dashboard-headers.conf dashboard-locations.conf:c15t-dashboard-locations.conf; do
    stage_nginx_file "$infra/infra/nginx/${f%%:*}" "$conf/snippets/${f##*:}" || { restore_nginx_files; return 1; }
  done
  stage_nginx_file "$WORK/c15t-upstreams.conf" "$conf/conf.d/c15t-upstreams.conf" || { restore_nginx_files; return 1; }
  if ((DRY_RUN)); then
    log "[dry-run] rendered $conf/conf.d/c15t-upstreams.conf:"
    sed 's/^/    /' "$WORK/c15t-upstreams.conf"
    log "[dry-run] ${SUDO[*]} $NGINX_BIN -t"
    return 0
  fi
  if ! nginx_test; then
    log "nginx -t rejected the new files"
    restore_nginx_files
    return 1
  fi
}

# ---- activation -------------------------------------------------------------------------------

switch_current() { # switch_current TARGET: TARGET is relative to $APP_DIR, e.g. releases/<id>
  run ln -sfn -- "$1" "$APP_DIR/.current.new"
  run mv -T -- "$APP_DIR/.current.new" "$CURRENT"
}

restart_services() { local s; for s in $C15T_SERVICES; do priv "$SYSTEMCTL_BIN" restart "$s" || return 1; done; }

health_check() { # health_check NAME URL
  local name=$1 url=$2 deadline=$((SECONDS + C15T_HEALTH_TIMEOUT))
  if ((DRY_RUN)); then log "[dry-run] health check $name: GET $url (up to ${C15T_HEALTH_TIMEOUT}s)"; return 0; fi
  until "$CURL_BIN" -g -fsS -o /dev/null --max-time 3 "$url" 2>/dev/null; do
    if ((SECONDS >= deadline)); then
      log "health check FAILED: $name $url (see: journalctl -u ${C15T_SERVICES%% *} -n 50)"
      return 1
    fi
    sleep 1
  done
  log "healthy: $name $url"
}

health_checks() {
  health_check consent-api "http://${CONSENT_HOST}:${CONSENT_PORT}${CONSENT_API_HEALTH_PATH}" || return 1
  health_check dashboard-api "http://${DASHBOARD_HOST}:${DASHBOARD_PORT}${DASHBOARD_API_HEALTH_PATH}" || return 1
}

# activate_release ID: nginx files, switch, reload, restart, health. Reverts everything on failure.
# Written without relying on `set -e`, because it is called from an `if`.
activate_release() {
  local id=$1 rel=$RELEASES_DIR/$1
  PREVIOUS_TARGET=$(readlink "$CURRENT" 2>/dev/null || true)
  stage_nginx "$rel" || return 1
  log "switching current -> releases/$id (was: ${PREVIOUS_TARGET:-none})"
  switch_current "releases/$id" || return 1
  if ! { priv "$SYSTEMCTL_BIN" reload nginx && restart_services && health_checks; }; then
    revert_activation
    return 1
  fi
  if [[ -n $PREVIOUS_TARGET && $PREVIOUS_TARGET != "releases/$id" ]]; then
    if run ln -sfn -- "$PREVIOUS_TARGET" "$APP_DIR/.previous.new"; then
      run mv -T -- "$APP_DIR/.previous.new" "$PREVIOUS_LINK" || warn "could not update the previous link"
    else
      warn "could not update the previous link"
    fi
  fi
}

revert_activation() {
  log "ROLLING BACK to ${PREVIOUS_TARGET:-nothing (first deploy)}"
  if [[ -n ${PREVIOUS_TARGET:-} ]]; then
    switch_current "$PREVIOUS_TARGET" || warn "could not switch current back"
  else
    warn "there is no previous release to go back to; current still points at the failed one"
  fi
  if ((${#NGINX_CHANGED[@]})); then
    restore_nginx_files
    if nginx_test; then priv "$SYSTEMCTL_BIN" reload nginx || warn "nginx reload failed"; else warn "nginx -t fails after the restore: fix /etc/nginx by hand"; fi
  fi
  if [[ -n ${PREVIOUS_TARGET:-} ]]; then
    restart_services || warn "restart failed"
    if health_checks; then log "the previous release is healthy again"; else warn "the previous release is NOT healthy either"; fi
  fi
}

warn_unit_drift() { # warn_unit_drift REL
  local f name
  for f in "$1"/infra/systemd/*.service "$1"/infra/systemd/*.timer; do
    [[ -f $f ]] || continue
    name=$(basename "$f")
    if [[ ! -f $C15T_SYSTEMD_DIR/$name ]]; then
      warn "$name is not installed in $C15T_SYSTEMD_DIR (README: Production)"
    elif ! cmp -s "$f" "$C15T_SYSTEMD_DIR/$name"; then
      warn "$name differs from the installed unit. Copy it, then systemctl daemon-reload, then restart."
    fi
  done
}

prune_releases() {
  local cur prev prev2 id n=0 victim
  cur=$(current_id)
  prev=$(basename "${PREVIOUS_TARGET:-/}")
  prev2=$(basename "$(readlink "$PREVIOUS_LINK" 2>/dev/null || echo /)")
  while IFS= read -r id; do
    [[ -n $id ]] || continue
    n=$((n + 1))
    ((n > C15T_KEEP_RELEASES)) || continue
    [[ $id != "$cur" && $id != "$prev" && $id != "$prev2" ]] || continue
    victim=$RELEASES_DIR/$id
    [[ $victim == "$RELEASES_DIR"/?* && -d $victim ]] || continue
    log "pruning old release $id"
    run rm -rf -- "$victim"
  done < <(list_releases)
}

sweep_partial_releases() { # leftovers of a killed build (no marker); safe because we hold the lock
  local d
  [[ -d $RELEASES_DIR ]] || return 0
  for d in "$RELEASES_DIR"/*/; do
    [[ -d $d && ! -f ${d}$MARKER ]] || continue
    warn "removing unfinished release $d"
    run rm -rf -- "${d%/}"
  done
}

acquire_lock() {
  ((DRY_RUN)) && return 0
  mkdir -p "$RELEASES_DIR"
  exec 9>"$APP_DIR/.deploy.lock"
  flock -n 9 || die "another deploy is running ($APP_DIR/.deploy.lock)"
}

record() { ((DRY_RUN)) || printf '%s %s %s %s\n' "$(date -u +%FT%TZ)" "$1" "$2" "${SUDO_USER:-${USER:-unknown}}" >>"$APP_DIR/deploy.log"; }

# ---- commands ---------------------------------------------------------------------------------

do_deploy() {
  local id rel
  preflight
  id=$(resolve_release_id)
  rel=$RELEASES_DIR/$id
  if ((DRY_RUN)); then log "release id: $id (dry run)"; else log "release id: $id"; fi
  acquire_lock
  sweep_partial_releases
  if release_complete "$id"; then
    log "release $id is already built: reusing it"
  else
    build_release "$id"
  fi
  local status=0
  migrate "$id" || status=$?
  if ((status == 3)); then exit 0; fi
  if ((status != 0)); then die "migration failed; nothing was switched, the running release is untouched"; fi
  warn_unit_drift "$rel"
  if activate_release "$id"; then
    bootstrap_realip
  else
    record "$id" FAILED_ROLLED_BACK
    # A failed release must never be picked by `rollback` or reused. Rebuilding it is cheap.
    if [[ $(current_id) != "$id" ]]; then run rm -rf -- "$rel"; fi
    die "release $id failed and was reverted; see the messages above. Database migrations were not reverted."
  fi
  touch "${rel}/$MARKER" 2>/dev/null || true
  record "$id" deployed
  prune_releases
  log "deployed $id (previous: ${PREVIOUS_TARGET:-none})"
}

do_rollback() {
  local target=$ROLLBACK_TARGET cur id
  preflight
  acquire_lock
  cur=$(current_id)
  if [[ -z $target && -L $PREVIOUS_LINK ]]; then target=$(basename "$(readlink "$PREVIOUS_LINK")"); fi
  if [[ -z $target ]]; then
    while IFS= read -r id; do
      [[ $id != "$cur" ]] && { target=$id; break; }
    done < <(list_releases)
  fi
  [[ -n $target ]] || die "no other release to roll back to"
  [[ $target != "$cur" ]] || die "release $target is already current"
  release_complete "$target" || die "release $target does not exist or is not complete (releases: $(list_releases | tr '\n' ' '))"
  log "rolling back: ${cur:-none} -> $target"
  if activate_release "$target"; then
    record "$target" rolled-back-to
    log "now running $target"
  else
    die "rollback to $target failed and was reverted"
  fi
}

case $COMMAND in
  deploy) do_deploy ;;
  rollback) do_rollback ;;
esac
