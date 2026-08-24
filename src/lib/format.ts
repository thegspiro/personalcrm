/**
 * Display helpers. Pure, so they can run on the server or the client.
 */
import { calendarDateInTz, diffPlainDays, type PlainDate } from "./dates";
import { formatPartialDate, type DatePrecision } from "./date-precision";

/**
 * How a date reads in a feed: "Today", "Yesterday", "3 days ago", then an
 * actual date once relative wording stops being useful.
 */
export function relativeDay(
  date: PlainDate,
  today: PlainDate,
  options: { short?: boolean } = {},
): string {
  const delta = diffPlainDays(today, date);

  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";

  if (delta < 0) {
    const ago = -delta;
    if (ago < 7) return `${ago} days ago`;
    if (ago < 14) return "Last week";
    if (ago < 31) return `${Math.round(ago / 7)} weeks ago`;
    if (ago < 365) return formatPartialDate(date, "MONTH_DAY", { short: options.short });
    return formatPartialDate(date, "DAY", { short: options.short });
  }

  if (delta < 7) return `In ${delta} days`;
  if (delta < 14) return "Next week";
  if (delta < 31) return `In ${Math.round(delta / 7)} weeks`;
  return formatPartialDate(date, delta < 365 ? "MONTH_DAY" : "DAY", { short: options.short });
}

export function relativeInstant(
  instant: Date,
  timezone: string,
  now: Date = new Date(),
): string {
  return relativeDay(calendarDateInTz(instant, timezone), calendarDateInTz(now, timezone), {
    short: true,
  });
}

/** "March 2019" or "Today", whichever is more useful at this precision. */
export function timelineDateLabel(
  date: PlainDate,
  precision: DatePrecision,
  today: PlainDate,
): string {
  // A fuzzy date has no business claiming to be "3 days ago".
  if (precision !== "DAY") return formatPartialDate(date, precision, { short: true });
  return relativeDay(date, today, { short: true });
}

export function timeOfDay(instant: Date, timezone: string): string {
  return instant.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
}

export const SENTIMENTS: ReadonlyArray<{ value: number; label: string; emoji: string }> = [
  { value: -2, label: "Rough", emoji: "😞" },
  { value: -1, label: "Off", emoji: "😕" },
  { value: 0, label: "Fine", emoji: "😐" },
  { value: 1, label: "Good", emoji: "🙂" },
  { value: 2, label: "Great", emoji: "😄" },
];

export function sentimentLabel(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return SENTIMENTS.find((s) => s.value === value)?.label ?? null;
}

export function formatMoney(cents: number | null | undefined, currency = "USD"): string | null {
  if (cents === null || cents === undefined) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatDuration(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Overdue by 5 days" / "Due today" / "In 12 days". */
export function cadenceMessage(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return "Due today";
  if (days < 0) {
    const over = -days;
    return over === 1 ? "Overdue by a day" : `Overdue by ${over} days`;
  }
  return days === 1 ? "Due tomorrow" : `In ${days} days`;
}

/** Tailwind classes for a taxonomy term's colour, in both themes. */
export function termColorClasses(color: string | null | undefined): string {
  const palette: Record<string, string> = {
    slate: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
    red: "bg-red-500/12 text-red-600 dark:text-red-400",
    orange: "bg-orange-500/12 text-orange-600 dark:text-orange-400",
    amber: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
    yellow: "bg-yellow-500/12 text-yellow-700 dark:text-yellow-400",
    lime: "bg-lime-500/12 text-lime-700 dark:text-lime-400",
    green: "bg-green-500/12 text-green-700 dark:text-green-400",
    emerald: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
    teal: "bg-teal-500/12 text-teal-700 dark:text-teal-400",
    cyan: "bg-cyan-500/12 text-cyan-700 dark:text-cyan-400",
    sky: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
    blue: "bg-blue-500/12 text-blue-600 dark:text-blue-400",
    indigo: "bg-indigo-500/12 text-indigo-600 dark:text-indigo-400",
    violet: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
    purple: "bg-purple-500/12 text-purple-600 dark:text-purple-400",
    fuchsia: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400",
    pink: "bg-pink-500/12 text-pink-600 dark:text-pink-400",
    rose: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  };
  return palette[color ?? ""] ?? "bg-muted text-muted-foreground";
}
