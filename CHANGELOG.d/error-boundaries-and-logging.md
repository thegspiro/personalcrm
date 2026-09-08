### A page that fails says so, and the log says why — 2026-09-06

*Schema: none*

#### Added
- **A page that fails to load now offers to try again instead of replacing the
  app.** A momentary database problem on any signed-in page used to hand the
  whole browser tab to React's bare error screen: no navigation, no way back,
  and nothing saying your data was still there. Every part of the app now has a
  boundary — the signed-in pages, sign-in and setup, the welcome flow, and a
  last-resort one for a failure in the shell itself — each keeping as much of
  the app as it safely can and showing a reference code that also appears in
  the container log, so a report and a log line can be matched up.
- **`LOG_LEVEL` and `LOG_FORMAT`.** Choose how much the container logs
  (`debug`, `info`, `warn`, `error`, `silent`) and whether lines are written for
  a person or as JSON for a log shipper. Both are optional, and leaving them
  unset produces the same lines as before with a timestamp and level in front of
  them, so an existing `grep` for `[startup]` or `[reminders]` still works.
  Warnings and errors now go to stderr rather than stdout.

#### Fixed
- **`/api/health` no longer publishes your database password.** When the
  database could not be reached, the endpoint returned the driver's own error —
  which quotes the connection string it failed on, host, user and password
  included — to anyone who could reach the port, with no sign-in required. It
  now answers with a fixed sentence and writes the real reason to the container
  log, where the troubleshooting guide already sends you, with the password
  masked. The success response and the `"database":"down"` marker that the
  Docker healthcheck depends on are unchanged.
- **Credentials are masked in the log itself, not at each call site.** Anything
  logged anywhere in the app now has passwords stripped out of connection
  strings, and any detail named after a secret replaced, before the line is
  written.
