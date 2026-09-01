/**
 * Who has been doing the reaching out.
 *
 * The one number this app produces that a person might read as a verdict on a
 * friendship, so the rules below are all about refusing to overstate it.
 */
import { calendarDateInTz } from "./dates";
import { formatPartialDate } from "./date-precision";

export type ReachedOutBy = "UNSPECIFIED" | "ME" | "THEM" | "MUTUAL";

/** Below this, no summary at all. */
const MIN_ATTRIBUTED = 5;
/** Below this, counts only — no ratio, no percentage. */
const MIN_FOR_RATIO = 10;
/** Nothing older than this many attributed interactions is considered. */
export const RECIPROCITY_WINDOW = 20;

export interface ReciprocityRow {
  reachedOutBy: ReachedOutBy;
  occurredAt: Date;
}

export interface ReciprocitySummary {
  /** Rendered above the timeline. Null means render nothing at all. */
  text: string | null;
  /** Shown under `text` when some interactions have no attribution. */
  coverage: string | null;
  me: number;
  them: number;
  mutual: number;
}

/**
 * `rows` should already be the most recent attributed interactions; `total` is
 * every logged interaction for the contact, attributed or not, so the coverage
 * line can be honest about the denominator.
 *
 * `timeZone` is not optional. The "since March" in the summary is a calendar
 * month, and which month an evening interaction fell in depends entirely on
 * whose calendar is being read — this used to resolve against the server's,
 * which is the one clock in the system that belongs to nobody.
 */
export function summarizeReciprocity(
  rows: readonly ReciprocityRow[],
  total: number,
  timeZone: string,
): ReciprocitySummary {
  const considered = rows.slice(0, RECIPROCITY_WINDOW);

  const me = considered.filter((row) => row.reachedOutBy === "ME").length;
  const them = considered.filter((row) => row.reachedOutBy === "THEM").length;
  // Counted and reported, but kept out of the ratio in both directions. A
  // chance meeting or a group dinner is a real thing that happened and nobody's
  // initiative; folding it into either side would invent an approach that was
  // never made.
  const mutual = considered.filter((row) => row.reachedOutBy === "MUTUAL").length;

  const attributed = me + them;
  const counted = attributed + mutual;
  const empty = { me, them, mutual };

  if (attributed < MIN_ATTRIBUTED) {
    // The day-one state for every contact that existed before this column did.
    // It has to read as "nothing to say yet" rather than as a failing grade,
    // and it must never be expressed as a percentage of nothing.
    return {
      ...empty,
      text: "Not enough noted yet — tick who got in touch when you log something.",
      coverage: null,
    };
  }

  const span = considered[considered.length - 1]?.occurredAt;
  const since = span
    ? ` — since ${formatPartialDate(calendarDateInTz(span, timeZone), "MONTH")}`
    : "";

  let text: string;
  if (attributed < MIN_FOR_RATIO) {
    // At five, one entry moves a percentage by twenty points. Bare counts claim
    // only what was actually counted.
    text = `You got in touch ${me} ${me === 1 ? "time" : "times"}, they got in touch ${them}${since}.`;
  } else if (me > them) {
    text = `You got in touch ${me} of the last ${attributed} times${since}.`;
  } else if (them > me) {
    text = `They got in touch ${them} of the last ${attributed} times${since}.`;
  } else {
    text = `Evenly split — ${me} each of the last ${attributed}${since}.`;
  }

  return {
    ...empty,
    text,
    coverage:
      counted < total
        ? `${counted} of ${total} logged have who-got-in-touch noted.`
        : null,
  };
}
