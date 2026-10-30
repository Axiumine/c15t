#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine

# Checks the real nginx snippets (infra/nginx/c15t.conf and dashboard-*.conf) against a throwaway
# nginx container (infra/test/compose.yaml, host networking) with an echo stub as the upstream.
# TEST ONLY: production has no Docker (README D7).
#
#   infra/test/nginx-snippet.test.sh
#
# What it proves:
#   - /api/c15t/* is rewritten to /s/<siteKey>/* and proxied to consent-api, also on a vhost that has
#     its own regex locations (`location ~* \.(js|json)$`, `location ~ ^/api/`): the `^~` prefix wins;
#   - the visitor IP comes from real_ip, client-sent X-Forwarded-For / Forwarded / X-Real-IP are
#     dropped, and the tenant cannot be changed by path tricks, headers, cookies or query strings;
#   - an unknown Host gets no answer (444), an upstream outage gives JSON 503 (never HTML);
#   - the dashboard locations send noindex / CSP headers on every answer, errors included.
#
# It picks free loopback ports itself and removes the containers when it ends (also on Ctrl-C).
# Needs: docker compose, curl, ss. Optional: TMPDIR for the scratch directory.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT="c15t-nginx-snippet-test-$$"
WORK=$(mktemp -d)
ENV_FILE=$WORK/test.env
pass=0
fail=0

compose() { docker compose -p "$PROJECT" -f "$HERE/compose.yaml" --env-file "$ENV_FILE" "$@"; }

cleanup() {
  local status=$?
  compose --profile stub down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

free_port() { # free_port VARNAME: a loopback port nobody listens on and not handed out before
  local p
  for _ in $(seq 1 200); do
    p=$((20000 + RANDOM % 30000))
    case " $USED_PORTS " in *" $p "*) continue ;; esac
    if [[ -z $(ss -ltnH "sport = :$p") ]]; then
      USED_PORTS="$USED_PORTS $p"
      printf -v "$1" '%s' "$p"
      return 0
    fi
  done
  echo "no free port found" >&2
  return 1
}

USED_PORTS=""
free_port NGINX_PORT
free_port CONSENT_PORT
free_port DASHBOARD_PORT
cat >"$ENV_FILE" <<EOF
NGINX_TEST_PORT=$NGINX_PORT
CONSENT_API_HOST=127.0.0.1
CONSENT_API_PORT=$CONSENT_PORT
DASHBOARD_API_HOST=127.0.0.1
DASHBOARD_API_PORT=$DASHBOARD_PORT
EOF

# ---- helpers ----------------------------------------------------------------------------------

ok() { pass=$((pass + 1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf 'FAIL %s\n     %s\n' "$1" "$2"; }

# request HOST PATH [curl args]: sets $STATUS, $HEADERS (lowercased names) and $BODY.
request() {
  local host=$1 path=$2
  shift 2
  STATUS=$(curl -sS --path-as-is --max-time 10 -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' \
    --resolve "$host:$NGINX_PORT:127.0.0.1" "$@" "http://$host:$NGINX_PORT$path" 2>/dev/null) || STATUS="curl:$?"
  BODY=$(cat "$WORK/body" 2>/dev/null || true)
  HEADERS=$(tr -d '\r' <"$WORK/headers" 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
}

expect_body() { # NAME PATTERN (fixed string)
  if [[ $BODY == *"$2"* ]]; then ok "$1"; else bad "$1" "body lacks '$2' (status $STATUS): ${BODY:0:300}"; fi
}
expect_no_body() { # NAME PATTERN (fixed string)
  if [[ $BODY != *"$2"* ]]; then ok "$1"; else bad "$1" "body has '$2' (status $STATUS): ${BODY:0:300}"; fi
}
expect_header() { # NAME LOWERCASE-HEADER-LINE (fixed string, a whole line)
  if grep -qxF -- "$2" <<<"$HEADERS"; then ok "$1"; else bad "$1" "no header line '$2' in: $(tr '\n' '|' <<<"$HEADERS")"; fi
}
expect_status() { # NAME STATUS
  if [[ $STATUS == "$2" ]]; then ok "$1"; else bad "$1" "status $STATUS, want $2"; fi
}
# stays_in_tenant NAME: the upstream, if it was reached at all, only saw /s/shop/...
stays_in_tenant() {
  if [[ $BODY == *'"uri":"'* && $BODY != *'"uri":"/s/shop/'* ]]; then
    bad "$1" "upstream saw another path: ${BODY:0:300}"
  elif [[ $BODY == *'/s/other'* && $BODY != *'"uri":"/s/shop/'* ]]; then
    bad "$1" "tenant 'other' leaked: ${BODY:0:300}"
  else
    ok "$1 (status $STATUS)"
  fi
}

# ---- start ------------------------------------------------------------------------------------

echo "ports: nginx $NGINX_PORT, consent-api stub $CONSENT_PORT, dashboard-api stub $DASHBOARD_PORT"
compose --profile stub up -d --quiet-pull >/dev/null
compose exec -T nginx nginx -t >/dev/null 2>&1 || { compose logs nginx >&2; echo "nginx -t failed in the container" >&2; exit 1; }

for _ in $(seq 1 50); do
  request shop.test /api/c15t/init
  [[ $STATUS == 200 ]] && break
  sleep 0.2
done
[[ $STATUS == 200 ]] || { compose logs >&2; echo "the test stack did not come up (status $STATUS)" >&2; exit 1; }

# ---- 1. the snippet: rewrite and proxy -----------------------------------------------------------

request shop.test /api/c15t/init?x=1
expect_body "shop: /api/c15t/init -> /s/shop/init?x=1" '"uri":"/s/shop/init?x=1"'
expect_body "shop: goes to the consent-api port" "\"port\":\"$CONSENT_PORT\""
expect_body "shop: Host is the site's own" '"host":"shop.test"'
expect_body "shop: X-Forwarded-Proto is https" '"xfproto":"https"'

# ---- 2. a vhost with competing regex locations -----------------------------------------------------

for path in /api/c15t/init /api/c15t/x.js /api/c15t/c15t.js /api/c15t/manifest.json /api/c15t/a/b.json?x=1 /api/c15t/status; do
  request regex.test "$path"
  expect_body "regex vhost: $path reaches the upstream" '"uri":"/s/shop/'
  expect_no_body "regex vhost: $path is not answered by a regex location" 'regex-'
done
# Controls: the vhost's own regex locations still work for everything else.
request regex.test /other.js
expect_body "control: /other.js is answered by the site's regex location" 'regex-location-hit'
request regex.test /api/own
expect_body "control: /api/own is answered by the site's regex location" 'regex-api-hit'

# ---- 3. header hygiene and real_ip -------------------------------------------------------------------

request shop.test /api/c15t/init -H 'CF-Connecting-IP: 203.0.113.7' -H 'CF-IPCountry: DE' \
  -H 'X-Forwarded-For: 6.6.6.6' -H 'Forwarded: for=6.6.6.6' -H 'X-Real-IP: 6.6.6.6' -H 'X-Forwarded-Host: evil.test'
expect_body "visitor IP comes from real_ip, client X-Forwarded-For is replaced" '"xff":"203.0.113.7"'
expect_body "client Forwarded is dropped" '"forwarded":""'
expect_body "client X-Real-IP is dropped" '"xrealip":""'
expect_body "client X-Forwarded-Host is replaced" '"xfhost":"shop.test"'
expect_body "CF-IPCountry passes through" '"country":"DE"'
request shop.test /api/c15t/init -H 'X-Forwarded-For: 6.6.6.6'
expect_body "without CF-Connecting-IP the peer address is used, not the client's XFF" '"xff":"127.0.0.1"'

# ---- 4. tenant escape ----------------------------------------------------------------------------------

request shop.test /api/c15t/../../s/other/init
stays_in_tenant "path traversal (..)"
request shop.test '/api/c15t/%2e%2e/%2e%2e/s/other/init'
stays_in_tenant "path traversal (%2e%2e)"
request shop.test '/api/c15t/..%2f..%2fs/other/init'
stays_in_tenant "path traversal (..%2f)"
request shop.test '/api/c15t/x/..%252f..%252fs/other/init'
stays_in_tenant "path traversal (double-encoded)"
request shop.test /api/c15t//s/other/init
stays_in_tenant "double slash"
request shop.test /api/c15t/init -H 'X-C15T-Site: other' -H 'X-Site-Key: other' -H 'Cookie: c15t_site=other; siteKey=other' -H 'Host-Override: other.test'
expect_body "tenant is not taken from headers or cookies" '"uri":"/s/shop/init"'
request shop.test '/api/c15t/init?siteKey=other&tenantId=other'
expect_body "tenant is not taken from the query string" '"uri":"/s/shop/init?siteKey=other&tenantId=other"'
request shop.test /s/shop/init
expect_no_body "the /s/ prefix is not reachable from outside" '"uri"'
request regex.test '/api/c15t/..%2f..%2fs/other/init'
stays_in_tenant "regex vhost: path traversal"

# An unknown Host never falls through to a site's tenant.
request unknown.test /api/c15t/init
if [[ $STATUS == curl:52 || $STATUS == 000 ]]; then ok "unknown Host: connection closed (444)"; else bad "unknown Host: connection closed (444)" "status $STATUS: ${BODY:0:200}"; fi

# ---- 5. dashboard locations ----------------------------------------------------------------------------

check_dashboard_headers() { # NAME
  expect_header "$1: X-Robots-Tag" 'x-robots-tag: noindex, nofollow'
  expect_header "$1: X-Content-Type-Options" 'x-content-type-options: nosniff'
  if grep -q "^content-security-policy: default-src 'self'.*frame-ancestors 'none'" <<<"$HEADERS"; then ok "$1: CSP"; else bad "$1: CSP" "missing"; fi
}
request dashboard.test /
expect_status "dashboard: / is the SPA" 200
expect_header "dashboard: / is no-cache" 'cache-control: no-cache'
check_dashboard_headers "dashboard /"
request dashboard.test /assets/app-abc123.js
expect_header "dashboard: hashed asset is immutable" 'cache-control: public, max-age=31536000, immutable'
check_dashboard_headers "dashboard asset"
request dashboard.test /assets/missing.js
expect_status "dashboard: a missing asset is 404" 404
expect_header "dashboard: a missing asset is never cached" 'cache-control: no-store'
check_dashboard_headers "dashboard 404 asset"
request dashboard.test /.env
expect_status "dashboard: dotfiles are 404" 404
check_dashboard_headers "dashboard dotfile"
request dashboard.test /robots.txt
expect_body "dashboard: robots.txt disallows everything" 'Disallow: /'
request dashboard.test /api/health
expect_body "dashboard: /api/ goes to dashboard-api" "\"port\":\"$DASHBOARD_PORT\""
expect_header "dashboard: /api/ is no-store" 'cache-control: no-store'
check_dashboard_headers "dashboard api"

# ---- 6. upstream down: JSON, never HTML ----------------------------------------------------------------

compose stop stub >/dev/null 2>&1
for host in shop.test regex.test; do
  request "$host" /api/c15t/init
  expect_status "$host: upstream down gives 503" 503
  expect_body "$host: upstream down gives the JSON error" '"code":"UPSTREAM_UNAVAILABLE"'
  expect_header "$host: upstream down is not cacheable" 'cache-control: no-store'
  expect_header "$host: upstream down is application/json" 'content-type: application/json'
done
request dashboard.test /api/health
expect_status "dashboard: api down gives 503" 503
expect_body "dashboard: api down gives the JSON error" '"code":"UPSTREAM_UNAVAILABLE"'
check_dashboard_headers "dashboard api down"

echo
echo "$pass passed, $fail failed"
((fail == 0))
