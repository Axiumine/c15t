#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Regenerates, from Cloudflare's published ranges:
#   1. nginx real_ip config  /etc/nginx/conf.d/cloudflare-realip.conf   (always)
#      set_real_ip_from per range + `real_ip_header CF-Connecting-IP;`: the visitor IP is restored
#      only for requests that really come from Cloudflare.
#   2. nftables allowlist    /etc/nftables.d/c15t-cloudflare.nft         (unless --no-nft)
#      Table inet c15t_cloudflare: only these ranges (plus EXTRA_ALLOW) may reach the web ports.
#      Loaded with `nft -f`, which replaces the whole table atomically (so loading it again is safe).
#      The kernel forgets the table at reboot. To keep it, enable infra/systemd/c15t-cloudflare-nft.service
#      (loads this file at boot, before the network is up) or add `include "/etc/nftables.d/*.nft"` at the
#      end of /etc/nftables.conf. --apply-nft warns when neither is in place.
#   3. ufw commands          /etc/c15t-platform/cloudflare-ufw.sh        (only with --ufw)
#      A script of `ufw allow ...` lines. It is written, never run: ufw has no atomic replace.
#
# Run weekly by cloudflare-ips.timer (docs/decisions.md D7). Exit code is non-zero if anything failed (a range
# list that is bad or too short, a file that cannot be written, nginx -t or nft rejecting the result),
# and the files that were already in place stay untouched in that case.
#
# Usage: update-cloudflare-ips.sh [options]
#   --dry-run          fetch and validate, show what would change, write nothing   (env DRY_RUN=1)
#   --out-dir DIR      write every output under DIR instead of /etc; do not run nginx -t, reload
#                      or nft (for tests)                                            (env OUT_DIR)
#   --ufw              also write the ufw script                                     (env CF_UFW=1)
#   --no-nft           skip the nftables file
#   --apply-nft        load the nftables file into the kernel after writing it       (env CF_NFT_APPLY=1)
#   --no-reload        skip `nginx -t` and the reload
#   -h, --help
#
# Other environment (all optional):
#   CF_IPS_V4_URL / CF_IPS_V6_URL   default https://www.cloudflare.com/ips-v4 and /ips-v6
#                                   (file:// is accepted only together with --out-dir)
#   CF_FIREWALL_PORTS               default "80,443"
#   EXTRA_ALLOW                     extra CIDRs for the firewall only (monitoring, office), comma or space separated
#   NGINX_CONF_DIR, NFT_DIR, UFW_FILE   output locations (UFW_FILE=- prints the ufw script to stdout)
#   NFT_CONF                        default /etc/nftables.conf (only read, to see whether it includes NFT_DIR)
#   NGINX_BIN, SYSTEMCTL, NFT_BIN, CURL_BIN
#
# The nftables rule drops every other source on those ports. Loopback is allowed. Check that your
# own access (monitoring, LAN hosts, a CDN other than Cloudflare) is covered before --apply-nft.
set -euo pipefail
umask 022

CF_IPS_V4_URL=${CF_IPS_V4_URL:-https://www.cloudflare.com/ips-v4}
CF_IPS_V6_URL=${CF_IPS_V6_URL:-https://www.cloudflare.com/ips-v6}
CF_FIREWALL_PORTS=${CF_FIREWALL_PORTS:-80,443}
EXTRA_ALLOW=${EXTRA_ALLOW:-}
OUT_DIR=${OUT_DIR:-}
DRY_RUN=${DRY_RUN:-0}
CF_UFW=${CF_UFW:-0}
CF_NFT=${CF_NFT:-1}
CF_NFT_APPLY=${CF_NFT_APPLY:-0}
CF_RELOAD=${CF_RELOAD:-1}
NGINX_BIN=${NGINX_BIN:-nginx}
SYSTEMCTL=${SYSTEMCTL:-systemctl}
NFT_BIN=${NFT_BIN:-nft}
CURL_BIN=${CURL_BIN:-curl}
NFT_CONF=${NFT_CONF:-/etc/nftables.conf}
NFT_UNIT=c15t-cloudflare-nft.service   # infra/systemd: loads the table again at boot
MIN_V4=${CF_MIN_V4:-5}     # Cloudflare publishes about 15 IPv4 and 7 IPv6 ranges; fewer means a bad answer
MIN_V6=${CF_MIN_V6:-3}

log() { printf '%s\n' "update-cloudflare-ips: $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

usage() { sed -n '2,/^set -euo/{/^set -euo/!s/^# \{0,1\}//p}' "${BASH_SOURCE[0]}"; }

while (($#)); do
  case $1 in
    --dry-run) DRY_RUN=1 ;;
    --out-dir) shift; [[ $# -gt 0 ]] || die "--out-dir needs a directory"; OUT_DIR=$1 ;;
    --ufw) CF_UFW=1 ;;
    --no-nft) CF_NFT=0 ;;
    --apply-nft) CF_NFT_APPLY=1 ;;
    --no-reload) CF_RELOAD=0 ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
  shift
done

if [[ -n $OUT_DIR ]]; then
  NGINX_CONF_DIR=${NGINX_CONF_DIR:-$OUT_DIR/nginx/conf.d}
  NFT_DIR=${NFT_DIR:-$OUT_DIR/nftables.d}
  UFW_FILE=${UFW_FILE:-$OUT_DIR/c15t-platform/cloudflare-ufw.sh}
  CF_RELOAD=0
  CF_NFT_APPLY=0
else
  NGINX_CONF_DIR=${NGINX_CONF_DIR:-/etc/nginx/conf.d}
  NFT_DIR=${NFT_DIR:-/etc/nftables.d}
  UFW_FILE=${UFW_FILE:-/etc/c15t-platform/cloudflare-ufw.sh}
fi
REALIP_FILE=$NGINX_CONF_DIR/cloudflare-realip.conf
NFT_FILE=$NFT_DIR/c15t-cloudflare.nft

# ---- validation -------------------------------------------------------------------------------

valid_v4() { # a.b.c.d/nn, each octet 0-255, prefix 0-32
  local cidr=$1 ip prefix o
  [[ $cidr =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$ ]] || return 1
  ip=${cidr%/*}
  prefix=${cidr#*/}
  ((10#$prefix <= 32)) || return 1
  local IFS=.
  for o in $ip; do ((10#$o <= 255)) || return 1; done
}

valid_v6() { # hex groups of 1-4 digits, at most one "::", at most 8 groups, prefix 0-128
  local cidr=$1 ip prefix rest g n=0
  [[ $cidr =~ ^[0-9A-Fa-f:]+/[0-9]{1,3}$ ]] || return 1
  ip=${cidr%/*}
  prefix=${cidr#*/}
  ((10#$prefix <= 128)) || return 1
  [[ $ip == *:::* ]] && return 1
  rest=${ip//::/:}
  [[ $ip == *::*::* ]] && return 1
  [[ $ip == *:* ]] || return 1
  rest=${rest#:}
  rest=${rest%:}
  local IFS=:
  for g in $rest; do
    [[ $g =~ ^[0-9A-Fa-f]{1,4}$ ]] || return 1
    n=$((n + 1))
  done
  if [[ $ip == *::* ]]; then ((n <= 7)) || return 1; else ((n == 8)) || return 1; fi
}

# fetch URL: print the body, or fail. https only; file:// only with --out-dir (tests).
fetch() {
  local url=$1 proto=https
  if [[ -n $OUT_DIR && $url == file://* ]]; then proto='file'; fi
  [[ $url == "$proto"://* ]] || die "refusing to fetch $url (https only)"
  "$CURL_BIN" --fail --silent --show-error --location --proto "=$proto" --proto-redir "=$proto" \
    --max-time 30 --retry 3 --retry-delay 2 "$url"
}

# read_ranges KIND URL MIN: print validated CIDRs, one per line, in the published order, deduplicated.
read_ranges() {
  local kind=$1 url=$2 min=$3 body line count=0 out=""
  body=$(fetch "$url") || die "could not fetch $url"
  while IFS= read -r line; do
    line=${line%$'\r'}
    line=${line//[[:space:]]/}
    [[ -z $line ]] && continue
    if [[ $kind == v4 ]]; then valid_v4 "$line" || die "$url: not an IPv4 CIDR: '$line'"
    else valid_v6 "$line" || die "$url: not an IPv6 CIDR: '$line'"; fi
    case $'\n'$out in *$'\n'"$line"$'\n'*) continue ;; esac
    out+="$line"$'\n'
    count=$((count + 1))
  done <<<"$body"
  ((count >= min)) || die "$url: only $count ranges (expected at least $min); keeping the current files"
  printf '%s' "$out"
}

# ---- generation -------------------------------------------------------------------------------

join_commas() { local out="" x; for x in "$@"; do out+="${out:+, }$x"; done; printf '%s' "$out"; }

render_realip() {
  local c
  printf '%s\n' "# Managed by infra/nginx/update-cloudflare-ips.sh. Do not edit by hand." \
    "# Source: https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6" \
    "# CF-Connecting-IP is trusted only from these ranges; from anyone else it is ignored."
  for c in "${V4[@]}" "${V6[@]}"; do printf 'set_real_ip_from %s;\n' "$c"; done
  printf '%s\n' "real_ip_header CF-Connecting-IP;" "real_ip_recursive off;"
}

render_nft() {
  local ports=${CF_FIREWALL_PORTS//[[:space:]]/}
  [[ $ports =~ ^[0-9]+(,[0-9]+)*$ ]] || die "CF_FIREWALL_PORTS must be a comma separated list of ports"
  ports=${ports//,/, }
  printf '%s\n' "# Managed by infra/nginx/update-cloudflare-ips.sh. Do not edit by hand." \
    "# Load: nft -f $NFT_FILE   (replaces the table atomically; loading it twice is fine)" \
    "# After a reboot: systemctl enable --now $NFT_UNIT, or include this directory from $NFT_CONF" \
    "table inet c15t_cloudflare" \
    "delete table inet c15t_cloudflare" \
    "table inet c15t_cloudflare {" \
    "    set cf_v4 {" \
    "        type ipv4_addr" \
    "        flags interval" \
    "        auto-merge" \
    "        elements = { $(join_commas "${A4[@]}") }" \
    "    }" \
    "    set cf_v6 {" \
    "        type ipv6_addr" \
    "        flags interval" \
    "        auto-merge" \
    "        elements = { $(join_commas "${A6[@]}") }" \
    "    }" \
    "    chain input {" \
    "        type filter hook input priority -10; policy accept;" \
    "        iifname \"lo\" accept" \
    "        tcp dport { $ports } ip saddr @cf_v4 accept" \
    "        tcp dport { $ports } ip6 saddr @cf_v6 accept" \
    "        tcp dport { $ports } counter drop" \
    "    }" \
    "}"
}

render_ufw() {
  local ports=${CF_FIREWALL_PORTS//[[:space:]]/} c
  [[ $ports =~ ^[0-9]+(,[0-9]+)*$ ]] || die "CF_FIREWALL_PORTS must be a comma separated list of ports"
  printf '%s\n' "#!/bin/sh" \
    "# Managed by infra/nginx/update-cloudflare-ips.sh. Do not edit by hand." \
    "# Review, then run as root: sh $UFW_FILE" \
    "# ufw cannot replace a rule set atomically. This only ADDS rules, so ranges that Cloudflare" \
    "# dropped stay allowed until you delete them (ufw status numbered). Also remove any generic" \
    "# 'allow 80,443' rule, or the allowlist has no effect." \
    "set -eu"
  for c in "${A4[@]}" "${A6[@]}"; do
    printf "ufw allow proto tcp from %s to any port %s comment 'c15t-cloudflare'\n" "$c" "$ports"
  done
}

# ---- installing -------------------------------------------------------------------------------

# install_file SRC DEST MODE: atomic replace (temp file in the same directory, then rename).
# Exit status: 0 = written, 10 = DEST already has this content, anything else = it failed (and said why).
# Callers must not use it as an `if` condition: errexit is off there, so every step checks itself.
INSTALL_UNCHANGED=10
install_file() {
  local src=$1 dest=$2 mode=$3 tmp
  if [[ -f $dest ]] && cmp -s "$src" "$dest"; then return "$INSTALL_UNCHANGED"; fi
  mkdir -p "$(dirname "$dest")" || { log "cannot create the directory of $dest"; return 1; }
  tmp=$(mktemp "$dest.XXXXXX") || { log "cannot create a temporary file next to $dest"; return 1; }
  if ! { cat "$src" >"$tmp" && chmod "$mode" "$tmp" && mv -f "$tmp" "$dest"; }; then
    rm -f "$tmp"
    log "cannot write $dest"
    return 1
  fi
}

# install_or_die SRC DEST MODE: like install_file, but a failure ends the script. Sets $INSTALLED to
# 1 when DEST was written and 0 when it was already up to date.
INSTALLED=0
install_or_die() {
  local status=0
  install_file "$@" || status=$?
  case $status in
    0) INSTALLED=1 ;;
    "$INSTALL_UNCHANGED") INSTALLED=0 ;;
    *) die "could not install $2 (the files that were in place are unchanged)" ;;
  esac
}

# nft_is_persistent: will the table come back after a reboot? Yes if the boot unit is enabled, or if
# nftables.conf includes a file from NFT_DIR.
nft_is_persistent() {
  local includes=""
  if "$SYSTEMCTL" is-enabled --quiet "$NFT_UNIT" 2>/dev/null; then return 0; fi
  if [[ -r $NFT_CONF ]]; then includes=$(grep -E '^[[:space:]]*include[[:space:]]' "$NFT_CONF" || true); fi
  [[ $includes == *"$NFT_DIR/"* ]]
}

show_change() { # DEST NEW
  if [[ -f $1 ]]; then
    if cmp -s "$2" "$1"; then log "unchanged: $1"; else log "would change: $1"; diff -u "$1" "$2" >&2 || true; fi
  else
    log "would create: $1 ($(wc -l <"$2") lines)"
  fi
}

# ---- main -------------------------------------------------------------------------------------

# Plain assignments, so that a die inside read_ranges stops the whole script (it would not inside < <(...)).
v4_text=$(read_ranges v4 "$CF_IPS_V4_URL" "$MIN_V4")
v6_text=$(read_ranges v6 "$CF_IPS_V6_URL" "$MIN_V6")
mapfile -t V4 <<<"$v4_text"
mapfile -t V6 <<<"$v6_text"
log "fetched ${#V4[@]} IPv4 and ${#V6[@]} IPv6 ranges"

A4=("${V4[@]}")
A6=("${V6[@]}")
for c in ${EXTRA_ALLOW//,/ }; do
  if valid_v4 "$c"; then A4+=("$c")
  elif valid_v6 "$c"; then A6+=("$c")
  else die "EXTRA_ALLOW: not a CIDR: '$c'"; fi
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
render_realip >"$work/realip.conf"
[[ $CF_NFT == 1 ]] && render_nft >"$work/c15t-cloudflare.nft"
[[ $CF_UFW == 1 ]] && render_ufw >"$work/cloudflare-ufw.sh"

if [[ $DRY_RUN == 1 ]]; then
  log "DRY RUN: nothing is written"
  show_change "$REALIP_FILE" "$work/realip.conf"
  [[ $CF_NFT == 1 ]] && show_change "$NFT_FILE" "$work/c15t-cloudflare.nft"
  if [[ $CF_UFW == 1 ]]; then
    if [[ $UFW_FILE == - ]]; then cat "$work/cloudflare-ufw.sh"; else show_change "$UFW_FILE" "$work/cloudflare-ufw.sh"; fi
  fi
  exit 0
fi

# 1. nginx: keep the old file until `nginx -t` accepts the new one.
backup=""
had_old=0
if [[ -f $REALIP_FILE ]]; then
  had_old=1
  backup=$work/realip.previous
  cp -p "$REALIP_FILE" "$backup"
fi
install_or_die "$work/realip.conf" "$REALIP_FILE" 0644
if ((INSTALLED)); then
  log "wrote $REALIP_FILE"
  if [[ $CF_RELOAD == 1 ]]; then
    if ! "$NGINX_BIN" -t 2>"$work/nginx-test.log"; then
      cat "$work/nginx-test.log" >&2
      if ((had_old)); then mv -f "$backup" "$REALIP_FILE"; else rm -f "$REALIP_FILE"; fi
      die "nginx -t rejected the new config; restored the previous $REALIP_FILE"
    fi
    "$SYSTEMCTL" reload nginx || die "nginx reload failed (the new config passed nginx -t)"
    log "nginx reloaded"
  fi
else
  log "unchanged: $REALIP_FILE"
fi

# 2. nftables
if [[ $CF_NFT == 1 ]]; then
  if [[ $CF_NFT_APPLY == 1 ]]; then
    "$NFT_BIN" -c -f "$work/c15t-cloudflare.nft" || die "nft rejected the generated file; $NFT_FILE not changed"
  fi
  install_or_die "$work/c15t-cloudflare.nft" "$NFT_FILE" 0644
  if ((INSTALLED)); then log "wrote $NFT_FILE"; else log "unchanged: $NFT_FILE"; fi
  if [[ $CF_NFT_APPLY == 1 ]]; then
    "$NFT_BIN" -f "$NFT_FILE" || die "nft -f $NFT_FILE failed"
    log "nftables table c15t_cloudflare loaded"
    nft_is_persistent ||
      log "WARNING: the table is gone after a reboot, and ports $CF_FIREWALL_PORTS are open to everyone until this runs again. Fix once: systemctl enable $NFT_UNIT (or add: include \"$NFT_DIR/*.nft\" to $NFT_CONF)"
  fi
fi

# 3. ufw
if [[ $CF_UFW == 1 ]]; then
  if [[ $UFW_FILE == - ]]; then
    cat "$work/cloudflare-ufw.sh"
  else
    install_or_die "$work/cloudflare-ufw.sh" "$UFW_FILE" 0750
    if ((INSTALLED)); then log "wrote $UFW_FILE (not executed)"; else log "unchanged: $UFW_FILE"; fi
  fi
fi
log "done"
