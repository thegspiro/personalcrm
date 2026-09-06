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
 * Say out loud what the same-owner-key migrations had to remove.
 *
 * A migration cannot write to the container log, and rows deleted silently are
 * not something an operator should have to read a diff to discover. The
 * migration leaves the counts behind only when there was something to remove,
 * so on every healthy installation this finds nothing and says nothing. The
 * row is cleared once reported, so it is said once rather than at every boot.
 */
const JOIN_KEY_REPAIR = "schemaRepair.sameOwnerJoinKeys";
const CONTACT_KEY_REPAIR = "schemaRepair.sameOwnerContactKeys";

/**
 * Counts as numbers, whatever the migration managed to store.
 *
 * A MariaDB user variable read back through the prepared-statement protocol
 * arrives as a string, so `JSON_OBJECT('deleted', @count)` can land as `"12"`
 * rather than `12` depending on which client ran the migration — and the
 * earliest of these migrations has shipped, so its rows cannot be corrected.
 * Reading them back through `Number` costs nothing and means the log never says
 * `NaN` at the one moment an operator is being told data was removed.
 */
function asCounts(value: unknown): Record<string, number | undefined> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, raw]) => {
      const parsed = Number(raw);
      return [key, Number.isFinite(parsed) ? parsed : 0];
    }),
  );
}

/**
 * Read a repair record, phrase it, and clear it. Absent means nothing to say.
 *
 * Each key is reported under its own guard: the two migrations are independent,
 * and a failure reading one is no reason to swallow the other's report.
 */
async function reportRepair(
  key: string,
  phrase: (counts: Record<string, number | undefined>) => string,
): Promise<void> {
  try {
    const record = await prisma.appSetting.findUnique({ where: { key } });
    if (!record) return;
    console.warn(phrase(asCounts(record.value)));
    await prisma.appSetting.delete({ where: { key } });
  } catch (error) {
    console.error(`[startup] could not report ${key}:`, error);
  }
}

async function reportSchemaRepairs(): Promise<void> {
  await reportRepair(
    JOIN_KEY_REPAIR,
    (counts) =>
      `[startup] the same-owner key migration removed ${counts.contactTags ?? 0} tag ` +
      `assignment(s) and ${counts.locationAliases ?? 0} place alias(es) that joined ` +
      "records belonging to different accounts. The application cannot create such a " +
      "row; they came from an import or a restore, and nothing could see them. See " +
      "docs/data-model.md.",
  );
  await reportRepair(
    CONTACT_KEY_REPAIR,
    (counts) =>
      `[startup] the same-owner key migration removed ${counts.deleted ?? 0} record(s) ` +
      `and cleared ${counts.detached ?? 0} link(s) that joined records belonging to ` +
      "different accounts. The application cannot create such a row; they came from an " +
      "import or a restore, and nothing could see them. Where the link was optional — an " +
      "idea, a task, a plan, a place — the record was kept and only the link cleared. " +
      "See docs/data-model.md.",
  );
}
