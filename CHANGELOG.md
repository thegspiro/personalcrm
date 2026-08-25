# Changelog

All notable changes to this project are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project will follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from its first tagged release. Nothing has been released yet: `package.json`
reads `0.1.0`, no tag exists, and everything below sits under **Unreleased**.

Work has landed in phases rather than versions, so each phase keeps its own
dated heading. The schema line under each one names the migrations that phase
introduced — see [`docs/data-model.md`](docs/data-model.md#migration-history)
for what each migration does.

---

## [Unreleased]

### Unversioned — 2026-08-25 — documentation and CI

#### Added
- **`docs/`** — architecture, data model, server actions, privacy, configuration,
  deployment and testing. The README had linked to the directory since Phase 1
  and it did not exist.
- **`CLAUDE.md`** and **`CONTRIBUTING.md`** — the commands, the layering, and the
  invariants that have each already been a bug.
- **This changelog.**
- **CI** (`.github/workflows/ci.yml`): typecheck/lint/build, unit and
  integration against a MariaDB service container, end-to-end against the
  standalone bundle on an empty database, and a container build that boots the
  image on an empty volume and restarts it. Local runs had been the only gate.
- A guard that fails the build when the integration suites **skip** rather than
  run. They skip themselves without `TEST_DATABASE_URL`, which in CI would have
  turned a broken service container into a green tick with 83 tests silently not
  run.

#### Fixed
- **`npm run lint` did not work.** `next lint` is deprecated and, with no ESLint
  config on disk, prompted interactively for one — which hangs a CI job rather
  than failing it. Replaced with a flat config and the ESLint CLI.
- Four claims in the README were checked against the code; three were wrong.
  `/config/backups` is created and never written to, so the nightly dump does
  not exist; nothing writes to `/config/uploads` either; and the notification
  tables have no sender. All three are now listed as known gaps.


### Phase 4d — 2026-08-24 — dietary needs, debts, and who reached out

*Schema: `20260824182152_add_dietary_debts_and_reach_out`*

#### Added
- **Dietary needs** on a contact — allergy, intolerance, medical or preference,
  with an optional "carries adrenaline" marker. No severity scale, by design:
  prior mild reactions do not predict future severe ones, so the UI renders two
  groups (must avoid / prefers to avoid) rather than four escalating tiers.
- **Debts** in both directions, for money *or* a lent object. `amountCents` is
  nullable because between neighbours what is lent is usually a drill or a
  casserole dish; items are listed alongside the balance and never folded into
  it. Balances are summarised per currency and never converted. Settling records
  a date rather than deleting the row.
- **Who got in touch** on every interaction (`reachedOutBy`), surfaced in the
  timeline meta row, on the log sheet, and in the backfill panel — where it
  stays sticky between entries.
- **A reciprocity summary** above the timeline, with deliberate floors: no
  summary below 5 attributed interactions, counts only below 10, and never more
  than the last 20 considered. It is the one number here a person might read as
  a verdict on a friendship.

#### Fixed
- **A privacy leak in the gifts list**: gifts for a private contact were
  readable while the lock was closed. Covered by a regression test.

#### Changed
- `countPrivateRows` now includes `Debt`, so a private debt correctly switches
  offline caching off for the account.
- The new tables were added to the integration-test truncation list.

---

### Phase 4c — 2026-08-24 — installable, readable offline, provider-neutral

#### Added
- **A web app manifest and an icon drawn at build time.** `layout.tsx` had
  advertised `/manifest.webmanifest` since Phase 1 with nothing behind it, so
  every page load was fetching a 404. Drawing the icon in code means no PNG to
  keep in sync with the theme and no binary assets in the repository.
- **Offline reading.** Pages you have visited stay readable with no connection.
  Queued writes are deliberately absent: everything non-GET goes straight to the
  network and fails honestly rather than pretending something was saved.
  - Nothing is cached unless a page asks, and a page only asks when the server
    has decided it is safe — the lock is closed, or the account contains nothing
    private at all. One private contact and the whole account stops being
    cacheable.
  - Locking or signing out wipes the cache. A saved copy of a page seen while
    unlocked would make the lock decorative.
  - Every offline page shows how stale it is **to the minute**, and the worker
    is network-first rather than cache-first: a cadence computed from a week-old
    copy will tell you someone is fine when they are not.

#### Changed
- **The optional assisted reading is no longer Anthropic-specific.** An
  OpenAI-compatible endpoint now covers OpenAI, Google's Gemini compatibility
  layer, Open WebUI, Ollama, LM Studio and vLLM; Anthropic keeps a small adapter
  because its request format differs. The vendor SDK was dropped in favour of
  plain `fetch` — shipping one provider's client library would quietly make that
  provider the default.
- A self-hosted endpoint is now a first-class choice: editable address, no key
  required, and connections are tested before they are stored. Responses are
  read forgivingly (fenced, prefaced with prose, wrapped in an array) because
  smaller local models do all three.

#### Fixed
- The privacy E2E spec left its private contact behind, which correctly switched
  offline caching off for the account and failed the next test project for an
  unrelated-looking reason. It cleans up after itself now, and the offline spec
  heals a leftover lock rather than inheriting one.

---

### Phase 4b — 2026-08-24 — quick entry, parsed locally

#### Added
- **Quick add.** Type *"coffee with Sarah yesterday, she got the promotion"* and
  confirm what it understood. Dates come from chrono-node resolved in the
  account's timezone; people are matched against your contacts; the type is
  matched against your own slugs and labels, so a type you renamed or invented
  works like any other. Runs locally with no key, no account and no network, and
  is always on.
- **A command palette** on ⌘K — the app's first global key handler — searching
  people through the same privacy filter as every other read.
- **A thumb-reachable log button** above the bottom bar on the browsing screens.
- **Optional assisted reading, off by default.** With a key and the toggle on,
  a line is *also* sent to a model for a better reading of awkward phrasing.
  Four rules hold it in place: nothing is sent until you switch it on; a line
  naming someone you marked private never leaves the machine, whatever the
  toggle says; nothing is written from a model response; and every failure falls
  back silently to the local reading. The model's answer is run back through the
  local matcher, so an assisted parse cannot do what the local parse refuses to.
- A key pasted in Settings is verified with the provider, then encrypted with
  AES-256-GCM under a key derived from the `authSecret` already in `/config`,
  and never shown again. `ANTHROPIC_API_KEY` remains the preferred path — it
  keeps the key out of the database entirely.

#### Fixed
- **Names two people share are never guessed.** Two relatives called John is not
  an edge case, it is a family. A shared name is surfaced with both candidates
  and saving is blocked until you pick; naming one in full resolves the other by
  elimination. A leftover name the app already knows is never offered as a
  stranger.
- Date extraction ran *before* name matching, so a contact called April, May or
  June would have been swallowed by the date parser and the interaction filed
  against nobody. People are matched first now.

*No schema change: `AppSetting` already existed, and creating a person inline
needed nothing new.*

---

### Phase 4a — 2026-08-24 — custom fields, editable types, arrangeable home

#### Added
- **Custom fields on four entities** — people, dating profiles, interactions and
  individual dates — in eight types, with contact fields scopeable to particular
  categories. The schema landed in Phase 1 and had sat unused; this builds the
  layer above it. On the two quick-entry forms they render collapsed behind a
  disclosure and never block submit.
- **Editable taxonomies in Settings**: labels, colours, icons and order for
  every type list in the app.
- **Home screen arrangement**: toggle, reorder, and tune each widget's row count
  and look-ahead.
- **Appearance and defaults finally reachable** — theme, accent, density,
  default cadence, week start and timezone were all stored and none had a UI.
  Settings is now tabbed: Look, Fields, Types, Home, Privacy.

#### Changed
- Custom-field values are validated server-side in one place, so a `NUMBER`
  field cannot be talked into holding `"banana"`, a `SELECT` cannot take a value
  outside its own list, and a `URL` cannot be a `javascript:` one. A field that
  fails aborts the whole save rather than leaving a record half-written.
- Three taxonomy rules are now enforced rather than documented: a term still in
  use cannot be deleted (turning it off hides it and keeps the records intact),
  a relationship type keeps its reciprocal paired in both directions, and
  `metadata` stays out of reach because family tiers and pipeline ordering are
  read from it by code.

#### Fixed
- **A leak that would have grown forever**: `CustomFieldValue.entityId` is a
  plain string pointing at four different tables, so nothing cascades. Deleting
  a contact, interaction or date left its values behind permanently, where they
  would have turned up in an export. Every delete path now sweeps them, scoped
  by entity type and owner.
- Forms declare which custom-field definitions they rendered, because an
  unchecked checkbox and a field that was never on screen look identical in a
  `FormData` — without the marker, saving from a form that omits custom fields
  would silently clear every boolean on the record.
- Collapsing the custom-field panel keeps its inputs mounted, so typing
  something and then folding it away no longer throws it out.
- The settings list and the home screen disagreed about what the ideas widget is
  called; what you switch off is now unambiguously what disappears.
- Theme buttons rendered with nothing selected until hydration finished.

---

### Family — 2026-08-24 — family, extended family, and relationships that end

*Schema: `20260824130123_add_households`,
`20260824130913_add_family_suggestion_dismissals`*

#### Added
- **A dedicated family area** alongside "Connected people" — grouping fourteen
  relatives in with three coworkers and a landlord buries exactly the thing you
  opened the page to check.
- **Family metadata on relationship types** — `family`, a `tier` (immediate /
  extended / in-law / step / chosen / former), a `generation` offset and a
  stable `role`. Inference and tree banding read the role, so renaming "Parent"
  to "Papá" keeps working and a term you invent simply gets no inference. Seeds
  cover aunts and uncles, nieces and nephews, cousins, in-laws, step and half
  relations, godparents and chosen family.
- **Households** — named groups, not addresses. Adult children, separations,
  lodgers and multi-generation homes all break the shared-address guess, and a
  household is as much "Mum and Dad's place" as it is a postcode.
- **Suggestions that stay suggestions.** Nothing is written without a press;
  each card shows its reasoning and its type stays editable, since the
  correction that matters most (*sibling → half-sibling*) should be one tap.
  Only recorded edges are traversed, so accepting one suggestion cannot cascade
  into a dozen more, and only current blood or marriage roles are paths — step,
  chosen and ended links are endpoints.
- **A `/family` view banded by generation** rather than a drawn pedigree: on a
  phone a drawn tree either scrolls in two directions or shrinks to nothing.
  Bands are measured from an anchor you can change, and anyone with no path to
  it still appears.
- **Dismissed suggestions persist**, held as an unordered pair so a dismissal
  survives whichever way round the suggestion is phrased.

#### Changed
- **Relationships that end are re-typed, never deleted.** A divorce usually does
  not mean you stop knowing the person — often the opposite, if there are
  children — so ending a marriage, an in-law link or a step relation converts
  both halves to their "former" counterparts, keeps the pair and its notes, and
  leaves the person in the family view. Blood relations offer no such control. A
  new marriage sits alongside the old one.
- Existing installs upgrade on boot: taxonomy provisioning adds the new terms
  and backfills metadata onto system terms that predate it, without overwriting
  anything you have set.

#### Fixed
- **A privacy leak**: relationships named the person on the other end, so a
  private relative was readable from an ordinary contact's page while locked.
- Horizontal overflow on contact pages and `/family`. Grid items default to
  `min-width: auto`, so a track constraint alone is not enough — a truncating
  name then sets the page width and, on a phone, pushes buttons off-screen where
  they look visible but cannot be tapped. The layout test now builds a family
  with long names; the previous one only opened a bare contact and never
  rendered a suggestion card.
- Test-harness flakiness: `FOREIGN_KEY_CHECKS` is a session variable, and the
  reset helper could disable it on one pooled connection and truncate on
  another. Latent until two of the new tables referenced each other.
- Per-person accessible names on the suggestion and ended buttons — a column of
  identical "Add" buttons tells a screen-reader user nothing.

---

### Phase 3 — 2026-08-24 — dating module, behind a real lock

*Schema: `20260824115630_add_privacy_lock_and_retrospective`*

#### Added
- **The dating layer**: pipeline, romantic profiles, a date log with ratings,
  green and red flags, a comparison view and a dashboard widget.
- **The secondary PIN lock** guarding all of it, plus anything marked private.
  It is an access gate, not encryption, and the setup screen says so rather than
  implying protection it does not have.
- **A retrospective field** kept separate from the factual reason a
  relationship ended — collapsing the two makes both of them worse.

#### Changed
- **A date is an interaction.** Each one writes an `Interaction` (so it lands in
  the unified timeline beside everything else) plus a `DateEntry`, then runs
  both Phase 2 services: activity is recomputed from full history, and sequences
  are renumbered so a date remembered late slots into where it actually
  happened. Deletion goes through the `Interaction`, which cascades, so the pair
  can never be left half-removed.
- **Nothing is destroyed by a status change.** Converting someone to an ordinary
  contact clears `isRomantic` but keeps their profile, dates, flags and notes.
  The pipeline keys on `isRomantic` rather than on the profile's existence, or
  every ex would drift back into it.
- Unlock state lives on the server session row, never in a cookie, so a client
  cannot claim to be unlocked and the unlock dies with the session.
- Enforcement moved into the query layer, not components: with server components
  a hidden section's rows would already have been fetched and serialised into
  the payload. Filters apply to contacts, facts, interactions, the timeline and
  every dashboard **count** — a total that shifts when you unlock is itself a
  disclosure.
- All nine dating writes re-check the lock rather than trusting that the page
  was gated, and marking something private is refused while locked.

#### Fixed
- Section add-forms stayed open holding stale text after a successful add, so a
  second add appeared to do nothing.
- The new dashboard widget reintroduced the grid overflow the layout spec exists
  to catch.

---

### Phase 2 — 2026-08-24 — core CRM, built for recording the past

*Schema: `20260824084606_add_life_events_and_date_precision`*

#### Added
- Contacts, interactions, facts, important dates, life events, ideas,
  follow-ups, gifts, the people graph, a unified timeline and the dashboard.
- **`LifeEvent` as its own entity**, because interactions assume you were there.
  "Her father died in 2019" is context about them, not something you did
  together, and not something to be reminded of every year.
- **Backfill mode** (`/people/[id]/backfill`) keeps the date and type between
  saves so a run of entries from one period is quick, and lists what was just
  added with undo.
- A layout spec asserting that no route scrolls horizontally.

#### Changed
- **Backdating must not corrupt cadences.** All denormalised activity now flows
  through one service that derives `lastInteractionAt` as `MAX(occurredAt)`
  across a contact's whole history rather than assigning it from the row just
  written; deleting the most recent interaction falls back to the one before it;
  future-dated interactions are excluded. Sixteen integration tests cover it,
  and mutating the implementation two ways confirms they bite.
- **Half-remembered dates stay half-remembered.** `DatePrecision` (`DAY`,
  `MONTH`, `YEAR`, `MONTH_DAY`) replaces two ad-hoc "year unknown" booleans, so
  "she moved to Austin in 2019" renders as 2019 rather than January 1st, which
  would later read as fact. The migration backfills from the old flags before
  dropping them — Prisma's generated diff would have dropped them outright.

#### Fixed
- Inputs inherited `text-sm`, so focusing any field made phones zoom in and
  never zoom back out. The 16px floor now sits outside `@layer` so no utility
  can defeat it.
- A long name pushed pages ~70px wider than the screen: `truncate` only shrinks
  when every flex and grid ancestor carries `min-w-0`, and both default to
  `min-width: auto`. Page columns are now pinned to `minmax(0,1fr)`. That
  overflow also displaced fixed elements enough to make the log sheet's submit
  button visible but unclickable.
- Sheet chrome could lose the flex fight on short viewports and overlap the
  footer.

---

### Phase 1 — 2026-08-24 — foundation

*Schema: `20260824021753_init`*

#### Added
- **The data model** — 26 tables covering contacts with keep-in-touch cadences,
  interactions with multiple participants, facts, important dates, conversation
  ideas, tasks, gifts, and a people graph with automatic reciprocal
  relationships. An optional 1:1 `RomanticProfile` adds the dating layer so
  someone can move between "dating" and "friend" without losing history. Custom
  field definitions and values are polymorphic across entities.
- **Taxonomies instead of enums.** Every "type" in the app is a `TaxonomyTerm`
  row, so interaction types, fact categories, relationship types and dating
  stages are user-editable without a migration. Enums are reserved for states
  the code actually branches on. Starter terms are provisioned per account and
  backfilled on boot, so a later release can add defaults without a manual seed.
- **The container.** Ubuntu LTS base matching the LinuxServer.io images Unraid
  users already run, Node from the official nodejs.org build, MariaDB bundled
  in. s6-overlay orders startup — permissions, database init, database ready,
  migrations, then the app — so pulling a newer image is all an upgrade takes.
  Setting `DATABASE_URL` skips the bundled MariaDB entirely. Secrets are
  generated once into `/config` and reused, so sessions and the database survive
  an image replacement. Ships an Unraid Community Applications template and a
  docker-compose stack for the external-database case.
- **Authentication.** Email and password with bcrypt, database-backed sessions
  in an `httpOnly` cookie with sliding expiry, and a first-run wizard that makes
  the first account the administrator. Login failures are indistinguishable
  between an unknown email and a wrong password.

---

[Unreleased]: https://github.com/thegspiro/personalcrm/commits/main
