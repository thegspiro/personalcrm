#!/usr/bin/env bash
# Shared helpers for the s6 service scripts.
#
# Sourced, never executed. Everything here must be idempotent — s6 runs the
# oneshots on every container start, not just the first.

DB_NAME="${DB_NAME:-personalcrm}"
DB_USER="${DB_USER:-personalcrm}"
SECRETS_FILE="${SECRETS_FILE:-/config/secrets.json}"

# True when the operator pointed the app at their own MariaDB/MySQL server.
using_external_database() {
    [[ -n "${DATABASE_URL:-}" ]]
}

# Read one field out of /config/secrets.json.
read_secret() {
    local key="$1"
    node -e '
      const fs = require("node:fs");
      try {
        const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const value = data[process.argv[2]];
        if (typeof value === "string" && value) process.stdout.write(value);
      } catch { /* handled by the caller checking for empty output */ }
    ' "${SECRETS_FILE}" "${key}"
}

# Create /config/secrets.json on first boot with a random database password and
# session-signing secret. Both stay put across upgrades, so sessions survive a
# container replacement and the database keeps working.
ensure_secrets() {
    if [[ -s "${SECRETS_FILE}" ]] && [[ -n "$(read_secret authSecret)" ]]; then
        return 0
    fi

    echo "[secrets] generating ${SECRETS_FILE}"
    node -e '
      const fs = require("node:fs");
      const crypto = require("node:crypto");
      const file = process.argv[1];
      let data = {};
      try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { data = {}; }
      if (!data.dbPassword) data.dbPassword = crypto.randomBytes(24).toString("base64url");
      if (!data.authSecret) data.authSecret = crypto.randomBytes(48).toString("base64url");
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    ' "${SECRETS_FILE}"

    chown "${PUID:-99}:${PGID:-100}" "${SECRETS_FILE}"
    chmod 600 "${SECRETS_FILE}"
}

# Resolve DATABASE_URL and AUTH_SECRET, then publish them to the rest of the
# s6 supervision tree via the container environment directory.
export_runtime_env() {
    ensure_secrets

    if ! using_external_database; then
        local password
        password="$(read_secret dbPassword)"
        if [[ -z "${password}" ]]; then
            echo "[env] could not read the database password from ${SECRETS_FILE}" >&2
            exit 1
        fi
        # The password is URL-encoded: base64url can't produce reserved
        # characters, but an operator-supplied one could.
        local encoded
        encoded="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${password}")"
        export DATABASE_URL="mysql://${DB_USER}:${encoded}@127.0.0.1:3306/${DB_NAME}"
    fi

    if [[ -z "${AUTH_SECRET:-}" ]]; then
        AUTH_SECRET="$(read_secret authSecret)"
        export AUTH_SECRET
    fi

    # Publish to the container environment directory as well, so `docker exec`
    # sessions and any later service see the same values. Best-effort: each
    # service computes these itself, so this is a convenience, not a dependency.
    if mkdir -p /run/s6/container_environment 2>/dev/null; then
        printf '%s' "${DATABASE_URL}" > /run/s6/container_environment/DATABASE_URL || true
        printf '%s' "${AUTH_SECRET}" > /run/s6/container_environment/AUTH_SECRET || true
    fi
}
