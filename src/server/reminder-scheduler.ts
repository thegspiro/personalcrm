import "server-only";
import cron from "node-cron";
import { processImportantDateReminders } from "@/server/services/reminders";
import { pruneLoginAttempts } from "@/server/auth/login-throttle";

let scheduled = false;

export function startReminderScheduler(): void {
  if (scheduled) return;
  scheduled = true;
  const run = () => void processImportantDateReminders().then(
    ({ sent, failed }) => {
      if (sent || failed) console.log(`[reminders] sent ${sent}; failed ${failed}`);
    },
    (error) => console.error("[reminders] scheduler failed:", error),
  );

  // Housekeeping for the sign-in limiter, riding the hourly tick rather than
  // adding a second schedule. Its size is bounded by construction, so this is
  // only about not holding entries nobody will read again — and about leaving
  // room free, so admitting a new pair rarely has to evict anything.
  const sweep = () => {
    const removed = pruneLoginAttempts();
    if (removed > 0) console.log(`[auth] pruned ${removed} spent sign-in counter(s)`);
  };

  // Run at startup and hourly. Due-ness is calendar-day based in each user's
  // timezone; the idempotency ledger makes repeated passes safe.
  run();
  cron.schedule("0 * * * *", () => {
    run();
    sweep();
  });
}
