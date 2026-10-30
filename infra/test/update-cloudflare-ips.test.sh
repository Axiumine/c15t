#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Tests for infra/nginx/update-cloudflare-ips.sh. No root, no network, no Docker: Cloudflare's lists
# come from fixtures, and curl, nginx, systemctl and nft are stand-ins that record how they were
# called. All output goes to a temporary directory.
#
#   infra/test/update-cloudflare-ips.test.sh
#
# Covers: --dry-run writes nothing; --out-dir writes and is idempotent; a file that cannot be
# written fails the run (exit code and message, never "unchanged"); bad input leaves the old files;
# nginx -t rejecting the new real_ip file restores the old one and skips the reload; --apply-nft
# loads the table and warns when it would not survive a reboot.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SCRIPT=$HERE/../nginx/update-cloudflare-ips.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
pass=0
fail=0

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n     %s\n' "$1" "$2"; }

# ---- fixtures and stand-ins --------------------------------------------------------------------

cat >"$WORK/v4.txt" <<'EOF'
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
EOF
cat >"$WORK/v6.txt" <<'EOF'
2400:cb00::/32
2606:4700::/32
2803:f800::/32
2405:b500::/32
EOF

BIN=$WORK/bin
mkdir -p "$BIN"
cat >"$BIN/curl" <<EOF
#!/usr/bin/env bash
case "\${*: -1}" in
  *ips-v4*) cat "$WORK/v4.txt" ;;
  *ips-v6*) cat "$WORK/v6.txt" ;;
  *) exit 22 ;;
esac
EOF
cat >"$BIN/nginx" <<EOF
#!/usr/bin/env bash
echo "nginx \$*" >>"$WORK/calls"
if [[ -n \${FAKE_NGINX_FAIL:-} ]]; then echo "nginx: [emerg] fake failure" >&2; exit 1; fi
EOF
cat >"$BIN/systemctl" <<EOF
#!/usr/bin/env bash
echo "systemctl \$*" >>"$WORK/calls"
if [[ \$1 == is-enabled ]]; then [[ -n \${FAKE_NFT_ENABLED:-} ]]; exit; fi
EOF
cat >"$BIN/nft" <<EOF
#!/usr/bin/env bash
echo "nft \$*" >>"$WORK/calls"
EOF
chmod +x "$BIN"/*
export CURL_BIN=$BIN/curl NGINX_BIN=$BIN/nginx SYSTEMCTL=$BIN/systemctl NFT_BIN=$BIN/nft

# run_script ARGS...: sets RC and OUT (stdout and stderr together). Runs in a fresh tree, $T.
run_script() {
  RC=0
  OUT=$(bash "$SCRIPT" "$@" 2>&1) || RC=$?
}
fresh() { # a new empty tree with the locations the script writes to
  T=$WORK/tree.$((++n))
  mkdir -p "$T"
  : >"$WORK/calls"
  unset OUT_DIR DRY_RUN CF_NFT_APPLY CF_UFW CF_RELOAD EXTRA_ALLOW FAKE_NGINX_FAIL FAKE_NFT_ENABLED
  export NGINX_CONF_DIR=$T/etc/nginx/conf.d NFT_DIR=$T/etc/nftables.d UFW_FILE=$T/etc/c15t-platform/cloudflare-ufw.sh
  export NFT_CONF=$T/etc/nftables.conf
}
n=0

assert() { # NAME CONDITION-RESULT(0 = true) DETAIL
  if (($2 == 0)); then ok "$1"; else bad "$1" "$3"; fi
}
has() { [[ $OUT == *"$1"* ]]; }
called() { grep -qF -- "$1" "$WORK/calls"; }

# ---- 1. dry run -------------------------------------------------------------------------------------

fresh
run_script --dry-run
assert "dry run: exit 0" "$RC" "exit $RC: $OUT"
assert "dry run: says so" "$(has 'DRY RUN' && echo 0 || echo 1)" "$OUT"
assert "dry run: writes nothing" "$([[ ! -e $T/etc ]] && echo 0 || echo 1)" "$(find "$T" | head)"
run_script --dry-run --apply-nft
assert "dry run with --apply-nft: nft is not called" "$(called 'nft ' && echo 1 || echo 0)" "$(cat "$WORK/calls")"

# ---- 2. --out-dir: write, then idempotent, then update -----------------------------------------------

fresh
unset NGINX_CONF_DIR NFT_DIR UFW_FILE
run_script --out-dir "$T/out" --ufw
assert "out-dir run: exit 0" "$RC" "exit $RC: $OUT"
assert "out-dir run: real_ip file has every range" "$([[ $(grep -c '^set_real_ip_from ' "$T/out/nginx/conf.d/cloudflare-realip.conf") == 10 ]] && echo 0 || echo 1)" "$(cat "$T/out/nginx/conf.d/cloudflare-realip.conf")"
assert "out-dir run: real_ip header is CF-Connecting-IP" "$(grep -q '^real_ip_header CF-Connecting-IP;' "$T/out/nginx/conf.d/cloudflare-realip.conf" && echo 0 || echo 1)" ""
assert "out-dir run: nft file written" "$([[ -s $T/out/nftables.d/c15t-cloudflare.nft ]] && echo 0 || echo 1)" ""
assert "out-dir run: ufw script written, not executable by others" "$([[ -s $T/out/c15t-platform/cloudflare-ufw.sh && $(stat -c %a "$T/out/c15t-platform/cloudflare-ufw.sh") == 750 ]] && echo 0 || echo 1)" ""
assert "out-dir run: nginx and nft are never called" "$([[ ! -s $WORK/calls ]] && echo 0 || echo 1)" "$(cat "$WORK/calls")"
run_script --out-dir "$T/out" --ufw
assert "second run: exit 0" "$RC" "exit $RC: $OUT"
assert "second run: reports unchanged, not wrote" "$(has 'unchanged:' && ! has 'wrote ' && echo 0 || echo 1)" "$OUT"
printf '%s\n' 198.51.100.0/24 >>"$WORK/v4.txt"
run_script --out-dir "$T/out"
assert "changed list: files are rewritten" "$(has 'wrote ' && grep -q 198.51.100.0/24 "$T/out/nginx/conf.d/cloudflare-realip.conf" && echo 0 || echo 1)" "$OUT"
sed -i '$d' "$WORK/v4.txt"

# real curl with file:// (only accepted together with --out-dir)
fresh
unset NGINX_CONF_DIR NFT_DIR UFW_FILE
RC=0
OUT=$(CURL_BIN=curl CF_IPS_V4_URL=file://$WORK/v4.txt CF_IPS_V6_URL=file://$WORK/v6.txt bash "$SCRIPT" --out-dir "$T/out" 2>&1) || RC=$?
assert "file:// lists are read with --out-dir" "$RC" "exit $RC: $OUT"
RC=0
OUT=$(CURL_BIN=curl CF_IPS_V4_URL=file://$WORK/v4.txt CF_IPS_V6_URL=file://$WORK/v6.txt bash "$SCRIPT" 2>&1) || RC=$?
assert "file:// lists are refused without --out-dir" "$([[ $RC != 0 ]] && echo 0 || echo 1)" "exit $RC: $OUT"

# ---- 3. a file that cannot be written fails the run ----------------------------------------------------

fresh
: >"$T/blocker" # a regular file: nothing can be created below it
export NFT_DIR=$T/blocker/nftables.d
run_script
assert "unwritable nft dir: non-zero exit" "$([[ $RC != 0 ]] && echo 0 || echo 1)" "exit $RC: $OUT"
assert "unwritable nft dir: says it could not install" "$(has 'could not install' && has 'c15t-cloudflare.nft' && echo 0 || echo 1)" "$OUT"
assert "unwritable nft dir: never says unchanged for it" "$(has 'unchanged: '"$NFT_DIR" && echo 1 || echo 0)" "$OUT"
assert "unwritable nft dir: never says done" "$(has ': done' && echo 1 || echo 0)" "$OUT"
assert "unwritable nft dir: no temp file left behind" "$([[ -z $(find "$T/etc" -name '*.??????' 2>/dev/null) ]] && echo 0 || echo 1)" "$(find "$T/etc")"

fresh
: >"$T/blocker"
export NGINX_CONF_DIR=$T/blocker/conf.d
run_script
assert "unwritable real_ip dir: non-zero exit" "$([[ $RC != 0 ]] && echo 0 || echo 1)" "exit $RC: $OUT"
assert "unwritable real_ip dir: says it could not install" "$(has 'could not install' && echo 0 || echo 1)" "$OUT"
assert "unwritable real_ip dir: nginx is not reloaded" "$(called 'reload' && echo 1 || echo 0)" "$(cat "$WORK/calls")"
assert "unwritable real_ip dir: the nft step did not run" "$([[ ! -e $T/etc/nftables.d ]] && echo 0 || echo 1)" ""

fresh
: >"$T/blocker"
export UFW_FILE=$T/blocker/cloudflare-ufw.sh
run_script --ufw
assert "unwritable ufw file: non-zero exit" "$([[ $RC != 0 ]] && echo 0 || echo 1)" "exit $RC: $OUT"

# ---- 4. bad input keeps the old files ---------------------------------------------------------------------

fresh
run_script
assert "full run: exit 0" "$RC" "exit $RC: $OUT"
assert "full run: nginx -t, then reload" "$(called 'nginx -t' && called 'systemctl reload nginx' && echo 0 || echo 1)" "$(cat "$WORK/calls")"
before=$(cat "$NGINX_CONF_DIR/cloudflare-realip.conf")
cp "$WORK/v4.txt" "$WORK/v4.good"
printf '%s\n' 'not-a-cidr' >>"$WORK/v4.txt"
run_script
assert "bad range: non-zero exit" "$([[ $RC != 0 ]] && echo 0 || echo 1)" "exit $RC: $OUT"
assert "bad range: old real_ip file untouched" "$([[ $(cat "$NGINX_CONF_DIR/cloudflare-realip.conf") == "$before" ]] && echo 0 || echo 1)" ""
cp "$WORK/v4.good" "$WORK/v4.txt"
printf '%s\n' '10.0.0.0/33' >>"$WORK/v4.txt"
run_script
assert "prefix out of range: non-zero exit" "$([[ $RC != 0 ]] && echo 0 || echo 1)" "exit $RC: $OUT"
cp "$WORK/v4.good" "$WORK/v4.txt"

# ---- 5. nginx -t rejects the new file ------------------------------------------------------------------------

fresh
run_script
before=$(cat "$NGINX_CONF_DIR/cloudflare-realip.conf")
printf '%s\n' 198.51.100.0/24 >>"$WORK/v4.txt"
: >"$WORK/calls"
export FAKE_NGINX_FAIL=1
run_script
assert "nginx -t fails: non-zero exit" "$([[ $RC != 0 ]] && echo 0 || echo 1)" "exit $RC: $OUT"
assert "nginx -t fails: previous real_ip file restored" "$([[ $(cat "$NGINX_CONF_DIR/cloudflare-realip.conf") == "$before" ]] && echo 0 || echo 1)" ""
assert "nginx -t fails: no reload" "$(called 'reload' && echo 1 || echo 0)" "$(cat "$WORK/calls")"
fresh
export FAKE_NGINX_FAIL=1
run_script
assert "nginx -t fails on a fresh host: file removed, exit non-zero" "$([[ $RC != 0 && ! -e $NGINX_CONF_DIR/cloudflare-realip.conf ]] && echo 0 || echo 1)" "exit $RC: $OUT"
sed -i '$d' "$WORK/v4.txt"

# ---- 6. --apply-nft: load, and say whether it survives a reboot -------------------------------------------------

fresh
run_script --apply-nft
assert "apply-nft: exit 0" "$RC" "exit $RC: $OUT"
assert "apply-nft: checks, then loads the file" "$(called "nft -c -f" && called "nft -f $NFT_DIR/c15t-cloudflare.nft" && echo 0 || echo 1)" "$(cat "$WORK/calls")"
assert "apply-nft: warns when nothing reloads it at boot" "$(has 'gone after a reboot' && has 'c15t-cloudflare-nft.service' && echo 0 || echo 1)" "$OUT"

fresh
export FAKE_NFT_ENABLED=1
run_script --apply-nft
assert "apply-nft with the boot unit enabled: no warning" "$(has 'gone after a reboot' && echo 1 || echo 0)" "$OUT"

fresh
mkdir -p "$T/etc"
printf '%s\n' 'flush ruleset' "# include \"$NFT_DIR/*.nft\"" >"$NFT_CONF"
run_script --apply-nft
assert "apply-nft: a commented-out include does not count" "$(has 'gone after a reboot' && echo 0 || echo 1)" "$OUT"
printf '%s\n' "include \"$NFT_DIR/*.nft\"" >>"$NFT_CONF"
run_script --apply-nft
assert "apply-nft with nftables.conf including the directory: no warning" "$(has 'gone after a reboot' && echo 1 || echo 0)" "$OUT"

fresh
run_script --apply-nft --no-nft
assert "--no-nft: nothing is loaded, no nft file" "$([[ ! -e $NFT_DIR && $(grep -c '^nft ' "$WORK/calls" || true) == 0 ]] && echo 0 || echo 1)" "$(cat "$WORK/calls")"

# ---- 7. the generated nft file ------------------------------------------------------------------------------------

fresh
run_script
nftfile=$NFT_DIR/c15t-cloudflare.nft
sequence=$(grep -E '^(delete )?table inet c15t_cloudflare( \{)?$' "$nftfile" | tr '\n' '|')
assert "nft file: declare, delete, define (safe to load twice)" "$([[ $sequence == 'table inet c15t_cloudflare|delete table inet c15t_cloudflare|table inet c15t_cloudflare {|' ]] && echo 0 || echo 1)" "$sequence"
assert "nft file: tells how to keep it after a reboot" "$(grep -q 'c15t-cloudflare-nft.service' "$nftfile" && echo 0 || echo 1)" ""

echo
echo "$pass passed, $fail failed"
((fail == 0))
