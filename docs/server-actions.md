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
| `loginAction` | Failures are indistinguishable between an unknown email and a wrong password |
| `setupAction` | First-run wizard; the first account becomes `ADMIN`, a label nothing checks yet. Hands off to `/welcome` |
| `signupAction` | Refused when `DISABLE_SIGNUP=true` |
| `logoutAction` | Deletes the session row and clears the cookie |
| `currentUserAction` | |

### Contacts — `actions/contacts.ts`

`createContact`, `updateContact`, `patchContact`, `snoozeContact`,
`deleteContact`, `setContactArchived`.

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
| Facts | `createFact`, `updateFact`, `deleteFact` |
| Important dates | `createImportantDate`, `updateImportantDate`, `deleteImportantDate` |
| Significant moments (`LifeEvent`) | `createLifeEvent`, `updateLifeEvent`, `deleteLifeEvent` |
| Ideas | `createIdea`, `updateIdea`, `setIdeaStatus`, `deleteIdea` |
| Plans | `createPlan`, `updatePlan`, `setPlanStatus`, `deletePlan` |
| Tasks | `createTask`, `updateTask`, `setTaskDone`, `deleteTask` |
| Gifts | `createGift`, `updateGift`, `setGiftStatus`, `deleteGift` |
| Debts | `createDebt`, `updateDebt`, `settleDebt`, `deleteDebt` |
| Dietary needs | `createDietaryNeed`, `updateDietaryNeed`, `deleteDietaryNeed` |
| Relationships | `createRelationship`, `updateRelationship`, `deleteRelationship` |

Life-event ranges compare the possible interval represented by each partial
date. The create and update actions reject only ranges that are definitively
inverted and return the problem against `endDate`; overlapping fuzzy dates
remain valid.

`createRelationship` writes **both** reciprocal rows under one `pairId`;
`updateRelationship` re-types both and keeps the `pairId`; `deleteRelationship`
removes both. `settleDebt` records a date rather than deleting the row.

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

`unlockPrivacyAction`, `lockPrivacyAction`, `setPinAction`, `clearPinAction`,
`updatePrivacyPreferences`, `setPrivate`.

`setPrivate` is refused while locked — otherwise a row vanishes with no way back
to it.

### AI settings — `actions/ai-settings.ts`

`updateAiEnabled`, `saveAiConnection`, `removeApiKey`. A connection is tested
against the provider before it is stored; the key is encrypted at rest and
never shown again.

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

`GET /api/health` → `200` with `{ status, database, latencyMs, version,
uptimeSeconds }`, or `503` with `{ status: "error", database: "down", message }`.
`cache-control: no-store`, runtime `nodejs`, `force-dynamic`.
