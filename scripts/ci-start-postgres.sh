#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine
#
# CI only. Starts the throwaway PostgreSQL container of the test job on a random port above 50000, published
# on the loopback address only, and appends PGPORT to $GITHUB_ENV for scripts/ci-bootstrap-db.sh.
#
# No port is fixed: a self-hosted runner host can run jobs of several repositories at once, and a
# `services:` container would take either port 5432 or one Docker picks from 32768 up. A port that is
# in use is skipped; if Docker still cannot bind the one it was given (another job was faster), the
# next random port is tried. Any other `docker run` failure stops the script.
#
# Input (environment):
#   PG_IMAGE           the image, pinned by digest
#   POSTGRES_PASSWORD  the administrator password of the container (passed by name, never on the command line)
#   PG_CONTAINER       the container name; unique to the job, so the cleanup step can remove it
#   GITHUB_ENV         required
#
# Output: PGPORT=<port> appended to $GITHUB_ENV. The container runs with --rm; remove it with
# `docker rm --force "$PG_CONTAINER"` when the job ends.
set -euo pipefail

die() { printf '[ci-start-postgres] error: %s\n' "$*" >&2; exit 1; }

[[ -n "${PG_IMAGE:-}" ]] || die 'PG_IMAGE is not set'
[[ -n "${POSTGRES_PASSWORD:-}" ]] || die 'POSTGRES_PASSWORD is not set'
[[ "${PG_CONTAINER:-}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$ ]] || die 'PG_CONTAINER must be a valid container name'
[[ -n "${GITHUB_ENV:-}" ]] || die 'GITHUB_ENV is not set (run this inside GitHub Actions)'

readonly first_port=50001 # 50001 to 65535
readonly port_count=15535

for _ in $(seq 1 50); do
  port=$((first_port + RANDOM % port_count))
  if command -v ss > /dev/null 2>&1 && [[ -n $(ss -ltnH "sport = :${port}") ]]; then continue; fi
  if out=$(docker run --detach --rm --name "$PG_CONTAINER" --publish "127.0.0.1:${port}:5432" \
    --env POSTGRES_PASSWORD "$PG_IMAGE" 2>&1); then
    echo "PGPORT=${port}" >> "$GITHUB_ENV"
    printf '[ci-start-postgres] %s listens on 127.0.0.1:%s\n' "$PG_CONTAINER" "$port"
    exit 0
  fi
  grep -qiE 'port is already allocated|address already in use' <<< "$out" || die "docker run failed: ${out}"
  docker rm --force "$PG_CONTAINER" > /dev/null 2>&1 || true # a failed publish leaves a created container
done
die 'no free port above 50000 after 50 tries'
