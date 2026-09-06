import { zonedTimeOfDay, type PlainDate } from "./dates";

/**
 * The time of day a plan is pencilled in for.
 *
 * Stored as local wall-clock minutes past midnight beside a DATE, never as an
 * instant — `src/lib/dates.ts` explains why the two are not interchangeable,
 * and the day is what gets compared, grouped and displayed. Resolving the pair
 * to a moment is `planInstant`, and only the things that genuinely need one
 * (a reminder, an ordering across days) should call it.
 *
 * Pure, so the form, the server action and the scheduler all read the same
 * rules rather than each parsing "19:30" their own way.
 */

/** Minutes past midnight; 1439 is 23:59, and 1440 would be the next day. */
export const PLAN_MINUTE_MAX = 1439;
/** A plan set aside for longer than a day is a trip, not an evening. */
export const PLAN_DURATION_MAX = 1440;

export type ParsedPlanNumber =
  | { ok: true; value: number | null }
  | { ok: false };

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/**
 * `"19:30"` from an `<input type="time">` into 1170.
 *
 * Absent or empty is a clear, not an error — the time is optional. Anything
 * else is rejected rather than coerced: a server action is a public POST
 * endpoint, and silently reading garbage as midnight would put a plan at a
 * time nobody chose.
 */
export function parsePlanMinute(raw: string | undefined | null): ParsedPlanNumber {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };

  const match = TIME_PATTERN.exec(trimmed);
  if (!match) return { ok: false };

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return { ok: false };

  return { ok: true, value: hours * 60 + minutes };
}

/** Minutes to set aside. Zero is not a duration, so it clears rather than stores. */
export function parsePlanDuration(raw: string | undefined | null): ParsedPlanNumber {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, value: null };

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > PLAN_DURATION_MAX) {
    return { ok: false };
  }
  return { ok: true, value: parsed === 0 ? null : parsed };
}

/** 1170 back into `"19:30"`, the shape an `<input type="time">` wants. */
export function planMinuteToInput(minute: number | null | undefined): string {
  if (minute === null || minute === undefined) return "";
  const hours = Math.floor(minute / 60);
  return `${String(hours).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/**
 * How a time reads in the interface — "7:30 PM", matching `timeOfDay` in
 * `src/lib/format.ts`.
 *
 * The locale is pinned rather than left ambient, the same way `timeOfDay` and
 * `formatMoney` pin theirs: this renders on the server first and hydrates in
 * the browser, and a machine whose locale disagrees would produce two different
 * strings for one plan and a hydration mismatch.
 *
 * Formatted off a fixed UTC date carrying the minute, with `timeZone: "UTC"`,
 * so the wall-clock number the user typed is the number shown. Handing the
 * formatter a real instant would re-project it into some zone and could move
 * the displayed hour.
 */
export function formatPlanTime(minute: number | null | undefined): string | null {
  if (minute === null || minute === undefined) return null;
  const at = new Date(Date.UTC(2000, 0, 1, Math.floor(minute / 60), minute % 60));
  return at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** "1h 30m", or null when nothing was set aside. */
export function formatPlanDuration(minutes: number | null | undefined): string | null {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The moment a plan starts, for the things that need one.
 *
 * A plan with a day but no time resolves to the start of that day, so callers
 * never have to branch: "sometime on the 12th" orders before anything timed on
 * the 12th, which is the order a day's agenda wants.
 */
export function planInstant(
  plannedFor: PlainDate,
  plannedStartMinute: number | null | undefined,
  timeZone: string,
): Date {
  return zonedTimeOfDay(plannedFor, plannedStartMinute ?? 0, timeZone);
}
