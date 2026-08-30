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

An unlock lasts **15 minutes of inactivity** (`IDLE_TIMEOUT_MS`), refreshed as
you use the app.

### Enforcement is in the query layer, not in components

[`src/server/privacy/where.ts`](../src/server/privacy/where.ts) exports
where-fragments applied to the queries themselves:

| Fragment | Applied to |
| --- | --- |
| `contactPrivacyWhere` | Contact queries |
| `factPrivacyWhere` | Fact queries |
| `debtPrivacyWhere` | Debt queries |
| `interactionPrivacyWhere` | Interactions — withheld if the row is private **or any participant is** |
| `viaContactPrivacyWhere` | Anything reached through a contact |

> A component that renders nothing is not a lock. With server components the
> rows would already have been fetched and serialised into the payload sent to
> the browser. Filtering at the query means locked content never leaves the
> database.

**Counts are filtered too.** A total that shifts when you unlock is itself a
disclosure.

The module is deliberately pure and free of request context so it can be tested
directly against a database; [`filter.ts`](../src/server/privacy/filter.ts)
supplies the live scope.

### What "private" applies to

`isPrivate` exists on `Contact`, `Fact`, `Interaction` and `Debt`. Marking a
contact private hides everything beneath them.

`DietaryNeed` deliberately has no `isPrivate` — an allergy behind a PIN is a
decorative allergy. Genuinely sensitive dietary context belongs in a private
`Fact`.

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
- **Failed PIN attempts back off**, counted on the `User` row rather than the
  session, so clearing cookies does not reset a lockout. Five failures before
  backoff starts; it tops out at 15 minutes.
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

### Locking or signing out wipes it

A saved copy of a page seen while unlocked would make the lock decorative.

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

| Source | Behaviour |
| --- | --- |
| `AI_API_KEY` (or `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`) | Wins. Keeps the key out of the database and therefore out of your backups. Cannot be edited from the app |
| Pasted in Settings | Verified against the provider before being stored, encrypted with **AES-256-GCM** under a key derived (HKDF) from the `authSecret` in `/config`, and never shown again |

That protects a key sitting in a backup file. It does not protect against
someone holding both the database and `/config`, and nothing claims it does. A
key that will not decrypt — after a rotated `AUTH_SECRET`, say — is treated as
absent rather than as an error.

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

## What the app never does

- No telemetry, no analytics, no crash reporting. `NEXT_TELEMETRY_DISABLED=1`
  is set in the image.
- No outbound request at all unless assisted reading is switched on and
  configured.
- No third-party fonts, scripts or asset CDNs at runtime.
