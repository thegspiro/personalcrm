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
| `loginAction` | Failures are indistinguishable between an unknown email and a wrong password. Throttled per address-and-client pair *before* the password is checked, so an unknown address is counted too and cannot be told apart by whether it backs off — see [privacy.md](privacy.md#sign-in-throttling) |
| `setupAction` | First-run wizard; the first account becomes `ADMIN`, a label nothing checks yet. Hands off to `/welcome` |
| `signupAction` | Refused when `DISABLE_SIGNUP=true` |
| `logoutAction` | Deletes the session row and clears the cookie |

### Contacts — `actions/contacts.ts`

`createContact`, `updateContact`, `updateContactBirthday`, `patchContact`,
`snoozeContact`, `deleteContact`, `setContactArchived`.

`deleteContact` sweeps the contact's `CustomFieldValue` rows explicitly —
`entityId` is not a foreign key, so nothing cascades.

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
| Ideas | `createIdea`, `updateIdea`, `setIdeaStatus`, `deleteIdea` |
| Plans | `createPlan`, `updatePlan`, `setPlanStatus`, `deletePlan` |
| Tasks | `createTask`, `updateTask`, `setTaskDone`, `deleteTask` |
| Gifts | `createGift`, `updateGift`, `setGiftStatus`, `deleteGift` |
| Debts | `createDebt`, `updateDebt`, `settleDebt`, `deleteDebt` |
| Dietary needs | `createDietaryNeed`, `updateDietaryNeed`, `deleteDietaryNeed`, `updateAllergyStatus` |
| Relationships | `createRelationship`, `updateRelationship`, `deleteRelationship` |

`ContactMethod` and `Address` carry no `ownerId` of their own, so these are the
actions where the ownership check is indirect: each looks its row up through
`contact: { ownerId, ...contactPrivacyWhere(scope) }`. Passing an id alone
would be a way back into a private contact's phone number using an id
remembered from an unlocked session.

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
`plainDate`; no server-timezone conversion is involved.

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
both halves to their `former` counterparts; it never deletes.

### Dating — `actions/dating.ts`

`upsertRomanticProfile`, `setDatingStage`, `endRelationship`, `convertToFriend`,
`createDateEntry`, `updateDateEntry`, `deleteDateEntry`, `createFlag`,
`updateFlag`, `deleteFlag`.

Every one re-checks the lock. `createDateEntry` writes an `Interaction` **and**
a `DateEntry`, recomputes activity from full history, and renumbers `sequence`
so a date remembered late slots in where it happened. `deleteDateEntry` goes
through the `Interaction` so the pair cannot be left half-removed.
Create and update validate and persist the nullable `wouldDoAgain` and
`nextTimeNotes` retrospective fields. Saved-plan preparation notes are shown as
context and are never silently copied into that private retrospective.
`convertToFriend` clears `isRomantic` and keeps the profile, dates, flags and
notes. `updateFlag` can re-type a flag between green, red and dealbreaker: a
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

Every place a lookup can be reached from is behind an explicit button. See
[privacy.md](privacy.md) for what is sent.

### Customization

| File | Actions |
| --- | --- |
| `actions/taxonomy.ts` | `createTerm`, `updateTerm`, `setTermActive`, `deleteTerm`, `moveTerm`, `restoreMissingDefaults` |
| `actions/custom-fields.ts` | `createFieldDefinition`, `updateFieldDefinition`, `setFieldActive`, `deleteFieldDefinition`, `moveFieldDefinition` |
| `actions/dashboard.ts` | `setWidgetEnabled`, `moveWidget`, `setWidgetSetting`, `resetDashboardLayout` |
| `actions/settings.ts` | `updateAppearance`, `updateDefaults` |

`deleteTerm` refuses while the term is still referenced — the foreign keys
would null the reference or cascade the row away. `setTermActive(false)` is the
supported alternative. A relationship type keeps its reciprocal paired in both
directions, and `metadata` is not editable from the UI because family tiers and
pipeline ordering are read from it by code.

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
must not stop you recording its address. It sends fixed copy with nothing
interpolated, because Settings stays reachable while the privacy lock is
closed and this is the one button there that could otherwise put a private
person's name on the wire. It writes no `ReminderLog`: the ledger's unique key
is the occurrence, and a test has none. It is rate-limited per channel, being
a public POST that makes an outbound request to a caller-supplied URL.

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

## The one HTTP endpoint

`GET /api/health` → `200` with `{ status, database, setup, latencyMs, version,
uptimeSeconds }`, or `503` with `{ status: "error", database: "down", message }`.
`cache-control: no-store`, runtime `nodejs`, `force-dynamic`.

`setup` is `"complete"` or `"pending"`, so an operator can tell a
booted-but-unconfigured instance from a working one without opening a browser.
