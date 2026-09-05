# Data model

Every table in the database, what it holds, and the rules that are enforced in
schema rather than in prose.

- **Engine:** MariaDB (Prisma `mysql` provider), `utf8mb4`
- **Source of truth:** [`prisma/schema.prisma`](../prisma/schema.prisma)
- **Tables:** 37 · **Enums:** 21 · **Migrations:** 22
- **Primary keys:** `cuid()` strings unless the table is a join table (composite)
  or a per-user singleton (`UserPreference`, `DashboardLayout` key on `userId`).

## The four rules the schema is built on

1. **Everything user-owned carries `ownerId`.** Multi-user instances share one
   database, so every top-level table is scoped by owner. A row that hangs off
   exactly one parent — a contact method, an address — is scoped through it and
   carries no copy. A row that names *two* parents does carry one, because two
   independent keys can otherwise be made to disagree about the owner: see
   [Same-owner foreign keys](#same-owner-foreign-keys).
2. **Anything renameable is a `TaxonomyTerm` row, never an enum.** Interaction
   types, fact categories, relationship types, dating stages and the rest are
   data. Enums are reserved for states the application code itself branches on
   — you cannot add a value to `DatePrecision` without writing code to handle it.
3. **Nothing is destroyed by a status change.** Ending a relationship re-types
   it, settling a debt records a date, converting a date to a friend clears a
   flag. Deletion is always an explicit delete.
4. **Partial knowledge stays partial.** `DatePrecision` on every historical date
   means "she moved in 2019" is stored as 2019 and rendered as 2019, not as
   January 1st that later reads as fact.

## Same-owner foreign keys

A table that carries `ownerId` and points at a `Contact`, `Tag` or `Location`
has two facts about ownership that say nothing about one another. A key naming
only `Contact(id)` lets a row belonging to one account hang off another
account's person — the application never writes one, but an import, a restore
or a hand repair can, and every reader then has to remember an owner predicate
to exclude it. Forgetting the predicate in one place is a cross-account
disclosure.

So `Contact`, `Tag` and `Location` each carry a `@@unique([ownerId, id])`, and
every foreign key into them names both columns: `(ownerId, contactId)` →
`Contact(ownerId, id)`, and so on. The two owners become literally the same
column, and the mismatch has nowhere to live.

Every relation into `Contact` uses this shape — `Relationship` (both ends),
`Fact`, `ImportantDate`, `LifeEvent`, `FamilySuggestionDismissal` (both ends),
`Idea`, `Task`, `Happening`, `Gift`, `Debt`, `DietaryNeed`, `RomanticProfile`,
`DateEntry`, `Plan`, `Flag` and `ContactTag` — along with `ContactTag` → `Tag`
and `LocationAlias` → `Location`.

The four join tables that name a contact and something else —
`InteractionParticipant`, `InteractionMention`, `LifeEventParticipant` and
`HouseholdMember` — carry an `ownerId` of their own for exactly this purpose,
backfilled from their parent, and key on it from both sides:
`(ownerId, interactionId)` → `Interaction(ownerId, id)` and
`(ownerId, contactId)` → `Contact(ownerId, id)`. They are the one place the
"scoped through the parent" rule does not apply, because there are two parents
and nothing else makes them agree. `Interaction`, `LifeEvent` and `Household`
each gained the `@@unique([ownerId, id])` those keys point at.

**Two exceptions, for a reason MariaDB imposes.** `Interaction.place` and
`Plan.place` are `ON DELETE SET NULL`, and MariaDB refuses a `SET NULL` foreign
key unless every column in it is nullable; `ownerId` is not, and making it
nullable would cost the guarantee the key exists to give. Those two keep an
explicit owner predicate in code instead — `src/server/services/locations.ts`
on the write path, and on the read every query that returns the place:
`src/server/queries/timeline.ts`, where it is both searched and rendered, and
`src/server/queries/dating.ts`, which reads a logged date's venue through its
interaction. Prisma takes no `where` on a to-one `include`, so both select the
place's `ownerId` and drop a mismatch in the mapper rather than filtering in the
query. **Any future reader of `place` owes the same check** — it is the one
reference in the schema the database will not make for you.

**This does not make the readers' predicates redundant.** `mariadb-dump` writes
`SET FOREIGN_KEY_CHECKS=0`, so restoring a dump taken before these keys existed
can still load a cross-owner row — the constraint governs what the application
and ordinary writes can do, not what a restore can carry in. The integration
suite creates such rows through that same route (`asARestoreWould`) to keep the
readers honest.

**The upgrade repairs rather than refuses.** Adding the constraint first would
abort the upgrade on precisely the installation that needs it, so
`20260904120000_same_owner_contact_keys` clears the mismatches first. Each
repair asks the constraint's own question — is there a `Contact` with this
owner and this id — rather than whether two owners disagree: the restore that
motivates all of this can equally leave a `contactId` pointing at nothing, that
row fails the new key just the same, and a join between the two tables would
skip it. Where the
link is required the row goes; where it is optional — an idea, a task, a plan,
a place — only the link is cleared, because the owner wrote that text and
deleting their note to fix our key is the wrong trade. Deleting a record takes
its `CustomFieldValue` rows with it: `entityId` points at four tables and is
therefore not a foreign key, so nothing cascades and every delete path,
including this one, sweeps them by hand. The counts are left in `AppSetting`
and said once in the boot log by `runStartupTasks`, so nothing is removed
silently.

---

## Accounts and auth

### `User`

The account. The first one created by the first-run wizard is `ADMIN`.

> The role is a label only. Nothing in the app checks it, so an administrator
> has no powers a member lacks — see [first-run.md](first-run.md#adding-other-people-to-the-instance).

| Column | Type | Notes |
| ------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| `id` | `cuid` | PK |
| `email` | `varchar(191)` | Unique |
| `name` | `varchar(191)` | |
| `passwordHash` | `varchar(255)` | bcrypt |
| `role` | `UserRole` | `ADMIN` \| `MEMBER`, default `MEMBER` |
| `isActive` | `bool` | Default `true`; an inactive user's sessions stop resolving |
| `privacyPinHash` | `varchar(255)?` | The secondary lock. Deliberately a **different** secret from `passwordHash` |
| `privacyPinFailedCount` | `int` | Backoff counter |
| `privacyPinFailedAt` | `datetime?` | Backoff anchor — on the user, not the session, so clearing cookies does not reset a lockout |
| `createdAt` / `updatedAt` | `datetime` | |

Every owned table cascades from here: deleting a user deletes their entire
dataset.

### `Session`

Database-backed sessions. The cookie (`pcrm_session`) holds a random 32-byte
token; only its SHA-256 hash is stored.

| Column | Type | Notes |
| ------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` | `cuid` | PK |
| `userId` | `cuid` | → `User`, cascade |
| `tokenHash` | `varchar(191)` | Unique |
| `expiresAt` | `datetime` | 30-day TTL, refreshed once 75% used (sliding expiry) |
| `createdAt` | `datetime` | |
| `userAgent` | `varchar(255)?` | |
| `ip` | `varchar(64)?` | |
| `privacyUnlockedAt` | `datetime?` | When the privacy lock was last opened **on this session**. Server-side so a client cannot claim to be unlocked, and so unlock state dies with the session |

Indexes: `userId`, `expiresAt` (the expiry sweep at boot).

### `UserPreference`

One row per user, PK is `userId`.

| Column | Type | Default | Notes |
| ----------------------- | ------------- | ------------------ | ------------------------------------------------------------------ |
| `theme` | `varchar(16)` | `system` | |
| `accent` | `varchar(24)` | `violet` | |
| `density` | `varchar(16)` | `comfortable` | |
| `timezone` | `varchar(64)` | `America/New_York` | **Every** date calculation anchors here, never to `process.env.TZ` |
| `weekStartsOn` | `int` | `0` | |
| `defaultCadenceDays` | `int?` | — | Fallback keep-in-touch cadence |
| `digestHour` | `int` | `8` | Local hour after which the hourly scheduler sends that day's digest |
| `digestEnabled` | `bool` | `true` | Enables one daily digest per configured channel |
| `privacyLockEnabled` | `bool` | `false` | The lock switch |
| `hideDating` | `bool` | `false` | Removes the dating module from nav and dashboard entirely |
| `blurPrivateNotes`      | `bool`        | `true`             | Shoulder-surfing layer _after_ the lock is open                    |
| `onboardingCompletedAt` | `datetime?` | — | When the welcome flow was finished or skipped |
| `homeAddress` / `homeCity` / `homeRegion` / `homeCountry` | `varchar(500)?` / `varchar(120)?` ×3 | — | Where you are, for the lookup to search and for the row to be recognisable |
| `homeLatitude` / `homeLongitude` | `decimal(10,7)?` | — | The only load-bearing half. A pair or nothing |
| `distanceUnit` | `varchar(8)` | `mi` | `mi` or `km`. Matches the other shipped defaults rather than guessing |

Your home base lives here rather than in `Location` deliberately: a home is the
point distances are counted from, not a venue with a history, and putting it in
the places list would file your own house among the restaurants. Everything is
optional — an account that sets none of it never sees a distance anywhere, which
is how every installation reads the day it upgrades.

### `AppSetting`

Instance-wide key/value store (`key` PK, `value` JSON). Used for first-run
completion state and the optional AI settings (`ai.enabled`, `ai.provider`,
`ai.baseUrl`, `ai.model`, `ai.apiKey` — the last encrypted, see
[Privacy and data flow](privacy.md#optional-assisted-reading)).

---

## Taxonomies

### `TaxonomyTerm`

Backs every "type" field in the app. Renaming, recolouring, reordering or
adding a type is a row edit, not a migration.

| Column | Type | Notes |
| --------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| `id` | `cuid` | PK |
| `ownerId` | `cuid` | → `User`, cascade |
| `kind` | `TaxonomyKind` | Which list this term belongs to |
| `slug` | `varchar(96)` | Stable key; unique per `(ownerId, kind)` |
| `label` | `varchar(96)` | What you see |
| `icon` | `varchar(64)?` | |
| `color` | `varchar(24)?` | |
| `sortOrder` | `int` | |
| `isSystem` | `bool` | Seeded default. Still renameable; protects the seed contract |
| `isActive` | `bool` | Turning a term **off** is the supported alternative to deleting one still in use |
| `metadata` | `json?` | Read by code — family `tier`/`role`/`generation`, pipeline ordering. Not user-editable for that reason |
| `inverseTermId` | `cuid?` | Self-relation: the reciprocal term (parent ↔ child, spouse ↔ spouse) |

Unique: `(ownerId, kind, slug)`. Indexes: `(ownerId, kind, sortOrder)`,
`inverseTermId`.

`TaxonomyKind` values (12 shown in Settings, plus `PLAN_CATEGORY`):

| Kind | What it names |
| --------------------- | ---------------------------------------------------------------- |
| `CONTACT_CATEGORY` | How you group people |
| `INTERACTION_TYPE` | The kinds of moments you log |
| `FACT_CATEGORY` | How things you know are grouped |
| `DATE_TYPE` | Birthdays, anniversaries, … |
| `RELATIONSHIP_TYPE` | How people connect (carries family metadata) |
| `CONTACT_METHOD_TYPE` | Phone, email, social handles |
| `MEETING_SOURCE` | Where you met someone, dating apps included |
| `GIFT_OCCASION` | Why a gift was given |
| `LIFE_EVENT_TYPE` | Significant moments: life changes, milestones, and memories |
| `DATING_STAGE` | The columns of the dating pipeline |
| `DATE_ACTIVITY_TYPE` | What you did on a date |
| `PLAN_CATEGORY` | Kinds of thing to do — a place, a film, a show, something to try |
| `HAPPENING_TYPE` | What someone has on — a trip, a deadline, visitors staying |

Defaults live in [`src/server/taxonomy/defaults.ts`](../src/server/taxonomy/defaults.ts)
and are provisioned per account at signup **and backfilled on every boot**, so a
release can add a default term without anyone running a seed script.

A term still referenced by rows cannot be deleted — the foreign keys would
either null the reference or cascade the record away. `isActive = false` is the
enforced alternative.

---

## People

### `Contact`

The centre of the model.

| Column | Type | Notes |
| ----------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `id` / `ownerId` | `cuid` | |
| `firstName` | `varchar(120)` | The only required name field |
| `lastName` / `nickname` | `varchar(120)?` | |
| `pronouns` | `varchar(48)?` | |
| `avatarPath` | `varchar(255)?` | Authenticated `/api/avatars/<server-name>` URL. The bytes live in `UPLOADS_DIR`, outside the public tree; ownership and the live privacy lock are checked on every read and write |
| `categoryId` | `cuid?` | → `TaxonomyTerm` (`CONTACT_CATEGORY`), `SET NULL` |
| `birthDate` | `date?` | |
| `birthDatePrecision` | `DatePrecision` | `MONTH_DAY` covers the birthday whose year nobody remembers |
| `howWeMet` | `text?` | |
| `whereWeMet` | `varchar(191)?` | |
| `metOn` / `metOnPrecision` | `date?` / `DatePrecision` | |
| `meetingSourceId` | `cuid?` | → `TaxonomyTerm` (`MEETING_SOURCE`), `SET NULL` |
| `occupation` / `employer` | `varchar(191)?` | |
| `city` / `region` / `country` | `varchar(120)?` | |
| `timezone` | `varchar(64)?` | Theirs, not yours |
| `summary` | `text?` | |
| `isFavorite` | `bool` | |
| `isArchived` | `bool` | Out of the lists, still in the data |
| `isRomantic` | `bool` | Drives the dating pipeline. Keyed on this rather than on the profile's existence, so an ex does not drift back in |
| `isPrivate` | `bool` | Hidden everywhere until the privacy lock is opened |
| `cadenceDays` | `int?` | Keep-in-touch cadence. Null = not tracked |
| `snoozedUntil` | `datetime?` | |
| `lastInteractionAt` | `datetime?` | **Denormalised.** Written only by `contact-activity.ts`, always as `MAX(occurredAt)` over full history |
| `nextTouchAt` | `datetime?` | Derived from the two above |

Indexes: `(ownerId, isArchived, lastName)`, `(ownerId, isArchived, firstName)`,
`(ownerId, nextTouchAt)`, `(ownerId, isRomantic, isArchived)`, `categoryId`,
`meetingSourceId`.

> The denormalised activity fields are the one place the schema can lie. See
> [`contact-activity.ts`](../src/server/services/contact-activity.ts): backdating
> an interaction must never read as "spoke today", and deleting the newest
> interaction must fall back to the one before it. Future-dated interactions are
> excluded — a planned dinner is not something you have done.

### `ContactMethod`

Phone numbers, emails, handles. `contactId` (cascade), `typeId` →
`CONTACT_METHOD_TYPE` (`SET NULL`), `value`, `label`, `isPrimary`, `sortOrder`.

`value` is stored exactly as it was typed, trimmed and nothing else. Nothing
normalises a number to E.164, because doing so has to guess a country the user
never supplied — the same class of invented certainty `DatePrecision` exists to
prevent. The consequence is that search matches the stored string: someone
filed as `+1 (555) 010-4477` is not found by typing `5550104477`.

`isPrimary` is set through its own action, which clears the flag on the
contact's other methods in the same transaction. MariaDB has no partial unique
index, so "exactly one primary" is only as true as that transaction — there is
no constraint behind it.

No `ownerId` and no `isPrivate`: it exists only beneath a contact, and a phone
number is not separately hideable from the person it belongs to. Ownership and
the privacy lock are therefore enforced on the _contact_ in every action, which
is why each one looks the row up through `contact: { ownerId, ...
contactPrivacyWhere(scope) }` rather than by id alone.

### `Address`

`contactId` (cascade), `label`, `line1`, `line2`, `city`, `region`,
`postalCode`, `country`, `notes`. Every part is optional, but at least one of
the address lines has to be filled in — a row with only a label renders as
nothing but a delete button.

`label` is deliberately free text rather than a taxonomy: an `ADDRESS_TYPE`
kind would need an enum migration, defaults, a usage count and an admin group
to replace a field whose realistic values are "Home" and "Work". The form
offers a `<datalist>` of suggestions instead.

`latitude`/`longitude` (`DECIMAL(10,7)`) and `osmType`/`osmId` place the
address, and are the same columns with the same meaning as on
[`Location`](#location) — one point reader, `pointOf` in `src/lib/geo.ts`,
serves every table that holds a pair. Stored as a whole pair or not at all;
`addressFields` refuses half of one out loud rather than dropping it, because
whoever typed a latitude meant to place the address. The OSM reference is kept
only while the coordinates it arrived with are still there: `mapLinkFor` prefers
it, so a reference outliving its coordinates would open the venue the address
used to be.

An address is placed either by the optional [address lookup](#location) or by
hand. By hand is the **only** route for a private contact — see
[privacy](privacy.md). A person's home deliberately does not become a
`Location`: places are a reusable list of venues with histories, and somebody's
house is not one.

Same privacy shape as `ContactMethod` — no `ownerId`, no `isPrivate`, scoped
through the contact.

### `Tag` / `ContactTag`

Free-form labels. `Tag` is unique per `(ownerId, slug)`; `ContactTag` is the
join table with composite PK `(contactId, tagId)`, cascading from both sides.

`ContactTag` also carries `ownerId`, and both its foreign keys include it —
`(ownerId, contactId)` → `Contact(ownerId, id)` and `(ownerId, tagId)` →
`Tag(ownerId, id)`, so a row cannot pair one account's person with another
account's tag. See [Same-owner foreign keys](#same-owner-foreign-keys) for why,
and for why the readers still check.

Names normalize to lowercase ASCII hyphenated slugs. Renaming preserves assignments;
merging deduplicates assignments into the destination before deleting the source; deleting
a tag removes only join rows, never contacts. All operations are owner-scoped. While the
privacy lock is closed, private-only tags are omitted and counts include visible contacts only.

### `Relationship`

The people graph. **Reciprocal rows are always created in pairs.**

| Column | Type | Notes |
| ------------------------------- | ------------- | --------------------------------------------------------------------------- |
| `ownerId` | `cuid` | |
| `fromContactId` / `toContactId` | `cuid` | Both cascade |
| `typeId` | `cuid` | → `TaxonomyTerm` (`RELATIONSHIP_TYPE`), **cascade** |
| `notes` | `text?` | |
| `pairId` | `varchar(32)` | Shared by the two halves so they are created, re-typed and removed together |

Unique: `(fromContactId, toContactId, typeId)`. Indexed on `ownerId`,
`toContactId`, `typeId`, `pairId`.

Family semantics are read from `TaxonomyTerm.metadata`, never inferred from the
slug — so renaming "Parent" to "Papá" keeps inference working:

- `family: true`
- `tier`: `immediate` | `extended` | `inlaw` | `step` | `chosen` | `former`
- `generation`: integer offset, used for the banding on `/family`
- `role`: a stable key (`spouse`, `parent`, `child`, `sibling`, …) that
  inference and tree building match on

A relationship that ends is **re-typed to its `former` counterpart**, keeping
`pairId`, notes and both people in the family view. Blood relations offer no
such control: a sibling does not stop being one.

---

## Activity

### `Interaction`

Something you did with someone. Multi-participant by design.

| Column | Type | Notes |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ownerId` | `cuid` | |
| `typeId` | `cuid?` | → `INTERACTION_TYPE`, `SET NULL` |
| `occurredAt` | `datetime` | Backdating is a first-class case |
| `durationMinutes` | `int?` | |
| `title` | `varchar(191)?` | |
| `notes` | `text?` | |
| `sentiment` | `int?` | −2 rough … 0 neutral … +2 great |
| `reachedOutBy` | `ReachedOutBy` | `UNSPECIFIED` \| `ME` \| `THEM` \| `MUTUAL`. Defaults to `UNSPECIFIED` so rows predating the column count as unknown rather than being attributed to whoever the default would name |
| `location` | `varchar(191)?` | |
| `isPrivate` | `bool` | |

Indexes: `(ownerId, occurredAt)`, `typeId`.

### `InteractionParticipant`

Join table, PK `(interactionId, contactId)`, cascading from both. An
interaction is withheld while locked if it is itself private **or** any
participant is.

Carries an `ownerId` backfilled from the interaction, and both keys name it —
`(ownerId, interactionId)` and `(ownerId, contactId)` — so a row cannot file
one account's interaction against another account's person. See
[Same-owner foreign keys](#same-owner-foreign-keys).

### `InteractionMention`

Join table, PK `(interactionId, contactId)`, for someone discussed but not
present. A mention makes the interaction discoverable from that person's
history without advancing their contact cadence. Private mentioned contacts
withhold the interaction while the lock is closed, just like participants.
Same-owner keyed on `ownerId` exactly as `InteractionParticipant` is.

### `Location`

An owner-scoped reusable place shared by interactions and plans. `name` is the
display label and `(ownerId, normalizedName)` is unique; normalization only
folds case and whitespace so similarly named real-world venues are never
silently merged. `address`, `city`, `region`, `country`, `phone`, `url` and
`notes` are the practical details, written through
[`actions/locations.ts`](server-actions.md#places--actionslocationsts);
`isArchived` takes a place out of the lists while its page and history stay
reachable. `Interaction.location` and `Plan.location` retain the exact
historical text while their optional `locationId` points at the canonical place
(`SET NULL`) — a rename never rewrites what was typed at the time.

`osmType` (`N`/`W`/`R`) and `osmId` record the OpenStreetMap object an optional
address lookup matched, and are written only by that lookup. Deliberately
_not_ Nominatim's own `place_id`: that is internal to a single instance and does
not survive a reimport, so it would decay into a reference to nothing. `osmId`
is a `BIGINT` because OSM ids are past 2^32. `latitude`/`longitude` come from
the same lookup and are stored as a pair or not at all — half a pair places
somewhere confidently wrong. Aliases live in owner-scoped `LocationAlias` rows.
Each stores the entered `value`, its case-and-whitespace-folded
`normalizedValue`, and whether it is the canonical name. `(ownerId,
normalizedValue)` is unique, so two places in one account cannot claim the same
spelling while different owners remain isolated. The alias references
`Location(ownerId, id)`, so its owner and its location's are the same column and
a cross-owner claim cannot be written. `resolveLocation` still checks, because a
restore can load one past the constraint: it reads the alias's `locationId`
alone and fetches the location owner-scoped, so a claim pointing somewhere this
account does not own reads as no claim and is re-pointed at the right place
rather than followed to the wrong one. Reading it through the relation is what
it must not do — the schema marks that relation required, so a row the
constraint would have refused makes Prisma throw rather than return null.
The legacy JSON `Location.aliases` column is retained only as a preservation
area for ambiguous imported claims; new reads and writes use the indexed table.

`resolveLocation` carries an accepted lookup's `city`, `region`, `country`,
coordinates and OSM reference onto the place, so one created as a side effect of
saving a plan or logging a date is as complete as one edited by hand. Nothing is
ever cleared by a blank, and two rules govern what a non-blank may do:

- `address` and `url` **overwrite when given**. They are edited from the place
  page and passed by `Plan`, which is a direct statement about the place itself.
- `city`, `region`, `country` and the coordinates are **filled in but never
  overwritten**. What a caller passes is the wording from one interaction or
  date — often an old one — while the place is shared by everything that names
  it. Editing a date's rating resubmits the city typed at the time, and
  overwriting on that would undo a correction made on the place page, or leave a
  venue holding coordinates for one city and text naming another, for everybody.
  The same reasoning covers the coordinates: a venue's name says *which* place is
  meant, not where it is, so a stray save must not move one geocoded
  deliberately.

**Both fill-only rules are expressed in the `WHERE` clause, not decided from a
read.** A plain read is a snapshot one, so deciding from it loses a race: a date
save and a place-page correction could see the same blank field, and the save
would write the old wording over the correction after it committed. Each write
therefore carries its own condition — `city: null`, or both coordinate columns
null — and the database evaluates it at the moment of writing against the row as
it is then, so nothing is decided from a value that may already be stale.

**And every caller reaches `resolveLocation` through `transact`, not a bare
`prisma.$transaction`.** The `WHERE` clause is the whole rule on MariaDB 10.11,
which the container bundles: the update matches no rows and the correction
stands. It is not the whole rule from 11.6.2 on, where
`innodb_snapshot_isolation` is on by default and REPEATABLE READ is a true
snapshot. There the row must still be locked before any condition of ours is
evaluated, and locking one that moved since the transaction's snapshot raises
**1020**, `Record has changed since last read` — so putting the condition in the
`WHERE` does not avoid the error, it only stops the write. A locking read avoids
it no better; that was tried first.

1020 is not a statement-level failure. Measured against 11.8.3:
`@@in_transaction` reads 0 afterwards, and the next statement commits on its own,
outside any transaction and untouched by a later `ROLLBACK`. So it cannot be
caught and stepped over — doing that would autocommit the remainder of a save one
statement at a time — and the answer is the one the server's own message asks
for: start the transaction again. `src/server/db/transaction.ts` does that, up to
three attempts, only for 1020. The restart takes a fresh snapshot, sees the
correction that displaced it, and fills nothing in. Both versions therefore keep
the correction; a Location is the most contended row in the schema, since every
interaction, plan and date that names a venue writes it.

**Distances are computed in process, not in SQL.** MariaDB has
`ST_Distance_Sphere`, but reaching it means raw SQL, which would lose Prisma's
typing and — the part that decides it — the privacy where-fragments this app
requires be applied *in the query* rather than after it. One account's places and
plans number in the tens, already capped by `src/lib/list-cap.ts`, so
`withDistance` in `src/lib/geo.ts` sorts the fetched rows instead. Rows with no
coordinates keep their incoming order behind the ones that have them, rather than
sorting to the top as zero or vanishing from the list.

### `Fact`

"Things to know" about a person. `contactId` (cascade), `categoryId` →
`FACT_CATEGORY` (`SET NULL`), `content` (text), `importance` (0 trivia, 1
normal, 2 important), `isPrivate`, and `sourceInteractionId` → `Interaction`
(`SET NULL`) recording the conversation a fact came out of.

### `ImportantDate`

Dates you want remembering or reminding about. The main timeline is purely
historical: it includes a `NONE` date only after that date has happened, and it
never renders a recurring definition at its stored anchor year. The dashboard,
global timeline, and person page instead have a **Coming up** section that uses
one shared projection policy for annual and monthly occurrences. The projected
date controls display and sorting; the stored year remains the source for an
age or anniversary number. February 29 is observed on February 28 in common
years, and a monthly day that is absent from a month is observed on its final
day. Recurring month- and year-only values are not projected because doing so
would invent a day; future one-time values at those precisions still appear in
Coming up and retain their partial display.

| Column | Type | Notes |
| -------------------- | ---------------- | --------------------------------------------------------------------- |
| `label` | `varchar(191)` | |
| `date` | `date` | Anchor |
| `precision` | `DatePrecision` | |
| `recurrence` | `DateRecurrence` | `NONE` \| `ANNUAL` \| `MONTHLY` |
| `reminderDaysBefore` | `json?` | Array of ints, e.g. `[30, 7, 0]`. Null falls back to the user default |
| `notes` | `text?` | |

### `LifeEvent`

A significant moment in a person's life — a formal change, milestone, or
personal memory on their timeline, not yours. The user-facing name is broader,
but the persistence model deliberately remains `LifeEvent`.

Deliberately not an `Interaction` (which assumes you were there) and not an
`ImportantDate` (which assumes you want reminding annually). "Her father died in
2019" and "the trip where we became friends" are context, not anniversaries.

Adds `endDate` / `endPrecision` for events that span a period, and
`isMilestone` to pin one to the top of the profile. `LifeEventParticipant` is
the join that lets one marriage, move, birth, reunion, or bereavement appear in
every selected person's history; it carries an `ownerId` from its event and
keys on it from both sides. `contactId` remains the compatibility anchor; the
migration backfills it into the participant join without changing dates or
duplicating events.

### `Happening`

Informal calendar information: a one-off, near-future thing going on in someone
else's life. "She is in Portugal from the 12th" — recorded so you neither invite
her to something she will miss, nor forget to ask how it went.

The fifth dated thing here, and deliberately none of the other four. A `Plan` is
something you do *with* them, so it carries a cost, a checklist and a link, and
it ends by becoming an `Interaction`. A `LifeEvent` is their history and keeps
for ever. An `ImportantDate` recurs and wants a yearly notification. A `Task` is
your errand. This is ephemeral and finished the moment it passes.

Field names match `LifeEvent` — `date`, `precision`, `endDate`, `endPrecision` —
so the partial-date form reader, the range validator and the range formatter are
the same code rather than a second copy that drifts. `precision` matters more
here than anywhere: a trip recorded as "October" must not be followed up on
October 2nd, so every comparison runs against `precisionRange`, never the stored
anchor.

| Column | Why |
| --- | --- |
| `availability` | `AvailabilityImpact` — `NONE`, `BUSY`, `AWAY`. An enum, not a taxonomy, because the code branches on it: the badge, the widget's grouping, and "who is unavailable this week" |
| `isTentative` | Heard secondhand or not firm yet. A marker rather than a third confidence value, so an unmarked row claims nothing either way |
| `source` | Where you heard it — "mentioned at dinner". Informal information is mostly secondhand, and its provenance is what tells you how confidently to raise it |
| `followUpTaskId` | The optional "ask how it went" `Task`, due the day after the *end of the precision range*. The pointer lives here so `Task` gained no column; `SET NULL` means deleting the task by hand leaves the happening intact |
| `acknowledgedAt` | Dismissed from the dashboard's follow-up list. A timestamp, not a delete |

Carries no `isPrivate`, like `LifeEvent`, `Plan` and `Task`: the anchor contact
is the marker, and the queries filter through `viaContactPrivacyWhere`. It is
therefore absent from `countPrivateRows`, and offline-cache eligibility is
unchanged.

The follow-up is an ordinary `Task` on purpose. It then rides the tasks page,
the open-tasks widget, the daily digest and the `INCOMPLETE_TASK_DUE` reminder
policy, instead of needing a new `ReminderEntity` and a second delivery ledger
to reach the same phone. An *incomplete* follow-up is removed when the box is
cleared or the happening deleted; a *completed* one always survives — asking how
the trip went is a thing that happened.

### `Household`

A **named** group of people — "The Whitfields", "Mum and Dad's place". Explicit
rather than derived from a shared address, because adult children, separations,
lodgers and multi-generation homes all break that guess. Unique per
`(ownerId, name)`.

`HouseholdMember` is the join: PK `(householdId, contactId)`, plus an optional
`role` label within the household ("Mum", "eldest", "the dog") and `sortOrder`.
It carries an `ownerId` from its household and keys on it from both sides, so a
household cannot be given a member from another account.

### `FamilySuggestionDismissal`

A pair you have told the app to stop suggesting a relationship for. Stored
rather than kept in client state — a dismissal that reappears next session is
worse than none. Held as an **unordered** pair (smaller id first) so it survives
whichever way round the suggestion is phrased. PK
`(ownerId, aContactId, bContactId)`.

---

## Things to do and things given

### `Idea`

Conversation starters. `contactId` is nullable — a general idea belongs to
nobody. `status`: `OPEN` | `USED` | `ARCHIVED`, with `usedAt` and
`usedInInteractionId` (`SET NULL`) recording where it was actually used.

### `Plan`

Something to **do** with someone, as opposed to something to **say** to them.

The distinction against `Idea` is the whole reason it is its own table: an idea
is a sentence you meant to say, a plan is an outing, and a plan needs what a
plan has — where it is, what it costs, a link to the listing, when you mean to
go. They also end differently. An idea is used when you _say_ it; a plan when
you _do_ it.

| Column | Type | Notes |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `contactId` | `cuid?` | Null = something you would do with anyone, not saved against one person |
| `title` | `varchar(191)` | |
| `categoryId` | `cuid?` | → `TaxonomyTerm` (`PLAN_CATEGORY`), `SET NULL` — so a place, a film, a show and whatever else you invent live in one list you control |
| `location` / `address` | `varchar(191)?` / `varchar(500)?` | The venue plus an optional complete street address or directions |
| `url` | `varchar(500)?` | The listing, the menu, the trailer, the ticket page |
| `estimatedCostCents` | `int?` | With `currency`, default `USD` |
| `notes` | `text?` | Free-form preparation context, including personal accessibility or dietary needs without reducing them to enums |
| `checklist` | `json` | A validated list of up to 25 `{ id, text, completed }` items. Suggestions begin only in the editor and are never completed automatically |
| `status` | `PlanStatus` | `OPEN` \| `PLANNED` \| `DONE` \| `ARCHIVED` |
| `plannedFor` | `date?` | Pencilled in, before there is anything logged to point at |
| `plannedStartMinute` | `int?` | Local wall-clock minutes past midnight on `plannedFor`, 0–1439. Cleared when there is no day — a time on nothing is not a time |
| `plannedDurationMinutes` | `int?` | How long to set aside, in minutes. Null = open-ended |
| `usedAt` | `datetime?` | |
| `usedInInteractionId` | `cuid?` | → `Interaction`, `SET NULL`. An interaction rather than a `DateEntry`: a plan carried out with a friend never produces one of those |

Deliberately not confined to the dating layer — a hike with a friend and a first
date are the same object, so it hangs off any `Contact`, or off nobody.
Checklist data inherits the plan's ownership and contact privacy filtering; it
does not add a separately queried or cacheable child row.

The time is a **day plus a local minute, never an instant**. `plannedFor` stays
a `DATE` because the day is what gets compared, grouped and displayed, and
storing a moment instead would drag every existing reader onto the instant side
of the split `src/lib/dates.ts` warns about. `zonedTimeOfDay` resolves the pair
against the account's timezone at the point something genuinely needs a moment,
and settles both daylight-saving transitions the way calendar apps do: a local
time inside the skipped hour lands after the gap, and one inside a repeated hour
takes the first.

### `Task`

Follow-ups. Optional `contactId`, `dueDate`, `completedAt`, `priority`
(`LOW` | `NORMAL` | `HIGH`). Indexed `(ownerId, completedAt, dueDate)`.

### `Gift`

Both directions. `direction`: `OUTGOING` | `INCOMING`; `status`: `IDEA` |
`RESERVED` | `PURCHASED` | `GIVEN`; plus `priceCents`, `currency`,
`occasionId` → `GIFT_OCCASION`, `occurredOn`, `rating`, `url`.

### `Debt`

Money — or a thing — that has moved and not come back.

| Column | Type | Notes |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `direction` | `DebtDirection` | `THEY_OWE_ME` \| `I_OWE_THEM` |
| `description` | `varchar(191)` | |
| `amountCents` | `int?` | **Null on purpose.** Between neighbours what is lent is usually a drill, a stepladder, a casserole dish. Items are listed alongside the balance but never folded into it |
| `currency` | `varchar(8)` | Default `USD`; balances are summarised per currency, never converted |
| `incurredOn` | `date` | |
| `settledOn` | `date?` | Settling records a date rather than deleting the row — that someone always pays you back is worth as much as knowing they owe you now |
| `isPrivate` | `bool` | |

### `DietaryNeed`

An allergy or something a person cannot, or will not, eat. `kind`: `ALLERGY` |
`INTOLERANCE` | `MEDICAL` | `PREFERENCE`. Allergies additionally have a
`category`: `FOOD` | `MEDICATION` | `ENVIRONMENTAL` | `OTHER`, factual reaction
and emergency-instruction fields, optional diagnosis state, and a last-confirmed
date. Non-food categories are valid only for allergies. Existing rows migrate
to `FOOD`, the only category justified by the former food-only interface.

`Contact.allergyStatus` distinguishes `UNKNOWN`, `NO_KNOWN`, and `KNOWN`; an
empty list therefore never silently means that the person has no allergies.

Two deliberate absences, both documented in the schema itself:

- **No severity scale.** Prior mild reactions do not predict future severe ones;
  a field inviting "mild" next to a peanut allergy would manufacture exactly the
  false reassurance the table exists to prevent. Severity is expressed only as
  `kind` and `carriesEpinephrine` — facts, not predictions. The UI renders two
  groups (must avoid / prefers to avoid), never four escalating tiers.
- **No `isPrivate`.** The allergen, reaction and emergency instructions remain
  available in an emergency. Sensitive diagnosis detail belongs in a private
  `Fact`; a need attached to a private contact is still hidden with that contact.

---

## Dating layer

Optional, and structurally a 1:1 extension of an ordinary `Contact` — so
someone can move between "dating" and "friend" without losing history.

### `RomanticProfile`

`contactId` is **unique** (the 1:1). Holds `stageId` → `DATING_STAGE`,
`sourceId` → `MEETING_SOURCE` and `sourceDetail`; the dates
`matchedOn` / `firstDateOn` / `endedOn`; `endedReason` **and** `retrospective`
kept apart, because collapsing the factual reason and the reflection makes both
worse; compatibility fields (`birthYear`, `heightCm`, `distanceKm`,
`livingSituation`, `relationshipStyle`, `wantsKids` (`KidsPreference`),
`hasKids`, `religion`, `politics`, `smoking`, `drinking`, `loveLanguages` JSON,
`mbti`, `enneagram`); `exclusive`; `overallRating` and `chemistryScore` (1–5);
`profileLinks` JSON (`{ label, url }`); and `privateNotes`.

`distanceKm` is what somebody told you — "about twenty minutes away" — rather
than a measurement, which is why it survives alongside the coordinates on their
`Address`: you can know it without knowing where they live. It is stored in
kilometres whatever the account reads distances in, and rendered through
`formatStoredKm` (`src/lib/geo.ts`) in the account's unit; it deliberately is
**not** a `Distance`, which carries a `source` describing how it was computed.
Where their address is placed and a home base is set, the measured figure is
shown beside it rather than replacing it — one is arithmetic and the other is
hearsay, and they answer differently.

Converting someone to an ordinary contact clears `Contact.isRomantic` and
**keeps** this row, their dates, flags and notes.

### `DateEntry`

One dated outing. `interactionId` is **unique**: every date also writes an
`Interaction`, so it lands in the unified timeline beside everything else, and
the `Interaction` holds the shared fields (when, notes). Deleting goes through
the `Interaction`, which cascades — the pair can never be left half-removed.

Adds `sequence` (nth date with this person, **renumbered on write** so a date
remembered late slots in where it happened rather than being appended),
`activityTypeId` → `DATE_ACTIVITY_TYPE`, `venue`, `city`, `whoPaid` (`WhoPaid`),
`costCents`, and the three 1–5 scores `rating`, `chemistry`,
`conversationQuality`. Optional retrospective fields `wouldDoAgain` and
`nextTimeNotes` remain null until the user answers them, so older dates never
acquire an invented opinion. These are separate from pre-date `Plan.notes`.

`venue` and `city` are the wording used at the time, exactly as
`Interaction.location` is. **Where the date was, as a place, lives on the
mirrored `Interaction`** — `createDateEntry` and `updateDateEntry` both resolve
the venue and write `Interaction.locationId`, and `listDateEntries` reads it back
through `interaction.place`. `DateEntry` deliberately has **no `locationId` of
its own**: `interactionId` is unique, so a second foreign key would store the
same fact twice and let the two drift. This is the one place the `Plan` pattern
is not copied, and the reason is that `Plan` has no interaction to hang it on.

Both write paths pass the form's `city` to `resolveLocation`, so a place first
seen by logging a date is born with a locality rather than a bare name — without
it nothing could ever measure or map that place. It only ever *fills in* a
missing city, never rewrites one; see [`Location`](#location) for why.

The place a date reads back is the interaction's, and `listDateEntries` drops one
whose `ownerId` does not match the account's before returning it. `place` is the
single-column reference the schema note above describes, so the application
cannot write a cross-owner link but a restore can, and this read would otherwise
hand one account another's venue and coordinates. `queries/timeline.ts` guards
the same reference the same way.

### `Flag`

Green and red flags. `kind`: `GREEN` | `RED` | `DEALBREAKER`; `severity` 1
minor … 3 major; `text`; optional `noticedOn`.

---

## Customization

### `CustomFieldDefinition`

User-defined fields on four entities (`CustomFieldEntity`: `CONTACT`,
`ROMANTIC`, `INTERACTION`, `DATE_ENTRY`) in eight types (`CustomFieldType`:
`TEXT`, `LONGTEXT`, `NUMBER`, `DATE`, `BOOLEAN`, `SELECT`, `MULTISELECT`,
`URL`).

`options` JSON holds the choices for `SELECT`/`MULTISELECT`;
`appliesToCategoryIds` JSON scopes a contact field to particular categories
(null/empty = all). Unique per `(ownerId, entity, key)`.

### `CustomFieldValue`

| Column | Type | Notes |
| -------------- | ------------------- | ------------------------------------------------------- |
| `definitionId` | `cuid` | → definition, cascade |
| `entityType` | `CustomFieldEntity` | |
| `entityId` | `varchar(64)` | **Not a foreign key** — it points at one of four tables |
| `value` | `json?` | Validated server-side against the definition's type |

Unique `(definitionId, entityId)`; indexed `(entityType, entityId)` and
`ownerId`.

> Because `entityId` is not a foreign key, **nothing cascades**. Every delete
> path for a contact, interaction or date entry must sweep its custom-field
> values explicitly, scoped by entity type and owner. Miss one and orphaned
> values accumulate forever — and turn up in an export.

### `DashboardLayout`

PK `userId`. `widgets` JSON is an ordered array of
`{ id, enabled, settings? }`, reconciled against the widget registry in
[`src/lib/dashboard.ts`](../src/lib/dashboard.ts) on read, so a stored layout
survives widgets being added or removed.

---

## Notifications

Enabled channels receive due important-date reminders from the hourly scheduler.

### `NotificationChannel`

`kind`: `EMAIL` | `NTFY` | `GOTIFY` | `DISCORD` | `WEBHOOK`; `name`; `config`
JSON (channel-specific); `isEnabled`. Email uses `host`, `port` (a **number**,
defaulted to 587), `secure`, optional `user`, and required `from`/`to`.
HTTP-backed channels use `url`.

**Credentials are stored encrypted, under their own key.** The SMTP password
lands in `passEnc` and a bearer token in `tokenEnc`, AES-256-GCM under a key
derived (HKDF) from `AUTH_SECRET` with the purpose string
`personalcrm-channel-secret` — deliberately different from the one the AI key
uses, so a ciphertext written for one cannot decrypt as the other. A plaintext
`pass`/`token` under the bare field name is still honoured, for rows inserted
by hand before there was a settings page; the next save rewrites them
encrypted, which is the whole migration.

The ciphertext gets its own key rather than replacing the plaintext one on
purpose. Encrypting in place and recognising ciphertext by its `v1.` prefix
would mean a bearer token that legitimately starts `v1.` is read as ciphertext,
fails its auth tag, and comes back null — silently, and in the direction of
sending the request unauthenticated.

**A credential that will not decrypt stops delivery.** Unlike the AI key, which
is treated as absent, an unreadable channel secret throws: an unauthenticated
SMTP login or a webhook POST missing its Authorization header is a request that
still leaves, just without its credential. The failure lands in
`ReminderLog.error` and is flagged on the channel in Settings.

### `ReminderLog`

The dedupe/retry ledger, so a restart never loses a reminder: a row is
written with its first retry deadline already set, before the send, so a
process that dies between the two leaves a row the next pass retries rather
than one the unique key silently buries. Delivery is therefore at-least-once,
not at-most-once. The one ambiguous case is a process that dies after the
channel accepted the message and before the row could say so; that reminder
is sent again. No channel offers idempotent acceptance, so the choice is
between an occasional duplicate and an occasional silence, and for the one
thing this app exists to do the duplicate is the right side to err on. Every row records
the explicit `schedulingPolicy` that produced it and a SHA-256 `dedupKey`, unique
per owner, derived from the entity, policy, occurrence, offset, and channel. The
older composite delivery unique key remains as additional protection, and the
scheduler reads the keys it already holds before inserting rather than
treating a refused insert as the normal case. A retry is claimed with one
conditional update before it is sent, for a lease longer than any delivery
can take and stamped from the clock at the moment of the claim rather than
the start of the pass, so two overlapping processes cannot both deliver it.
Nothing is sent before its occurrence has arrived in the owner's timezone as
it is at the moment of sending: a candidate read just after midnight in one
zone waits if the owner has since moved to one where the day has not begun.
The channel is read again at that moment too, and must still be this owner's
and switched on — the ledger's owner and channel are independent keys, so a
repaired row naming another account's channel is cancelled, never sent, and
a queued retry whose channel has been switched off is cancelled rather than
held for the channel's return. That cancellation is not final: a switched-off
channel is one more way a reminder can be ineligible, and when the channel
is switched on again anything still due on it is a candidate once more, so
the row is put back on the retry path below like any other cancelled row and
sent, worded for that day — exactly what would happen had the failed attempt
never been made — and a reminder no longer due is left cancelled. A row
cancelled while its reminder was ineligible is put back on the retry path if
its reminder becomes a candidate again — a task reopened, a person made
visible — rather than being skipped for ever under its key. `entityType`
is a `ReminderEntity` (`IMPORTANT_DATE` | `CADENCE` | `TASK` | `DIGEST`). Failed
sends retry with exponential delay up to five attempts. Before retrying, the
engine re-reads the row's own entity under the same owner, archive and privacy
rules it was created under — not today's candidate list, which a send that
failed on the last pass of one day would never appear in on the first pass of
the next. Completion, a corrected date, an interaction that moved a cadence on,
archival, locking private content or a policy change cancels the retry; a
retry that goes out is worded for the day it goes out on. A digest is the
exception: within its day it is retried with its counts read afresh — and
waits if its hour has since been moved later — and once its day has ended it
is dropped rather than sent stale.

Cadence rows use `Contact.nextTouchAt` falling on or before the end of the
owner's local day — the same reading as the overdue count and the People
filter — task rows use an incomplete task's due date, and digest rows use the
user's local calendar date.

A digest reaches two days past today: cadences whose `nextTouchAt` falls before
the end of that third local day, incomplete tasks due on or before it, and
important-date occurrences whose own `reminderDaysBefore` policy would speak on
any of the three days. Each entry is labelled overdue, due today or upcoming
from its date, and carries whether its *reminder* is owed today or is being
previewed. Those are not the same thing — a date warned about a week ahead is
owed today for an occurrence still a week out — so the 20-entry cap ranks on
the reminder day, not the occurrence date, and trims the look-ahead rather than
work already owed. The wider read has its own where-fragments rather than reusing
the standalone policies': appearing in the look-ahead must never be able to
send an individual reminder early, so the query that decides what is *owed* is
kept separate from the one that decides what is *shown*. Digest scheduling uses
`UserPreference.timezone`, `digestHour`, and `digestEnabled`, all three editable
under Settings → Reminders; a late hourly pass catches up once, including after
a skipped spring-forward hour, while the daily key suppresses a repeated
fall-back hour. A same-day retry rebuilds the whole list under current
ownership, archive, privacy-lock, and task-contact rules.

`channelId` is `SET NULL`, so deleting a channel keeps the record of what was
already sent and cannot start it re-sending.

---

## Enum reference

| Enum | Values |
| ------------------------- | ------------------------------------------------------------------------------- |
| `UserRole` | `ADMIN`, `MEMBER` |
| `TaxonomyKind` | 12 values — see [Taxonomies](#taxonomies) |
| `DateRecurrence` | `NONE`, `ANNUAL`, `MONTHLY` |
| `DatePrecision` | `DAY`, `MONTH`, `YEAR`, `MONTH_DAY` |
| `IdeaStatus` | `OPEN`, `USED`, `ARCHIVED` |
| `PlanStatus` | `OPEN`, `PLANNED`, `DONE`, `ARCHIVED` |
| `TaskPriority` | `LOW`, `NORMAL`, `HIGH` |
| `GiftStatus` | `IDEA`, `RESERVED`, `PURCHASED`, `GIVEN` |
| `GiftDirection` | `OUTGOING`, `INCOMING` |
| `DebtDirection` | `THEY_OWE_ME`, `I_OWE_THEM` |
| `DietaryKind` | `ALLERGY`, `INTOLERANCE`, `MEDICAL`, `PREFERENCE` |
| `ReachedOutBy` | `UNSPECIFIED`, `ME`, `THEM`, `MUTUAL` |
| `KidsPreference` | `UNKNOWN`, `WANTS`, `DOES_NOT_WANT`, `OPEN`, `HAS_AND_DONE` |
| `WhoPaid` | `UNSPECIFIED`, `ME`, `THEM`, `SPLIT` |
| `FlagKind` | `GREEN`, `RED`, `DEALBREAKER` |
| `CustomFieldEntity` | `CONTACT`, `ROMANTIC`, `INTERACTION`, `DATE_ENTRY` |
| `CustomFieldType` | `TEXT`, `LONGTEXT`, `NUMBER`, `DATE`, `BOOLEAN`, `SELECT`, `MULTISELECT`, `URL` |
| `NotificationChannelKind` | `EMAIL`, `NTFY`, `GOTIFY`, `DISCORD`, `WEBHOOK` |
| `AllergyStatus` | `UNKNOWN`, `NONE_KNOWN`, `HAS_ALLERGIES` |
| `AllergyCategory` | `FOOD`, `MEDICATION`, `ENVIRONMENTAL`, `OTHER` |
| `ReminderEntity` | `IMPORTANT_DATE`, `CADENCE`, `TASK`, `DIGEST` |

`UNSPECIFIED` appears in both `ReachedOutBy` and `WhoPaid` for the same reason:
unknown has to be its own value, or historical rows silently acquire an answer
nobody gave.

---

## Delete behaviour at a glance

| Deleting… | Takes with it | Leaves behind |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A `User` | Everything they own, by cascade | — |
| A `Contact` | Methods, addresses, tags, facts, dates, life events, happenings, gifts, debts, dietary needs, flags, ideas, plans, tasks, household memberships, relationships (both halves), participations, romantic profile, date entries, and its avatar file | `CustomFieldValue` rows — **swept explicitly** by the action |
| An `Interaction` | Participants, its `DateEntry` | `Fact.sourceInteractionId`, `Idea.usedInInteractionId` and `Plan.usedInInteractionId` set to null |
| A `TaxonomyTerm` | `Relationship` rows of that type (cascade) — which is why deleting a term still in use is blocked; other references are `SET NULL` | The records themselves |
| A `Session` | Nothing | The unlock state dies with it |

---

## Migration history

Applied automatically at container start (`prisma migrate deploy`, ordered by
the `init-migrate` s6 oneshot).

| Migration | What it did |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260824021753_init` | The foundation — 26 tables: accounts, taxonomies, contacts, activity, dating layer, custom fields, notifications |
| `20260824084606_add_life_events_and_date_precision` | Adds `LifeEvent` and `DatePrecision`. **Hand-edited**: backfills `MONTH_DAY` from the old `birthYearKnown` / `yearKnown` booleans _before_ dropping them — Prisma's generated diff would have dropped them outright and lost the distinction                                                                                                                                                                                                             |
| `20260824115630_add_privacy_lock_and_retrospective` | `isPrivate` on `Contact`/`Fact`/`Interaction`, PIN and backoff columns on `User`, `Session.privacyUnlockedAt`, privacy preferences, `RomanticProfile.retrospective` |
| `20260824130123_add_households` | `Household`, `HouseholdMember` |
| `20260824130913_add_family_suggestion_dismissals` | `FamilySuggestionDismissal` |
| `20260824182152_add_dietary_debts_and_reach_out` | `Debt`, `DietaryNeed`, `Interaction.reachedOutBy` |
| `20260825094500_add_plans` | `Plan`, `PlanStatus`, and `PLAN_CATEGORY` on `TaxonomyKind` |
| `20260825120000_add_onboarding_state` | `UserPreference.onboardingCompletedAt` |
| `20260829120000_enable_reminder_delivery` | Widens the `ReminderLog` ledger for real delivery — `offsetDays`, `attemptCount`, `nextAttemptAt`, a nullable `sentAt` — and replaces the unique index with `ReminderLog_delivery_key`, named by hand because Prisma's generated name exceeds MariaDB's 64-character identifier limit. Pre-delivery rows are preserved rather than dropped |
| `20260830120000_add_date_entry_retrospective` | Additive nullable `DateEntry.wouldDoAgain` and `nextTimeNotes` reflections; existing rows remain unanswered |
| `20260830120000_expand_plan_practical_details` | Renames `Plan.city` to the wider `address` without losing values and adds the validated JSON checklist |
| `20260831120000_add_shared_family_context` | Adds interaction mentions and shared life-event participants; backfills every existing life event into its participant join |
| `20260831120000_add_locations` | Adds `Location` and the nullable `locationId` on `Interaction` and `Plan`, backfilling from the existing free-text labels by case and whitespace only. The original `location` columns are deliberately kept, not dropped: they are the historical wording |
| `20260831120000_distinguish_allergy_categories` | Splits allergies from dietary preferences: `Contact.allergyStatus`, and `category`/`reaction` and the adrenaline columns on `DietaryNeed`. **Hand-edited**: existing rows describe food, so `FOOD` is the only honest backfill |
| `20260831205130_add_location_osm_reference` | Additive nullable `Location.osmType` and `osmId`, so a place can be tied to a real OpenStreetMap object |
| `20260901120000_add_login_attempt_throttle` | Added `LoginAttempt`, a durable store for sign-in backoff counters. Superseded three commits later — see below |
| `20260901191500_drop_login_attempt_table` | Drops it again. Both halves of its key came from whoever was knocking, which made it a store an attacker chose the size of; bounding it meant dropping records, and dropping records meant the throttle could be switched off by filling it. Sign-in throttling now lives in the process serving the request, in a structure of fixed size. The table held only ephemeral counters, so nothing is lost but whatever backoff was in flight at the upgrade |
| `20260902120000_add_reminder_policy_and_dedup_key` | Adds and backfills an explicit scheduling policy and SHA-256 durable deduplication key for every existing reminder ledger row before making the key required and unique per owner. **Hand-edited**: the backfill computes the very key the application does — byte for byte, so pre-upgrade rows are found by the scheduler's lookup rather than blocking their reminders for ever — the policy column's default exists only for the backfill and is dropped afterwards, and rows whose channel was since deleted fold in their own id, because the delivery key they derive from lets any number of `NULL` channels coexist |
| `20260903120000_add_happenings` | Adds `Happening` and `AvailabilityImpact`, and appends `HAPPENING_TYPE` to `TaxonomyKind`. Purely additive: no column is re-expressed, so there is nothing to backfill before a drop. The enum `MODIFY` appends a value without reordering the existing ones, so no stored `TaxonomyTerm.kind` changes meaning |
| `20260903140000_same_owner_join_keys` | Gives `ContactTag` an `ownerId` and points both of its keys, and `LocationAlias`'s, at `(ownerId, id)` so a join across two accounts cannot be stored. **Hand-edited**: backfills the new column, then records and removes the rows that cannot satisfy the new key *before* adding it — adding it first would abort the upgrade on exactly the installation that needs the repair. The counts go to `AppSetting` for `runStartupTasks` to say once in the boot log |
| `20260904120000_same_owner_contact_keys` | Extends the same treatment to every remaining reference to a `Contact` — seventeen owned relations, plus `InteractionParticipant`, `InteractionMention`, `LifeEventParticipant` and `HouseholdMember`, which gain an `ownerId` backfilled from their parent. **Hand-edited**: repairs before it constrains, deleting a row whose link is required and clearing only the link where it is optional, sweeping the `CustomFieldValue` rows of anything it deletes, and detaching cross-owner `Interaction.place` / `Plan.place`, which keep a single-column key because `SET NULL` needs every column nullable. Ships a `down.sql` |
| `20260904150000_add_plan_times` | Additive nullable `Plan.plannedStartMinute` and `plannedDurationMinutes`, so a pencilled-in plan can carry a time of day and a rough length. Purely additive — no existing column is re-expressed, and a plan with a day but no time reads exactly as it did before |
| `20260905120000_add_address_coordinates_and_home_base` | Adds `latitude`, `longitude`, `osmType` and `osmId` to `Address`, and the home base plus `distanceUnit` to `UserPreference`. Entirely additive — every column nullable or defaulted, nothing removed or renamed, so there is nothing to backfill and nothing that can be lost |

Writing a migration that changes the meaning of existing data — not just its
shape — is covered in [CONTRIBUTING.md](../CONTRIBUTING.md#migrations).

---

## Not yet wired

Every table and column in the schema is now read and written by application
code. `UserPreference.digestHour`/`digestEnabled` drive the daily digest and
`Contact.avatarPath` is set by the avatar upload, both as of the same release.

`/config/backups` receives daily consistent database dumps from the container.
They are not encrypted and do not contain uploads or `secrets.json`, so back up
all of `/config` separately.
