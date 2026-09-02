### Complete reminder scheduling — 2026-09-02

*Schema: `20260902120000_add_reminder_policy_and_dedup_key`*

#### Added
- **Cadence, due-task, and timezone-aware daily digest notifications.** Every
  configured channel now receives the reminders enabled for its owner, without
  including archived or locked-private people.

#### Changed
- **Reminder retries now re-check current state and privacy.** Completed tasks,
  changed policies, archived people, and newly locked private content cancel a
  queued retry, and every delivery has a durable policy-specific deduplication key.
