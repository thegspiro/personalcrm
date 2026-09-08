import "server-only";
import { addPlainDays, clampToDbDate, todayInTz } from "@/lib/dates";
import { toFeedEvents } from "@/lib/calendar-feed";
import { icsDocument } from "@/lib/export/ics";
import type { PrivacyScope } from "@/server/privacy/filter";
import { getCalendarEntries } from "./calendar";

/**
 * The iCalendar document a subscribed client fetches.
 *
 * Built from `getCalendarEntries` — the same query the calendar page draws —
 * rather than a second set of reads. That is the whole design: every privacy
 * condition, the birthday de-duplication, the happening span and the vague-date
 * rules stay in one place, so the feed cannot quietly drift into showing
 * something the page would not.
 */

/**
 * The lock, permanently shut.
 *
 * A feed is fetched by Google or Apple with no session, so there is nothing
 * that could ever be unlocked and no user present to unlock it. Passing a
 * closed scope means every private row, and every contact marked private, is
 * excluded by construction — exactly what a locked browser session sees.
 *
 * `enabled` is true rather than false deliberately. The where-fragments branch
 * only on `unlocked`, so the pair that matters is "not unlocked"; saying the
 * lock is on describes the situation honestly for any future fragment that
 * does read `enabled`, where `{ enabled: false }` would read as "no lock
 * configured, show everything".
 */
const CLOSED: PrivacyScope = { enabled: true, unlocked: false };

/**
 * How much of the calendar a subscription carries.
 *
 * A month behind so a birthday that has just passed is still visible, and
 * thirteen months ahead so every annual date appears exactly once and the
 * coming one is never missed at a year boundary. It is a rolling window rather
 * than an endless `RRULE`, because a recurring date arrives here already
 * expanded into occurrences and re-deriving a rule from them would be inventing
 * one. Clients re-fetch on their own schedule, so the window moves.
 */
export const FEED_DAYS_BACK = 31;
export const FEED_DAYS_FORWARD = 400;

/**
 * Raised well above the page's per-source cap, which is sized for one month.
 * Thirteen months of birthdays is one per contact per year, so this is the
 * bound that keeps a large account's dates whole while still refusing to fan
 * out without limit.
 */
const FEED_PER_SOURCE_CAP = 2000;

export const FEED_CALENDAR_NAME = "Personal CRM";

export async function buildCalendarFeed(
  ownerId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<string> {
  const today = todayInTz(timezone, now);
  const window = {
    from: clampToDbDate(addPlainDays(today, -FEED_DAYS_BACK)),
    to: clampToDbDate(addPlainDays(today, FEED_DAYS_FORWARD)),
  };

  const entries = await getCalendarEntries(ownerId, timezone, window, {
    scope: CLOSED,
    perSourceCap: FEED_PER_SOURCE_CAP,
  });

  return icsDocument(toFeedEvents(entries, timezone), today.year, now, {
    name: FEED_CALENDAR_NAME,
  });
}
