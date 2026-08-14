#!/usr/bin/env bash
set -euo pipefail

# Load .env if present
if [ -f "$(dirname "$0")/../.env" ]; then
  set -o allexport
  source "$(dirname "$0")/../.env"
  set +o allexport
fi

POSTGRES_USER="${POSTGRES_USER:-celesol}"
POSTGRES_DB="${POSTGRES_DB:-celesol}"
POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-5432}"
PGADMIN_HOST_PORT="${PGADMIN_HOST_PORT:-5050}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"

ok()   { printf "  ${GREEN}✔${RESET} %s\n" "$1"; }
fail() { printf "  ${RED}✘${RESET} %s\n" "$1"; FAILED=1; }
info() { printf "  ${YELLOW}→${RESET} %s\n" "$1"; }

FAILED=0

# ── PostgreSQL ────────────────────────────────────────────────────────────────
echo ""
echo "▸ PostgreSQL  (localhost:${POSTGRES_HOST_PORT})"

if docker compose exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q 2>/dev/null; then
  ok "pg_isready: accepting connections"
else
  fail "pg_isready: not ready"
fi

PG_VERSION=$(docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT version();" 2>/dev/null | head -1)
if [ -n "$PG_VERSION" ]; then
  ok "SQL query OK  →  $PG_VERSION"
else
  fail "SQL query failed"
fi

# ── pgAdmin ───────────────────────────────────────────────────────────────────
echo ""
echo "▸ pgAdmin  (http://localhost:${PGADMIN_HOST_PORT})"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${PGADMIN_HOST_PORT}/misc/ping" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  ok "HTTP $HTTP_CODE — /misc/ping"
else
  info "HTTP $HTTP_CODE on /misc/ping — trying login page"
  HTTP_CODE2=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:${PGADMIN_HOST_PORT}" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE2" =~ ^(200|302|301)$ ]]; then
    ok "HTTP $HTTP_CODE2 — login page reachable"
  else
    fail "HTTP $HTTP_CODE2 — pgAdmin not reachable"
  fi
fi

# ── MinIO API ─────────────────────────────────────────────────────────────────
echo ""
echo "▸ MinIO API  (http://localhost:9000)"

HTTP_MINIO=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:9000/minio/health/live 2>/dev/null || echo "000")
if [ "$HTTP_MINIO" = "200" ]; then
  ok "HTTP $HTTP_MINIO — /minio/health/live"
else
  fail "HTTP $HTTP_MINIO — health endpoint not responding"
fi

# MinIO: list buckets via mc alias (if mc is available)
if command -v mc &>/dev/null; then
  mc alias set local http://localhost:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" --quiet 2>/dev/null
  if mc ls local --quiet 2>/dev/null; then
    ok "mc: credentials and API valid"
  else
    fail "mc: could not list buckets"
  fi
else
  info "mc (MinIO client) not installed — skipping bucket check"
fi

# ── MinIO Console ─────────────────────────────────────────────────────────────
echo ""
echo "▸ MinIO Console  (http://localhost:9001)"

HTTP_CONSOLE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:9001 2>/dev/null || echo "000")
if [[ "$HTTP_CONSOLE" =~ ^(200|302|301)$ ]]; then
  ok "HTTP $HTTP_CONSOLE — console reachable"
else
  fail "HTTP $HTTP_CONSOLE — console not reachable"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILED" -eq 0 ]; then
  printf "${GREEN}All checks passed.${RESET}\n\n"
else
  printf "${RED}One or more checks failed.${RESET}\n\n"
  exit 1
fi
