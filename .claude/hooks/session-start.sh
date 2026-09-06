#!/bin/sh
# Bootstraps a Claude Code on the web session so the full validation set in
# CONTRIBUTING.md can actually run.
#
# Without this, a remote session starts with no node_modules, no .env and no
# MariaDB. `npm test` then still exits 0 while every integration suite skips
# silently (tests/integration/db.ts short-circuits on a missing
# TEST_DATABASE_URL), which is the one failure mode Agent.md section 13 calls
# out by name: a skipped suite reported as a passing one.
#
# POSIX sh, idempotent, non-interactive. Local checkouts are left alone.
set -eu

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

DB_USER=personalcrm
DB_PASSWORD=personalcrm
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=personalcrm
TEST_DB_NAME=personalcrm_test
# The end-to-end suite needs a database that starts empty so first-run setup
# runs, and it wipes it on every run — so it is its own, never the dev one.
E2E_DB_NAME=personalcrm_e2e

DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
TEST_DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${TEST_DB_NAME}"
E2E_DATABASE_URL="mysql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${E2E_DB_NAME}"

note() { printf '%s\n' "$*"; }

# ---------------------------------------------------------------------------
# Dependencies. `install` rather than `ci` so the cached container layer is
# reused on the next session instead of being rebuilt from scratch.
# ---------------------------------------------------------------------------
npm install --no-audit --no-fund --silent
npx --yes prisma generate >/dev/null

# ---------------------------------------------------------------------------
# MariaDB. Ubuntu 24.04 ships 10.11; CI runs 11. Close enough for the suites,
# but see the caveat in .claude/skills/db-change/SKILL.md before trusting a
# local result about transaction rollback behaviour.
# ---------------------------------------------------------------------------
db_ready() { mariadb-admin ping >/dev/null 2>&1; }

start_database() {
  if db_ready; then
    return 0
  fi

  if [ ! -x /usr/sbin/mariadbd ]; then
    [ "$(id -u)" -eq 0 ] || return 1
    DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || return 1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mariadb-server >/dev/null 2>&1 || return 1
  fi

  mkdir -p /var/run/mysqld
  chown mysql:mysql /var/run/mysqld 2>/dev/null || true
  nohup /usr/sbin/mariadbd \
    --user=mysql \
    --bind-address="$DB_HOST" \
    --port="$DB_PORT" \
    --skip-name-resolve \
    >/tmp/mariadb-session-start.log 2>&1 &

  i=0
  while [ "$i" -lt 60 ]; do
    db_ready && return 0
    i=$((i + 1))
    sleep 1
  done
  return 1
}

DATABASE_READY=no
if start_database; then
  # Socket auth as root; the app and the suites connect over TCP as an
  # unprivileged user, the way they do everywhere else.
  mariadb <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`${TEST_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS \`${E2E_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${TEST_DB_NAME}\`.* TO '${DB_USER}'@'%';
GRANT ALL PRIVILEGES ON \`${E2E_DB_NAME}\`.* TO '${DB_USER}'@'%';
FLUSH PRIVILEGES;
SQL
  DATABASE_READY=yes
fi

# ---------------------------------------------------------------------------
# .env. Gitignored, and tests/setup-env.ts reads it, so this is what makes
# TEST_DATABASE_URL visible to vitest.
# ---------------------------------------------------------------------------
# Only the missing keys are appended, never an existing value rewritten, so a
# container whose .env survives from an earlier session picks up a key added
# since — E2E_DATABASE_URL was exactly that — without losing anything already
# in it.
ensure_env() {
  grep -q "^$1=" .env 2>/dev/null && return 0
  printf '%s="%s"\n' "$1" "$2" >> .env
}

if [ "$DATABASE_READY" = yes ]; then
  if [ ! -f .env ]; then
    echo '# Written by .claude/hooks/session-start.sh. Not committed (.gitignore).' > .env
  fi
  ensure_env DATABASE_URL "$DATABASE_URL"
  ensure_env TEST_DATABASE_URL "$TEST_DATABASE_URL"
  ensure_env E2E_DATABASE_URL "$E2E_DATABASE_URL"
  ensure_env UPLOADS_DIR "./data/uploads"
  ensure_env APP_URL "http://127.0.0.1:3200"
  # Generated only when it is actually missing: the argument to ensure_env is
  # evaluated before the call, so doing this unconditionally would start node
  # on every resume to throw the result away.
  grep -q '^AUTH_SECRET=' .env 2>/dev/null ||
    ensure_env AUTH_SECRET "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  ensure_env DISABLE_SIGNUP "false"
  ensure_env TZ "America/New_York"
fi

mkdir -p data/uploads

# ---------------------------------------------------------------------------
# Schema. The test database for the integration suites, the dev one so
# `npm run dev` has somewhere to go. `migrate deploy` is what the container
# runs, and it is a no-op once applied. The e2e database is created above but
# migrated by .claude/skills/e2e/run-e2e.sh instead, which has to empty it on
# every run anyway.
# ---------------------------------------------------------------------------
if [ "$DATABASE_READY" = yes ]; then
  DATABASE_URL="$TEST_DATABASE_URL" npx --yes prisma migrate deploy >/dev/null
  DATABASE_URL="$DATABASE_URL" npx --yes prisma migrate deploy >/dev/null # dev database

  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    {
      printf 'export DATABASE_URL=%s\n' "$DATABASE_URL"
      printf 'export TEST_DATABASE_URL=%s\n' "$TEST_DATABASE_URL"
      printf 'export E2E_DATABASE_URL=%s\n' "$E2E_DATABASE_URL"
    } >> "$CLAUDE_ENV_FILE"
  fi

  note "Dependencies installed. MariaDB is up on ${DB_HOST}:${DB_PORT} with ${DB_NAME} and ${TEST_DB_NAME} migrated."
  note "Integration tests will run for real: npm test. For end-to-end, .claude/skills/e2e/run-e2e.sh builds, starts and drives the app."
else
  note "WARNING: MariaDB could not be started, so TEST_DATABASE_URL is unset and every integration suite will SKIP."
  note "Do not report 'all tests passed' from this session — report the skip, per Agent.md section 13."
fi
