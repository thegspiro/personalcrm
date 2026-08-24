"use client";

import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/**
 * A 1–5 rating. Renders as buttons rather than a slider so it works with a
 * thumb, and clicking the current value clears it — a rating you can't take
 * back is worse than no rating.
 */
export function RatingInput({
  name,
  label,
  defaultValue,
  hint,
  className,
  icon = "star",
}: {
  name: string;
  label?: string;
  defaultValue?: number | null;
  hint?: string;
  className?: string;
  icon?: "star" | "number";
}) {
  const [value, setValue] = React.useState<number | null>(defaultValue ?? null);

  return (
    <div className={cn("grid gap-1.5", className)}>
      {label ? <Label>{label}</Label> : null}
      <input type="hidden" name={name} value={value ?? ""} />
      <div className="flex gap-1" role="radiogroup" aria-label={label ?? name}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value !== null && n <= value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} out of 5`}
              onClick={() => setValue((current) => (current === n ? null : n))}
              className={cn(
                "tap flex h-10 flex-1 items-center justify-center rounded-lg border transition-colors",
                active
                  ? "border-accent-8 bg-accent-3 text-accent-11"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {icon === "star" ? (
                <Star className={cn("size-4", active && "fill-current")} />
              ) : (
                <span className="text-sm font-medium">{n}</span>
              )}
            </button>
          );
        })}
      </div>
      {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}

/** Read-only rendering of a stored rating. */
export function RatingDisplay({
  value,
  label,
  className,
}: {
  value: number | null | undefined;
  label?: string;
  className?: string;
}) {
  if (value === null || value === undefined) return null;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            "size-3",
            n <= value ? "fill-[var(--warning)] text-[var(--warning)]" : "text-border",
          )}
        />
      ))}
    </span>
  );
}
