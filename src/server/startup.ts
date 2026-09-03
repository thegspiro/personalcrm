import "server-only";
import { prisma } from "@/server/db/client";
import { provisionTaxonomies } from "@/server/taxonomy/provision";
import { purgeExpiredSessions } from "@/server/auth/session";

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

  await reportSchemaRepairs();
}

/**
 * Say out loud what the same-owner-keys migration had to remove.
 *
 * A migration cannot write to the container log, and rows deleted silently are
 * not something an operator should have to read a diff to discover. The
 * migration leaves the counts behind only when there was something to remove,
 * so on every healthy installation this finds nothing and says nothing. The
 * row is cleared once reported, so it is said once rather than at every boot.
 */
const SCHEMA_REPAIR_KEY = "schemaRepair.sameOwnerJoinKeys";

async function reportSchemaRepairs(): Promise<void> {
  try {
    const record = await prisma.appSetting.findUnique({
      where: { key: SCHEMA_REPAIR_KEY },
    });
    if (!record) return;
    const counts = record.value as { contactTags?: number; locationAliases?: number };
    console.warn(
      `[startup] the same-owner key migration removed ${counts.contactTags ?? 0} tag ` +
        `assignment(s) and ${counts.locationAliases ?? 0} place alias(es) that joined ` +
        "records belonging to different accounts. The application cannot create such a " +
        "row; they came from an import or a restore, and nothing could see them. See " +
        "docs/data-model.md.",
    );
    await prisma.appSetting.delete({ where: { key: SCHEMA_REPAIR_KEY } });
  } catch (error) {
    console.error("[startup] could not report schema repairs:", error);
  }
}
