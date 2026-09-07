### A policy that stops injected script — 2026-09-06

*Schema: none*

#### Added
- **A real Content-Security-Policy.** The app already refused to be framed and
  pinned where forms could submit, but nothing constrained where script could
  come from — so an injected `<script>` would simply have run. Every page now
  carries a policy built around a one-time value that Next puts on its own
  scripts and that injected markup has no way to obtain, so script an attacker
  gets onto a page does not execute. Images, styles, fonts and network calls are
  restricted to the app itself as well.
- **`CSP_REPORT_ONLY`.** The policy is enforced by default. Set this to `true`
  and violations are reported to the browser console without anything being
  blocked — the way back for a deployment the policy trips, without waiting for
  a new release.

#### Changed
- **The error screen no longer runs a script to pick its colours.** It is the
  one page that cannot be given the one-time value, so it now carries its own
  styling and follows your system's light or dark setting. If you had chosen a
  theme explicitly, that one page follows the system instead; everywhere else is
  unchanged.
