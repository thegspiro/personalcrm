# Write surface: server actions

There is no REST API. Every mutation is a Next.js **server action** in
`src/server/actions/`, and the only route handler in the app is
`GET /api/health`.

Contact birthdays are updated by `updateContactBirthday`. It validates a
partial date (including `MONTH_DAY`), scopes the contact by owner, and applies
the live privacy-lock filter before writing `Contact.birthDate`; it never
creates an `ImportantDate` shadow row.

## The contract

Every action returns `ActionResult` from
[`actions/helpers.ts`](../src/server/actions/helpers.ts):

```ts
interface ActionResult<T = void> {
  ok: boolean;
  error?: string;                        // form-level message
  fieldErrors?: Record<string, string>;  // keyed by input name
  data?: T;
}
```

and follows the same five steps:

1. `await owner()` → `{ ownerId, timezone }` (redirects when signed out).
2. Parse `FormData` with the typed helpers — `str`, `num`, `bool`, `strList`,
   `instant`, `partialDate`, `plainDate`, `toDbDate`.
3. Validate with Zod; `invalid(err)` maps issues onto `fieldErrors`.
4. Write — in `prisma.$transaction` whenever more than one table is touched.
5. Re-derive denormalised state, `revalidatePath`, return.

**A server action is a public POST endpoint.** Three consequences the code
enforces rather than documents:

- Every value is re-validated server-side. The browser is not a validator.
- Every dating write re-checks the privacy lock instead of trusting that the
  page was gated.
- Every query is scoped by `ownerId`, or by a parent that is.

## Reference

### Auth — `actions/auth.ts`

| Action | Notes |
| --- | --- |
| `loginAction` | Failures are indistinguishable between an unknown email and a wrong password. Throttled per address-and-client pair *before* the password is checked, and synchronously, so a burst cannot slip through between the read and the write; an unknown address is counted too and cannot be told apart by whether it backs off — see [privacy.md](privacy.md#sign-in-throttling) |
| `setupAction` | First-run wizard; the first account becomes `ADMIN`, a label nothing checks yet. Hands off to `/welcome` |
| `signupAction` | Refused when `DISABLE_SIGNUP=true` |
| `logoutAction` | Deletes the session row and clears the cookie |

### Account — `actions/account.ts`

All mutations derive the account from the authenticated session; no caller may
choose an owner. `updateDisplayName` changes the navigation/profile label.
`updateEmail` uses registration's trim-and-lowercase normalization, requires the
current password, and relies on the database uniqueness constraint; like
`changePassword` its write is conditional on the row still carrying the hash it
confirmed, so a request in flight on a session a password change has just
revoked cannot still move the sign-in address. Password
changes reuse the signup strength and bcrypt helpers, preserve the current
session, revoke every other session, and clear `privacyUnlockedAt` on the
preserved session — which is also re-keyed, so copies of its cookie stop
resolving. The write is conditional on the row still carrying the hash that was
just confirmed, so of two changes racing only one applies: written blindly, the
loser's session sweep ended the winner's newly issued session and left the
account with none. `secureSessionsAfterPasswordChange` returns the callback that writes
the new cookie, and `changePassword` invokes it after the transaction commits;
writing it inside would leave the browser holding a token a rollback removed. Individual and bulk revocation predicates include `userId`
and explicitly exclude the current token hash.

### Contacts — `actions/contacts.ts`

`createContact`, `updateContact`, `updateContactBirthday`, `patchContact`,
`snoozeContact`, `deleteContact`, `setContactArchived`.

`deleteContact` sweeps the contact's `CustomFieldValue` rows explicitly —
`entityId` is not a foreign key, so nothing cascades.

`createContact` and `updateContact` accept an `avatar` file and `updateContact`
a `removeAvatar` flag. The bytes are checked for being a whole JPEG, PNG or WebP
and written under a server-generated name *before* the transaction, so a failed
save removes the new file rather than leaving a row pointing at nothing; the
previous file is removed only after the row points elsewhere. `deleteContact`
unlinks the file after the row is gone. An avatar-bearing contact that is
private is refused while the lock is closed, before any byte is written.

### Interactions — `actions/interactions.ts`

`createInteraction`, `updateInteraction`, `deleteInteraction`,
`loadInteractionForEdit`.

All three writes run `contact-activity` recomputation for every participant, so
backdating and deletion cannot corrupt a cadence. `updateInteraction` recomputes
for the people it *removed* as well as the ones it kept — a contact dropped from
an interaction must not keep a last-contact date from a meeting they were not at.

Both `updateInteraction` and `loadInteractionForEdit` filter through
`interactionPrivacyWhere`, so an id hidden behind a closed lock can be neither
read back into a form nor written to by guessing at it. `typeId` is checked
against the account's own taxonomy on the way in — the column is a plain foreign
key, so an unchecked id from another account would otherwise be accepted.

`loadInteractionForEdit` is a read behind `"use server"`, called when the edit
sheet opens rather than embedded in the timeline payload: a feed of a hundred
rows should not ship a hundred contact pickers to the browser. It returns
participants who are archived or currently hidden alongside the picker's own
list, because a person missing from the form would be silently dropped on save.

### Everything hanging off a contact — `actions/details.ts`

| Group | Actions |
| --- | --- |
| Contact methods | `createContactMethod`, `updateContactMethod`, `deleteContactMethod`, `setPrimaryContactMethod`, `moveContactMethod` |
| Addresses | `createAddress`, `updateAddress`, `deleteAddress` |
| Facts | `createFact`, `updateFact`, `deleteFact` |
| Important dates | `createImportantDate`, `updateImportantDate`, `deleteImportantDate` |
| Significant moments (`LifeEvent`) | `createLifeEvent`, `updateLifeEvent`, `deleteLifeEvent` |
| Going on in their life (`Happening`) | `createHappening`, `updateHappening`, `acknowledgeHappening`, `deleteHappening` |
| Ideas | `createIdea`, `updateIdea`, `setIdeaStatus`, `deleteIdea` |
| People in their life (`Acquaintance`) | `createAcquaintance`, `updateAcquaintance`, `promoteAcquaintance`, `deleteAcquaintance` |
| Plans | `createPlan`, `updatePlan`, `setPlanStatus`, `deletePlan` |
| Tasks | `createTask`, `updateTask`, `setTaskDone`, `deleteTask` |
| Gifts | `createGift`, `updateGift`, `setGiftStatus`, `deleteGift` |
| Debts | `createDebt`, `updateDebt`, `settleDebt`, `deleteDebt` |
| Dietary needs | `createDietaryNeed`, `updateDietaryNeed`, `deleteDietaryNeed`, `updateAllergyStatus` |
| Relationships | `createRelationship`, `updateRelationship`, `deleteRelationship` |

`promoteAcquaintance` is the one action here that creates a `Contact`. It runs
in a transaction that creates the person, claims the entry, and writes both
halves of the reciprocal `Relationship` — sharing `writeRelationshipPair` with
`createRelationship` so the second half cannot go missing on one path and not
the other.

The claim is a compare-and-set on `promotedContactId: null` rather than a
read-then-write. A second submission — two tabs, or a retried request, neither
of which a disabled button catches — blocks on the first writer's row lock,
matches nothing, and throws to roll its own half-built person away. The action
then answers with the contact that already exists rather than an error, because
a stale tab should land on the person, not on a red toast. Once the pointer is
set the entry refuses `updateAcquaintance`: it is a record of what was written
before the profile existed, and the profile is where that person is edited now.
Deleting is still allowed, and takes nothing about the created person with it.

The new person inherits privacy from both the entry and the contact it hangs
off, so promoting a note from behind the lock does not publish the name.

`ContactMethod` and `Address` carry no `ownerId` of their own, so these are the
actions where the ownership check is indirect: each looks its row up through
`contact: { ownerId, ...contactPrivacyWhere(scope) }`. Passing an id alone
would be a way back into a private contact's phone number using an id
remembered from an unlocked session.

The happening actions each write inside a `$transaction` with
`syncFollowUpTask`, because the "ask how it went" reminder is an ordinary
`Task`: creating, re-dating or standing one down has to land with the dates it
was derived from, or an edit leaves a task asking about a trip that no longer
exists. They revalidate `/tasks` as well as the profile whenever one was
touched. `acknowledgeHappening` only stamps `acknowledgedAt` — it is what
dismisses a finished happening from the dashboard, and it destroys nothing.

An *incomplete* follow-up is deleted when the box is cleared or the happening
removed. A *completed* one always survives: it records that you did ask.

`setPrimaryContactMethod` is separate from `updateContactMethod` on purpose. As
a checkbox it would be written on every save, so ticking it on a second row
leaves two rows claiming to be primary and the header silently picks whichever
sorts first; as its own action it clears the others in the same transaction.

Life-event ranges compare the possible interval represented by each partial
date. The create and update actions reject only ranges that are definitively
inverted and return the problem against `endDate`; overlapping fuzzy dates
remain valid.

`createRelationship` writes **both** reciprocal rows under one `pairId`;
`updateRelationship` re-types both and keeps the `pairId`; `deleteRelationship`
removes both. `settleDebt` records a date rather than deleting the row.

Plan create and update parse the checklist as JSON and validate at most 25
items, each with a bounded id and non-empty, 191-character text. Checklist
completion is changed only by a submitted user edit. It is stored on the owned
`Plan`, so the existing owner lookup and contact-inherited privacy query also
scope the checklist. `plannedFor` remains a calendar date parsed by
`plainDate`; no server-timezone conversion is involved. The optional
`plannedStartTime` and `plannedDurationMinutes` are read by `parsePlanMinute`
and `parsePlanDuration`, which refuse anything they cannot read rather than
coercing it — filing a plan at midnight because the form sent "half seven"
would put it at a time nobody chose. A time arriving without a day is dropped
instead, so clearing the day does not become an error to understand. The minute
is stored as a local wall-clock reading against the day, never converted to an
instant here.

Important-date and life-event updates and deletes also filter through their
contact's privacy marker. The timeline exposes these controls, so an id retained
from an unlocked view must become unreachable when that contact is locked.

**An `update*` writes the whole form.** These are `PUT`s, not `PATCH`es: an
absent field is stored as absent, not left alone. A form that offers a field
when adding and not when editing therefore clears it on the first correction,
which is why the add and edit forms for each entry are rendered from one shared
field-set component rather than written twice. An empty Important-date reminder
policy is explicitly stored as database null so it returns to the account
default rather than retaining a previous per-date override. The three deliberate
exceptions each keep a state change out of a text correction: `updateGift` falls back to
the stored status, `updateDebt` never touches `settledOn`, and `updateTask`
never touches `completedAt`.

**The privacy marker is not freely writable.** `updateFact` and `updateDebt`
scope their lookup through the privacy where-fragment, so a private row is out
of reach while the lock is closed rather than merely hidden, and they refuse a
change to `isPrivate` unless the lock is open — hiding a row from a session
that could not then reach it is exactly what `setPrivate` refuses for the same
reason. `updateDateEntry` may write it freely because the dating guard has
already established the lock is open.

### Family — `actions/family.ts`

`createHousehold`, `updateHousehold`, `deleteHousehold`, `addHouseholdMember`,
`removeHouseholdMember`, `acceptSuggestion`, `dismissSuggestion`,
`endRelationshipLink`.

Suggestions are never written without a press. `endRelationshipLink` re-types
both halves to their `former` counterparts; it never deletes. `updateHousehold`
is reached from the rename control on each household card on `/family`; it
rejects a name already taken by another household of the same owner, which is
what the `@@unique([ownerId, name])` constraint would otherwise surface as a
raw database error.

Linking two relatives from `/family` goes through `createRelationship` in
`actions/details.ts` — the same action the contact page uses — rather than a
second write path, so both halves of a pair are still written together.

### Dating — `actions/dating.ts`

`upsertRomanticProfile`, `setDatingStage`, `endRelationship`, `markAsRomantic`,
`convertToFriend`, `createDateEntry`, `updateDateEntry`, `deleteDateEntry`,
`createFlag`, `updateFlag`, `deleteFlag`.

Every one re-checks the lock. `createDateEntry` writes an `Interaction` **and**
a `DateEntry`, recomputes activity from full history, and renumbers `sequence`
so a date remembered late slots in where it happened. `deleteDateEntry` goes
through the `Interaction` so the pair cannot be left half-removed.
Create and update validate and persist the nullable `wouldDoAgain` and
`nextTimeNotes` retrospective fields. Saved-plan preparation notes are shown as
context and are never silently copied into that private retrospective.
`markAsRomantic` and `convertToFriend` are mirrors, and each sets nothing but
the one flag the pipeline reads: `convertToFriend` clears `isRomantic` and keeps
the profile, dates, flags and notes, and `markAsRomantic` sets it again without
creating a profile, so someone put back gets the history they already had.
`markAsRomantic` lives here rather than reusing `patchContact`, which checks
ownership only — right for a favourite, wrong for the flag that decides whether
a page renders someone's private notes. `updateFlag` can re-type a flag between green, red and dealbreaker: a
second look often moves one, and re-typing keeps the wording and the day you
first noticed it rather than starting over.

### Quick add — `actions/quick-add.ts`

| Action | Notes |
| --- | --- |
| `interpretQuickAdd` | Parses a line **locally**; optionally asks a model when assistance is on and no named contact is private. Returns a proposal, writes nothing |
| `confirmQuickAdd` | Writes what you approved, through the same activity machinery as any other log |
| `searchPalette` | ⌘K search, through the same privacy filter as every other read |

A name two contacts share is never guessed: both candidates are surfaced and
saving is blocked until you pick.

The venue is read the same way. `interpretQuickAdd` matches the line against the
account's own places — filtered by the predicate the Places directory uses, since
where you have been is itself a disclosure — and otherwise proposes one from an
"at ..." cue. `confirmQuickAdd` resolves it from the **confirmed text**, never
from a posted id: `resolveLocation` get-or-creates on `(ownerId,
normalizedName)`, which is owner-scoped by construction, so neither a forged form
nor an assisted reading can point an interaction at somebody else's row.

### Places — `actions/locations.ts`

| Action | Notes |
| --- | --- |
| `updateLocation` | The practical fields: address, city, region, country, phone, link, notes. Also renames, recomputing `normalizedName` |
| `applyLocationLookup` | Writes what an address lookup found, including the OSM reference. The only writer of `osmType`/`osmId`/`latitude`/`longitude` |
| `lookupLocationAddress` | Asks the configured endpoint for candidates. **Writes nothing** — the user picks, then `applyLocationLookup` writes |
| `setLocationArchived` | Sets the flag. Nothing is deleted and no label is rewritten |

Each of these looks the place up through `locationVisibleWhere` rather than by
`{ id, ownerId }`. Scoping by owner alone would let a locked session edit a place
known only through a hidden interaction — and the difference between "not found"
and a field error is itself enough to confirm one exists, so both answers are the
same sentence.

A rename onto a name already in use is **refused**, never merged: two real venues
can be spelled alike, and folding one into the other would take a history with it.

While the lock is closed, both a rename and a change to a place's alternate
names are refused outright — every one, not only the ones that collide. Asking
whether a name is taken is asking whether a hidden place answers to it, and the
refusal itself was the answer. `updateLocation` compares the submitted aliases
with the stored ones so only a *change* is held back: every other field stays
editable, and a save that resubmits the aliases it was rendered with goes
through.

Every place a lookup can be reached from is behind an explicit button. See
[privacy.md](privacy.md) for what is sent.

The gate itself — the toggle check, the dynamic `import()` of the optional
directory, and turning every failure into a sentence rather than an error page —
lives once in `src/server/geo/lookup.ts` (`searchPlaces`). All three callers use
it, so they cannot drift into three different failure stories.

`lookupContactAddress` (in `actions/details.ts`) is the same lookup for a
person's home. It is **refused outright for a private contact** — the promise the
assisted-reading layer already makes, applied here because a home address
identifies somebody more precisely than a name does. Their coordinates are typed
by hand instead, which is why the form offers the fields directly. For everyone
else only the address is sent: the lines, the city, the region, the country.
Never the label, never the notes, never the person's name.

`placeUnplaced` (in `actions/bulk-place.ts`) is the same lookup applied to
everything at once: a bounded batch of **ten rows**, returning a cursor the
browser passes back until there is nothing left. No queue, no job table, no
background worker — the loop lives in the settings panel, so closing the tab
stops it and pressing the button again resumes.

Three rules make it safe to run unattended. It is **refused outright against the
public OpenStreetMap service** (`isRateLimited`), whose usage policy asks
applications not to geocode in bulk against hardware the foundation runs on
donations. It writes **only an unambiguous match** — anything other than exactly
one candidate is left for a person, because nobody is present to choose and a
pin in the wrong city looks answered when it is not. And it selects **only rows
with no coordinates**, re-checking that in the `updateMany` where-clause, so a
row placed by hand in another tab is never overwritten by a machine's guess.
Private contacts are excluded by the query that feeds it, not filtered
afterwards.

`lookupHomeBase` and `updateHomeBase` (in `actions/settings.ts`) do the same for
your own address. `updateHomeBase` follows `updateDefaults`' presence-not-value
rule for `distanceUnit`, so a panel that omits the field never resets it, and it
refuses half a coordinate pair out loud rather than storing a prime-meridian
guess.

### Tags — `actions/tags.ts`

| Action | Notes |
| --- | --- |
| `createTag` | Name plus a `normalizeTagSlug` key, unique per owner. The key keeps letters and numbers in any script, so a name with no ASCII spelling is not refused as empty. Refused while locked — see below |
| `renameTag` | Recomputes the key; a rename onto an existing one is refused rather than merged. Refused while locked, and the tag itself must be one `tagVisibleWhere` admits |
| `mergeTag` | Moves the source's assignments onto the destination and deletes the source. Refused while locked if either tag is on someone private — the move would carry the hidden assignment |
| `deleteTag` | Removes the tag; assignments go by cascade, contacts are untouched. Refused while locked on the same condition, since the cascade destroys the hidden assignment |
| `setContactTag` | Assigns or unassigns one tag on one contact |

Creating and renaming are refused while the lock is closed, because both answer
"is this name taken" and a taken name you cannot see belongs to a tag used only
by private people — the same reasoning that holds back a place rename.
Assigning an existing tag changes no name and is unaffected.

Every one of these scopes by `ownerId`, and each that names a tag by id asks
`tagVisibleWhere` rather than ownership alone — as do `createContact` and
`updateContact` when they replace a contact's tags. A form rendered while
unlocked keeps the ids it listed, and closing the lock in another tab does not
empty it, so the write is the only place that check can be made. See
[privacy.md](privacy.md) for what the predicate admits.

### Customization

| File | Actions |
| --- | --- |
| `actions/taxonomy.ts` | `createTerm`, `updateTerm`, `setTermActive`, `deleteTerm`, `moveTerm`, `restoreMissingDefaults` |
| `actions/custom-fields.ts` | `createFieldDefinition`, `updateFieldDefinition`, `setFieldActive`, `deleteFieldDefinition`, `moveFieldDefinition` |
| `actions/dashboard.ts` | `setWidgetEnabled`, `moveWidget`, `setWidgetSetting`, `resetDashboardLayout` |
| `actions/settings.ts` | `updateAppearance`, `updateDefaults`, `updateDigest` |

`deleteTerm` refuses while the term is still referenced — the foreign keys
would null the reference or cascade the row away. `setTermActive(false)` is the
supported alternative. A relationship type keeps its reciprocal paired in both
directions, and `metadata` is not editable from the UI because family tiers and
pipeline ordering are read from it by code.

`updateDigest` is the switch and local hour for the daily digest, the one
message the scheduler sends on its own initiative. It lives under Settings →
Reminders beside the channels it reaches. The hour is validated as a whole
number from 0 to 23 and refused per field otherwise.

### Onboarding — `actions/onboarding.ts`

`updateProfileName`, `completeOnboarding`, `markPwaInstalled`. The welcome flow
runs once per account and records that it did in
`UserPreference.onboardingCompletedAt`, so skipping counts as finishing.

### Privacy — `actions/privacy.ts`

`unlockPrivacyAction`, `lockPrivacyAction`, `privacyActivityHeartbeat`,
`setPinAction`, `clearPinAction`, `setPrivacyLockEnabled`,
`updatePrivacyPreferences`, `setPrivate`.

Unlock, PIN replacement, and PIN removal return the same retry duration from a
shared account-level verifier. Its counter is serialized in the database, so
requests from separate sessions cannot race around the backoff.

`setPrivate` is refused while locked — otherwise a row vanishes with no way back
to it.

Disabling an enabled lock is handled only by `setPrivacyLockEnabled`. The action
requires either an unlocked current session or a verified current PIN; posting a
`privacyLockEnabled` field to the general preference action cannot lower the
lock boundary.

### Address lookup settings — `actions/geo-settings.ts`

| Action | Notes |
| --- | --- |
| `updateGeoEnabled` | The toggle. Off until switched on |
| `saveGeoConnection` | Provider and, for a self-hosted one, the endpoint. A fixed public endpoint is not editable from the app |

### AI settings — `actions/ai-settings.ts`

`updateAiEnabled`, `saveAiConnection`, `removeApiKey`. A connection is tested
against the provider before it is stored; the key is encrypted at rest and
never shown again.

### Notification channels — `actions/notifications.ts`

`createChannel`, `updateChannel`, `setChannelEnabled`, `deleteChannel`,
`sendTestNotification`.

Where a reminder is allowed to go. Until these existed nothing could create a
`NotificationChannel`, so the hourly job found none on every account and sent
nothing — the delivery engine had been complete and unreachable for months.

The kind is fixed at creation. Changing it would leave a config shaped for the
old one, and the sender reads that JSON with raw `typeof` guards.

Credentials never round-trip. The settings query returns a redacted channel, so
a blank password field means *keep what is stored* rather than *clear it*; an
explicit checkbox does the clearing. See
[data model](data-model.md#notificationchannel) for how they are encrypted, and
why one that will not decrypt stops delivery instead of degrading to an
unauthenticated send.

Unlike the AI and address-lookup settings, nothing here is administrator-only.
That is not an oversight: `NotificationChannel` carries an `ownerId`, so each
account's channels are its own and `owner()` scoping is the whole guard. The
other two store an `AppSetting`, which belongs to the *installation* and has no
owner to scope by — which is why they need a role check and this does not.

`sendTestNotification` is separate from saving on purpose. Verifying before
storing is right for the AI key — one global value, where a bad key means
silent nothingness — and wrong for a row: a Gotify box down for ten minutes
must not stop you recording its address.

What it sends is the fixed sample digest in `src/lib/sample-digest.ts`:
invented people and invented dates, rendered by the same `digestMessage()` the
scheduler uses. Nothing is interpolated and no record is read, because Settings
stays reachable while the privacy lock is closed and this is the one button
there that could otherwise put a private person's name on the wire. Going
through the real formatter is what makes the sample worth sending — it shows
how a genuine digest will wrap, truncate and group on that channel — and the
sample carries one entry of every kind and every timing word so no section
goes unexercised. Its subject says "sample" rather than only its body: a push
notification is often read as a single collapsed line.

It writes no `ReminderLog`: the ledger's unique key is the occurrence, and a
test has none. It is rate-limited per account rather than per channel, being a
public POST that makes an outbound request to a caller-supplied URL — keyed by
channel, the guard would reset by creating another one. A send that succeeds
means the transport accepted the payload, not that a mail provider,
notification service or recipient device will display it.

## Custom fields on a form

Two failure modes the shared helper
([`services/custom-field-values.ts`](../src/server/services/custom-field-values.ts))
exists to prevent:

- **Absence is ambiguous in a `FormData`.** An unchecked checkbox and a field
  that was never on screen look identical. Forms therefore submit a hidden
  `cf_rendered` input listing the definitions they rendered, so saving from a
  form that omits custom fields cannot clear every boolean on the record.
- **A failing field aborts the whole save** rather than leaving a record
  half-written.

## The two HTTP endpoints

`GET /api/health` → `200` with `{ status, database, setup, latencyMs, version,
uptimeSeconds }`, or `503` with `{ status: "error", database: "down", message }`.
`cache-control: no-store`, runtime `nodejs`, `force-dynamic`.

`setup` is `"complete"` or `"pending"`, so an operator can tell a
booted-but-unconfigured instance from a working one without opening a browser.

`GET /api/avatars/[filename]` → the image bytes with `cache-control: private,
no-store` and `x-content-type-options: nosniff`, or `404`. It is `404` for every
refusal alike — no session, a name the server did not generate, another owner's
contact, a private contact while the lock is closed, a missing file — because
whether a file exists is itself a disclosure. Authorisation is one query beyond
the session (`queries/avatars.ts`), which folds the privacy lock into the
contact lookup so a page of two hundred avatars is two hundred queries, not a
thousand.
