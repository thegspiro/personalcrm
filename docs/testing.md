# Testing

Three suites, three different jobs.

| Suite | Runner | Needs | Count | Command |
| --- | --- | --- | --- | --- |
| Unit | Vitest | Nothing | 29 files | `npm test` |
| Integration | Vitest | A throwaway MariaDB | 20 files | `npm test` (skipped without `TEST_DATABASE_URL`) |
| End-to-end | Playwright | A running instance | 23 specs | `npx playwright test` |

File counts are what is in the tree; the case counts move with every change, so
run the suite rather than trusting a number written here.

## Unit tests — `tests/unit/`

Everything in `src/lib/` is pure: no Prisma, no request context, no clock it
does not own. That is what makes these fast and worth writing.

| File | Covers |
| --- | --- |
| `cadence.test.ts` | Overdue / due-soon maths, snoozing, DST |
| `dates.test.ts`, `date-precision.test.ts` | Timezone-anchored calendar maths, partial dates |
| `quick-parse.test.ts` | Reading a typed line into an interaction |
| `reciprocity.test.ts` | Who has been reaching out, and when to say nothing |
| `debts.test.ts`, `dietary.test.ts` | Balances per currency; allergy categories and safe dietary grouping |
| `family-suggestions.test.ts` | Graph inference, and what it refuses to infer |
| `custom-fields.test.ts` | Type coercion and validation |
| `offline.test.ts` | Offline-cacheability rules |
| `preflight.test.ts` | The container's start-up validation |
| `setup-checklist.test.ts` | What the welcome flow considers done |
| `taxonomy-seeds.test.ts` | The seeded default terms |
| `ai-providers.test.ts` | Forgiving response parsing across provider dialects |
| `birthdays.test.ts`, `life-events.test.ts` | Recurring-date projection; milestone ranges over partial dates |
| `reminders.test.ts` | Reminder offsets, timezone boundaries, DST transitions, digest hours, and durable deduplication keys |
| `notification-channels.test.ts` | Per-kind channel validation, and that the test message interpolates nothing |
| `secrets.test.ts` | At-rest encryption, and that the two HKDF purpose strings stay pinned |
| `contact-methods.test.ts` | Turning a stored number or handle into a link worth offering |
| `locations.test.ts` | Matching a typed venue to a place already recorded |
| `plan-checklist.test.ts` | The validated JSON checklist on a plan |
| `privacy-where.test.ts`, `privacy-lock.test.ts` | The where-fragments themselves, and the lock's timing constants |
| `security-headers.test.ts` | The response headers the app sets, and the one it leaves to the proxy |
| `service-worker.test.ts` | That `public/sw.js` parses as a classic script |
| `migrations.test.ts` | That every migration on disk is accounted for |
| `geo-providers.test.ts` | Reading an address-lookup reply across provider dialects |
| `ai-quick-add.test.ts` | That an assisted parse cannot do what the local one refuses to |

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
- `quick-add.test.ts`, `phase4d.test.ts`, `plans.test.ts` — the newer write paths.
- `interactions.test.ts` — editing something already logged: that the type and
  the people are re-checked against the account, that a dropped participant is
  recomputed too, and that a closed lock refuses the edit as firmly as the read.
- `locations.test.ts` — that a place is a second route to a visit and so a
  second way to leak one: the closed lock withholds a private visit and a
  visit with a private participant, the free text each row was written with
  survives beside the canonical id, and two accounts naming the same café keep
  two rows.
- `entry-editing.test.ts` — the same for everything else that hangs off a
  person: that an `update*` writes the whole form rather than patching it, that
  the state changes it deliberately leaves alone stay put (a gift's status, a
  debt's settlement, a task's tick), that a private fact or debt is out of
  reach while the lock is closed, and that re-typing a relationship moves both
  halves of the pair.
- `contact-methods.test.ts` — phone numbers and addresses, which carry no
  `ownerId` of their own: that ownership and the lock are enforced through the
  contact, that exactly one method stays primary, and that searching for a
  private contact's number finds nothing while the lock is closed.
- `notifications.test.ts` — that a channel credential is stored encrypted and
  never reaches the browser, that a blank field keeps the stored one, and that
  a secret which will not decrypt refuses to send rather than going out without
  it.
- `reminders.test.ts` — all four delivery policies; retries and cancellation after
  task/privacy changes; owner isolation; multiple channels; and both encrypted
  and legacy plaintext channel shapes reaching the network with credentials.
- `privacy-actions.test.ts`, `privacy-pin.test.ts` — disabling the lock, and
  the shared backoff that separate sessions cannot race around.
- `reciprocity.test.ts` — the reaching-out ratio against real interaction rows.
- `geo-settings.test.ts`, `ai-settings.test.ts` — that the two settings stored
  per installation rather than per owner are only writable by an `ADMIN`, and
  that a refusal leaves the stored value alone.
- `settings-counts.test.ts` — the aggregates on a page the lock does not gate:
  that every usage total and custom-field count is filtered by the same scope
  as the rows behind it, that a life event naming a private participant is
  excluded even though its anchor contact is public, that dating taxonomies
  report nothing at all rather than a filtered number, and that refusing to
  delete a term in use does not quote a count while locked.

`interactions.test.ts` and `entry-editing.test.ts` call the server actions
themselves rather than reproducing their steps. That needs `server-only` neutralised — `vitest.config.ts` aliases it
to the same empty module Next resolves it to on the server — plus stubs for the
request context, the privacy lock, and `next/cache`.

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

`edit-interaction.spec.ts` walks the loop quick add opens: type a line with a
possessive in it, check the person survives into the title, then correct that
title from the timeline. It is the only spec that exercises `updateInteraction`
through the UI.

`edit-entries.spec.ts` does the same for the contact page's sections — add
something, get it wrong, fix it in place — and checks the fixes that are easy
to get wrong from the server side alone: that the edit form opens holding the
record, that a debt turns round, and that a dietary preference can become the
allergy it turned out to be.

`locations.spec.ts` walks the only way a place is actually created — logging a
visit with a venue — then adds a second person to that visit from the timeline
and reads the place back, so the aggregation is exercised across participants
rather than echoing whoever logged it.

`contact-methods.spec.ts` records a number and an email, presses the resulting
`tel:` and `mailto:` links into existence, and moves the primary from one to
the other — the header chip has to follow, since a primary nothing points at is
the state that made this look broken before.

`notifications.spec.ts` adds a channel, edits it without retyping its token,
switches it off and deletes it. Its test-send deliberately points at a port
nothing listens on: a spec that needed a reachable endpoint would be a spec
that fails on a plane.

### Specs that must clean up after themselves

`privacy.spec.ts` creates a private contact. Leaving one behind correctly
switches offline caching off **for the whole account**, which then fails the
next project for a reason that has nothing to do with it. It cleans up, and
`offline.spec.ts` heals a leftover lock rather than inheriting one.

## Running everything

```bash
npm run verify                        # everything below, in CI's order
npx playwright test                   # against a running instance
```

`verify` is:

```bash
npm run typecheck                     # tsc --noEmit
npm run lint                          # eslint .
npm run lint:sw                       # public/sw.js parses as a classic script
npm run changelog:check               # CHANGELOG.d/ entries are well formed
npm run changelog:guard               # CHANGELOG.md itself was not hand-edited
npm test                              # unit + integration
npm run build                         # production build
```

These are what a change is expected to pass locally before it is pushed; CI
runs the same set on every pull request. Run them individually when a failure
needs isolating — `verify` stops at the first one that fails.

**One `tsc` error usually looks like three broken jobs.** `next build`
typechecks, and the end-to-end and container jobs both build before they do
anything else, so a single missing import fails Typecheck, End-to-end and
Container build together. Read the typecheck output first; the other two
usually have nothing of their own wrong with them.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every pull
request, on pushes to `main`, and on demand. Four jobs, all independent:

| Job | Does | Why it exists |
| --- | --- | --- |
| **Typecheck, lint, build** | `tsc --noEmit`, `eslint .`, the service-worker parse check, the changelog-entry check, `next build` | The cheapest signal, so it does not queue behind a database |
| **Unit and integration tests** | Vitest against a MariaDB service container | The suites that need a real database |
| **End-to-end tests** | Playwright against the **standalone bundle**, on an empty database | What actually ships, not `next dev` |
| **Container build and boot** | Builds the image, boots it on an empty volume, restarts it | The container is the product |

Three details worth knowing before editing the workflow:

**The integration suites must not pass vacuously.** They skip themselves when
`TEST_DATABASE_URL` is missing — deliberately, so a developer without a spare
database is not blocked. In CI that same behaviour would turn a broken service
container into a green tick with 83 tests silently not run. The test job writes
the JSON reporter output and
[`assert-integration-ran.mjs`](../.github/scripts/assert-integration-ran.mjs)
fails the build if any of them skipped.

**Lint is only enforced here.** `next.config.ts` sets
`eslint.ignoreDuringBuilds`, so a build never fails on lint. The lint job is the
only thing between a lint error and `main`.

**The service worker is checked separately because nothing else checks it.**
`eslint.config.mjs` ignores `public/sw.js` and it is not TypeScript, so
`npm run lint:sw` is its only static gate. A merge once put two
`let cachingEnabled` declarations in it: the worker was a `SyntaxError`, so it
never installed and offline reading stopped working, and the eight-minute
end-to-end job was the first thing to notice. The check notices in about fifty
milliseconds.

It compiles the file with **classic-script** grammar via `vm.Script` rather
than running `node --check`. Those are not the same test here: `package.json`
declares `"type": "module"`, so `node --check` parses `public/sw.js` as a module
and accepts `import`, `export` and top-level `await` — none of which a classic
worker can run, and both registrations of the file (`offline.tsx` and
`offline.spec.ts`) omit `{ type: "module" }`. A gate that accepts syntax the
browser rejects is worse than no gate, because it gets trusted.

**The E2E job runs the standalone bundle.** `npm run build` produces
`.next/standalone`, and the workflow copies `public/` and `.next/static` into it
exactly as the Dockerfile does, then runs `node .next/standalone/server.js`.
Testing `next dev` would skip the tracing step that has its own failure modes.

The container job boots the image on an empty volume and then restarts it —
which is the pair of things every phase has verified by hand: a first boot that
generates secrets, initialises MariaDB under `/config/db` and applies every
migration, and a restart that reuses both rather than starting over.

### Lint findings that are warnings, not errors

`eslint-config-next` 16 ships the React Compiler rule set, and three of its
rules flag patterns this codebase uses on purpose. They are set to `warn` in
[`eslint.config.mjs`](../eslint.config.mjs), with the reasoning next to them, so
that lint is a gate that can actually be enforced rather than one permanently
red:

- `react-hooks/set-state-in-effect` — the `mounted` pattern behind theme-aware
  controls. The theme is only known after hydration.
- `react-hooks/purity` — `Date.now()` in a client component rendering a
  relative day count.
- `react-hooks/immutability` — writing `document.documentElement.dataset` so an
  accent change shows before the action returns.

Everything else, `react-hooks/rules-of-hooks` included, fails the build.

## What a change is expected to bring with it

| Change | Test it needs |
| --- | --- |
| Anything in `src/lib/` | A unit test — that is why the module is pure |
| A new table | An entry in the integration `TABLES` list |
| An `isPrivate` column | A line in `countPrivateRows`, plus privacy coverage |
| A new write path | Integration coverage that the denormalised activity fields survive backdating and deletion |
| A new page or widget | It must appear in `layout.spec.ts`'s route sweep |
| Anything user-visible | An entry in [`CHANGELOG.d/`](../CHANGELOG.d/README.md) |
| A merge of `main` into the branch | The whole set again, on the merged tree — see [CONTRIBUTING.md](../CONTRIBUTING.md#merging-main-into-a-long-lived-branch) |
