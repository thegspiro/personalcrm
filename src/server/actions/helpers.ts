import "server-only";
import { z } from "zod";
import { getUserContext } from "@/server/user/context";
import { parsePlainDate, plainDateToDb, type PlainDate } from "@/lib/dates";
import { normalizeToPrecision, type DatePrecision } from "@/lib/date-precision";

/** What every server action returns, so forms can render errors uniformly. */
export interface ActionResult<T = void> {
  ok: boolean;
  error?: string;
  /** Seconds before a rate-limited action may be attempted again. */
  retryAfterSeconds?: number;
  fieldErrors?: Record<string, string>;
  data?: T;
}

export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, retryAfterSeconds?: number): ActionResult<never> {
  return { ok: false, error, retryAfterSeconds };
}

export function fieldError(field: string, message: string): ActionResult<never> {
  return {
    ok: false,
    error: "Please check the highlighted fields.",
    fieldErrors: { [field]: message },
  };
}

export function invalid(error: z.ZodError): ActionResult<never> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return { ok: false, error: "Please check the highlighted fields.", fieldErrors };
}

/** The signed-in user's id and timezone, for scoping every query. */
export async function owner(): Promise<{ ownerId: string; timezone: string }> {
  const { user, timezone } = await getUserContext();
  return { ownerId: user.id, timezone };
}

// --- form parsing ----------------------------------------------------------

export function str(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function num(form: FormData, key: string): number | undefined {
  const raw = str(form, key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function bool(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === "true" || value === "on" || value === "1";
}

export function strList(form: FormData, key: string): string[] {
  return form
    .getAll(key)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** A DateTime the user picked, e.g. when an interaction happened. */
export function instant(form: FormData, key: string): Date | undefined {
  const raw = str(form, key);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export const DATE_PRECISIONS = ["DAY", "MONTH", "YEAR", "MONTH_DAY"] as const;

export interface PartialDateInput {
  date: Date;
  precision: DatePrecision;
}

/**
 * Read a `DateField` from a form: a `YYYY-MM-DD` anchor plus its precision.
 *
 * The anchor is normalised to the precision before storage, so "March 2019"
 * always lands on 2019-03-01 no matter which day the picker happened to have
 * selected when the precision was changed.
 */
export function partialDate(
  form: FormData,
  key: string,
  precisionKey = `${key}Precision`,
): PartialDateInput | undefined {
  const raw = str(form, key);
  if (!raw) return undefined;

  const parsed = parsePlainDate(raw);
  if (!parsed) return undefined;

  const rawPrecision = str(form, precisionKey) ?? "DAY";
  const precision = (DATE_PRECISIONS as readonly string[]).includes(rawPrecision)
    ? (rawPrecision as DatePrecision)
    : "DAY";

  return { date: plainDateToDb(normalizeToPrecision(parsed, precision)), precision };
}

/** A plain calendar date with no precision attached, e.g. a task due date. */
export function plainDate(form: FormData, key: string): Date | undefined {
  const raw = str(form, key);
  if (!raw) return undefined;
  const parsed = parsePlainDate(raw);
  return parsed ? plainDateToDb(parsed) : undefined;
}

export function toDbDate(date: PlainDate): Date {
  return plainDateToDb(date);
}
