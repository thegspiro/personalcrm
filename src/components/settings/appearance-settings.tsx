"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction, useAddAction } from "@/components/form/use-action";
import { ACCENTS } from "@/components/providers/theme-provider";
import { updateAppearance, updateDefaults } from "@/server/actions/settings";

const CADENCE_PRESETS = [
  { label: "Don't remind me by default", days: null },
  { label: "Every week", days: 7 },
  { label: "Every 2 weeks", days: 14 },
  { label: "Every month", days: 30 },
  { label: "Every 3 months", days: 90 },
  { label: "Every 6 months", days: 180 },
  { label: "Once a year", days: 365 },
];

export function AppearanceSettings({
  accent,
  density,
  defaultCadenceDays,
  weekStartsOn,
  timezone,
}: {
  accent: string;
  density: string;
  defaultCadenceDays: number | null;
  weekStartsOn: number;
  timezone: string;
}) {
  const run = useAction();
  const save = useAddAction();
  const { theme, setTheme } = useTheme();
  // next-themes only knows the theme after hydration; without this guard every
  // option renders unselected on first paint.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const [currentAccent, setCurrentAccent] = React.useState(accent);
  const [currentDensity, setCurrentDensity] = React.useState(density);

  /** Applied immediately so you can see it, then persisted. */
  function apply(next: { accent?: string; density?: string }) {
    const form = new FormData();
    if (next.accent) {
      setCurrentAccent(next.accent);
      document.documentElement.dataset.accent = next.accent;
      form.set("accent", next.accent);
    }
    if (next.density) {
      setCurrentDensity(next.density);
      document.documentElement.dataset.density = next.density;
      form.set("density", next.density);
    }
    void run(() => updateAppearance(form));
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Appearance</h3>

        <div className="mt-3 grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Theme</span>
            <div className="flex flex-wrap gap-1.5">
              {["light", "dark", "system"].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTheme(option)}
                  aria-pressed={mounted && theme === option}
                  className={cn(
                    "min-h-9 rounded-lg border border-border px-3 text-sm capitalize",
                    mounted && theme === option && "border-accent-8 bg-accent-3 text-accent-11",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Accent</span>
            <div className="flex flex-wrap gap-2">
              {ACCENTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => apply({ accent: option })}
                  aria-pressed={currentAccent === option}
                  aria-label={option}
                  data-accent={option}
                  className={cn(
                    "size-8 rounded-full bg-accent-9",
                    currentAccent === option &&
                      "ring-2 ring-accent-8 ring-offset-2 ring-offset-card",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Density</span>
            <div className="flex flex-wrap gap-1.5">
              {["comfortable", "compact"].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => apply({ density: option })}
                  aria-pressed={currentDensity === option}
                  className={cn(
                    "min-h-9 rounded-lg border border-border px-3 text-sm capitalize",
                    currentDensity === option && "border-accent-8 bg-accent-3 text-accent-11",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Defaults</h3>
        <form action={save(updateDefaults, () => {}, "Saved")} className="mt-3 grid gap-3">
          <Field
            label="Default reminder for new people"
            htmlFor="defaultCadenceDays"
            hint="Only seeds the add-person form — nobody you've already added is changed."
          >
            <select
              id="defaultCadenceDays"
              name="defaultCadenceDays"
              defaultValue={String(defaultCadenceDays ?? "")}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              {CADENCE_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.days ?? ""}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Weeks start on" htmlFor="weekStartsOn">
            <select
              id="weekStartsOn"
              name="weekStartsOn"
              defaultValue={String(weekStartsOn)}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
            </select>
          </Field>

          <Field
            label="Timezone"
            htmlFor="timezone"
            hint="Every date in the app is worked out in this zone, not the server's."
          >
            <Input id="timezone" name="timezone" defaultValue={timezone} />
          </Field>

          <SubmitButton size="sm" className="justify-self-start">
            Save
          </SubmitButton>
        </form>
      </section>
    </div>
  );
}
