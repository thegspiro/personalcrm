---
name: db-change
description: The checklist for changing persistence in Personal CRM. Use whenever a task edits prisma/schema.prisma, adds or hand-edits a file under prisma/migrations/, adds or renames a table, column, enum or relation, changes a Prisma model's fields, or runs npm run db:migrate / prisma migrate. Also use when reviewing a generated migration's SQL, when a change re-expresses existing data (a rename, a split, a widening), or when asked whether a migration is data-safe.
---

# Changing the schema

Authoritative text: **Agent.md section 10**, **AGENTS.md → Database and Migration
Safety**, **CLAUDE.md → Adding a table**, **CONTRIBUTING.md → Migrations**. Read
the current versions — this file routes, it does not restate.

## Order of work

1. Read the existing model and its migration history before editing anything.
2. Find every reader and writer of the columns you are touching
   (`src/server/queries/`, `src/server/actions/`, `src/server/services/`).
3. Edit `prisma/schema.prisma`. Give the model `ownerId` unless it only ever
   exists beneath a `Contact`.
4. `npm run db:migrate`.
5. **Read the generated SQL.** This is the step that has cost data before.

## Reading the generated SQL

Prisma diffs shape, not meaning. When a change re-expresses data that already
exists, the generated migration drops the old column and takes the information
with it — Prisma has no idea it was a rename.

Hand-edit the migration to backfill *before* the drop, in the same migration.
The worked example is `prisma/migrations/20260824084606_add_life_events_and_date_precision`.

Never edit a migration that may already have shipped.

## After the migration applies

- **New table** → add it to `TABLES` in `tests/integration/db.ts`. Forgetting
  this leaks rows between tests and the failures look like anything but the
  cause.
- **Carries `isPrivate`** → invoke the `privacy-check` skill. Both the
  where-fragment and `countPrivateRows` are required; missing the count is
  silent and ships private rows to disk via the service worker.
- **Any new delete path** → sweep `CustomFieldValue`. Its `entityId` points at
  four tables so it is not a foreign key and nothing cascades.
- **Derived contact fields** → never write `Contact.lastInteractionAt` or
  `nextTouchAt` directly. `src/server/services/contact-activity.ts` recomputes
  them from the full interaction history; assigning from the row just written
  makes a backdated log read as "spoke today".
- **Historical dates** → every one carries a `DatePrecision`. Do not
  materialise an unknown month or day.
- **New "type" or category** → a `TaxonomyTerm` row in
  `src/server/taxonomy/defaults.ts`, not an enum, unless code branches on it.
  `runStartupTasks` backfills existing accounts at boot; no migration, no seed.
- **Writes that resolve a place** → go through `transact`
  (`src/server/db/transaction.ts`), never a bare `prisma.$transaction`.
- Update `docs/data-model.md` and add a fragment to `CHANGELOG.d/`.

## Validating it

```bash
npx vitest run tests/integration/<the-suite>.test.ts
npm run verify
```

A migration is only proven by applying it to a database that already holds
rows in the old shape. `npx prisma migrate reset` proves the fresh path only.

Caveat on the local database: the session-start hook installs MariaDB 10.11
(what Ubuntu 24.04 ships); CI and the container run MariaDB 11. The invariant
in CLAUDE.md about a write to a moved row rolling back the *whole* transaction
is 11.6.2 behaviour and will not reproduce locally. Reason about it from the
code, not from a green local run.
