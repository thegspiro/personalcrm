# Testing

Three suites, three different jobs.

| Suite | Runner | Needs | Count | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest | Nothing | 190 cases, 11 files | `npm test` |
| Integration | Vitest | A throwaway MariaDB | 83 cases, 7 files | `npm test` (skipped without `TEST_DATABASE_URL`) |
| End-to-end | Playwright | A running instance | 76 cases, 12 specs | `npx playwright test` |

Counts are the test cases in the tree at the time of writing — treat them as a
scale, not a contract.

## Unit tests — `tests/unit/`

Everything in `src/lib/` is pure: no Prisma, no request context, no clock it
does not own. That is what makes these fast and worth writing.

| File | Covers |
| --- | --- |
| `cadence.test.ts` | Overdue / due-soon maths, snoozing, DST |
| `dates.test.ts`, `date-precision.test.ts` | Timezone-anchored calendar maths, partial dates |
| `quick-parse.test.ts` | Reading a typed line into an interaction |
| `reciprocity.test.ts` | Who has been reaching out, and when to say nothing |
| `debts.test.ts`, `dietary.test.ts` | Balances per currency; must-avoid grouping |
| `family-suggestions.test.ts` | Graph inference, and what it refuses to infer |
| `custom-fields.test.ts` | Type coercion and validation |
| `offline.test.ts` | Offline-cacheability rules |
| `ai-providers.test.ts` | Forgiving response parsing across provider dialects |

The date-sensitive suites run against a **fixed clock**, and the timezone-aware
ones assert in a zone that is not UTC — a DST bug in `snoozeUntil` that
millisecond arithmetic hid is the reason.

## Integration tests — `tests/integration/`

Run against a real MariaDB, because the things they check are things Prisma and
the schema do, not things a mock can:

- `contact-activity.test.ts` — that backdating never reads as "spoke today",
  and that deleting the newest interaction falls back correctly.
- `privacy.test.ts` — that locked rows never come back from a query, counts
  included.
- `family.test.ts` — reciprocal pairs, ending a link, dismissals.
- `dating.test.ts` — the Interaction/DateEntry pair and sequence renumbering.
- `custom-fields.test.ts` — server-side validation and the delete sweep.
- `quick-add.test.ts`, `phase4d.test.ts` — the newer write paths.

### Setting one up

```bash
# any MariaDB you can reach; the database name MUST end in _test
TEST_DATABASE_URL="mysql://user:pass@127.0.0.1:3306/personalcrm_test"
```

Put it in `.env` — `tests/setup-env.ts` loads that file so nobody has to export
it by hand. Without the variable the integration suites skip; they never fall
back to `DATABASE_URL`.

Two guards worth knowing about:

- **The URL must name a database ending in `_test`.** `tests/integration/db.ts`
  throws otherwise, because `reset()` truncates every table.
- **`fileParallelism` is off.** The suites share one database, so they must not
  run concurrently.

`TABLES` in `tests/integration/db.ts` is the truncation list. **Every new table
has to be added to it** — a missing entry leaks rows between tests and produces
failures that look like anything except the real cause.

## End-to-end tests — `tests/e2e/`

Playwright against an **already-running** instance, so the same suite points at
`next start` locally or at the built container.

```bash
E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test
```

Three projects, run in order:

| Project | Viewport | Notes |
| --- | --- | --- |
| `first-run` | Desktop | Creates the account every other project signs in with |
| `mobile` | iPhone 13 | **Mobile first** — the primary flows are verified at phone width |
| `desktop` | 1440×900 | |

`fullyParallel: false`, one worker: the suite shares one instance and one
account, so it must not race itself.

`layout.spec.ts` is not a feature spec — it asserts that **no route scrolls
horizontally**, ignoring content that legitimately scrolls inside its own
container. Horizontal overflow on a phone pushes buttons off-screen where they
look tappable and are not, and it has recurred often enough to earn a permanent
test.

### Specs that must clean up after themselves

`privacy.spec.ts` creates a private contact. Leaving one behind correctly
switches offline caching off **for the whole account**, which then fails the
next project for a reason that has nothing to do with it. It cleans up, and
`offline.spec.ts` heals a leftover lock rather than inheriting one.

## Running everything

```bash
npm run typecheck                     # tsc --noEmit
npm test                              # unit + integration
npm run build                         # production build
npx playwright test                   # against a running instance
```

There is no CI workflow in the repository yet — these are what a change is
expected to pass locally before it is pushed.

## What a change is expected to bring with it

| Change | Test it needs |
| --- | --- |
| Anything in `src/lib/` | A unit test — that is why the module is pure |
| A new table | An entry in the integration `TABLES` list |
| An `isPrivate` column | A line in `countPrivateRows`, plus privacy coverage |
| A new write path | Integration coverage that the denormalised activity fields survive backdating and deletion |
| A new page or widget | It must appear in `layout.spec.ts`'s route sweep |
