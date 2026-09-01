# Privacy, the lock, and where data goes

Three separate mechanisms, often confused with each other:

1. **The privacy lock** — a secondary PIN gating the dating module and anything
   marked private.
2. **Offline caching** — what the service worker is allowed to write to disk.
3. **Optional assisted reading** — the only feature that can send anything off
   the machine, off by default.

## What the lock is, precisely

An **access gate** against someone holding your already-unlocked device — a
partner, a colleague, a borrowed laptop.

**It is not encryption.** Every row is stored in plain text. Anyone who can read
`/config` or a database backup can read this data whether or not a PIN is set.
The setup screen says so rather than implying protection it does not have.

Two design decisions carry the whole thing:

### Unlock state lives on the server

`Session.privacyUnlockedAt` is a column on the session row — never a cookie,
never client state. A client cannot claim to be unlocked, and the unlock dies
with the session rather than lingering after sign-out.

An unlock lasts **15 minutes of inactivity** (`IDLE_TIMEOUT_MS`). “Activity” is
successful use of protected content: opening dating views, reading
private-capable records, or completing a guarded write. Ordinary public page
requests do not keep the lock open.

The authenticated browser shell listens for pointer, keyboard, touch, scroll,
and focus activity while protected content is rendered. It sends at most one
heartbeat per minute, and the server accepts that heartbeat only if the session
is still unlocked; a late heartbeat cannot revive an expired unlock. At the
deadline the shell immediately replaces its rendered children, purges protected
offline state, and navigates to the unlock screen. This browser behavior limits
what remains on screen, but is not authorization: every later read and write is
still gated on the server.

### Enforcement is in the query layer, not in components

[`src/server/privacy/where.ts`](../src/server/privacy/where.ts) exports
where-fragments applied to the queries themselves:

| Fragment                         | Applied to                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| `contactPrivacyWhere`            | Contact queries                                                                                 |
| `factPrivacyWhere`               | Fact queries                                                                                    |
| `debtPrivacyWhere`               | Debt queries                                                                                    |
| `interactionPrivacyWhere`        | Interactions — withheld if the row is private, **or any participant is, or anyone mentioned is** |
| `viaContactPrivacyWhere`         | Anything reached through a contact                                                              |
| `viaOptionalContactPrivacyWhere` | Anything whose contact is optional — a task or idea can stand on its own                        |
| `householdPrivacyWhere`          | Household lists — a household with a private member can name them in its own title or notes     |

`viaOptionalContactPrivacyWhere` cannot be `viaContactPrivacyWhere` dropped into
an `OR` beside `{ contactId: null }`: that fragment is `{}` when unlocked, and an
empty member of an `OR` matches nothing rather than everything. That inversion
emptied the list for exactly the accounts entitled to see all of it — including
every account that never switched the lock on, which is unlocked by definition.

> A component that renders nothing is not a lock. With server components the
> rows would already have been fetched and serialised into the payload sent to
> the browser. Filtering at the query means locked content never leaves the
> database.

**Counts are filtered too.** A total that shifts when you unlock is itself a
disclosure.

The Places directory derives its visits, people, rankings and last-visited
dates only from interactions admitted by `interactionPrivacyWhere`. A place
known solely through hidden interactions is not listed while locked. Plans at
a place inherit the privacy of their optional contact.

The module is deliberately pure and free of request context so it can be tested
directly against a database; [`filter.ts`](../src/server/privacy/filter.ts)
supplies the live scope.

### What "private" applies to

`isPrivate` exists on `Contact`, `Fact`, `Interaction` and `Debt`. Marking a
contact private hides everything beneath them.

`DietaryNeed` deliberately has no `isPrivate` — an allergen or emergency
instruction behind a PIN is decorative safety information. This includes food,
medication and environmental allergies. Genuinely sensitive diagnosis context
belongs in a private `Fact`; all allergy data is still hidden when its contact
is private.

### Dating is gated differently from private rows

Romantic contacts stay visible in People while locked; only their dating
sections are withheld. A person vanishing from your contact list is its own
tell. Hiding someone entirely is what marking them private is for.

`UserPreference.hideDating` is the stronger option: the module disappears from
navigation and the dashboard altogether.

### Rules the write paths enforce

- **Every dating write re-checks the lock.** Server actions are public POST
  endpoints; they do not trust that the page was gated.
- **Date retrospectives stay in the locked dating layer.** Repeat-date queries
  are owner-scoped and run only after unlock; private `nextTimeNotes` are never
  copied into the non-private `Plan.notes` field.
- **Marking something private is refused while locked** — otherwise a row
  vanishes with no way back to it.
- **Disabling the lock requires authorization on the server.** The current
  session must already be unlocked or the current PIN must verify. General
  preference form data cannot switch the lock off.
- **Failed PIN attempts back off**, counted on the `User` row rather than the
  session, so clearing cookies does not reset a lockout. Five failures before
  backoff starts; it tops out at 15 minutes. Unlock, PIN replacement, and PIN
  removal use the same counter, and each verification locks the account row so
  simultaneous requests cannot lose attempts or cross the threshold unchecked.
- **The PIN is a different secret from the password.** Handing someone your
  login should not hand them this.

## Offline caching

Pages you have visited stay readable with no connection. Queued writes are
deliberately **not** implemented: everything non-GET goes straight to the
network and fails honestly rather than pretending something was saved.

Two rules shape the service worker:

### Nothing is cached unless a page asks

The default is not to store. A page opts in only when the server has decided it
is safe, which is true in exactly two situations
([`offline.ts`](../src/server/privacy/offline.ts)):

1. **The lock is on and closed.** Every query has already excluded private rows
   by construction, so what lands on disk is precisely what someone holding your
   unlocked phone could see anyway.
2. **There is nothing private in the account at all** — the common case for
   someone who has never used the marker.

One contact marked private, with the lock off, and the whole account stops being
cacheable. Guessing from URL patterns instead would mean one missed pattern
quietly writes someone's private notes to disk.

> `countPrivateRows` in [`counts.ts`](../src/server/privacy/counts.ts) must gain
> a line for **every** model that gains an `isPrivate` column. The cost of
> forgetting is silent: offline caching stays on and the private row is written
> to disk.

### What a cached contact page holds

Worth knowing rather than discovering: a contact page cached for offline
reading carries everything that page shows, which now includes phone numbers,
email addresses, handles and postal addresses alongside the facts, allergies
and dietary notes that were already there. That is the same rule as before —
what lands on disk is what the page rendered — but the contents got more
sensitive when the reach-them sections landed, and "cache this page" is a
decision worth making with that in mind.

`ContactMethod` and `Address` carry no `isPrivate` of their own, by design: a
phone number is not separately hideable from the person it belongs to. They
inherit the contact's state, so a private contact's number is withheld exactly
when the contact is, and never reaches the cache while the lock is closed.

### Locking or signing out wipes it

A saved copy of a page seen while unlocked would make the lock decorative.

Settings also has a manual recovery action. It unregisters the Personal CRM
worker and deletes only caches whose names begin with `pcrm-`, then reloads the
app. This is deliberately narrower than clearing all origin storage: recovery
from a broken offline setup must not erase unrelated browser data.

### Updates wait for consent

A newly installed worker waits when an older generation already controls the
page. The app announces that the update is ready and sends an explicit
activation message only after “Reload to update” is chosen. It then waits for
the browser's `controllerchange` event before reloading, so the refreshed page
cannot race ahead while the old generation is still in control. Repeated
registration failures are shown as a non-blocking warning with the Settings
recovery path rather than being silently ignored.

### Staleness is shown, not hidden

Every offline page carries how old it is, **to the minute** — day-granular
relative time makes ten minutes and twenty hours both read as "today" when only
one of them should worry you. The worker is network-first rather than
cache-first for the same reason: a cadence computed from a week-old copy will
tell you someone is fine when they are not.

## Optional assisted reading

Quick add parses **locally** — [`src/lib/quick-parse.ts`](../src/lib/quick-parse.ts),
no key, no account, no network, always on. The optional layer in
`src/server/ai/` only produces a better reading of awkward phrasing, and only
once you switch it on and point it at a provider.

Four rules hold it in place:

1. **Nothing is sent until you switch it on**, and the settings copy says
   plainly what goes where.
2. **A line naming someone you marked private never leaves the machine**,
   whatever the toggle says. A PIN is not consent to transmit. The UI says so
   when it happens.
3. **Nothing is written from a model response.** The parse fills a form you
   confirm. The model never sees or returns a database id, so it cannot address
   a row; names come back as written and are resolved on our side.
4. **Every failure falls back silently** to the local reading — no key, no
   network, a timeout, a response that does not fit.

The assisted answer is run back through the local matcher rather than trusted,
so the shared-name rule still holds: an assisted parse cannot do what the local
parse refuses to do (two contacts called John block the save until you pick).

### Where the key lives

| Source                                                                      | Behaviour                                                                                                                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_API_KEY` (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) | Wins. Keeps the key out of the database and therefore out of your backups. Cannot be edited from the app                                                               |
| Pasted in Settings                                                          | Verified against the provider before being stored, encrypted with **AES-256-GCM** under a key derived (HKDF) from the `authSecret` in `/config`, and never shown again |

That protects a key sitting in a backup file. It does not protect against
someone holding both the database and `/config`, and nothing claims it does. A
key that will not decrypt — after a rotated `AUTH_SECRET`, say — is treated as
absent rather than as an error.

**Notification channel credentials** — the SMTP password, a webhook bearer
token — are encrypted the same way, under a *separate* key derived with its own
purpose string, so a ciphertext written for one cannot decrypt as the other.
They differ from the API key in what happens when one cannot be read: delivery
**stops**, rather than degrading to absent. An unauthenticated SMTP login, or a
POST to a third-party host with its Authorization header quietly missing, is a
request that still leaves — just without its credential. The channel is flagged
in Settings until it is re-entered.

Rotating `AUTH_SECRET` therefore invalidates the stored API key *and* every
channel credential.

### Providers

Provider-neutral by construction: an OpenAI-compatible endpoint covers OpenAI,
Google's Gemini compatibility layer, Open WebUI, Ollama, LM Studio, vLLM and
anything else speaking that shape; Anthropic gets a small adapter because its
request format differs. Plain `fetch` rather than a vendor SDK — shipping one
provider's client library would quietly make that provider the default.

A self-hosted endpoint is a first-class choice: its address is editable, no key
is required, and nothing leaves your network if the endpoint doesn't. Replies
are read forgivingly (fenced, prefaced with prose, or wrapped in an array),
because smaller local models do all three.

## Reminder delivery

The one part of the app that reaches the network on its own. An hourly job
(`src/server/reminder-scheduler.ts`) looks for important dates coming due and
delivers them through the channels added under **Settings → Reminders**. No
channel, no outbound request — a fresh install has none, so nothing leaves the
machine until you say where it should go.

### What a reminder sends

More than most people assume, so it is written out here rather than left to be
discovered:

| Field | Example |
| --- | --- |
| The date's label | `Anniversary` |
| The contact's first and last name | `Dana Whitfield` |
| The occurrence date | `2026-09-14` |
| How far out it is | `in 7 days` |

That goes to whatever host the channel names, on the hour, with no preview and
no confirmation step. A retry after a failure sends a shorter body carrying the
scheduled date only.

**Email is different in kind from the rest.** An ntfy, Gotify or webhook URL can
point at a box on your own network, and then nothing leaves it. SMTP goes
through a mail relay — a third party unless you run your own — and the contents
of every reminder sit in that relay's logs.

### Private contacts and the send

While the privacy lock is **switched on**, people marked private are excluded
from reminders entirely — whether or not you happen to be unlocked at the
moment the job runs. The hourly job has no request context and so cannot ask;
it reads the setting instead.

With the lock switched **off**, `isPrivate` is a display preference rather than
an access gate, and those contacts are included like anyone else. That follows
from what the lock is (see above), but it is worth saying plainly: turning the
lock off turns off this filter too.

## What the app never does

- No telemetry, no analytics, no crash reporting. `NEXT_TELEMETRY_DISABLED=1`
  is set in the image.
- No outbound request for assisted reading unless it is switched on and
  configured. Reminder delivery is the other way out, and only to the
  channels you add yourself — see [What a reminder sends](#what-a-reminder-sends).
- No third-party fonts, scripts or asset CDNs at runtime.
