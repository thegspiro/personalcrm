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
| `lifeEventPrivacyWhere`          | Life events — withheld if the anchor contact is private, **or any participant is**              |
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

One predicate, `locationVisibleWhere`, expresses that and is shared by the
directory, the place page, quick add's venue matching and every edit action — so
a hidden place is neither offered back to you nor editable while locked, and
"that place wasn't found" is the only answer either way, since a distinguishable
error would itself confirm one exists. Typing its name still resolves to the
existing row rather than creating a duplicate.

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

### Counts, not only rows

Settings is reachable while the lock is closed, and it is full of totals: how
many records use a type, how many values a custom field holds. Those are
filtered by the same scope as the rows they count. An unfiltered total answers
"how many private people are filed under this" from a page the lock does not
gate, which is the whole reason the invariant covers counts.

Dating taxonomies and dating custom fields report nothing at all while locked,
rather than a number filtered row by row — the module is hidden whole, so a
count of it would be the only part still visible.

A total is filtered by the *same* predicate as the rows, not merely a similar
one. A life event has an anchor contact and any number of participants, and the
timeline withholds it when either is private; filtering the settings tally on
the anchor alone counted events the timeline was hiding, and reported their
type. Both now go through `lifeEventPrivacyWhere`, which is what the fragment
exists for — the rule had been hand-copied at four call sites and forgotten at
the fifth.

One count is deliberately **not** filtered: the guard that refuses to delete a
taxonomy term still in use. Filtering it would let a locked session delete a
term that private rows point at, cascading them away — the history-rewrite the
refusal exists to prevent. Only the *figure* is withheld: a locked session is
told something still uses the term, without the number.

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

### Where a channel may point

Any `http(s)` address, including one on your own network — that is how ntfy and
Gotify are meant to be run, and it is the case where nothing leaves the
building at all.

With one boundary: on an installation with more than one account, only an
administrator may aim a channel at a **private, loopback or link-local
address**. The server makes the request and reports what came back, so without
that line any member could use it to probe the host's own network. A
single-account install never meets it — the only account is the administrator.

That applies to an SMTP host as much as to a URL — an email channel names a
host and a port rather than an address, and it is opened from the server just
the same.

**Redirects are not followed.** An allowed address that answers with a redirect
to a refused one would otherwise walk straight through the boundary, since the
destination never passes back through it. A notification endpoint has no reason
to redirect; configure the address it points at.

**Literal addresses only, and that is a deliberate limit rather than an
oversight.** A hostname that resolves to a private address is not caught. Doing
so properly means resolving the name and then pinning the connection to the
address that was checked — otherwise the answer can change between the check
and the connection — in both the HTTP client and the mail transport. That is
not implemented; see [known gaps](README.md#known-gaps).

So the boundary raises the cost of probing rather than making it impossible. It
is worth having on those terms, and it is not worth mistaking for more. If the
people with accounts on your installation are not people you trust with an
outbound request from the server, `DISABLE_SIGNUP` is the control that actually
answers that, and it is the recommended posture anyway.

### Private contacts and the send

While the privacy lock is **switched on**, people marked private are excluded
from reminders entirely — whether or not you happen to be unlocked at the
moment the job runs. The hourly job has no request context and so cannot ask;
it reads the setting instead.

With the lock switched **off**, `isPrivate` is a display preference rather than
an access gate, and those contacts are included like anyone else. That follows
from what the lock is (see above), but it is worth saying plainly: turning the
lock off turns off this filter too.

## Optional address lookup

The third and last thing in the app that sends anything anywhere.
`src/server/geo/` is off by default: switched off, nothing in it runs and a
place's address is simply something you type.

Four rules, the same shape as the assisted reading's:

1. **Nothing is sent until you switch it on.** Off is the shipped state.
2. **Nothing is sent except when you press the button.** Never while you type,
   never on a page load, never in the background. An address does not leave the
   machine as a side effect of browsing. This also happens to be what
   Nominatim's usage policy requires — it forbids search-as-you-type outright —
   but it is the rule we would want regardless.
3. **Only the place's name and the address you typed.** Never the notes, never
   who was seen there, never anything about an interaction. A place is the only
   subject; the people are not part of the query.
4. **Nothing is written from the answer.** Candidates are shown, you pick one,
   and the write goes through `applyLocationLookup` like any other action. Every
   failure — not configured, timed out, an unreadable reply — returns no
   candidates rather than an error, and the field stays typeable.

What it stores is an OpenStreetMap object reference (`osmType` + `osmId`) plus
the address parts and coordinates. Nominatim's own `place_id` is deliberately
discarded: it is internal to one instance and does not survive a reimport.

### Endpoints

Nominatim (the OpenStreetMap Foundation's own, on donated servers), Photon, or
anything speaking the Nominatim `/search` shape. Both dialects can be pointed at
an instance on your own network, in which case nothing leaves it — Photon by
editing its endpoint, Nominatim through the self-hosted entry. Photon is the
lighter of the two to run. Plain `fetch`, no SDK, for the same
reason the AI layer uses none. Requests identify the application in their
`User-Agent`, which Nominatim's policy asks for and which is why a stock HTTP
library's default would be rejected.

## Sign-in throttling

The privacy lock has always backed off after repeated wrong PINs. The front
door did not, which left the secondary lock better defended than the primary
one. It does now, on the same schedule: five attempts at full speed, then a
wait doubling from five seconds to a ceiling of fifteen minutes, measured from
the last attempt. A successful sign-in clears the record; a run of failures is
forgotten after twenty-four hours, so five typos last week do not throttle the
first attempt today.

**What it is keyed on, and why.** One counter per *address-and-client pair*
(`LoginAttempt`), not a counter on the account. A counter on the account would
hand anyone who knows your email address a way to lock you out of it, which
trades one denial of service for another. The pair also means the throttle
covers addresses that have no account behind it — necessary, because a throttle
that only fired for real accounts would answer the question the login error
carefully refuses to: whether that address is one of ours. Both the refusal and
the rejection are the same for an address that has never existed.

**What it does not do.** The client half of the key is whatever the request
presents as `X-Forwarded-For` (falling back to `X-Real-IP`, then to no address
at all, which is counted as one group). Nothing verifies it. An attacker who
can vary that header can therefore have as many buckets as they like, and the
per-client dimension is worth exactly as much as the proxy in front of the app
— which, in the intended deployment, is one the operator controls and which
overwrites the header. What the throttle does buy unconditionally is that a
single client cannot grind through a password list, and that every attempt now
costs a counted, serialised write before any password is checked. It is not a
substitute for a strong password or for keeping the instance off the open
internet.

**Where it happens.** `registerLoginAttempt` runs *before* the password is
verified, so a burst of concurrent guesses cannot all read the same count and
pass the gate together. The bcrypt call is deliberately outside that
transaction: verifying a password takes a quarter of a second at this cost
factor, and holding a locked row across it would turn every sign-in into a
queue.

## What the app never does

- No telemetry, no analytics, no crash reporting. `NEXT_TELEMETRY_DISABLED=1`
  is set in the image.
- **Three ways out, all of them yours to open.** Assisted reading and address
  lookup are both off until switched on and configured, and neither sends
  anything except when you ask it to. Reminder delivery is the one that acts on
  its own, hourly — and only to channels you added yourself, so a fresh install
  has nowhere to send and sends nothing. What a reminder carries is written out
  under [What a reminder sends](#what-a-reminder-sends).
- No third-party fonts, scripts or asset CDNs at runtime.
