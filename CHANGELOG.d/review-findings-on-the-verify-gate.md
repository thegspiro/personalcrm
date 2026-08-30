### Sharper service-worker and changelog checks — 2026-08-30

*Schema: none*

#### Fixed
- **The service-worker check now uses the grammar the browser uses.** It parsed
  with `node --check`, and `package.json` declares `"type": "module"`, so
  `import`, `export` and top-level `await` were accepted in a file both
  registrations load as a *classic* worker, where all three are syntax errors.
  It now compiles with classic-script grammar, so the gate rejects what the
  browser would.
- **A changelog heading dated `2026-99-99` no longer passes validation.** The
  check tested the digit pattern rather than the date, so a typo would have been
  folded into the changelog permanently at release.
- **Folding entries twice keeps them in date order.** Each release inserted its
  batch at the top and sorted only the pending files, so a delayed branch's
  older entry landed above a newer one already folded in.
- **The pull-request template asks for `npm run verify`**, not the three
  commands it replaced — following the checklist skipped lint, the
  service-worker check and changelog validation.
