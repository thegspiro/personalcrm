import "server-only";
import cron from "node-cron";
import { processReminderDeliveries, pruneReminderLog } from "@/server/services/reminders";
import { pruneLoginAttempts } from "@/server/auth/login-throttle";
import { createLogger } from "@/server/log";

const log = createLogger("reminders");
const authLog = createLogger("auth");

let scheduled = false;

export function startReminderScheduler(): void {
  if (scheduled) return;
  scheduled = true;
  const run = () => void processReminderDeliveries().then(
    ({ sent, failed }) => {
      if (sent || failed) log.info("delivery pass finished", { sent, failed });
    },
    (error) => log.error("scheduler pass failed", error),
  );

  // Housekeeping for the sign-in limiter, riding the hourly tick rather than
  // adding a second schedule. Its size is bounded by construction, so this is
  // only about not holding entries nobody will read again — and about leaving
  // room free, so admitting a new pair rarely has to evict anything.
  const sweep = () => {
    const removed = pruneLoginAttempts();
    if (removed > 0) authLog.info("pruned spent sign-in counters", { removed });
    // Delivered rows whose occurrence cannot come round again. Riding the same
    // hourly tick rather than adding a schedule, and after the delivery pass
    // rather than before it, so a row written this hour is never a candidate
    // for its own retention window.
    void pruneReminderLog().then(
      (pruned) => { if (pruned > 0) log.info("pruned delivered reminders", { pruned }); },
      (error) => log.error("ledger prune failed", error),
    );
  };

  // Run at startup and hourly. Due-ness is calendar-day based in each user's
  // timezone; the idempotency ledger makes repeated passes safe.
  run();
  cron.schedule("0 * * * *", () => {
    run();
    sweep();
  });
}
