# Pending changelog entries

One file per change. At release they are folded into
[`CHANGELOG.md`](../CHANGELOG.md) in date order and deleted.

This exists for one reason: every change wants the top of `## [Unreleased]`, so
two branches that both edit `CHANGELOG.md` conflict by construction. It was the
most common merge conflict in this repository, and on several branches the only
one. Two new files never conflict.

## Writing one

Name it after the change — `milestone-summary.md`, `reminder-delivery.md`. The
name is scaffolding; only the heading is read.

The content is the section exactly as it will appear in the changelog:

```markdown
### Milestones at a glance — 2026-08-29

*Schema: none*

#### Added
- **A dedicated milestone summary on person profiles.** Up to the three most
  recent marked life events appear above the timeline, with a link to the full
  section. Every milestone stays in the chronological history rather than being
  moved or copied into a new record.
```

The heading carries an em dash and an ISO date. `*Schema:*` names the migrations
the change introduces, or `none` — it is the line someone upgrading reads first.
Use `#### Added` / `#### Changed` / `#### Fixed` when the entry has more than one
kind of thing in it.

Write for the person deciding whether to upgrade, not for the person reviewing
the diff: what is different now, and what it means for their data.

## Commands

Release folds entries in by date rather than stacking each batch on top, so
running it twice — a delayed branch contributing an older entry — still leaves
the section in date order. The heading date is validated as a real calendar
day, so `2026-99-99` is caught here rather than folded in permanently.

```bash
npm run changelog            # what is pending
npm run changelog:check      # validate the fragments (CI runs this)
npm run changelog:release    # fold them into CHANGELOG.md and delete them
```
