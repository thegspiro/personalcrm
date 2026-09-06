### Complete reminder scheduling — 2026-09-02

*Schema: `20260902120000_add_reminder_policy_and_dedup_key`*

#### Added
- **Cadence, due-task, and timezone-aware daily digest notifications.** Every
  configured channel now receives the reminders enabled for its owner, without
  including archived or locked-private people. A cadence counts as due for the
  whole of its local day, the way the overdue list already reads it.
- **Daily digest controls.** Settings → Reminders gains a switch for the digest
  and the local hour after which it is sent, so the one message the app sends
  on its own initiative can be stopped without deleting every channel.

#### Changed
- **Reminder retries now re-check current state and privacy.** Completed tasks,
  corrected dates, changed policies, archived people, and newly locked private
  content cancel a queued retry; one that still stands is sent even after the
  day it was owed on, worded for the day it goes out. Every delivery has a
  durable policy-specific deduplication key.
