import "server-only";
import { prisma } from "@/server/db/client";
import { provisionTaxonomies } from "@/server/taxonomy/provision";
import { purgeExpiredSessions } from "@/server/auth/session";
import { purgeStaleLoginAttempts } from "@/server/auth/login-throttle";
import { startReminderScheduler } from "@/server/reminder-scheduler";

let started = false;

/**
 * Idempotent boot tasks. Failures are logged and swallowed: none of this is
 * required to serve a request, and a container that refuses to start is far
 * worse than one missing a housekeeping pass.
 */
export async function runStartupTasks(): Promise<void> {
  if (started) return;
  started = true;
  startReminderScheduler();

  try {
    // An upgrade can add new default taxonomy terms; existing accounts get them
    // here rather than needing a manual seed run.
    const users = await prisma.user.findMany({ select: { id: true } });
    for (const user of users) {
      await prisma.$transaction((tx) => provisionTaxonomies(tx, user.id));
    }
    if (users.length > 0) {
      console.log(`[startup] taxonomies verified for ${users.length} account(s)`);
    }
  } catch (error) {
    console.error("[startup] taxonomy backfill failed:", error);
  }

  try {
    const removed = await purgeExpiredSessions();
    if (removed > 0) console.log(`[startup] cleared ${removed} expired session(s)`);
  } catch (error) {
    console.error("[startup] session cleanup failed:", error);
  }

  try {
    // Rows past the retention window never block anyone; this only stops the
    // table growing without bound on an instance that is scanned regularly.
    const removed = await purgeStaleLoginAttempts();
    if (removed > 0) console.log(`[startup] cleared ${removed} stale sign-in attempt(s)`);
  } catch (error) {
    console.error("[startup] sign-in attempt cleanup failed:", error);
  }
}
