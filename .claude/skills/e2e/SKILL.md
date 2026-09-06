---
name: e2e
description: Running the Playwright end-to-end suite for Personal CRM, including starting the app it needs. Use when a change touches the UI, navigation, forms, the privacy lock, offline behaviour or a user workflow; when asked to run Playwright, e2e or a .spec.ts file under tests/e2e/; when an e2e test fails and needs diagnosing; or when the final gate calls for end-to-end validation before a push or PR.
---

# End-to-end

`playwright.config.ts` targets an **already-running instance** — deliberately,
so the same suite can be pointed at `next start`, at this runner, or at the
built container via `E2E_BASE_URL`. So `npx playwright test` on its own fails
with connection refused unless something is already serving `127.0.0.1:3200`.

`run-e2e.sh` is that something. It does what the CI job does, in order:

```bash
.claude/skills/e2e/run-e2e.sh                             # the whole suite
.claude/skills/e2e/run-e2e.sh tests/e2e/privacy.spec.ts   # one file
.claude/skills/e2e/run-e2e.sh --project=mobile            # one project
.claude/skills/e2e/run-e2e.sh -g "the wrong PIN"          # one case
```

Arguments pass straight through to `playwright test`. Expect several minutes:
the suite runs `workers: 1` because it shares one instance and one account.

## What it does, and why each step is there

1. **`prisma migrate deploy`, then `reset-db.mjs`** against `E2E_DATABASE_URL`.
   The `first-run` project creates the account the other two sign in with, so
   the database has to start with no account in it. Migrations run first so a
   table added since the last run exists and gets swept too. `reset-db.mjs`
   truncates rather than dropping — narrower than `migrate reset`, and the same
   shape as `reset()` in `tests/integration/db.ts`. It refuses any database
   whose name does not end in `_e2e`, and `run-e2e.sh` refuses `personalcrm`
   and `personalcrm_test` by name before that.
2. **`npm run build`**, then copying `public/` and `.next/static` into
   `.next/standalone/`. `output: "standalone"` traces only the modules the
   server needs; the assets are copied separately, exactly as the Dockerfile
   and the CI job do it. Skip this and the app boots with every asset 404ing.
3. **Start `.next/standalone/server.js`** — the bundle the container ships, not
   `next dev`, so what is tested is what is released. It polls
   `/api/health` until the app answers, and gives up if the process dies first.
4. **Run Playwright**, then kill the server from an `EXIT` trap so a failed run
   never leaves one holding the port. On failure it prints the tail of
   `.devtmp/e2e/server.log`, which is where a 500 during a test explains itself.

`DATABASE_URL` is exported for the Playwright process as well as the app.
`tests/e2e/privacy.spec.ts` builds its own `new PrismaClient()` to age a
session's unlock, and with no override that client reads `.env` — the dev
database — while the app under test is on the e2e one, so the session it looks
for does not exist. CI never sees this because there `DATABASE_URL` is set for
the whole job.

## What it needs

`E2E_DATABASE_URL`, pointing at a throwaway database whose name ends in `_e2e`.
In a web session `.claude/hooks/session-start.sh` creates `personalcrm_e2e` and
writes the variable into `.env`. Locally, add it yourself.

Chromium: if `PLAYWRIGHT_CHROMIUM_PATH` is unset and `/opt/pw-browsers/chromium`
exists, the script uses it. The provisioned browser's build number often does
not match the Playwright release — 1.62 wants v1234 where the image ships v1194
— and launching the one that is here beats downloading a second copy.
`npx playwright install chromium` remains the fallback if it will not launch.

## When a test fails

- **`test-results/<test>/trace.zip`** — `npx playwright show-trace <path>` gives
  the DOM, network and console at every step. Read this before re-running.
- **`.devtmp/e2e/server.log`** — server-side errors. A failing assertion with
  nothing here is a client-side or timing problem; a 500 here is not.
- **The screenshot** in the same directory, for layout failures.

`retries: 0` is deliberate, so there is no retry to absorb a bad wait: a test
that passes on a second run has a race in it, not bad luck. Fix the wait —
assert on a condition the app actually reaches, never a fixed sleep — rather
than adding a retry. Do not skip or quarantine a test to get green.

`tests/e2e/layout.spec.ts` asserts no route scrolls horizontally; when it fails
the cause is usually a `truncate` whose flex or grid ancestor is missing
`min-w-0`, since both default to `min-width: auto`.
