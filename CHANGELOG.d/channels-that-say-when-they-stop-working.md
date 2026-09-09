### Channels that tell you when they have stopped working — 2026-09-09

*Schema: `NotificationChannel.pausedAt`, `pauseReason`, `lastProbeAt`;
`ReminderLog.lastAttemptAt`. All nullable and additive; nothing is backfilled
and no existing value is re-expressed.*

#### Added
- **Settings → Reminders now says whether each channel is actually
  delivering.** A revoked Gotify token, a rotated SMTP password or a host that
  quietly started answering 404 used to look exactly like a week with nothing
  due: every failure was recorded in the ledger and nothing ever read it back.
  Each channel card now shows when it last delivered, the last failure and its
  reason, and how many reminders were given up on since it last worked. A new
  channel says nothing has been sent yet rather than claiming health — that
  being the same state a channel which will never work is in.
- **A channel that swallows a run of reminders is paused, and says so.** Three
  reminders that each used all five attempts is fifteen failed deliveries; no
  brief outage produces that. Pausing is deliberately *not* the on/off switch:
  "I turned this off" and "the app gave up on this" stay separate states, so
  resuming knows which one it is undoing.
- **A paused channel heals itself.** Once a day one real reminder is tried
  anyway, and anything getting through lifts the pause — a self-hosted box that
  comes back after an overnight upgrade recovers without you noticing it broke.
  A successful test send lifts it too, so fixing a token and pressing test is
  one step rather than two. There is also a **Send to it again** button.

#### Changed
- **The delivery ledger is pruned hourly**, ninety days after a reminder was
  delivered. Only policies whose occurrence cannot come round again are touched
  — the daily digest, important dates and plans. Overdue cadence and due-task
  rows are kept whatever their age, because the ledger row is the only thing
  stopping a second send and both of those regenerate an identical candidate
  every hour until you act on them: deleting one would not tidy history, it
  would re-send the reminder. Failed and abandoned rows are kept too; they are
  what a channel's health is read from.
