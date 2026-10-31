#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Tests for `infra/deploy.sh install` and `infra/deploy.sh uninstall`. No root, no sudo, no Docker, no
# network, no real systemd, nginx or database: the host is a directory tree under a temporary directory
# (C15T_ROOT), and systemctl, nginx, nft and useradd are stand-ins that record how they were called.
# Tripwire stand-ins for psql, dropdb, pg_dump, yarn, curl, git, sudo and userdel fail the test if
# deploy.sh ever calls them. Nothing outside the temporary directory is read or written.
#
#   infra/test/uninstall.test.sh
#
# Covers: --dry-run changes nothing and calls nothing; a real uninstall removes exactly the c15t files,
# in the right order (nginx -t before the reload, the services stopped before /opt is deleted), and
# keeps the config files, the database, the c15t user and everything that is not ours; a second run is
# a no-op; the host-wide Cloudflare files (real_ip, nftables allowlist, boot unit, ufw script) are KEPT
# by default and removed only by --remove-cloudflare (a follow-up run finishes the job);
# --purge-config removes the config files; a held deploy lock refuses the run and a run creates no lock;
# nginx -t failing before or after the removal leaves nginx as it was, also when the run is interrupted
# or was killed earlier; a service that cannot be stopped, or runs without a unit file, keeps /opt; a
# directory that deploy.sh did not make is not touched; mistyped C15T_* paths and service names, a
# DRY_RUN that is not 0 or 1 and two commands at once are refused; install is idempotent, never
# overwrites a config file, never changes a directory that exists, keeps a copy of a unit file it
# replaces, and uninstall --purge-config undoes it.
# SC2016: the conditions given to chk are single-quoted on purpose, chk evaluates them later.
# SC2034: the variables they read (before, after, removed, added, config_before) are used inside them.
# shellcheck disable=SC2016,SC2034
set -euo pipefail
export LC_ALL=C

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEPLOY=$HERE/../deploy.sh
SRC=$(cd "$HERE/../.." && pwd)
WORK=$(mktemp -d)
HOLDER=""
trap 'rm -rf "$WORK"; if [[ -n $HOLDER ]]; then kill "$HOLDER" 2>/dev/null || true; fi' EXIT
pass=0
fail=0

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n     %s\n' "$1" "$2"; }

# ---- stand-ins -----------------------------------------------------------------------------------------

CALLS=$WORK/calls
FORBIDDEN=$WORK/forbidden
BIN=$WORK/bin
mkdir -p "$BIN"
: >"$CALLS"
: >"$FORBIDDEN"

# ACTIVE lists the units that "run". stop and disable --now take a unit off the list, unless FAKE_STOP_NOOP
# is set (a stop that reports success but does not stop it).
ACTIVE=$WORK/active
: >"$ACTIVE"
cat >"$BIN/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >>"$CALLS"
if [[ -n \${FAKE_SYSTEMCTL_FAIL:-} && " \$* " == *" \$FAKE_SYSTEMCTL_FAIL "* ]]; then exit 1; fi
case \$1 in
  is-active) if grep -qxF -- "\$2" "$ACTIVE"; then echo active; exit 0; fi; echo inactive; exit 3 ;;
  stop | disable)
    if [[ -z \${FAKE_STOP_NOOP:-} ]]; then
      for a in "\${@:2}"; do [[ \$a == -* ]] || { grep -vxF -- "\$a" "$ACTIVE" >"$ACTIVE.new" || true; mv "$ACTIVE.new" "$ACTIVE"; }; done
    fi ;;
esac
EOF
# nginx -t fails when FAKE_NGINX_FAIL is set, and, like the real one, when an enabled vhost includes a
# snippet that does not exist.
cat >"$BIN/nginx" <<EOF
#!/usr/bin/env bash
echo "nginx \$*" >>"$CALLS"
if [[ -n \${FAKE_NGINX_HANG_ON:-} && \$(grep -c '^nginx -t' "$CALLS") == "\$FAKE_NGINX_HANG_ON" ]]; then echo \$\$ >"$WORK/hang.pid"; exec sleep 60; fi
if [[ -n \${FAKE_NGINX_FAIL:-} ]]; then echo "nginx: [emerg] fake failure" >&2; exit 1; fi
status=0
conf=\$FAKE_NGINX_DIR
while IFS= read -r inc; do
  if [[ ! -e \$conf/\$inc ]]; then echo "nginx: [emerg] open() \"\$conf/\$inc\" failed (2: No such file or directory)" >&2; status=1; fi
done < <(grep -rhoE --exclude='.*' '(snippets|conf\.d)/[A-Za-z0-9._-]+\.conf' "\$conf/sites-enabled" "\$conf/conf.d" 2>/dev/null | sort -u || true)
exit \$status
EOF
cat >"$BIN/nft" <<EOF
#!/usr/bin/env bash
echo "nft \$*" >>"$CALLS"
if [[ \$1 == list ]]; then [[ -n \${FAKE_NFT_LOADED:-} ]]; exit; fi
EOF
cat >"$BIN/useradd" <<EOF
#!/usr/bin/env bash
echo "useradd \$*" >>"$CALLS"
EOF
for tool in psql dropdb pg_dump yarn curl git sudo userdel; do
  printf '#!/usr/bin/env bash\necho "%s $*" >>"%s"\nexit 1\n' "$tool" "$FORBIDDEN" >"$BIN/$tool"
done
chmod +x "$BIN"/*
export PATH=$BIN:$PATH

# ---- the host under test -----------------------------------------------------------------------------------

SECRET=SUPERSECRET-fake-value-for-the-test
n=0

use_host() {
  : >"$CALLS"
  : >"$FORBIDDEN"
  : >"$ACTIVE"
  unset FAKE_NGINX_FAIL FAKE_NFT_LOADED FAKE_SYSTEMCTL_FAIL FAKE_STOP_NOOP FAKE_NGINX_HANG_ON C15T_APP_DIR C15T_ENV_DIR C15T_NGINX_DIR C15T_SYSTEMD_DIR \
    C15T_NFT_DIR C15T_SERVICES SUDO_USER DRY_RUN
  export C15T_ROOT=$1 C15T_SUDO='' C15T_SRC_DIR=$SRC
  export SYSTEMCTL_BIN=$BIN/systemctl NGINX_BIN=$BIN/nginx NFT_BIN=$BIN/nft USERADD_BIN=$BIN/useradd
  export FAKE_NGINX_DIR=$1/etc/nginx
  C15T_USER=$(id -un)
  C15T_GROUP=$(id -gn)
  export C15T_USER C15T_GROUP
}

# fresh_host: a fully installed host under $T, and the environment that points deploy.sh at it.
fresh_host() {
  T=$WORK/host.$((++n))
  mkdir -p "$T/opt/c15t-platform/releases/abc123" "$T/opt/c15t-platform/releases/def456" "$T/etc/c15t-platform" \
    "$T/etc/nginx/conf.d" "$T/etc/nginx/snippets" "$T/etc/nginx/sites-available" "$T/etc/nginx/sites-enabled" \
    "$T/etc/systemd/system" "$T/etc/nftables.d"
  local rel f
  for rel in abc123 def456; do
    : >"$T/opt/c15t-platform/releases/$rel/.release-ok"
    echo "built" >"$T/opt/c15t-platform/releases/$rel/app.js"
  done
  ln -s releases/def456 "$T/opt/c15t-platform/current"
  ln -s releases/abc123 "$T/opt/c15t-platform/previous"
  : >"$T/opt/c15t-platform/.deploy.lock"
  echo "2026-01-01T00:00:00Z def456 deployed gio" >"$T/opt/c15t-platform/deploy.log"
  # The service config files hold a fake secret: it must survive, and must never be printed.
  for f in consent-api.env dashboard-api.env cloudflare-ips.env; do
    printf 'DATABASE_URL_C15T=postgres://nobody:%s@db.invalid/consent\nCONSENT_API_PORT=4100\n' "$SECRET" >"$T/etc/c15t-platform/$f"
    chmod 0600 "$T/etc/c15t-platform/$f"
  done
  echo '#!/bin/sh' >"$T/etc/c15t-platform/cloudflare-ufw.sh"
  # Real files of the repository, installed where deploy.sh and docs/nginx.md put them.
  cp "$SRC/infra/nginx/c15t.conf" "$T/etc/nginx/snippets/c15t.conf"
  cp "$SRC/infra/nginx/dashboard-headers.conf" "$T/etc/nginx/snippets/c15t-dashboard-headers.conf"
  cp "$SRC/infra/nginx/dashboard-locations.conf" "$T/etc/nginx/snippets/c15t-dashboard-locations.conf"
  echo "upstream c15t_consent_api { server host:1; }" >"$T/etc/nginx/conf.d/c15t-upstreams.conf"
  echo "real_ip_header CF-Connecting-IP;" >"$T/etc/nginx/conf.d/cloudflare-realip.conf"
  cp "$SRC/infra/nginx/dashboard.conf" "$T/etc/nginx/sites-available/c15t-dashboard.conf"
  ln -s ../sites-available/c15t-dashboard.conf "$T/etc/nginx/sites-enabled/c15t-dashboard.conf"
  echo "include snippets/other.conf;" >"$T/etc/nginx/sites-enabled/website.conf"
  echo "# not ours" >"$T/etc/nginx/snippets/other.conf"
  echo "# not ours" >"$T/etc/nginx/conf.d/other.conf"
  cp "$SRC"/infra/systemd/*.service "$SRC"/infra/systemd/*.timer "$T/etc/systemd/system/"
  echo "[Service]" >"$T/etc/systemd/system/unrelated.service"
  echo "table inet c15t_cloudflare" >"$T/etc/nftables.d/c15t-cloudflare.nft"
  echo "table inet other" >"$T/etc/nftables.d/other.nft"
  use_host "$T"
  printf 'c15t-consent-api.service\nc15t-dashboard-api.service\n' >"$ACTIVE"   # after use_host, which empties it
}

# bare_host: only a systemd directory, as on a machine that never ran install.
bare_host() {
  T=$WORK/host.$((++n))
  mkdir -p "$T/etc/systemd/system" "$T/opt"
  use_host "$T"
}

# run_deploy ARGS...: RC and OUT (stdout and stderr together). Refuses to run without a test host.
run_deploy() {
  [[ -n ${C15T_ROOT:-} && $C15T_ROOT == "$WORK"/* ]] || { echo "test bug: C15T_ROOT is not a test host" >&2; exit 2; }
  RC=0
  OUT=$(bash "$DEPLOY" "$@" 2>&1) || RC=$?
}

snap() { # every path with type, link target and mode, plus the checksum of every file
  (cd "$1" && find . -printf '%p|%y|%l|%m\n' | sort && find . -type f -exec sha256sum {} + | sort)
}
paths() { (cd "$1" && find . -mindepth 1 | sort); }

# chk NAME 'CONDITION': the condition is shell code, evaluated here (so it sees RC, OUT, T and the helpers).
chk() {
  if eval "$2"; then ok "$1"; else bad "$1" "exit=$RC; output: $(tail -n 12 <<<"$OUT"); calls: $(tr '\n' ';' <"$CALLS")"; fi
}
has() { [[ $OUT == *"$1"* ]]; }
called() { grep -qF -- "$1" "$CALLS"; }
call_line() { grep -nF -- "$1" "$CALLS" | head -1 | cut -d: -f1; }
no_forbidden() { [[ ! -s $FORBIDDEN ]]; }
mutating_calls() { grep -E 'disable|stop|reload|daemon-reload|reset-failed|delete|useradd|enable' "$CALLS" || true; }

# What uninstall removes from a full host by default, relative to $T. The Cloudflare files are not in it.
expected_removed() {
  {
    (cd "$T" && find opt/c15t-platform | sed 's|^|./|')
    printf './%s\n' \
      etc/nginx/conf.d/c15t-upstreams.conf \
      etc/nginx/snippets/c15t.conf etc/nginx/snippets/c15t-dashboard-headers.conf etc/nginx/snippets/c15t-dashboard-locations.conf \
      etc/nginx/sites-enabled/c15t-dashboard.conf \
      etc/systemd/system/c15t-consent-api.service etc/systemd/system/c15t-dashboard-api.service \
      etc/systemd/system/cloudflare-ips.service etc/systemd/system/cloudflare-ips.timer
  } | sort
}
# The host-wide Cloudflare files, which only --remove-cloudflare removes.
cloudflare_files() {
  printf './%s\n' etc/nginx/conf.d/cloudflare-realip.conf etc/systemd/system/c15t-cloudflare-nft.service \
    etc/nftables.d/c15t-cloudflare.nft etc/c15t-platform/cloudflare-ufw.sh
}
expected_removed_all() { { expected_removed; cloudflare_files; } | sort; }

# ---- 1. dry run -----------------------------------------------------------------------------------------------

fresh_host
before=$(snap "$T")
FAKE_NFT_LOADED=1 run_deploy uninstall --dry-run
chk "dry run: exit 0" '((RC == 0))'
chk "dry run: says so and lists the removals" 'has "[dry-run] remove" && has "dry run finished: nothing was changed"'
chk "dry run: changes nothing" '[[ $(snap "$T") == "$before" ]]'
chk "dry run: calls no tool at all" '[[ ! -s $CALLS ]]'
chk "dry run: never prints the secret" '! has "$SECRET"'
chk "dry run (default): does not list a Cloudflare file for removal, says they are kept" '! has "[dry-run] remove $T/etc/nginx/conf.d/cloudflare-realip.conf" && ! has "nft delete" && has "--remove-cloudflare" && has "kept"'
run_deploy uninstall --dry-run --purge-config
chk "dry run with --purge-config: lists the config files, changes nothing" '((RC == 0)) && has "consent-api.env" && [[ $(snap "$T") == "$before" ]]'
FAKE_NFT_LOADED=1 run_deploy uninstall --dry-run --remove-cloudflare
chk "dry run with --remove-cloudflare: lists the real_ip file, the table and the boot unit, says what it changes" '((RC == 0)) && has "[dry-run] remove $T/etc/nginx/conf.d/cloudflare-realip.conf" && has "nft delete table inet c15t_cloudflare" && has "disable --now c15t-cloudflare-nft.service" && has "stop being limited to Cloudflare" && has "visitor IP"'
chk "dry run with --remove-cloudflare: changes nothing, calls no tool" '[[ $(snap "$T") == "$before" && ! -s $CALLS ]]'

# a website vhost that still includes the snippet is reported by the dry run
echo "include snippets/c15t.conf;" >>"$T/etc/nginx/sites-enabled/website.conf"
before=$(snap "$T")
run_deploy uninstall --dry-run
chk "dry run: names the vhost that still includes a c15t snippet" '((RC == 0)) && has "website.conf" && has "still include a c15t snippet"'
chk "dry run with an including vhost: still changes nothing" '[[ $(snap "$T") == "$before" ]]'

# ---- 2. real run, then a second run ----------------------------------------------------------------------------------

fresh_host
paths "$T" >"$WORK/before.paths"
expected=$(expected_removed)   # before the run: it lists what is below /opt now
config_before=$(cd "$T/etc/c15t-platform" && sha256sum consent-api.env dashboard-api.env cloudflare-ips.env)
FAKE_NFT_LOADED=1 run_deploy uninstall
chk "uninstall: exit 0" '((RC == 0))'
paths "$T" >"$WORK/after.paths"
removed=$(comm -23 "$WORK/before.paths" "$WORK/after.paths")
added=$(comm -13 "$WORK/before.paths" "$WORK/after.paths")
chk "uninstall: removes exactly the c15t files, but not the Cloudflare ones (real_ip, nft file, boot unit, ufw script)" '[[ $removed == "$expected" ]]'
chk "uninstall: the Cloudflare files are all still there" '[[ -f $T/etc/nginx/conf.d/cloudflare-realip.conf && -f $T/etc/nftables.d/c15t-cloudflare.nft && -f $T/etc/c15t-platform/cloudflare-ufw.sh && -f $T/etc/systemd/system/c15t-cloudflare-nft.service ]]'
chk "uninstall: the allowlist is not unloaded and its boot unit is not touched" '! called "nft" && ! called "c15t-cloudflare-nft"'
chk "uninstall: says the Cloudflare files were kept, lists them, and how to remove them" 'has "Cloudflare: kept 4" && has "$T/etc/nginx/conf.d/cloudflare-realip.conf" && has "uninstall --remove-cloudflare" && has "no longer updated"'
chk "uninstall: the refresh timer is gone, the services are stopped" '[[ ! -e $T/etc/systemd/system/cloudflare-ips.timer && ! -s $ACTIVE ]]'
chk "uninstall: creates nothing (no temporary or hidden leftovers)" '[[ -z $added ]]'
chk "uninstall: the config files are untouched" '[[ $(cd "$T/etc/c15t-platform" && sha256sum consent-api.env dashboard-api.env cloudflare-ips.env) == "$config_before" ]]'
chk "uninstall: files of other software are kept" '[[ -f $T/etc/nginx/snippets/other.conf && -f $T/etc/nginx/conf.d/other.conf && -f $T/etc/nginx/sites-enabled/website.conf && -f $T/etc/nftables.d/other.nft && -f $T/etc/systemd/system/unrelated.service ]]'
chk "uninstall: the dashboard vhost in sites-available is kept and reported" '[[ -f $T/etc/nginx/sites-available/c15t-dashboard.conf ]] && has "sites-available/c15t-dashboard.conf"'
chk "uninstall: nginx -t runs before and after the removal, then nginx is reloaded" '[[ $(grep -c "^nginx -t" "$CALLS") == 2 ]] && called "systemctl reload nginx"'
chk "uninstall: the reload comes after the last nginx -t" '(( $(call_line "systemctl reload nginx") > $(grep -n "^nginx -t" "$CALLS" | tail -1 | cut -d: -f1) ))'
chk "uninstall: services and timer are stopped and disabled" 'called "systemctl disable --now c15t-consent-api.service" && called "systemctl disable --now c15t-dashboard-api.service" && called "systemctl disable --now cloudflare-ips.timer" && called "systemctl stop cloudflare-ips.service"'
chk "uninstall: nginx is done before the services are stopped" '(( $(call_line "systemctl reload nginx") < $(call_line "disable --now c15t-consent-api.service") ))'
chk "uninstall: daemon-reload once the unit files are gone" 'called "systemctl daemon-reload"'
chk "uninstall: prints what it keeps: database, user, config files" 'has "PostgreSQL" && has "sudo userdel $C15T_USER" && has "--purge-config"'
chk "uninstall: never calls a database, build, network or user tool" 'no_forbidden'
chk "uninstall: never prints the secret" '! has "$SECRET"'

after=$(snap "$T")
: >"$CALLS"
unset FAKE_NFT_LOADED
run_deploy uninstall
chk "second run: exit 0" '((RC == 0))'
chk "second run: changes nothing" '[[ $(snap "$T") == "$after" ]]'
chk "second run: stops, disables, reloads and deletes nothing" '[[ -z $(mutating_calls) ]]'
chk "second run: nginx is not called, systemctl is only asked whether a service runs" '! called "nginx" && [[ -z $(grep -v "^systemctl is-active" "$CALLS") ]]'
chk "second run: says there was nothing to remove" 'has "none of the c15t files to remove exist" && has "no c15t unit files"'

# The follow-up: the Cloudflare files go only now, and only on request.
: >"$CALLS"
FAKE_NFT_LOADED=1 run_deploy uninstall --remove-cloudflare
chk "follow-up with --remove-cloudflare: exit 0, the Cloudflare files are removed" '((RC == 0)) && [[ ! -e $T/etc/nginx/conf.d/cloudflare-realip.conf && ! -e $T/etc/nftables.d/c15t-cloudflare.nft && ! -e $T/etc/c15t-platform/cloudflare-ufw.sh && ! -e $T/etc/systemd/system/c15t-cloudflare-nft.service ]]'
chk "follow-up with --remove-cloudflare: the table is unloaded, nginx is tested and reloaded, the boot unit is stopped" 'called "nft delete table inet c15t_cloudflare" && called "systemctl reload nginx" && called "systemctl disable --now c15t-cloudflare-nft.service"'
chk "follow-up with --remove-cloudflare: names the consequence before it acts" 'has "ports 80 and 443 stop being limited to Cloudflare" && has "visitor IP"'
chk "follow-up with --remove-cloudflare: files of other software are still kept" '[[ -f $T/etc/nginx/conf.d/other.conf && -f $T/etc/nftables.d/other.nft && -f $T/etc/systemd/system/unrelated.service && -f $T/etc/nginx/sites-enabled/website.conf ]]'

# ---- 3. --purge-config -------------------------------------------------------------------------------------------------

fresh_host
run_deploy uninstall --purge-config
chk "purge-config: exit 0, the env files are gone" '((RC == 0)) && [[ ! -e $T/etc/c15t-platform/consent-api.env && ! -e $T/etc/c15t-platform/dashboard-api.env && ! -e $T/etc/c15t-platform/cloudflare-ips.env ]]'
chk "purge-config: the kept Cloudflare ufw script keeps the directory, and the message says what is in it" '[[ -f $T/etc/c15t-platform/cloudflare-ufw.sh ]] && has "kept $T/etc/c15t-platform: it holds other files: cloudflare-ufw.sh"'
chk "purge-config: nothing else of the host changed" '[[ -f $T/etc/nginx/conf.d/other.conf && -f $T/etc/nftables.d/other.nft ]]'
run_deploy uninstall --purge-config
chk "purge-config twice: the second run is a no-op" '((RC == 0))'
run_deploy uninstall --purge-config --remove-cloudflare
chk "purge-config with --remove-cloudflare afterwards: the directory is empty and goes" '((RC == 0)) && [[ ! -e $T/etc/c15t-platform ]]'

fresh_host
run_deploy uninstall --purge-config --remove-cloudflare
chk "purge-config and remove-cloudflare in one run: the config directory is gone" '((RC == 0)) && [[ ! -e $T/etc/c15t-platform ]]'

fresh_host
echo "ca" >"$T/etc/c15t-platform/db-ca.pem"
run_deploy uninstall --purge-config --remove-cloudflare
chk "purge-config: a foreign file in the config directory keeps the directory" '[[ -f $T/etc/c15t-platform/db-ca.pem && ! -e $T/etc/c15t-platform/consent-api.env ]] && has "kept $T/etc/c15t-platform"'

# ---- 4. --remove-cloudflare (the default is to keep) --------------------------------------------------------------------

fresh_host
paths "$T" >"$WORK/before.paths"
expected_all=$(expected_removed_all)
FAKE_NFT_LOADED=1 run_deploy uninstall --remove-cloudflare
paths "$T" >"$WORK/after.paths"
removed=$(comm -23 "$WORK/before.paths" "$WORK/after.paths")
chk "remove-cloudflare: exit 0, removes exactly the c15t files including every Cloudflare file" '((RC == 0)) && [[ $removed == "$expected_all" ]]'
chk "remove-cloudflare: the table is unloaded and the boot unit stopped" 'called "nft delete table inet c15t_cloudflare" && called "systemctl disable --now c15t-cloudflare-nft.service"'
chk "remove-cloudflare: the real_ip file goes through the same nginx -t and reload as the rest" '[[ $(grep -c "^nginx -t" "$CALLS") == 2 ]] && (( $(call_line "systemctl reload nginx") > $(grep -n "^nginx -t" "$CALLS" | tail -1 | cut -d: -f1) ))'
chk "remove-cloudflare: files of other software are kept" '[[ -f $T/etc/nginx/conf.d/other.conf && -f $T/etc/nftables.d/other.nft && -f $T/etc/systemd/system/unrelated.service ]]'
chk "remove-cloudflare: says what it changed and lists no kept Cloudflare file" 'has "stop being limited to Cloudflare" && has "no longer limited" && ! has "Cloudflare: kept"'

fresh_host   # the table is not loaded: nothing to unload, no nft delete
run_deploy uninstall --remove-cloudflare
chk "remove-cloudflare, table not loaded: no nft delete, the file is still removed" '((RC == 0)) && ! called "nft delete" && [[ ! -e $T/etc/nftables.d/c15t-cloudflare.nft ]]'

fresh_host   # a website includes the real_ip file by name: nginx -t decides, as for the other files
echo "include conf.d/cloudflare-realip.conf;" >"$T/etc/nginx/sites-enabled/needs-realip.conf"
before=$(snap "$T")
run_deploy uninstall --remove-cloudflare
chk "remove-cloudflare, a vhost includes the real_ip file: nginx -t fails, everything is back, no service touched" '((RC != 0)) && [[ $(snap "$T") == "$before" && -z $(mutating_calls) ]]'
run_deploy uninstall
chk "the same host without --remove-cloudflare: the default keeps the file, so the run succeeds" '((RC == 0)) && [[ -f $T/etc/nginx/conf.d/cloudflare-realip.conf ]]'

run_deploy --keep-cloudflare uninstall
chk "the old --keep-cloudflare flag no longer exists" '((RC != 0)) && has "unknown argument: --keep-cloudflare"'

# ---- 5. a deploy holds the lock ---------------------------------------------------------------------------------------------------

fresh_host
lock=$T/opt/c15t-platform/.deploy.lock
rm -f "$WORK/lock-held"
( exec 8>"$lock"; flock -n 8 && { touch "$WORK/lock-held"; exec sleep 60; } ) &
HOLDER=$!
for _ in $(seq 1 100); do [[ -e $WORK/lock-held ]] && break; sleep 0.1; done
[[ -e $WORK/lock-held ]] || { echo "test bug: the lock holder did not start" >&2; exit 2; }
before=$(snap "$T")
run_deploy uninstall
chk "locked: refuses with a non-zero exit" '((RC != 0)) && has "a deploy" && has "holds"'
chk "locked: changes nothing and calls nothing" '[[ $(snap "$T") == "$before" && ! -s $CALLS ]]'
run_deploy uninstall --dry-run
chk "locked: a dry run refuses as well" '((RC != 0))'
kill "$HOLDER" 2>/dev/null || true; wait "$HOLDER" 2>/dev/null || true; HOLDER=""
run_deploy uninstall
chk "lock released: uninstall goes through" '((RC == 0)) && [[ ! -e $T/opt/c15t-platform ]]'

# ---- 6. nginx -t fails -----------------------------------------------------------------------------------------------------------------

fresh_host   # a website vhost still includes the c15t snippet: nginx -t fails once the snippet is gone
echo "include snippets/c15t.conf;" >>"$T/etc/nginx/sites-enabled/website.conf"
before=$(snap "$T")
run_deploy uninstall --purge-config
chk "nginx -t fails after the removal: non-zero exit" '((RC != 0))'
chk "nginx -t fails after the removal: every file is back (nothing at all differs)" '[[ $(snap "$T") == "$before" ]]'
chk "nginx -t fails after the removal: no reload, no service touched, no nft change" '[[ -z $(mutating_calls) ]]'
chk "nginx -t fails after the removal: names the vhost to fix" 'has "website.conf"'
sed -i '/snippets\/c15t.conf/d' "$T/etc/nginx/sites-enabled/website.conf"   # the operator removes the include line
run_deploy uninstall
chk "after the vhost is fixed the next run succeeds" '((RC == 0)) && [[ ! -e $T/etc/nginx/snippets/c15t.conf ]]'

fresh_host   # nginx -t already fails before anything changed
before=$(snap "$T")
FAKE_NGINX_FAIL=1 run_deploy uninstall
chk "nginx -t fails first: non-zero exit, says nothing was changed" '((RC != 0)) && has "Nothing was changed"'
chk "nginx -t fails first: nothing differs, no reload, no service touched" '[[ $(snap "$T") == "$before" && -z $(mutating_calls) ]]'
chk "nginx -t fails first: it was tested once and the files were never moved" '[[ $(grep -c "^nginx -t" "$CALLS") == 1 ]]'

# ---- 7. a service that cannot be stopped ---------------------------------------------------------------------------------------------------

fresh_host
FAKE_SYSTEMCTL_FAIL=c15t-dashboard-api.service run_deploy uninstall
chk "stop fails: non-zero exit" '((RC != 0)) && has "could not stop and disable c15t-dashboard-api.service"'
chk "stop fails: /opt and all unit files are kept" '[[ -d $T/opt/c15t-platform/releases/def456 && -f $T/etc/systemd/system/c15t-dashboard-api.service && -f $T/etc/systemd/system/c15t-consent-api.service ]]'
run_deploy uninstall
chk "stop fails: after the fix a second run finishes the job" '((RC == 0)) && [[ ! -e $T/opt/c15t-platform && ! -e $T/etc/systemd/system/c15t-dashboard-api.service ]]'

# ---- 8. a mistyped app directory, a bare host, argument checks ------------------------------------------------------------------------------

fresh_host
for bad_dir in / /opt //x relative/dir "$T/opt/../../etc"; do
  C15T_APP_DIR=$bad_dir run_deploy uninstall --dry-run
  chk "refuses C15T_APP_DIR=${bad_dir#"$T"}" '((RC != 0)) && has "refusing to uninstall"'
done

bare_host
before=$(snap "$T")
run_deploy uninstall
chk "bare host: exit 0, nothing created" '((RC == 0)) && [[ $(snap "$T") == "$before" && ! -e $T/opt/c15t-platform ]]'
chk "bare host: only read-only queries (is a service running?) are made" '[[ -z $(grep -v "^systemctl is-active" "$CALLS") ]]'

run_deploy --purge-config
chk "--purge-config without uninstall is refused" '((RC != 0)) && has "belong to the uninstall"'
run_deploy uninstall --plan-only
chk "--plan-only with uninstall is refused" '((RC != 0)) && has "belong to a deploy"'
run_deploy install --remove-cloudflare
chk "--remove-cloudflare with install is refused" '((RC != 0)) && has "belong to the uninstall"'

# ---- 9. install -------------------------------------------------------------------------------------------------------------------------------

bare_host
before=$(snap "$T")
C15T_USER=no-such-user-c15t-test run_deploy install --dry-run
chk "install dry run: exit 0, would create the user" '((RC == 0)) && has "creating the system user no-such-user-c15t-test" && has "[dry-run]"'
chk "install dry run: changes nothing, calls no tool" '[[ $(snap "$T") == "$before" && ! -s $CALLS ]]'

run_deploy install
chk "install: exit 0" '((RC == 0))'
chk "install: config dir 0750, config files empty and 0600" '[[ $(stat -c %a "$T/etc/c15t-platform") == 750 && $(stat -c "%a %s" "$T/etc/c15t-platform/consent-api.env") == "600 0" && $(stat -c "%a %s" "$T/etc/c15t-platform/dashboard-api.env") == "600 0" ]]'
chk "install: /opt/c15t-platform exists" '[[ -d $T/opt/c15t-platform ]]'
chk "install: every unit of infra/systemd is copied unchanged" 'for f in "$SRC"/infra/systemd/*; do cmp -s "$f" "$T/etc/systemd/system/$(basename "$f")" || exit 1; done'
chk "install: daemon-reload, enable both services, enable the timer; nothing is started" 'called "systemctl daemon-reload" && called "systemctl enable c15t-consent-api.service c15t-dashboard-api.service" && called "systemctl enable --now cloudflare-ips.timer" && ! called "systemctl start" && ! called "systemctl restart"'
chk "install: no useradd for an existing user, no nginx, no database tool" '! called useradd && ! called nginx && no_forbidden'
chk "install: says what to do next" 'has "infra/deploy.sh" && has "docs/database-setup.md"'

echo "KEEP_ME=1" >"$T/etc/c15t-platform/consent-api.env"
after=$(snap "$T")
: >"$CALLS"
run_deploy install
chk "install twice: exit 0, changes nothing" '((RC == 0)) && [[ $(snap "$T") == "$after" ]]'
chk "install twice: an existing config file is never overwritten" '[[ $(cat "$T/etc/c15t-platform/consent-api.env") == KEEP_ME=1 ]]'
chk "install twice: no daemon-reload when no unit changed" '! called "daemon-reload"'
echo "# drift" >>"$T/etc/systemd/system/c15t-consent-api.service"
: >"$CALLS"
run_deploy install
chk "install after a drift: the unit is copied again, with a daemon-reload" 'cmp -s "$SRC/infra/systemd/c15t-consent-api.service" "$T/etc/systemd/system/c15t-consent-api.service" && called "daemon-reload" && has "installed $T/etc/systemd/system/c15t-consent-api.service"'
chk "install after a drift: warns and keeps the edited unit as .c15t-saved (not silently clobbered)" 'has "WARNING" && has "differs from" && grep -qx "# drift" "$T/etc/systemd/system/c15t-consent-api.service.c15t-saved" && ! cmp -s "$SRC/infra/systemd/c15t-consent-api.service" "$T/etc/systemd/system/c15t-consent-api.service.c15t-saved"'
after=$(snap "$T")
run_deploy install
chk "install once more: the saved copy is not touched, nothing changes" '((RC == 0)) && [[ $(snap "$T") == "$after" ]]'
run_deploy uninstall --purge-config
chk "uninstall after that: lists the saved copy as left in place, does not delete it" '((RC == 0)) && has "c15t-consent-api.service.c15t-saved" && [[ -f $T/etc/systemd/system/c15t-consent-api.service.c15t-saved ]]'

# install, then uninstall: the host is as it was
bare_host
paths "$T" >"$WORK/bare.paths"
run_deploy install
run_deploy uninstall
chk "install then uninstall: exit 0" '((RC == 0))'
chk "install then uninstall: every unit and /opt are gone (no allowlist was ever written, so the boot unit goes too), the config files stay" '[[ -f $T/etc/c15t-platform/consent-api.env && ! -e $T/opt/c15t-platform && -z $(ls "$T/etc/systemd/system") ]]'
run_deploy uninstall --purge-config
chk "install then uninstall --purge-config: back to the initial host" '[[ $(paths "$T") == "$(cat "$WORK/bare.paths")" ]]'

# ---- 10. install: hardening ------------------------------------------------------------------------------------------------------------------------

# a unit in the source tree that is not the platform's own is never copied into the systemd directory
fake=$WORK/fake-src
mkdir -p "$fake/infra/systemd"
cp "$SRC"/infra/systemd/* "$fake/infra/systemd/"
echo "[Service]" >"$fake/infra/systemd/nginx.service"
bare_host
C15T_SRC_DIR=$fake run_deploy install
chk "install: copies the platform's units only, skips any other unit file in the source tree" '((RC == 0)) && [[ ! -e $T/etc/systemd/system/nginx.service ]] && has "skipped" && [[ -f $T/etc/systemd/system/c15t-consent-api.service ]]'

# nothing that exists is changed: directory modes, an env file with its own mode and content
bare_host
mkdir -p "$T/etc/c15t-platform" "$T/opt/c15t-platform"
chmod 0711 "$T/etc/c15t-platform"
chmod 0700 "$T/opt/c15t-platform"
echo "DASHBOARD_API_PORT=4200" >"$T/etc/c15t-platform/dashboard-api.env"
chmod 0644 "$T/etc/c15t-platform/dashboard-api.env"
# (the mtime of the config directory changes when consent-api.env is created in it, so only the file's mtime counts)
before=$(cd "$T" && stat -c '%n %a %u %g' etc/c15t-platform opt/c15t-platform; stat -c '%n %a %u %g %s %Y' etc/c15t-platform/dashboard-api.env)
run_deploy install
chk "install: an existing config dir, app dir and env file keep mode and owner; the env file keeps size and mtime too" '((RC == 0)) && [[ $(cd "$T" && stat -c "%n %a %u %g" etc/c15t-platform opt/c15t-platform; stat -c "%n %a %u %g %s %Y" etc/c15t-platform/dashboard-api.env) == "$before" ]] && [[ -f $T/etc/c15t-platform/consent-api.env && $(<"$T/etc/c15t-platform/dashboard-api.env") == DASHBOARD_API_PORT=4200 ]]'

for bad_services in nginx "c15t-consent-api nginx" "*" "c15t-../x"; do
  bare_host
  before=$(snap "$T")
  C15T_SERVICES=$bad_services run_deploy install
  chk "install refuses C15T_SERVICES='$bad_services'" '((RC != 0)) && has "refusing to install" && [[ $(snap "$T") == "$before" && ! -s $CALLS ]]'
done
bare_host
before=$(snap "$T")
DRY_RUN=true run_deploy install
chk "install refuses DRY_RUN=true (it would have been a real run)" '((RC != 0)) && has "DRY_RUN must be 0 or 1" && [[ $(snap "$T") == "$before" && ! -s $CALLS ]]'
DRY_RUN=1 run_deploy install
chk "install with DRY_RUN=1 is a dry run" '((RC == 0)) && has "[dry-run]" && [[ $(snap "$T") == "$before" && ! -s $CALLS ]]'
C15T_SYSTEMD_DIR=etc/systemd/system run_deploy install
chk "install refuses a relative C15T_SYSTEMD_DIR" '((RC != 0)) && has "refusing to install" && [[ $(snap "$T") == "$before" ]]'
SYSTEMCTL_BIN=$T/no-such-systemctl run_deploy install
chk "install without systemctl: stops before changing anything" '((RC != 0)) && has "missing tool" && [[ $(snap "$T") == "$before" ]]'
run_deploy install uninstall
chk "two commands at once are refused" '((RC != 0)) && has "only one command" && [[ $(snap "$T") == "$before" ]]'
run_deploy uninstall rollback
chk "uninstall rollback is refused as well" '((RC != 0)) && has "only one command"'

# ---- 11. uninstall: hardening ----------------------------------------------------------------------------------------------------------------------

fresh_host
before=$(snap "$T")
DRY_RUN=true run_deploy uninstall
chk "DRY_RUN=true is refused: it must not turn a requested dry run into a real uninstall" '((RC != 0)) && has "DRY_RUN must be 0 or 1" && [[ $(snap "$T") == "$before" && ! -s $CALLS ]]'
DRY_RUN=yes run_deploy uninstall
chk "DRY_RUN=yes is refused as well" '((RC != 0)) && [[ $(snap "$T") == "$before" ]]'
DRY_RUN=1 run_deploy uninstall
chk "DRY_RUN=1 is a dry run" '((RC == 0)) && has "dry run finished" && [[ $(snap "$T") == "$before" && ! -s $CALLS ]]'

# C15T_SERVICES can only name c15t units: a unit of another service in the same directory is never touched
echo "[Service]" >"$T/etc/systemd/system/nginx.service"
before=$(snap "$T")
for bad_services in nginx "c15t-consent-api nginx" "*" "c15t-../x" "/etc/passwd"; do
  C15T_SERVICES=$bad_services run_deploy uninstall
  chk "uninstall refuses C15T_SERVICES='$bad_services', nothing is changed or called" '((RC != 0)) && has "refusing to uninstall" && [[ $(snap "$T") == "$before" && ! -s $CALLS ]]'
done
echo "[Service]" >"$T/etc/systemd/system/c15t-extra.service"
echo "c15t-extra.service" >>"$ACTIVE"
C15T_SERVICES="c15t-consent-api c15t-dashboard-api.service c15t-extra" run_deploy uninstall
chk "a further c15t-* service in C15T_SERVICES is stopped and removed; nginx.service is not" '((RC == 0)) && called "systemctl disable --now c15t-extra.service" && [[ ! -e $T/etc/systemd/system/c15t-extra.service && -f $T/etc/systemd/system/nginx.service && ! -s $ACTIVE ]]'

# every directory setting must be absolute, deep enough and without ..
for var in C15T_ENV_DIR C15T_NGINX_DIR C15T_SYSTEMD_DIR C15T_NFT_DIR; do
  fresh_host
  before=$(snap "$T")
  for bad_dir in relative/dir / /etc "$T/etc/../etc/nginx"; do
    env "$var=$bad_dir" bash "$DEPLOY" uninstall >"$WORK/out" 2>&1 && RC=0 || RC=$?
    OUT=$(<"$WORK/out")
    chk "refuses $var=${bad_dir#"$T"}" '((RC != 0)) && has "refusing to uninstall" && [[ $(snap "$T") == "$before" && ! -s $CALLS ]]'
  done
done

# a directory that deploy.sh did not make is not touched, and no lock file is created in it
fresh_host
mkdir -p "$T/srv/shop/releases/20240101" "$T/srv/shop/shared"
echo "<?php" >"$T/srv/shop/releases/20240101/index.php"
ln -s releases/20240101 "$T/srv/shop/current"
ln -s releases/20240101 "$T/srv/shop/previous"
before_shop=$(snap "$T/srv/shop")
C15T_APP_DIR=$T/srv/shop run_deploy uninstall
chk "an app dir without deploy.sh's marker files (a Capistrano-style tree): releases, current, previous, shared are untouched" '((RC == 0)) && [[ $(snap "$T/srv/shop") == "$before_shop" ]] && has "kept the contents of $T/srv/shop"'
chk "uninstall creates no lock file in a directory without one" '[[ ! -e $T/srv/shop/.deploy.lock ]]'
mkdir -p "$T/srv/mine/releases/a" "$T/srv/mine/releases/b"
: >"$T/srv/mine/releases/b/.release-ok"
ln -s releases/b "$T/srv/mine/current"
C15T_APP_DIR=$T/srv/mine run_deploy uninstall
chk "a release with .release-ok marks the directory as deploy.sh's: it is removed" '((RC == 0)) && [[ ! -e $T/srv/mine ]]'

# the unit files of a running service sit elsewhere: uninstall must not delete /opt under it
fresh_host
rm "$T/etc/systemd/system/c15t-consent-api.service"
before=$(snap "$T")
run_deploy uninstall
chk "a running service without a unit file in the systemd dir: refused before any change" '((RC != 0)) && has "c15t-consent-api.service is running, but its unit file is not in" && [[ $(snap "$T") == "$before" && -z $(mutating_calls) ]]'

fresh_host   # a stop that reports success and does not stop
FAKE_STOP_NOOP=1 run_deploy uninstall
chk "a service still running after stop: /opt and the unit files stay, exit non-zero" '((RC != 0)) && has "is still running after it was stopped" && [[ -d $T/opt/c15t-platform/releases/def456 && -f $T/etc/systemd/system/c15t-consent-api.service ]]'
run_deploy uninstall
chk "and once the stop works, the next run finishes the job" '((RC == 0)) && [[ ! -e $T/opt/c15t-platform && ! -e $T/etc/systemd/system/c15t-consent-api.service ]]'

# missing tools: stop before changing anything
fresh_host
before=$(snap "$T")
SYSTEMCTL_BIN=$T/no-such-systemctl run_deploy uninstall
chk "no systemctl, but unit files exist: refuses before changing anything" '((RC != 0)) && has "not found" && [[ $(snap "$T") == "$before" ]]'
NGINX_BIN=$T/no-such-nginx run_deploy uninstall
chk "no nginx, but c15t nginx files exist: refuses before changing anything" '((RC != 0)) && has "not found" && [[ $(snap "$T") == "$before" && -z $(mutating_calls) ]]'

# a dashboard vhost that was copied (not linked) into sites-enabled may be the only copy: never deleted
fresh_host
rm "$T/etc/nginx/sites-enabled/c15t-dashboard.conf"
cp "$SRC/infra/nginx/dashboard.conf" "$T/etc/nginx/sites-enabled/c15t-dashboard.conf"
before=$(snap "$T")
run_deploy uninstall
chk "a regular file at sites-enabled/c15t-dashboard.conf: kept; nginx -t stops the run, every file is back" '((RC != 0)) && has "is a regular file" && has "nginx -t rejects" && [[ $(snap "$T") == "$before" && -z $(mutating_calls) ]]'

# the allowlist boot unit: kept while it has a file to load, or is loaded; an inert copy goes
fresh_host
rm "$T/etc/nftables.d/c15t-cloudflare.nft"
run_deploy uninstall
chk "no allowlist file and the boot unit not running: the inert boot unit is removed with the rest" '((RC == 0)) && [[ ! -e $T/etc/systemd/system/c15t-cloudflare-nft.service ]]'
fresh_host
rm "$T/etc/nftables.d/c15t-cloudflare.nft"
echo "c15t-cloudflare-nft.service" >>"$ACTIVE"   # loaded: stopping it would delete the table (ExecStop)
run_deploy uninstall
chk "the boot unit is running (the table is loaded): kept and not stopped without --remove-cloudflare" '((RC == 0)) && [[ -f $T/etc/systemd/system/c15t-cloudflare-nft.service ]] && ! called "disable --now c15t-cloudflare-nft.service"'

# something other than a file at a c15t path is left alone
fresh_host
rm "$T/etc/nginx/snippets/c15t-dashboard-headers.conf"
mkdir "$T/etc/nginx/snippets/c15t-dashboard-headers.conf"
sed -i '/c15t-dashboard-headers/d' "$T/etc/nginx/sites-available/c15t-dashboard.conf"
run_deploy uninstall
chk "a directory where a snippet file should be is not touched" '((RC == 0)) && [[ -d $T/etc/nginx/snippets/c15t-dashboard-headers.conf && ! -e $T/etc/nginx/snippets/c15t.conf ]]'

# --- an interrupted run (SIGTERM, as on a closed ssh session or a CI timeout) puts the nginx files back
fresh_host
before=$(snap "$T")
rm -f "$WORK/hang.pid"
FAKE_NGINX_HANG_ON=2 bash "$DEPLOY" uninstall >"$WORK/hang.out" 2>&1 &
HOLDER=$!
for _ in $(seq 1 100); do [[ -s $WORK/hang.pid ]] && break; sleep 0.1; done
[[ -s $WORK/hang.pid ]] || { echo "test bug: the nginx stand-in did not hang" >&2; exit 2; }
moved=$(find "$T/etc/nginx" -name '.*.c15t-removed' | wc -l)
kill -TERM "$HOLDER"
wait "$HOLDER" 2>/dev/null && RC=0 || RC=$?
kill "$(<"$WORK/hang.pid")" 2>/dev/null || true
HOLDER=""
OUT=$(<"$WORK/hang.out")
chk "SIGTERM after the files were moved away and before nginx -t finished: they were moved, then every file is back" '((moved >= 5)) && ((RC != 0)) && [[ $(snap "$T") == "$before" && -z $(mutating_calls) ]]'

# --- a run that was killed for good (SIGKILL, power loss) leaves hidden files: the next run puts them back first
fresh_host
mv "$T/etc/nginx/snippets/c15t.conf" "$T/etc/nginx/snippets/.c15t.conf.c15t-removed"
echo "include snippets/c15t.conf;" >>"$T/etc/nginx/sites-enabled/website.conf"
run_deploy uninstall
chk "a hidden leftover of a killed run is put back before anything else (here the vhost still includes it, so everything stays)" '((RC != 0)) && has "putting $T/etc/nginx/snippets/c15t.conf back" && cmp -s "$SRC/infra/nginx/c15t.conf" "$T/etc/nginx/snippets/c15t.conf" && [[ -z $(find "$T/etc/nginx" -name ".*.c15t-removed") ]]'
fresh_host
mv "$T/etc/nginx/snippets/c15t.conf" "$T/etc/nginx/snippets/.c15t.conf.c15t-removed"
run_deploy uninstall
chk "a hidden leftover of a killed run: put back, tested, then removed with the rest; no hidden file remains" '((RC == 0)) && [[ ! -e $T/etc/nginx/snippets/c15t.conf && -z $(find "$T/etc/nginx" -name ".*.c15t-removed") ]]'
fresh_host
cp "$T/etc/nginx/snippets/c15t.conf" "$T/etc/nginx/snippets/.c15t.conf.c15t-removed"   # both exist: the hidden one is stale
run_deploy uninstall
chk "a stale hidden copy next to the live file is removed" '((RC == 0)) && [[ -z $(find "$T/etc/nginx" -name ".*.c15t-removed") ]]'

# --- releases is a symlink, current a directory: only what deploy.sh makes is removed
fresh_host
mkdir "$T/elsewhere"
echo "keep" >"$T/elsewhere/data"
rm -rf "$T/opt/c15t-platform/releases"
ln -s "$T/elsewhere" "$T/opt/c15t-platform/releases"
run_deploy uninstall
chk "releases is a symlink: only the link is removed, the target and its files stay" '((RC == 0)) && [[ -f $T/elsewhere/data && ! -e $T/opt/c15t-platform ]] && has "only the link is removed"'
fresh_host
rm "$T/opt/c15t-platform/current"
mkdir "$T/opt/c15t-platform/current"
echo "x" >"$T/opt/c15t-platform/current/file"
run_deploy uninstall
chk "current is a real directory: kept with a warning, everything else is removed, the directory stays" '((RC == 0)) && [[ -f $T/opt/c15t-platform/current/file && ! -e $T/opt/c15t-platform/releases && ! -e $T/opt/c15t-platform/.deploy.lock ]] && has "it is not a symlink"'

# --- the script lives in the tree it deletes, and the shell stands in it
fresh_host
mkdir -p "$T/opt/c15t-platform/releases/def456/infra"
cp "$DEPLOY" "$T/opt/c15t-platform/releases/def456/infra/deploy.sh"
RC=0
OUT=$(cd "$T/opt/c15t-platform/current" && bash "$T/opt/c15t-platform/current/infra/deploy.sh" uninstall 2>&1) || RC=$?
chk "run from inside the tree it deletes (script and working directory in current/): exit 0, /opt is gone, no error" '((RC == 0)) && [[ ! -e $T/opt/c15t-platform ]] && ! has "No such file" && ! has "getcwd"'

# --- a real run does not touch what only a dry run might read: no lock created on a host without /opt
bare_host
mkdir -p "$T/opt/c15t-platform"
before=$(snap "$T")
run_deploy uninstall
chk "an empty /opt/c15t-platform (install only): removed, and no lock or log file was ever created in it" '((RC == 0)) && [[ ! -e $T/opt/c15t-platform ]]'
mkdir -p "$T/opt/c15t-platform"
run_deploy uninstall --dry-run
chk "dry run on an empty /opt/c15t-platform: creates no lock file" '((RC == 0)) && [[ -z $(ls -A "$T/opt/c15t-platform") ]]'

echo
echo "$pass passed, $fail failed"
((fail == 0))
