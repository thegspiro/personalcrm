# Data model

Every table in the database, what it holds, and the rules that are enforced in
schema rather than in prose.

- **Engine:** MariaDB (Prisma `mysql` provider), `utf8mb4`
- **Source of truth:** [`prisma/schema.prisma`](../prisma/schema.prisma)
- **Tables:** 33 · **Enums:** 19 · **Migrations:** 8
- **Primary keys:** `cuid()` strings unless the table is a join table (composite)
  or a per-user singleton (`UserPreference`, `DashboardLayout` key on `userId`).

## The four rules the schema is built on

1. **Everything user-owned carries `ownerId`.** Multi-user instances share one
   database, so every top-level table is scoped by owner. Rows that only exist
   beneath a `Contact` (methods, addresses, join rows) are scoped through their
   parent instead of carrying their own copy.
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

---

## Accounts and auth

### `User`

The account. The first one created by the first-run wizard is `ADMIN`.

> The role is a label only. Nothing in the app checks it, so an administrator
> has no powers a member lacks — see [first-run.md](first-run.md#adding-other-people-to-the-instance).

| Column | Type | Notes |
| --- | --- | --- |
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
| --- | --- | --- |
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
| --- | --- | --- | --- |
| `theme` | `varchar(16)` | `system` | |
| `accent` | `varchar(24)` | `violet` | |
| `density` | `varchar(16)` | `comfortable` | |
| `timezone` | `varchar(64)` | `America/New_York` | **Every** date calculation anchors here, never to `process.env.TZ` |
| `weekStartsOn` | `int` | `0` | |
| `defaultCadenceDays` | `int?` | — | Fallback keep-in-touch cadence |
| `digestHour` | `int` | `8` | Reserved for the digest (see [Not yet wired](#not-yet-wired)) |
| `digestEnabled` | `bool` | `true` | Same |
| `privacyLockEnabled` | `bool` | `false` | The lock switch |
| `hideDating` | `bool` | `false` | Removes the dating module from nav and dashboard entirely |
| `blurPrivateNotes` | `bool` | `true` | Shoulder-surfing layer *after* the lock is open |
| `onboardingCompletedAt` | `datetime?` | — | When the welcome flow was finished or skipped |

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
| --- | --- | --- |
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

`TaxonomyKind` values (11 shown in Settings, plus `PLAN_CATEGORY`):

| Kind | What it names |
| --- | --- |
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
| --- | --- | --- |
| `id` / `ownerId` | `cuid` | |
| `firstName` | `varchar(120)` | The only required name field |
| `lastName` / `nickname` | `varchar(120)?` | |
| `pronouns` | `varchar(48)?` | |
| `avatarPath` | `varchar(255)?` | Rendered when set. No upload path writes it yet — see [Not yet wired](#not-yet-wired) |
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

### `Address`

`contactId` (cascade), `label`, `line1`, `line2`, `city`, `region`,
`postalCode`, `country`, `notes`.

### `Tag` / `ContactTag`

Free-form labels. `Tag` is unique per `(ownerId, slug)`; `ContactTag` is the
join table with composite PK `(contactId, tagId)`, cascading from both sides.

### `Relationship`

The people graph. **Reciprocal rows are always created in pairs.**

| Column | Type | Notes |
| --- | --- | --- |
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
| --- | --- | --- |
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

### `InteractionMention`

Join table, PK `(interactionId, contactId)`, for someone discussed but not
present. A mention makes the interaction discoverable from that person's
history without advancing their contact cadence. Private mentioned contacts
withhold the interaction while the lock is closed, just like participants.

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
| --- | --- | --- |
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
every selected person's history. `contactId` remains the compatibility anchor;
the migration backfills it into the participant join without changing dates or
duplicating events.

### `Household`

A **named** group of people — "The Whitfields", "Mum and Dad's place". Explicit
rather than derived from a shared address, because adult children, separations,
lodgers and multi-generation homes all break that guess. Unique per
`(ownerId, name)`.

`HouseholdMember` is the join: PK `(householdId, contactId)`, plus an optional
`role` label within the household ("Mum", "eldest", "the dog") and `sortOrder`.

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
go. They also end differently. An idea is used when you *say* it; a plan when
you *do* it.

| Column | Type | Notes |
| --- | --- | --- |
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
| `usedAt` | `datetime?` | |
| `usedInInteractionId` | `cuid?` | → `Interaction`, `SET NULL`. An interaction rather than a `DateEntry`: a plan carried out with a friend never produces one of those |

Deliberately not confined to the dating layer — a hike with a friend and a first
date are the same object, so it hangs off any `Contact`, or off nobody.
Checklist data inherits the plan's ownership and contact privacy filtering; it
does not add a separately queried or cacheable child row.

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
| --- | --- | --- |
| `direction` | `DebtDirection` | `THEY_OWE_ME` \| `I_OWE_THEM` |
| `description` | `varchar(191)` | |
| `amountCents` | `int?` | **Null on purpose.** Between neighbours what is lent is usually a drill, a stepladder, a casserole dish. Items are listed alongside the balance but never folded into it |
| `currency` | `varchar(8)` | Default `USD`; balances are summarised per currency, never converted |
| `incurredOn` | `date` | |
| `settledOn` | `date?` | Settling records a date rather than deleting the row — that someone always pays you back is worth as much as knowing they owe you now |
| `isPrivate` | `bool` | |

### `DietaryNeed`

Something a person cannot, or will not, eat. `kind`: `ALLERGY` |
`INTOLERANCE` | `MEDICAL` | `PREFERENCE`; plus `label`, `notes` and
`carriesEpinephrine`.

Two deliberate absences, both documented in the schema itself:

- **No severity scale.** Prior mild reactions do not predict future severe ones;
  a field inviting "mild" next to a peanut allergy would manufacture exactly the
  false reassurance the table exists to prevent. Severity is expressed only as
  `kind` and `carriesEpinephrine` — facts, not predictions. The UI renders two
  groups (must avoid / prefers to avoid), never four escalating tiers.
- **No `isPrivate`.** An allergy behind a PIN is a decorative allergy. Sensitive
  dietary context belongs in a private `Fact`; a need attached to a private
  contact is still hidden with that contact.

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
| --- | --- | --- |
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
JSON (channel-specific); `isEnabled`. Email uses `host`, optional `port`,
`secure`, optional `user`/`pass`, and required `from`/`to`. HTTP-backed channels
use `url` and an optional bearer `token`.

### `ReminderLog`

The dedupe/retry ledger, so a restart never re-sends a reminder. Unique on
`(ownerId, entityType, entityId, scheduledFor, offsetDays, channelId)` with
`entityType` a `ReminderEntity` (`IMPORTANT_DATE` | `CADENCE` | `TASK` |
`DIGEST`). Records `attemptCount`, `nextAttemptAt`, `ok`, and `error`; failed
sends retry with exponential delay up to five attempts.

---

## Enum reference

| Enum | Values |
| --- | --- |
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
| `ReminderEntity` | `IMPORTANT_DATE`, `CADENCE`, `TASK`, `DIGEST` |

`UNSPECIFIED` appears in both `ReachedOutBy` and `WhoPaid` for the same reason:
unknown has to be its own value, or historical rows silently acquire an answer
nobody gave.

---

## Delete behaviour at a glance

| Deleting… | Takes with it | Leaves behind |
| --- | --- | --- |
| A `User` | Everything they own, by cascade | — |
| A `Contact` | Methods, addresses, tags, facts, dates, life events, gifts, debts, dietary needs, flags, ideas, plans, tasks, household memberships, relationships (both halves), participations, romantic profile, date entries | `CustomFieldValue` rows — **swept explicitly** by the action |
| An `Interaction` | Participants, its `DateEntry` | `Fact.sourceInteractionId`, `Idea.usedInInteractionId` and `Plan.usedInInteractionId` set to null |
| A `TaxonomyTerm` | `Relationship` rows of that type (cascade) — which is why deleting a term still in use is blocked; other references are `SET NULL` | The records themselves |
| A `Session` | Nothing | The unlock state dies with it |

---

## Migration history

Applied automatically at container start (`prisma migrate deploy`, ordered by
the `init-migrate` s6 oneshot).

| Migration | What it did |
| --- | --- |
| `20260824021753_init` | The foundation — 26 tables: accounts, taxonomies, contacts, activity, dating layer, custom fields, notifications |
| `20260824084606_add_life_events_and_date_precision` | Adds `LifeEvent` and `DatePrecision`. **Hand-edited**: backfills `MONTH_DAY` from the old `birthYearKnown` / `yearKnown` booleans *before* dropping them — Prisma's generated diff would have dropped them outright and lost the distinction |
| `20260824115630_add_privacy_lock_and_retrospective` | `isPrivate` on `Contact`/`Fact`/`Interaction`, PIN and backoff columns on `User`, `Session.privacyUnlockedAt`, privacy preferences, `RomanticProfile.retrospective` |
| `20260824130123_add_households` | `Household`, `HouseholdMember` |
| `20260824130913_add_family_suggestion_dismissals` | `FamilySuggestionDismissal` |
| `20260824182152_add_dietary_debts_and_reach_out` | `Debt`, `DietaryNeed`, `Interaction.reachedOutBy` |
| `20260825094500_add_plans` | `Plan`, `PlanStatus`, and `PLAN_CATEGORY` on `TaxonomyKind` |
| `20260825120000_add_onboarding_state` | `UserPreference.onboardingCompletedAt` |
| `20260830120000_add_date_entry_retrospective` | Additive nullable `DateEntry.wouldDoAgain` and `nextTimeNotes` reflections; existing rows remain unanswered |
| `20260830120000_expand_plan_practical_details` | Renames `Plan.city` to the wider `address` without losing values and adds the validated JSON checklist |
| `20260831120000_add_shared_family_context` | Adds interaction mentions and shared life-event participants; backfills every existing life event into its participant join |

Writing a migration that changes the meaning of existing data — not just its
shape — is covered in [CONTRIBUTING.md](../CONTRIBUTING.md#migrations).

---

## Not yet wired

Tables that exist and are migrated, but that no application code reads or
writes yet. Documented here so nobody assumes the feature works:

| Table / column | State |
| --- | --- |
| `UserPreference.digestHour`, `digestEnabled` | Stored, not acted on |
| `Contact.avatarPath` | Read and rendered everywhere, but nothing uploads an image to set it |

`/config/backups` is likewise created at boot but nothing writes to it — the
nightly dump described in the README is not implemented. Back up `/config`
yourself.
