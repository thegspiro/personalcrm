# First run

## What the container does before it serves anything

Startup is ordered, and each step refuses to let the next one begin if it
failed. Watching `docker logs -f personalcrm` on a first boot you'll see:

1. **`init-perms`** — creates the runtime user from `PUID`/`PGID` and makes
   `/config` writable by it.
2. **`init-preflight`** — checks what you supplied. Anything that would make the
   app subtly wrong rather than obviously broken is reported here, while the log
   is still short. A bad `APP_URL`, a `DATABASE_URL` that isn't MySQL, a
   non-numeric `PORT` or an unwritable `/config` stop the container. A typo in
   `TZ`, a trailing slash on `APP_URL`, or plain `http` on a real hostname are
   warnings — they're printed and boot continues.
3. **`init-mariadb`** — generates `secrets.json` if it isn't there, then creates
   the database on first boot. Skipped entirely when `DATABASE_URL` is set.
4. **`init-db-ready`** — waits for the database to accept connections.
5. **`init-migrate`** — applies any pending migrations. If this fails the app
   does not start, rather than running against a schema it doesn't match.
6. **`svc-app`** — the app, which prints the URL to open.

You can check the state from outside at any point:

```bash
curl -s http://127.0.0.1:3000/api/health
{"status":"ok","database":"up","setup":"pending","latencyMs":3,...}
```

`setup: "pending"` means the app is running and nobody has made an account yet.

## Setting up, in five steps

Open the URL. A fresh instance sends you to `/setup` and nowhere else.

**Step 1 — your account.** Name, email, password. **The first account created is
the administrator**, so make it yours. Nothing is emailed anywhere and no
account is created for you in advance; if this screen isn't showing, an account
already exists on this instance.

**Step 2 — about you.** Your name and, importantly, your timezone. Every
birthday, reminder and "overdue" calculation in the app is worked out in your
zone rather than the server's — a wrong one here quietly shifts all of them. It
is prefilled from your browser, which is nearly always right.

**Step 3 — make it yours.** Accent colour, density, and how often you want to be
reminded to reach out to someone new. This is also where you decide whether the
dating module appears at all. Turning it off hides it from navigation entirely;
you can turn it back on in Settings, and lock it behind a separate PIN there.

**Step 4 — your first few people.** Up to three, just names and how you know
them. This exists because an empty CRM has nothing to show you, and three people
is enough for the dashboard to make sense.

**Step 5 — put it on your home screen.** See below.

Every step can be skipped, and skipping is a decision rather than a deferral —
you go straight to the dashboard. Anything still outstanding turns up as a short
checklist there, which disappears on its own once you've added someone and
logged something.

## Installing to a home screen

Personal CRM is a PWA. Installed, it opens in its own window with no address bar
and its own icon, which on a phone is the difference between a bookmark and
something you reach for.

- **Android, Chrome, Edge** — an **Install** button appears on the step. That
  raises the browser's own install dialog.
- **iOS, Safari** — Apple provides no button for this, so the step shows the
  three taps instead: **Share** → **Add to Home Screen** → **Add**. It must be
  Safari; Chrome and Firefox on iOS cannot install.
- **Desktop Firefox** — cannot install web apps, and the step says so rather
  than offering a button that does nothing.

Installing does **not** put a copy of your data on the device — your server
still has to be reachable. Some pages do keep a copy for reading offline, and
say how old it is; see the **App** tab in Settings.

Each device installs separately. To install later, or on a second device, go to
**Settings → App**.

## Adding other people to the instance

The first account is recorded as the administrator and later ones as members.
Today that role is a label only — nothing in the app grants an administrator any
power an ordinary account doesn't have. It exists so that the accounts already
carry the right role when something does check it.

What is enforced is separation: every row in the database is owned by an
account, and every query is scoped to the account making it. Contacts, notes,
settings and taxonomies are entirely per-account, and no account can read
another's data regardless of role.

Anyone who can reach the page can create an account until you stop them, so once
your accounts exist set `DISABLE_SIGNUP=true` and restart.

## Next

[Backing up](backup.md) · [Upgrading](upgrade.md) · [Troubleshooting](troubleshooting.md)
