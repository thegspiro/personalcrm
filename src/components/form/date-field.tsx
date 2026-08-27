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
import { addPlainDays, plainDateKey, parsePlainDate, type PlainDate } from "@/lib/dates";

export interface DateFieldProps {
  name: string;
  /**
   * Prefix for the element ids, defaulting to `name`. Set it when an add form
   * and an inline edit form are open at once: both submit the same field name,
   * and two elements sharing an id sends every label to the first of them.
   */
  idPrefix?: string;
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
  idPrefix,
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
  const ids = idPrefix ?? name;
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

  function commit(next: PlainDate, nextPrecision?: DatePrecision) {
    setDate(next);
    if (nextPrecision) setPrecision(nextPrecision);
  }

  /**
   * Free text is tried as a partial date first ("2019", "March 2019"), then
   * handed to chrono for the relative phrasings people actually type
   * ("3 years ago", "last March").
   */
  function commitText(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    const partial = parsePartialDate(trimmed);
    if (partial) {
      commit(partial.date, partial.precision);
      setText("");
      setOpen(false);
      return;
    }

    const parsed = chrono.parseDate(trimmed, new Date(), { forwardDate: false });
    if (parsed) {
      commit(
        { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() },
        "DAY",
      );
      setText("");
      setOpen(false);
    }
  }

  const display = anchor ? formatPartialDate(anchor, precision) : "Pick a date";
  const yearForInputs = anchor?.year ?? todayPlain().year;

  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? <Label htmlFor={`${ids}-trigger`}>{label}</Label> : null}

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
            id={`${ids}-trigger`}
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
              <Label htmlFor={`${ids}-text`}>Type a date</Label>
              <Input
                id={`${ids}-text`}
                value={text}
                placeholder="2019, March 2019, 3 years ago…"
                onChange={(event) => setText(event.target.value)}
                onBlur={(event) => commitText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitText(text);
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
                  <Label htmlFor={`${ids}-year`}>Year</Label>
                  <Input
                    id={`${ids}-year`}
                    type="number"
                    inputMode="numeric"
                    min={1900}
                    max={2200}
                    value={anchor?.year ?? ""}
                    onChange={(event) => {
                      const year = Number(event.target.value);
                      if (year >= 1900 && year <= 2200) {
                        commit({ ...(anchor ?? todayPlain()), year });
                      }
                    }}
                  />
                </div>
              ) : null}

              {precision !== "YEAR" ? (
                <div className="grid gap-1">
                  <Label htmlFor={`${ids}-month`}>Month</Label>
                  <select
                    id={`${ids}-month`}
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
                  <Label htmlFor={`${ids}-day`}>Day</Label>
                  <Input
                    id={`${ids}-day`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={31}
                    value={anchor?.day ?? ""}
                    onChange={(event) => {
                      const day = Number(event.target.value);
                      if (day >= 1 && day <= 31) commit({ ...(anchor ?? todayPlain()), day });
                    }}
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
