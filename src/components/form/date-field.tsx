"use client";

/**
 * The date input used everywhere in the app.
 *
 * Two jobs beyond a plain `<input type="date">`:
 *
 *  1. Reaching backwards has to be quick. Yesterday, last week, and last month
 *     are one tap, because most backfilling lands near those.
 *  2. A half-remembered date stays half-remembered. Switching precision to
 *     "Year only" records 2019, and the app renders "2019" forever after
 *     instead of inventing January 1st and later presenting it as fact.
 *
 * Submits two form values: `name` (a YYYY-MM-DD anchor) and `${name}Precision`.
 * The server normalises the anchor to the precision, so the day left over from
 * an earlier selection never leaks into a month-precision value.
 */
import * as React from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import * as chrono from "chrono-node";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DATE_PRECISIONS,
  PRECISION_LABELS,
  UNKNOWN_YEAR,
  formatPartialDate,
  normalizeToPrecision,
  parsePartialDate,
  type DatePrecision,
} from "@/lib/date-precision";
import {
  addPlainDays,
  clampPlainDate,
  daysInMonth,
  plainDateKey,
  parsePlainDate,
  type PlainDate,
} from "@/lib/dates";

export interface DateFieldProps {
  name: string;
  label?: string;
  defaultValue?: string | null;
  defaultPrecision?: DatePrecision;
  /** Offer year/month precision. Off for things that need a real day. */
  allowPrecision?: boolean;
  /** Which presets to show; empty hides the row. */
  presets?: Array<"today" | "yesterday" | "lastWeek" | "lastMonth" | "lastYear">;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  onChange?: (value: { date: string; precision: DatePrecision }) => void;
}

const DEFAULT_PRESETS: DateFieldProps["presets"] = ["today", "yesterday", "lastWeek", "lastMonth"];

const PRESET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  lastWeek: "Last week",
  lastMonth: "Last month",
  lastYear: "Last year",
};

function todayPlain(): PlainDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function presetDate(preset: string): PlainDate {
  const today = todayPlain();
  switch (preset) {
    case "yesterday":
      return addPlainDays(today, -1);
    case "lastWeek":
      return addPlainDays(today, -7);
    case "lastMonth":
      return addPlainDays(today, -30);
    case "lastYear":
      return addPlainDays(today, -365);
    default:
      return today;
  }
}

export function DateField({
  name,
  label,
  defaultValue,
  defaultPrecision = "DAY",
  allowPrecision = true,
  presets = DEFAULT_PRESETS,
  required,
  hint,
  error,
  className,
  onChange,
}: DateFieldProps) {
  const [precision, setPrecision] = React.useState<DatePrecision>(defaultPrecision);
  const [date, setDate] = React.useState<PlainDate | null>(() => {
    if (!defaultValue) return null;
    return parsePlainDate(defaultValue);
  });
  const [text, setText] = React.useState("");
  const [open, setOpen] = React.useState(false);

  const anchor = date ? normalizeToPrecision(date, precision) : null;
  const value = anchor ? plainDateKey(anchor) : "";

  React.useEffect(() => {
    if (anchor && onChange) onChange({ date: plainDateKey(anchor), precision });
    // `anchor` is derived, so keying on its serialised form avoids a loop.
  }, [value, precision]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Every path into state goes through here so a day can never outrun its
   * month. Picking February with 31 already in the day box used to build
   * 2026-02-31, which `parsePlainDate` rejects on the server — and `partialDate`
   * turns a rejected anchor into `undefined`, so the form saved cleanly with the
   * date silently missing. Clamping to the 28th loses a digit; not clamping lost
   * the whole date without saying so.
   */
  function commit(next: PlainDate, nextPrecision?: DatePrecision) {
    setDate(clampPlainDate(next));
    if (nextPrecision) setPrecision(nextPrecision);
  }

  /**
   * Free text is tried as a partial date first ("2019", "March 2019"), then
   * handed to chrono for the relative phrasings people actually type
   * ("3 years ago", "last March").
   */
  function commitText(raw: string, close: boolean) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const partial = parsePartialDate(trimmed);
    if (partial) {
      commit(partial.date, partial.precision);
      setText("");
      if (close) setOpen(false);
      return;
    }

    const parsed = chrono.parseDate(trimmed, new Date(), { forwardDate: false });
    if (parsed) {
      commit(
        { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() },
        "DAY",
      );
      setText("");
      if (close) setOpen(false);
    }
  }

  const display = anchor ? formatPartialDate(anchor, precision) : "Pick a date";
  const yearForInputs = anchor?.year ?? todayPlain().year;

  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? <Label htmlFor={`${name}-trigger`}>{label}</Label> : null}

      {/* The values that actually get submitted. */}
      <input type="hidden" name={name} value={value} />
      <input type="hidden" name={`${name}Precision`} value={precision} />
      {required ? (
        <input
          tabIndex={-1}
          aria-hidden
          required
          className="sr-only h-0 w-0"
          value={value}
          onChange={() => {}}
        />
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={`${name}-trigger`}
            type="button"
            variant="outline"
            className={cn(
              "h-10 w-full justify-start gap-2 font-normal",
              !anchor && "text-muted-foreground/70",
              error && "border-destructive",
            )}
          >
            <CalendarDays className="size-4 shrink-0 opacity-60" />
            <span className="truncate">{display}</span>
            <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-[19rem] p-3" align="start">
          <div className="grid gap-3">
            {presets && presets.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      commit(presetDate(preset), "DAY");
                      setOpen(false);
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor={`${name}-text`}>Type a date</Label>
              <Input
                id={`${name}-text`}
                value={text}
                placeholder="2019, March 2019, 3 years ago…"
                onChange={(event) => setText(event.target.value)}
                // Tapping straight into Year must not close the popover out
                // from under the finger that opened it.
                onBlur={(event) => commitText(event.target.value, false)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitText(text, true);
                  }
                }}
              />
            </div>

            {allowPrecision ? (
              <div className="grid gap-1.5">
                <Label>How much do you know?</Label>
                <div className="grid gap-1">
                  {DATE_PRECISIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        const base = anchor ?? todayPlain();
                        const next =
                          option === "MONTH_DAY"
                            ? { ...base, year: UNKNOWN_YEAR }
                            : base.year === UNKNOWN_YEAR
                              ? { ...base, year: todayPlain().year }
                              : base;
                        commit(next, option);
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                        precision === option && "bg-accent-3 text-accent-11",
                      )}
                    >
                      <Check
                        className={cn("size-3.5", precision === option ? "opacity-100" : "opacity-0")}
                      />
                      {PRECISION_LABELS[option]}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-3 gap-2">
              {precision !== "MONTH_DAY" ? (
                <div className="grid gap-1">
                  <Label htmlFor={`${name}-year`}>Year</Label>
                  <NumberBox
                    id={`${name}-year`}
                    value={anchor?.year ?? null}
                    min={1900}
                    max={2200}
                    digits={4}
                    onCommit={(year) => commit({ ...(anchor ?? todayPlain()), year })}
                  />
                </div>
              ) : null}

              {precision !== "YEAR" ? (
                <div className="grid gap-1">
                  <Label htmlFor={`${name}-month`}>Month</Label>
                  <select
                    id={`${name}-month`}
                    value={anchor?.month ?? 1}
                    onChange={(event) =>
                      commit({
                        ...(anchor ?? todayPlain()),
                        year: yearForInputs,
                        month: Number(event.target.value),
                      })
                    }
                    className="h-10 rounded-lg border border-input bg-card px-2 text-sm"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <option key={i + 1} value={i + 1}>
                        {new Date(Date.UTC(2000, i, 1)).toLocaleDateString("en-US", {
                          month: "short",
                          timeZone: "UTC",
                        })}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {precision === "DAY" || precision === "MONTH_DAY" ? (
                <div className="grid gap-1">
                  <Label htmlFor={`${name}-day`}>Day</Label>
                  <NumberBox
                    id={`${name}-day`}
                    value={anchor?.day ?? null}
                    min={1}
                    max={daysInMonth(yearForInputs, anchor?.month ?? todayPlain().month)}
                    digits={2}
                    onCommit={(day) => commit({ ...(anchor ?? todayPlain()), day })}
                  />
                </div>
              ) : null}
            </div>

            <Button type="button" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground/80">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A digits-only box that can actually be typed into.
 *
 * The obvious version — a controlled `<input type="number">` that only calls
 * back when the value is in range — cannot be retyped at all. Clearing 2026 to
 * enter 1985 goes through "", "1", "19", "198", and every one of those is out
 * of range, so nothing commits, the controlled value re-renders as 2026, and
 * the box fights the keyboard. This is what a phone user sees as a stuck field.
 *
 * So the keystrokes live in a draft that is always shown, and only a complete,
 * in-range number is committed upward. Blur drops the draft, which snaps a
 * half-typed or impossible entry back to the value that is really selected —
 * a visible correction rather than a silent one.
 */
function NumberBox({
  id,
  value,
  min,
  max,
  digits,
  onCommit,
}: {
  id: string;
  value: number | null;
  min: number;
  max: number;
  digits: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);

  return (
    <Input
      id={id}
      // Not `type="number"`: it offers a keypad with "." and "," on it, accepts
      // "1e5", and turns a stray scroll over the field into a changed year.
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      maxLength={digits}
      value={draft ?? (value === null ? "" : String(value))}
      onChange={(event) => {
        const typed = event.target.value.replace(/\D/g, "").slice(0, digits);
        setDraft(typed);
        const next = Number(typed);
        if (typed !== "" && next >= min && next <= max) onCommit(next);
      }}
      // Tapping in to change the year almost always means replacing it.
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => setDraft(null)}
    />
  );
}

/**
 * Date and time for something that happened at a moment rather than on a day.
 * Defaults to now; the presets shift the day and keep the time.
 */
export function DateTimeField({
  name,
  label,
  defaultValue,
  hint,
  className,
}: {
  name: string;
  label?: string;
  defaultValue?: Date | string | null;
  hint?: string;
  className?: string;
}) {
  const [value, setValue] = React.useState(() => toLocalInput(defaultValue ?? new Date()));

  function shiftDays(days: number) {
    const current = new Date(value);
    const base = Number.isNaN(current.getTime()) ? new Date() : current;
    base.setDate(base.getDate() + days);
    setValue(toLocalInput(base));
  }

  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? <Label htmlFor={name}>{label}</Label> : null}
      <Input
        id={name}
        name={name}
        type="datetime-local"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        <PresetChip label="Now" onClick={() => setValue(toLocalInput(new Date()))} />
        <PresetChip label="−1 day" onClick={() => shiftDays(-1)} />
        <PresetChip label="−1 week" onClick={() => shiftDays(-7)} />
        <PresetChip label="−1 month" onClick={() => shiftDays(-30)} />
      </div>
      {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}

function PresetChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
    >
      {label}
    </button>
  );
}

/** `datetime-local` wants local wall-clock time, not an ISO instant. */
function toLocalInput(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}
