#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Installs, deploys and uninstalls the platform: build a release, migrate, switch `current`, reload
# nginx, restart, check health.
#
#   infra/deploy.sh install [--dry-run]                           prepare the host (once; safe to repeat)
#   infra/deploy.sh [--dry-run] [--plan-only] [--skip-migrate]    build and activate the commit at C15T_REF (HEAD)
#   infra/deploy.sh rollback [RELEASE_ID]                         activate the previous (or the named) release
#   infra/deploy.sh uninstall [--dry-run] [--purge-config] [--remove-cloudflare]
#                                                                 remove what install and deploy put on the host
#   infra/deploy.sh -h | --help
#
# install: creates the system user, /etc/c15t-platform (0750) with empty 0600 env files, /opt/c15t-platform,
# copies infra/systemd/* into the systemd directory (also the way to refresh them after an upgrade), runs
# daemon-reload and enables the two services and cloudflare-ips.timer. It never overwrites an env file,
# never starts the services, does not touch nginx or the database, and changes nothing that already
# exists except a unit file that differs from infra/systemd: that one is replaced, with a warning, and
# the previous copy is kept next to it as <unit>.c15t-saved (put your own changes in a drop-in).
# Then: fill in the env files, prepare the database (docs/database-setup.md), run `infra/deploy.sh`.
#
# Steps (docs/decisions.md D7, CLAUDE.md "Hosting"):
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
# uninstall, in this order (it stops at the first problem, and every step can be repeated):
#   0. checks first, changes nothing: absolute paths, the deploy lock (it refuses to run while a deploy
#      holds it), and that no c15t service is running whose unit file uninstall would not remove
#   1. nginx: move the c15t files away (upstreams, the three snippets, the sites-enabled link of the
#      dashboard vhost), run `nginx -t`, and only if it passes delete them and reload nginx. If it fails
#      (for example a website vhost still includes snippets/c15t.conf) the files are put back, nginx is
#      untouched and the command stops with the list of files that still include them
#   2. stop and disable the services and the timer, delete the unit files, daemon-reload
#   3. only with --remove-cloudflare: unload the nftables table c15t_cloudflare, delete its file and the
#      ufw script (and, in step 1 and 2, the real_ip file and c15t-cloudflare-nft.service; see below)
#   4. delete releases/, current, previous and the lock and log files of /opt/c15t-platform, then the
#      directory itself when it is empty. Only when deploy.sh made them (.deploy.lock, deploy.log or a
#      releases/*/.release-ok is there), so a mistyped C15T_APP_DIR cannot reach another application
#   5. only with --purge-config: delete the env files in /etc/c15t-platform
# It NEVER touches PostgreSQL or consent data, never removes the c15t user (it prints the command), keeps
# the env files (they hold secrets) unless --purge-config is given, and leaves
# sites-available/c15t-dashboard.conf and the include lines in your website vhosts alone.
#
# The Cloudflare files are host-wide: other websites on the same server may rely on them. So by default
# uninstall KEEPS the nginx real_ip file (conf.d/cloudflare-realip.conf), the nftables allowlist (its file,
# the loaded table inet c15t_cloudflare, and c15t-cloudflare-nft.service while there is a file for it to
# load) and the ufw script, and says so. The refresh timer is still removed (it runs from
# /opt/c15t-platform/current), so those lists are no longer updated. --remove-cloudflare removes them too,
# which has two effects: ports 80 and 443 are no longer limited to Cloudflare, and nginx no longer restores
# the visitor IP from CF-Connecting-IP, for every site on the host. Run uninstall again with that flag
# later if you change your mind.
#
# A second run finds nothing and changes nothing. --dry-run (or DRY_RUN=1) creates, writes and runs
# nothing that changes the host.
#
# Run as the deploy user with sudo rights, or as root. Privileged steps (reading the 0600 env files,
# writing /etc/nginx, nginx -t, systemctl) go through sudo; the build runs as the invoking user.
# /opt/c15t-platform must be writable by that user and traversable by user c15t and by nginx.
#
# Environment (all optional):
#   DRY_RUN=1                 print what would happen, change nothing (same as --dry-run). Only 0 and 1 are accepted
#   C15T_ROOT                 prefix for the directories below (tests); default empty
#   C15T_APP_DIR              default $C15T_ROOT/opt/c15t-platform   (releases/, current)
#   C15T_ENV_DIR              default $C15T_ROOT/etc/c15t-platform   (consent-api.env, dashboard-api.env)
#   C15T_NGINX_DIR            default $C15T_ROOT/etc/nginx           (conf.d/, snippets/)
#   C15T_SYSTEMD_DIR          default $C15T_ROOT/etc/systemd/system  (install and uninstall write it, deploy compares it)
#   C15T_NFT_DIR              default $C15T_ROOT/etc/nftables.d      (uninstall --remove-cloudflare removes c15t-cloudflare.nft)
#                             install and uninstall refuse a directory setting that is relative, contains .. or has
#                             fewer than two path components
#   C15T_USER, C15T_GROUP     the service user and group `install` creates, default c15t. The unit files
#                             name c15t, so change them too if you change these (meant for tests)
#   C15T_SRC_DIR              source tree, default: the repository this script is in
#   C15T_REF                  git ref to deploy, default HEAD
#   C15T_RELEASE_ID           release directory name, default: short git sha or timestamp
#   C15T_KEEP_RELEASES        default 5
#   C15T_SERVICES             default "c15t-consent-api c15t-dashboard-api". install and uninstall accept only
#                             names that start with c15t-, so they can never touch another service
#   C15T_HEALTH_TIMEOUT       seconds to wait per health check, default 45
#   CONSENT_API_HEALTH_PATH   default /status        DASHBOARD_API_HEALTH_PATH   default /api/health
#   C15T_SUDO                 command prefix for privileged steps; "" for none (default: none as root, else sudo)
#   C15T_NODE_BIN             the node the services run, default /usr/bin/node (its major version is checked)
#   YARN_BIN, NGINX_BIN, SYSTEMCTL_BIN, CURL_BIN, GIT_BIN, NFT_BIN, USERADD_BIN   tool names or paths
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
C15T_NFT_DIR=${C15T_NFT_DIR:-$C15T_ROOT/etc/nftables.d}
C15T_USER=${C15T_USER:-c15t}
C15T_GROUP=${C15T_GROUP:-$C15T_USER}
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
NFT_BIN=${NFT_BIN:-nft}
USERADD_BIN=${USERADD_BIN:-useradd}
PLAN_ONLY=0
SKIP_MIGRATE=0
PURGE_CONFIG=0
REMOVE_CLOUDFLARE=0
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

# priv_exists PATH: does PATH exist? Always really asks (also under --dry-run), through sudo, because
# /etc/c15t-platform is not traversable by the deploy user.
priv_exists() { "${SUDO[@]}" test -e "$1" || "${SUDO[@]}" test -L "$1"; }

WORK=""
PARTIAL_REL=""
declare -a MOVED_AWAY=()   # uninstall: "file<TAB>hidden name" of nginx files renamed away and not deleted yet
cleanup() {
  # An uninstall that was interrupted between "move the nginx files away" and "nginx -t passed".
  if ((${#MOVED_AWAY[@]})); then restore_moved_away || true; fi
  [[ -n $WORK && -d $WORK ]] && rm -rf "$WORK"
  if [[ -n $PARTIAL_REL && -d $PARTIAL_REL ]]; then
    warn "removing the unfinished release $PARTIAL_REL"
    rm -rf "$PARTIAL_REL"
  fi
  return 0
}
trap cleanup EXIT

# set_command NAME: one command per run. `install uninstall` must not quietly mean "uninstall".
set_command() {
  [[ $COMMAND == deploy ]] || die "only one command at a time: $COMMAND and $1 were both given (see --help)"
  COMMAND=$1
}

while (($#)); do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --plan-only) PLAN_ONLY=1 ;;
    --skip-migrate) SKIP_MIGRATE=1 ;;
    rollback) set_command rollback; if [[ ${2-} != "" && $2 != -* ]]; then ROLLBACK_TARGET=$2; shift; fi ;;
    install) set_command install ;;
    uninstall) set_command uninstall ;;
    --purge-config) PURGE_CONFIG=1 ;;
    --remove-cloudflare) REMOVE_CLOUDFLARE=1 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
  shift
done
# ((DRY_RUN)) treats a word such as "true" as 0, which would turn a requested dry run into a real one.
[[ $DRY_RUN == 0 || $DRY_RUN == 1 ]] || die "DRY_RUN must be 0 or 1 (got: $DRY_RUN)"
((PLAN_ONLY && SKIP_MIGRATE)) && die "--plan-only and --skip-migrate cannot be combined"
if ((PURGE_CONFIG || REMOVE_CLOUDFLARE)) && [[ $COMMAND != uninstall ]]; then
  die "--purge-config and --remove-cloudflare belong to the uninstall command"
fi
if ((PLAN_ONLY || SKIP_MIGRATE)) && [[ $COMMAND != deploy ]]; then
  die "--plan-only and --skip-migrate belong to a deploy"
fi
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
    warn "cloudflare-ips.service failed (journalctl -u cloudflare-ips -n 30). Until it succeeds nginx has no real_ip config and the visitor IP is wrong. Is the unit installed (infra/deploy.sh install)?"
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
      warn "$name is not installed in $C15T_SYSTEMD_DIR (run: infra/deploy.sh install)"
    elif ! cmp -s "$f" "$C15T_SYSTEMD_DIR/$name"; then
      warn "$name differs from the installed unit. Run infra/deploy.sh install (copies it and runs daemon-reload), then restart the service."
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

# ---- install and uninstall: shared checks -----------------------------------------------------

# The units install and uninstall manage: these three, plus the C15T_SERVICES (names must start with
# c15t-, so a mistyped C15T_SERVICES can never make either command touch another service's unit).
KNOWN_UNITS=(cloudflare-ips.timer cloudflare-ips.service c15t-cloudflare-nft.service)
declare -a SERVICE_UNITS=()

require_bash44() {
  ((BASH_VERSINFO[0] > 4 || (BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4))) || die "bash 4.4 or newer is required"
}

# load_service_units: SERVICE_UNITS from C15T_SERVICES, split on blanks without pathname expansion.
load_service_units() {
  local -a words=()
  local w
  read -r -a words <<<"$C15T_SERVICES"
  ((${#words[@]})) || die "refusing to $COMMAND: C15T_SERVICES is empty"
  for w in "${words[@]}"; do
    w=${w%.service}
    [[ $w =~ ^c15t-[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
      die "refusing to $COMMAND: the C15T_SERVICES entry '$w' is not a c15t service (the name must be c15t-<name>)"
    SERVICE_UNITS+=("$w.service")
  done
}

is_known_unit() {
  local u
  for u in "${KNOWN_UNITS[@]}" "${SERVICE_UNITS[@]}"; do
    [[ $1 == "$u" ]] && return 0
  done
  return 1
}

# require_plain_dir NAME VALUE: a directory setting must be absolute, at least two levels deep and free
# of "..". Everything install and uninstall create or delete hangs below these directories.
require_plain_dir() {
  [[ $2 =~ ^/[^/]+/[^/]+ && $2 != *..* && $2 != *[[:cntrl:]]* ]] ||
    die "refusing to $COMMAND: $1 ($2) must be an absolute path with at least two components, without .. and without control characters"
}

# ---- install ----------------------------------------------------------------------------------

# do_install: the host preparation of docs/installation.md "Setting up by hand", steps 1 to 3. Safe to repeat: it creates what
# is missing, never overwrites an env file, never changes a directory that exists, refreshes the unit
# files when infra/systemd changed (keeping a copy of one that differs), and starts nothing but
# cloudflare-ips.timer (which waits for its schedule).
do_install() {
  local src=$C15T_SRC_DIR/infra/systemd owner f name dest s changed=0
  require_bash44
  load_service_units
  [[ $C15T_USER =~ ^[a-z_][a-z0-9_-]{0,31}$ && $C15T_GROUP =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] ||
    die "refusing to install: C15T_USER ($C15T_USER) and C15T_GROUP ($C15T_GROUP) must be plain lower-case account names"
  require_plain_dir C15T_APP_DIR "$APP_DIR"
  require_plain_dir C15T_ENV_DIR "$C15T_ENV_DIR"
  require_plain_dir C15T_SYSTEMD_DIR "$C15T_SYSTEMD_DIR"
  for s in install cmp cp "$SYSTEMCTL_BIN"; do command -v "$s" >/dev/null 2>&1 || die "missing tool: $s"; done
  "${SUDO[@]}" true || die "cannot run privileged commands (${SUDO[*]:-none}): run as root or set up sudo"
  compgen -G "$src/*.service" >/dev/null || die "no unit files in $src (run install from a checkout or an unpacked source tarball)"
  [[ -d $C15T_SYSTEMD_DIR ]] || die "$C15T_SYSTEMD_DIR does not exist (is this a systemd host?)"
  owner=${SUDO_USER:-$(id -un)}

  if id -u "$C15T_USER" >/dev/null 2>&1; then
    log "user $C15T_USER exists"
  else
    command -v "$USERADD_BIN" >/dev/null 2>&1 || die "missing tool: $USERADD_BIN"
    log "creating the system user $C15T_USER"
    priv "$USERADD_BIN" --system --home-dir /nonexistent --shell /usr/sbin/nologin "$C15T_USER"
  fi
  if priv_exists "$C15T_ENV_DIR"; then
    log "exists: $C15T_ENV_DIR"
  else
    priv install -d -o "$C15T_USER" -g "$C15T_GROUP" -m 0750 -- "$C15T_ENV_DIR"
  fi
  if [[ -d $APP_DIR ]]; then
    log "exists: $APP_DIR"
  else
    priv install -d -o "$owner" -m 0755 -- "$APP_DIR"
  fi
  for f in "$ENV_CONSENT" "$ENV_DASHBOARD"; do
    if priv_exists "$f"; then
      log "kept, never overwritten: $f"
    else
      priv install -m 0600 -o "$C15T_USER" -g "$C15T_GROUP" /dev/null "$f"
      log "created $f (empty, mode 0600): fill it in before the first deploy"
    fi
  done
  for f in "$src"/*.service "$src"/*.timer; do
    [[ -f $f ]] || continue
    name=$(basename "$f")
    if ! is_known_unit "$name"; then
      log "skipped $f: not one of the platform's units"
      continue
    fi
    dest=$C15T_SYSTEMD_DIR/$name
    if [[ -f $dest ]] && cmp -s "$f" "$dest"; then
      log "unchanged: $dest"
      continue
    fi
    if [[ -e $dest || -L $dest ]]; then
      warn "$dest differs from $f (edited by you, or left by an older release). It is replaced; the previous copy is kept as $dest.c15t-saved. Changes belong in a drop-in: systemctl edit $name"
      priv cp -p -- "$dest" "$dest.c15t-saved"
    fi
    priv install -m 0644 -- "$f" "$dest"
    log "installed $dest"
    changed=1
  done
  if ((changed)); then priv "$SYSTEMCTL_BIN" daemon-reload; fi
  priv "$SYSTEMCTL_BIN" enable "${SERVICE_UNITS[@]}"
  priv "$SYSTEMCTL_BIN" enable --now cloudflare-ips.timer
  log "installed. Next: 1. fill in $ENV_CONSENT and $ENV_DASHBOARD (docs/configuration.md)"
  log "                2. prepare the database (docs/database-setup.md)"
  log "                3. run infra/deploy.sh (the first deploy installs the nginx snippets and starts the services)"
  log "                4. add the dashboard vhost (docs/nginx.md)"
}

# ---- uninstall --------------------------------------------------------------------------------

SAW_UFW_SCRIPT=0
declare -a UNINSTALL_UNITS=()   # in stop order: the timer first (so it cannot fire), the firewall unit last
declare -a KEPT_CLOUDFLARE=()   # Cloudflare files that exist and are kept (the default)
KEEP_NFT_UNIT=0                 # c15t-cloudflare-nft.service stays: it loads the allowlist file at boot

# remove_file PATH: delete a file or symlink through sudo (nothing else), and say so.
remove_file() {
  priv rm -f -- "$1"
  if ((DRY_RUN)); then return 0; fi
  log "removed $1"
}

hidden_name() { printf '%s/.%s.c15t-removed' "$(dirname "$1")" "$(basename "$1")"; }

# restore_moved_away: put the renamed nginx files back (their hidden names are never matched by an nginx include glob).
restore_moved_away() {
  local pair
  for pair in "${MOVED_AWAY[@]}"; do
    "${SUDO[@]}" mv -f -- "${pair#*$'\t'}" "${pair%%$'\t'*}" || warn "could not put ${pair%%$'\t'*} back; it is at ${pair#*$'\t'}"
  done
  MOVED_AWAY=()
}

# recover_interrupted PATH...: an uninstall that was killed (SIGKILL, power loss) between "move away" and
# "delete" leaves a hidden .NAME.c15t-removed file and a nginx without NAME. Put it back before anything
# else; if NAME exists again (a deploy ran since), the hidden copy is stale and goes.
recover_interrupted() {
  local f h
  for f in "$@"; do
    h=$(hidden_name "$f")
    priv_exists "$h" || continue
    if priv_exists "$f"; then
      log "removing the leftover $h of an interrupted uninstall"
      priv rm -f -- "$h"
    else
      log "putting $f back: an earlier uninstall was interrupted after it moved the file away"
      priv mv -- "$h" "$f"
    fi
  done
}

# still_including: files below the nginx directory that mention a c15t snippet (website vhosts and the
# like), apart from the files uninstall removes itself and the dashboard vhost in sites-available. One per
# line. Read through sudo: nginx directories are not always readable for the deploy user.
still_including() {
  local conf=$C15T_NGINX_DIR f
  [[ -d $conf ]] || return 0
  while IFS= read -r f; do
    case $f in */.*.c15t-removed | "$conf"/snippets/c15t.conf | "$conf"/snippets/c15t-dashboard-*.conf | "$conf"/sites-available/c15t-dashboard.conf) continue ;; esac
    printf '%s\n' "$f"
  done < <("${SUDO[@]}" grep -rlE 'snippets/c15t(-dashboard-(headers|locations))?\.conf' -- "$conf" 2>/dev/null || true)
}

# service_running UNIT: is it active, starting, reloading or stopping?
service_running() {
  local state
  state=$("${SUDO[@]}" "$SYSTEMCTL_BIN" is-active "$1" 2>/dev/null) || true
  case $state in active | activating | reloading | deactivating) return 0 ;; esac
  return 1
}

unit_file_exists() { [[ -e $C15T_SYSTEMD_DIR/$1 || -L $C15T_SYSTEMD_DIR/$1 ]]; }

uninstall_preflight() {
  local u have_units=0
  require_bash44
  command -v flock >/dev/null 2>&1 || die "missing tool: flock"
  load_service_units
  UNINSTALL_UNITS=(cloudflare-ips.timer cloudflare-ips.service "${SERVICE_UNITS[@]}")
  # uninstall deletes below these directories, so a mistyped value must not reach a system directory.
  require_plain_dir C15T_APP_DIR "$APP_DIR"
  require_plain_dir C15T_ENV_DIR "$C15T_ENV_DIR"
  require_plain_dir C15T_NGINX_DIR "$C15T_NGINX_DIR"
  require_plain_dir C15T_SYSTEMD_DIR "$C15T_SYSTEMD_DIR"
  require_plain_dir C15T_NFT_DIR "$C15T_NFT_DIR"
  # priv_exists cannot tell "no such file" from "sudo refused", so find out now.
  "${SUDO[@]}" true || die "cannot run privileged commands (${SUDO[*]:-none}): run as root or set up sudo"
  # The boot unit of the allowlist belongs to the Cloudflare files: it stays unless --remove-cloudflare, but
  # only while it has something to load (the file) or is loaded. An inert copy that install put there goes
  # with the rest. (Stopping a loaded one would delete the table, which is what --remove-cloudflare is for.)
  if ((!REMOVE_CLOUDFLARE)); then
    if priv_exists "$C15T_NFT_DIR/c15t-cloudflare.nft"; then
      KEEP_NFT_UNIT=1
    elif ((!DRY_RUN)) && service_running c15t-cloudflare-nft.service; then
      KEEP_NFT_UNIT=1
    fi
  fi
  if ((!KEEP_NFT_UNIT)); then UNINSTALL_UNITS+=(c15t-cloudflare-nft.service); fi
  for u in "${UNINSTALL_UNITS[@]}"; do if unit_file_exists "$u"; then have_units=1; fi; done
  if ((have_units)) && ! command -v "$SYSTEMCTL_BIN" >/dev/null 2>&1; then
    if ((DRY_RUN)); then
      warn "$SYSTEMCTL_BIN not found: a real run would stop here, because it cannot stop the services whose unit files exist"
    else
      die "$SYSTEMCTL_BIN not found, but c15t unit files exist in $C15T_SYSTEMD_DIR, so the services cannot be stopped. Nothing was changed."
    fi
  fi
  local config=kept
  if ((PURGE_CONFIG)); then config="env files deleted (--purge-config)"; fi
  log "uninstall: app dir $APP_DIR, config dir $C15T_ENV_DIR ($config), nginx dir $C15T_NGINX_DIR. The database is not touched."
  if ((REMOVE_CLOUDFLARE)); then
    log "--remove-cloudflare: ports 80 and 443 stop being limited to Cloudflare, and nginx stops restoring the visitor IP from CF-Connecting-IP, for EVERY site on this host"
  else
    log "the Cloudflare real_ip file and nftables allowlist are not removed: other sites on this host may rely on them (--remove-cloudflare removes them)"
  fi
}

# acquire_uninstall_lock: the lock a deploy holds for its whole run. deploy.sh creates .deploy.lock before
# it does anything else, so no file means no deploy to wait for. Nothing is created here (not even by a
# dry run), and the file is only opened for reading: flock does not need more.
acquire_uninstall_lock() {
  local lock=$APP_DIR/.deploy.lock
  [[ -f $lock ]] || return 0
  if ! exec 9<"$lock"; then
    if ((DRY_RUN)); then warn "cannot open $lock, so a running deploy would not be noticed"; return 0; fi
    die "cannot open $lock, so a running deploy would not be noticed. Nothing was changed."
  fi
  flock -n 9 || die "a deploy (or another uninstall) is running and holds $lock. Nothing was changed; run uninstall again when it has finished."
}

# refuse_orphan_services: a service that runs without a unit file in C15T_SYSTEMD_DIR would not be
# stopped by uninstall, and would run on after /opt/c15t-platform is deleted under it.
refuse_orphan_services() {
  local u
  if ((DRY_RUN)); then log "[dry-run] check that no c15t service is running without a unit file in $C15T_SYSTEMD_DIR"; return 0; fi
  for u in "${SERVICE_UNITS[@]}"; do
    if unit_file_exists "$u"; then continue; fi
    if service_running "$u"; then
      die "$u is running, but its unit file is not in $C15T_SYSTEMD_DIR, so uninstall would not stop it and would delete $APP_DIR under it. Stop it (systemctl stop $u) or set C15T_SYSTEMD_DIR, then run uninstall again. Nothing was changed."
    fi
  done
}

uninstall_nginx() {
  local conf=$C15T_NGINX_DIR f pair offenders
  local -a found=() gone=()
  local -a paths=(
    "$conf/conf.d/c15t-upstreams.conf"
    "$conf/snippets/c15t.conf"
    "$conf/snippets/c15t-dashboard-headers.conf"
    "$conf/snippets/c15t-dashboard-locations.conf"
    "$conf/sites-enabled/c15t-dashboard.conf"
  )
  if ((REMOVE_CLOUDFLARE)); then paths+=("$conf/conf.d/cloudflare-realip.conf"); fi
  recover_interrupted "${paths[@]}"
  for f in "${paths[@]}"; do
    if [[ $f == "$conf"/sites-enabled/* && -f $f && ! -L $f ]]; then
      # install put a link here (docs/installation.md: ln -s). A regular file may be the only copy of the vhost.
      warn "$f is a regular file, not a link to sites-available. uninstall does not delete it; remove or move it yourself (it includes c15t snippets, so nginx -t will stop the run until you do)"
      continue
    fi
    if [[ -f $f || -L $f ]]; then found+=("$f"); fi
  done
  if ((${#found[@]} == 0)); then
    log "nginx: none of the c15t files to remove exist in $conf"
    return 0
  fi
  offenders=$(still_including)
  if ((DRY_RUN)); then
    for f in "${found[@]}"; do log "[dry-run] remove $f"; done
    log "[dry-run] ${SUDO[*]} $NGINX_BIN -t, then reload nginx; the files are put back if the test fails"
    if [[ -n $offenders ]]; then
      warn "these files still include a c15t snippet, so a real run stops at nginx -t until you remove those lines:"
      while IFS= read -r f; do printf '    %s\n' "$f"; done <<<"$offenders"
    fi
    return 0
  fi
  command -v "$NGINX_BIN" >/dev/null 2>&1 || die "nginx ($NGINX_BIN) not found, so the configuration cannot be tested. Nothing was changed."
  nginx_test || die "nginx -t already fails before uninstall changed anything. Fix the nginx configuration first. Nothing was changed."
  for f in "${found[@]}"; do
    "${SUDO[@]}" mv -f -- "$f" "$(hidden_name "$f")" || { restore_moved_away; die "could not move $f away. Nothing was changed."; }
    MOVED_AWAY+=("$f"$'\t'"$(hidden_name "$f")")
  done
  if ! nginx_test; then
    restore_moved_away
    if [[ -n $offenders ]]; then
      log "these files still include a c15t snippet. Remove those lines (or the vhosts), then run uninstall again:"
      while IFS= read -r f; do printf '    %s\n' "$f" >&2; done <<<"$offenders"
    fi
    die "nginx -t rejects the configuration without the c15t files. They are back in place, nginx was not reloaded and nothing else was changed."
  fi
  # The test passed: this is the point of no return. From here the files are deleted, never put back
  # (a half-restored set would be worse than none), so the interrupt handler must not restore them.
  gone=("${MOVED_AWAY[@]}")
  MOVED_AWAY=()
  for pair in "${gone[@]}"; do
    "${SUDO[@]}" rm -f -- "${pair#*$'\t'}" || warn "could not delete ${pair#*$'\t'}"
    log "removed ${pair%%$'\t'*}"
  done
  priv "$SYSTEMCTL_BIN" reload nginx || warn "nginx reload failed (is nginx running?). The configuration passed nginx -t, so the next start is fine."
}

uninstall_services() {
  local u
  local -a present=()
  for u in "${UNINSTALL_UNITS[@]}"; do
    if unit_file_exists "$u"; then present+=("$u"); fi
  done
  if ((${#present[@]} == 0)); then
    log "systemd: no c15t unit files in $C15T_SYSTEMD_DIR"
  fi
  for u in "${present[@]}"; do
    if [[ $u == cloudflare-ips.service ]]; then   # a oneshot without [Install]: stop it, nothing to disable
      log "stopping $u"
      priv "$SYSTEMCTL_BIN" stop "$u" || die "could not stop $u. The units are still installed; fix that and run uninstall again."
    else
      log "stopping and disabling $u"
      priv "$SYSTEMCTL_BIN" disable --now "$u" || die "could not stop and disable $u. The unit files and /opt are still in place; fix that and run uninstall again."
    fi
  done
  # Never delete the application from under a process. (A dry run stopped nothing, so it cannot ask.)
  if ((!DRY_RUN)); then
    for u in "${SERVICE_UNITS[@]}"; do
      if service_running "$u"; then die "$u is still running after it was stopped. $APP_DIR is kept. Stop it by hand and run uninstall again."; fi
    done
  fi
  if ((${#present[@]} == 0)); then return 0; fi
  for u in "${present[@]}"; do remove_file "$C15T_SYSTEMD_DIR/$u"; done
  priv "$SYSTEMCTL_BIN" daemon-reload || warn "systemctl daemon-reload failed; run it by hand"
  priv "$SYSTEMCTL_BIN" reset-failed "${present[@]}" 2>/dev/null || true
}

uninstall_nft() {
  local f
  if ((!REMOVE_CLOUDFLARE)); then
    for f in "$C15T_NGINX_DIR/conf.d/cloudflare-realip.conf" "$C15T_NFT_DIR/c15t-cloudflare.nft" "$C15T_ENV_DIR/cloudflare-ufw.sh"; do
      if priv_exists "$f"; then KEPT_CLOUDFLARE+=("$f"); fi
    done
    if ((KEEP_NFT_UNIT)) && unit_file_exists c15t-cloudflare-nft.service; then KEPT_CLOUDFLARE+=("$C15T_SYSTEMD_DIR/c15t-cloudflare-nft.service"); fi
    if ((${#KEPT_CLOUDFLARE[@]})); then log "Cloudflare: kept ${#KEPT_CLOUDFLARE[@]} file(s) that other sites may rely on (listed at the end)"; fi
    return 0
  fi
  if ((DRY_RUN)); then
    log "[dry-run] ${SUDO[*]} $NFT_BIN delete table inet c15t_cloudflare   (only when it is loaded)"
  elif command -v "$NFT_BIN" >/dev/null 2>&1 && "${SUDO[@]}" "$NFT_BIN" list table inet c15t_cloudflare >/dev/null 2>&1; then
    log "unloading the nftables table inet c15t_cloudflare: ports 80 and 443 are no longer limited to Cloudflare"
    priv "$NFT_BIN" delete table inet c15t_cloudflare ||
      warn "could not delete the table; it stays until the next reboot, or run: nft delete table inet c15t_cloudflare"
  fi
  if priv_exists "$C15T_ENV_DIR/cloudflare-ufw.sh"; then SAW_UFW_SCRIPT=1; fi
  for f in "$C15T_NFT_DIR/c15t-cloudflare.nft" "$C15T_ENV_DIR/cloudflare-ufw.sh"; do
    if priv_exists "$f"; then remove_file "$f"; fi
  done
}

# app_dir_is_ours: did deploy.sh make this directory? It writes .deploy.lock and deploy.log, and a
# .release-ok into every release it builds. Without any of them the contents belong to someone else.
app_dir_is_ours() {
  [[ -f $APP_DIR/.deploy.lock || -f $APP_DIR/deploy.log ]] && return 0
  compgen -G "$RELEASES_DIR/*/$MARKER" >/dev/null
}

uninstall_app() {
  local f
  [[ -d $APP_DIR ]] || { log "app: $APP_DIR does not exist"; return 0; }
  if app_dir_is_ours; then
    # The two links first, the lock last: it is what makes a second uninstall or a deploy wait.
    for f in current previous .current.new .previous.new; do
      [[ -e $APP_DIR/$f || -L $APP_DIR/$f ]] || continue
      if [[ -L $APP_DIR/$f ]]; then remove_file "$APP_DIR/$f"; else warn "kept $APP_DIR/$f: it is not a symlink, so deploy.sh did not make it"; fi
    done
    if [[ -L $RELEASES_DIR ]]; then
      warn "$RELEASES_DIR is a symlink: only the link is removed, its target ($(readlink "$RELEASES_DIR")) is left alone"
      remove_file "$RELEASES_DIR"
    elif [[ -d $RELEASES_DIR ]]; then
      # --one-file-system: a mount somewhere below a release (a cache, a bind mount) must survive.
      priv rm -rf --one-file-system -- "$RELEASES_DIR"
      if ((!DRY_RUN)); then log "removed $RELEASES_DIR"; fi
    elif [[ -e $RELEASES_DIR ]]; then
      warn "kept $RELEASES_DIR: it is not a directory, so deploy.sh did not make it"
    fi
    for f in deploy.log .deploy.lock; do
      [[ -e $APP_DIR/$f || -L $APP_DIR/$f ]] || continue
      if [[ -f $APP_DIR/$f ]]; then remove_file "$APP_DIR/$f"; else warn "kept $APP_DIR/$f: it is not a file, so deploy.sh did not make it"; fi
    done
  else
    log "app: kept the contents of $APP_DIR: none of .deploy.lock, deploy.log or releases/*/$MARKER is there, so deploy.sh did not make them. Is C15T_APP_DIR the directory you deployed to?"
  fi
  if ((DRY_RUN)); then log "[dry-run] rmdir $APP_DIR (only when it is empty)"; return 0; fi
  if "${SUDO[@]}" rmdir -- "$APP_DIR" 2>/dev/null; then
    log "removed $APP_DIR"
  else
    log "kept $APP_DIR: it holds files that deploy.sh did not create"
  fi
}

uninstall_config() {
  local f rest
  local -a present=()
  for f in consent-api.env dashboard-api.env cloudflare-ips.env; do
    if priv_exists "$C15T_ENV_DIR/$f"; then present+=("$f"); fi
  done
  if ((!PURGE_CONFIG)); then
    if ((${#present[@]})); then log "kept the env files in $C15T_ENV_DIR (secrets): ${present[*]}"; fi
    return 0
  fi
  for f in "${present[@]}"; do remove_file "$C15T_ENV_DIR/$f"; done
  priv_exists "$C15T_ENV_DIR" || return 0
  if ((DRY_RUN)); then log "[dry-run] rmdir $C15T_ENV_DIR (only when it is empty)"; return 0; fi
  if "${SUDO[@]}" rmdir -- "$C15T_ENV_DIR" 2>/dev/null; then
    log "removed $C15T_ENV_DIR"
  else
    rest=$("${SUDO[@]}" ls -A -- "$C15T_ENV_DIR" 2>/dev/null | tr '\n' ' ') || true
    log "kept $C15T_ENV_DIR: it holds other files: ${rest% }"
  fi
}

uninstall_report() {
  local u f uid vhost=$C15T_NGINX_DIR/sites-available/c15t-dashboard.conf
  if ((DRY_RUN)); then log "dry run finished: nothing was changed"; else log "uninstall finished"; fi
  log "left in place on purpose:"
  log "  PostgreSQL: the databases, the schemas c15t and app, and the roles c15t_api and dashboard (consent records are legal proof; docs/installation.md explains how to drop them)"
  uid=$(id -u "$C15T_USER" 2>/dev/null) || uid=0   # unknown, or root: no userdel hint
  if ((uid != 0)); then log "  the system user $C15T_USER: sudo userdel $C15T_USER"; fi
  if ((!PURGE_CONFIG)) && priv_exists "$C15T_ENV_DIR"; then
    log "  $C15T_ENV_DIR (secrets): infra/deploy.sh uninstall --purge-config deletes the env files"
  fi
  if [[ -e $vhost ]]; then log "  $vhost (your per-host values): sudo rm $vhost"; fi
  for u in "${KNOWN_UNITS[@]}" "${SERVICE_UNITS[@]}"; do
    if [[ -d $C15T_SYSTEMD_DIR/$u.d ]]; then log "  $C15T_SYSTEMD_DIR/$u.d (a drop-in of yours): sudo rm -r $C15T_SYSTEMD_DIR/$u.d"; fi
    if [[ -e $C15T_SYSTEMD_DIR/$u.c15t-saved ]]; then log "  $C15T_SYSTEMD_DIR/$u.c15t-saved (your earlier edit of the unit, saved by install): sudo rm $C15T_SYSTEMD_DIR/$u.c15t-saved"; fi
  done
  if ((${#KEPT_CLOUDFLARE[@]})); then
    log "  the Cloudflare files, because other sites on this host may rely on them (infra/deploy.sh uninstall --remove-cloudflare removes them):"
    for f in "${KEPT_CLOUDFLARE[@]}"; do log "    $f"; done
    log "    kept means: nginx still restores the visitor IP from Cloudflare, and ports 80 and 443 stay limited to Cloudflare while the nftables table is loaded (and, with c15t-cloudflare-nft.service, after a reboot)."
    log "    The refresh timer is gone, so these lists are no longer updated: Cloudflare adds ranges now and then, and a missing range blocks real visitors. Keep them current yourself, or remove them when no site needs them."
  fi
  if ((SAW_UFW_SCRIPT)); then log "  ufw rules you created from cloudflare-ufw.sh: ufw status numbered, then ufw delete"; fi
}

do_uninstall() {
  cd / || true   # do not stand inside the tree that is about to be deleted (the script itself may live in it)
  uninstall_preflight
  acquire_uninstall_lock
  refuse_orphan_services
  uninstall_nginx
  uninstall_services
  uninstall_nft
  uninstall_app
  uninstall_config
  uninstall_report
}

case $COMMAND in
  deploy) do_deploy ;;
  rollback) do_rollback ;;
  install) do_install ;;
  uninstall) do_uninstall ;;
esac
