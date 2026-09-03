#!/usr/bin/env bash
# Exercise the shipped backup path against representative relational data, then
# destroy and restore the database so this cannot pass on a readable gzip alone.
set -euo pipefail
container="${1:-personalcrm-ci}"

# -i, because the seeding call below feeds SQL in on stdin: without it
# docker attaches no stdin, the client reads nothing, the rows are never
# written, and the comparison at the end fails on an empty result.
sql() { docker exec -i "${container}" mariadb --socket=/run/mysqld/mysqld.sock "$@"; }

sql personalcrm <<'SQL'
INSERT INTO User (id, email, name, passwordHash, role, isActive, createdAt, updatedAt)
VALUES ('backup-smoke-user', 'backup-smoke@example.invalid', 'Backup Smoke', 'not-a-login', 'ADMIN', 1, NOW(), NOW());
INSERT INTO Contact (id, ownerId, firstName, lastName, summary, isFavorite, isArchived, isRomantic, isPrivate, birthDatePrecision, metOnPrecision, allergyStatus, createdAt, updatedAt)
VALUES ('backup-smoke-contact', 'backup-smoke-user', 'Ada', 'Restore', 'quotes: '' and unicode: café', 1, 0, 0, 1, 'DAY', 'DAY', 'UNKNOWN', NOW(), NOW());
SQL

docker exec "${container}" s6-setuidgid abc /etc/s6-overlay/scripts/backup-now
backup="$(find "${RUNNER_TEMP}/config/backups" -maxdepth 1 -name 'personalcrm-*.sql.gz' -type f | sort | tail -1)"
test -n "${backup}"
test "$(stat -c '%u:%g' "${backup}")" = "1001:1001"
test -z "$(find "${RUNNER_TEMP}/config/backups" -maxdepth 1 \( -name '*.partial.*' -o -name '.mariadb-client.*' \) -print -quit)"
# The option file holds the database password. It is written to volatile
# runtime storage, never to the persistent volume the dumps are published on,
# and it is gone once the run ends.
test -z "$(docker exec "${container}" sh -c "find /run/personalcrm -maxdepth 1 -type f -name '.mariadb-client.*' -print -quit 2>/dev/null")"

sql -e 'DROP DATABASE personalcrm;'
gzip -dc "${backup}" | docker exec -i "${container}" mariadb --socket=/run/mysqld/mysqld.sock
actual="$(sql --batch --skip-column-names personalcrm -e "SELECT CONCAT(User.email, '|', Contact.firstName, '|', Contact.lastName, '|', Contact.summary, '|', Contact.isPrivate) FROM User JOIN Contact ON Contact.ownerId = User.id WHERE User.id = 'backup-smoke-user';")"
test "${actual}" = "backup-smoke@example.invalid|Ada|Restore|quotes: ' and unicode: café|1"
echo "backup restore smoke test passed"
