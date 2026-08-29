import "server-only";
import cron from "node-cron";
import { processImportantDateReminders } from "@/server/services/reminders";

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
  // Run at startup and hourly. Due-ness is calendar-day based in each user's
  // timezone; the idempotency ledger makes repeated passes safe.
  run();
  cron.schedule("0 * * * *", run);
}
