#!/bin/sh
# Runs the end-to-end suite the way CI does: against the standalone bundle the
# container actually ships, on a database that starts empty.
#
# playwright.config.ts deliberately targets an already-running instance so the
# same suite can be pointed at `next start` or at the built container, which
# means something has to start one. In CI that is a job step; here it is this.
#
#   .claude/skills/e2e/run-e2e.sh                          # everything
#   .claude/skills/e2e/run-e2e.sh tests/e2e/privacy.spec.ts
#   .claude/skills/e2e/run-e2e.sh --project=mobile
#
# Arguments are passed through to `playwright test` untouched.
set -eu

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)}"
cd "$PROJECT_DIR"

PORT="${E2E_PORT:-3200}"
HOST=127.0.0.1
BASE_URL="http://${HOST}:${PORT}"
WORK_DIR=.devtmp/e2e
SERVER_LOG="$WORK_DIR/server.log"

# The suite's first project creates the account every other project signs in
# with, so it needs a database with no account in it. Its own, never the dev
# one: this is wiped on every run.
DB_URL="${E2E_DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -f .env ]; then
  DB_URL="$(sed -n 's/^E2E_DATABASE_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env | head -1)"
fi
if [ -z "$DB_URL" ]; then
  echo "E2E_DATABASE_URL is not set and .env does not define it." >&2
  echo "In a web session .claude/hooks/session-start.sh writes it. Locally, point it" >&2
  echo "at a throwaway database — the suite wipes it — and re-run." >&2
  exit 1
fi
# A whitelist, not a blacklist of the two names that came to mind: the database
# is emptied on every run, and `migrate deploy` below touches it before
# reset-db.mjs gets to enforce anything. A blacklist let
# `…/personalcrm?connection_limit=5` through — it ends in neither name — and
# would have applied pending migrations to the dev database. Same rule
# reset-db.mjs applies, and the same shape as the `_test` guard in
# tests/integration/db.ts.
DB_NAME="${DB_URL##*/}"      # everything after the last slash
DB_NAME="${DB_NAME%%\?*}"    # minus any query string
case "$DB_NAME" in
  *_e2e) ;;
  *)
    echo "E2E_DATABASE_URL names \"${DB_NAME}\", which does not end in \"_e2e\"." >&2
    echo "This script empties that database on every run. Refusing." >&2
    exit 1
    ;;
esac

mkdir -p "$WORK_DIR"

# Playwright 1.62 wants a Chromium build the pre-provisioned images do not
# necessarily ship. playwright.config.ts reads PLAYWRIGHT_CHROMIUM_PATH for
# exactly this: launching the browser that is already here beats downloading a
# second copy of one.
# `${VAR+set}` is empty only when VAR is *unset*, so exporting
# PLAYWRIGHT_CHROMIUM_PATH= (empty) opts out and lets Playwright use its own
# managed browser — which is what makes the `npx playwright install chromium`
# fallback below reachable when the pre-provisioned one will not launch.
if [ -z "${PLAYWRIGHT_CHROMIUM_PATH+set}" ] && [ -x /opt/pw-browsers/chromium ]; then
  PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium
  export PLAYWRIGHT_CHROMIUM_PATH
fi

SERVER_PID=""
cleanup() {
  status=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  # The server log is the only place a 500 during a test explains itself — but
  # only this run's. Guarded on SERVER_PID because a failure before the server
  # started would otherwise print the previous run's log as if it were the
  # explanation.
  if [ "$status" -ne 0 ] && [ -n "$SERVER_PID" ] && [ -s "$SERVER_LOG" ]; then
    echo "--- $SERVER_LOG (last 40 lines) ---" >&2
    tail -40 "$SERVER_LOG" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
# Their own traps, exiting non-zero: sharing the EXIT handler meant a signal
# arriving after the last command succeeded entered cleanup with $? = 0 and
# reported an interrupted run as a passing one.
trap 'exit 130' INT
trap 'exit 143' TERM

# Nothing else may already own the port. The health poll below cannot tell a
# stale instance from ours — it would accept the old one's 200, and Playwright
# would then drive an app on a different database while the specs that write
# through Prisma use this one.
if node -e '
  const socket = require("node:net").connect({ host: process.argv[1], port: Number(process.argv[2]) });
  socket.on("connect", () => { socket.end(); process.exit(0); });
  socket.on("error", () => process.exit(1));
  setTimeout(() => process.exit(1), 2000);
' "$HOST" "$PORT" 2>/dev/null; then
  echo "Something is already listening on ${BASE_URL}." >&2
  echo "Stop it, or set E2E_PORT to a free port. Refusing to test an instance this" >&2
  echo "script did not start — it would be running against a different database." >&2
  exit 1
fi

# The generated client has to match the schema being tested. CI regenerates
# before it migrates and builds; without this, a run started right after a
# schema edit builds against a stale client and cannot validate the very change
# it was invoked for.
echo "==> Generating the Prisma client"
npx --yes prisma generate >/dev/null

# Migrations first, so a table added since the last run exists and is swept
# too; then empty it. `migrate deploy` is the non-destructive command the
# container runs, and reset-db.mjs truncates rather than dropping — see its
# header for why.
echo "==> Preparing ${DB_NAME}"
DATABASE_URL="$DB_URL" npx --yes prisma migrate deploy >/dev/null
DATABASE_URL="$DB_URL" node .claude/skills/e2e/reset-db.mjs

echo "==> Building"
npm run build

# `output: "standalone"` traces only the modules the server needs; static
# assets and public/ are copied in separately, exactly as the Dockerfile and
# the CI job do it. Without this the app boots and every asset 404s.
echo "==> Assembling the standalone bundle"
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

echo "==> Starting the app on ${BASE_URL}"
: > "$SERVER_LOG"
PORT="$PORT" \
HOSTNAME="$HOST" \
DATABASE_URL="$DB_URL" \
APP_URL="$BASE_URL" \
AUTH_SECRET="${E2E_AUTH_SECRET:-e2e-only-secret-not-used-anywhere-else-0123456789}" \
DISABLE_SIGNUP=false \
UPLOADS_DIR="$PROJECT_DIR/$WORK_DIR/uploads" \
TZ="${TZ:-America/New_York}" \
  node .next/standalone/server.js >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Liveness is checked before the health response is accepted, not after: if the
# process died the answer can only have come from something else.
attempt=0
while :; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "The app exited before it became healthy." >&2
    exit 1
  fi
  curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1 && break
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "The app never became healthy on ${BASE_URL}." >&2
    exit 1
  fi
  sleep 2
done
echo "==> Healthy after ${attempt} attempt(s)"

# DATABASE_URL is for the test process, not the app: privacy.spec.ts builds its
# own `new PrismaClient()` to age a session's unlock, and with no override that
# client reads .env — i.e. the dev database, while the app under test is on the
# e2e one, and the session it looks for does not exist. CI never sees this
# because there DATABASE_URL is set for the whole job.
echo "==> Running Playwright"
E2E_BASE_URL="$BASE_URL" DATABASE_URL="$DB_URL" npx playwright test "$@"
