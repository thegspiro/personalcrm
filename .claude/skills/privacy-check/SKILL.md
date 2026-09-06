---
name: privacy-check
description: How the privacy lock is enforced in Personal CRM, and what a change has to do to stay inside it. Use when adding or editing anything under src/server/queries/ or src/server/actions/, when a model gains or uses isPrivate, when adding a count, total, badge or aggregate, when touching src/server/privacy/, offline caching, public/sw.js, or when reviewing a change for cross-owner or private-data exposure.
---

# The privacy lock

Authoritative text: **docs/privacy.md**, **AGENTS.md → Ownership and privacy**,
**Agent.md section 6**, **CLAUDE.md invariants 3 and 4**. Read the current
versions.

Cross-owner exposure or private-data leakage is a blocking correctness failure,
not a bug to file.

## The four things a change must satisfy

1. **Filter in the query, never in the component.** With server components a
   hidden section's rows have already been fetched and serialised into the
   payload before anything decides not to render them. Use the fragments in
   `src/server/privacy/where.ts` — `contactPrivacyWhere`, `factPrivacyWhere`,
   `interactionPrivacyWhere`, `viaContactPrivacyWhere` and the rest.

2. **Counts are disclosures.** A total that shifts when the lock opens tells
   the observer exactly what it was meant to hide. Aggregates take the same
   where-fragment as the rows.

3. **Every server action is an untrusted public POST.** Re-validate input,
   re-check the lock, scope by `ownerId`. The page having been gated is not a
   guarantee — the action is reachable without it.

4. **Offline eligibility.** A model carrying `isPrivate` must be counted in
   `countPrivateRows` (`src/server/privacy/counts.ts`). Caching is only offered
   when the server has proven the account is safe to cache — lock closed, or
   nothing private exists. Missing the count fails silently: caching stays on
   and the private row is written to disk by the service worker.

## Where the pieces live

| File | What it holds |
| --- | --- |
| `src/server/privacy/lock.ts` | lock state |
| `src/server/privacy/where.ts` | the where-fragments, one per model |
| `src/server/privacy/counts.ts` | `countPrivateRows` — offline eligibility |
| `src/server/privacy/offline.ts` | whether a page may be cached |
| `src/server/privacy/filter.ts` | `privacyScope()` — the request-scoped scope every query passes to a fragment |

## Adjacent rules that bite

- Anchor date calculations to `UserContext.timezone`, never `process.env.TZ` or
  the server clock — an overdue list computed in the wrong zone discloses a
  different set of people.
- A line naming a private contact never leaves the machine, whatever the AI or
  geo toggle says (`src/server/ai/`, `src/server/geo/`).

## Validating it

```bash
npx vitest run tests/integration/privacy.test.ts
npx playwright test tests/e2e/privacy.spec.ts
npx playwright test tests/e2e/offline.spec.ts
```

Write the test that opens the lock and asserts the count *changes*, and the one
that leaves it closed and asserts the row is absent from the payload — not just
absent from the screen.
