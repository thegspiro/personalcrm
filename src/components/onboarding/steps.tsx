"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { ACCENTS } from "@/components/providers/theme-provider";
import { InstallApp } from "@/components/pwa/install";
import { updateAppearance, updateDefaults } from "@/server/actions/settings";
import { updatePrivacyPreferences } from "@/server/actions/privacy";
import { updateProfileName } from "@/server/actions/onboarding";
import { createContact } from "@/server/actions/contacts";
import type { ActionResult } from "@/server/actions/helpers";

/**
 * The panels of the first-run wizard.
 *
 * Every one of these settings is also in Settings, and deliberately so: the
 * wizard is a guided pass over the handful that matter on day one, not a
 * separate place where things live. Each panel reuses the same server action
 * the Settings screen calls, so there is one code path per setting.
 */

const CADENCE_PRESETS = [
  { label: "Don't remind me by default", days: "" },
  { label: "Every 2 weeks", days: "14" },
  { label: "Every month", days: "30" },
  { label: "Every 3 months", days: "90" },
  { label: "Every 6 months", days: "180" },
  { label: "Once a year", days: "365" },
];

export interface StepProps {
  /** Runs an action, surfaces its error, and advances only when it succeeds. */
  save: (run: () => Promise<ActionResult<unknown>>) => Promise<boolean>;
  pending: boolean;
}

// --- Step 2: who you are ---------------------------------------------------

export function AboutYouStep({
  save,
  pending,
  name,
  timezone,
  weekStartsOn,
}: StepProps & { name: string; timezone: string; weekStartsOn: number }) {
  // The account was created with the browser's zone, but a wrong one shifts
  // every date in the app, so it gets shown rather than assumed.
  const [zone, setZone] = React.useState(timezone);

  const onSubmit = async (form: FormData) => {
    const nameForm = new FormData();
    nameForm.set("name", String(form.get("name") ?? ""));
    await save(async () => {
      const named = await updateProfileName(nameForm);
      if (!named.ok) return named;
      return updateDefaults(form);
    });
  };

  return (
    <form action={onSubmit} className="grid gap-4">
      <Field label="Your name" htmlFor="name">
        <Input id="name" name="name" defaultValue={name} required autoComplete="name" />
      </Field>

      <Field
        label="Timezone"
        htmlFor="timezone"
        hint="Birthdays, reminders and everything &ldquo;overdue&rdquo; are worked out in this zone — not the server's."
      >
        <Input
          id="timezone"
          name="timezone"
          value={zone}
          onChange={(event) => setZone(event.target.value)}
        />
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

      <Button type="submit" loading={pending} className="h-11 w-full">
        Continue
      </Button>
    </form>
  );
}

// --- Step 3: make it yours -------------------------------------------------

export function PreferencesStep({
  save,
  pending,
  accent,
  density,
  defaultCadenceDays,
  hideDating,
  privacyLockEnabled,
  blurPrivateNotes,
}: StepProps & {
  accent: string;
  density: string;
  defaultCadenceDays: number | null;
  hideDating: boolean;
  privacyLockEnabled: boolean;
  blurPrivateNotes: boolean;
}) {
  const [currentAccent, setCurrentAccent] = React.useState(accent);
  const [currentDensity, setCurrentDensity] = React.useState(density);
  const [dating, setDating] = React.useState(!hideDating);

  /** Applied to the page first so the choice is visible, then persisted. */
  const applyLook = (next: { accent?: string; density?: string }) => {
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
    void updateAppearance(form);
  };

  const onSubmit = async (form: FormData) => {
    // updatePrivacyPreferences writes all three privacy flags from the form, so
    // the two this panel doesn't ask about are passed through unchanged rather
    // than being silently cleared.
    const privacy = new FormData();
    privacy.set("hideDating", dating ? "false" : "true");
    privacy.set("privacyLockEnabled", privacyLockEnabled ? "true" : "false");
    privacy.set("blurPrivateNotes", blurPrivateNotes ? "true" : "false");

    await save(async () => {
      const defaults = await updateDefaults(form);
      if (!defaults.ok) return defaults;
      return updatePrivacyPreferences(privacy);
    });
  };

  return (
    <form action={onSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Accent</span>
        <div className="flex flex-wrap gap-2">
          {ACCENTS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => applyLook({ accent: option })}
              aria-pressed={currentAccent === option}
              aria-label={option}
              data-accent={option}
              className={cn(
                "size-8 rounded-full bg-accent-9",
                currentAccent === option && "ring-2 ring-accent-8 ring-offset-2 ring-offset-card",
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
              onClick={() => applyLook({ density: option })}
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

      <Field
        label="Remind me to reach out"
        htmlFor="defaultCadenceDays"
        hint="The starting point for someone new. You can set a different one per person."
      >
        <select
          id="defaultCadenceDays"
          name="defaultCadenceDays"
          defaultValue={defaultCadenceDays === null ? "" : String(defaultCadenceDays)}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          {CADENCE_PRESETS.map((preset) => (
            <option key={preset.label} value={preset.days}>
              {preset.label}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-start gap-3 rounded-lg border border-border p-3">
        <input
          type="checkbox"
          checked={dating}
          onChange={(event) => setDating(event.target.checked)}
          className="mt-0.5 size-4"
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">Show the dating module</span>
          <span className="text-xs text-muted-foreground">
            A pipeline, a date log, flags and compatibility notes. Off hides it from
            navigation entirely — you can turn it on later in Settings, and lock it behind a
            PIN there too.
          </span>
        </span>
      </label>

      <Button type="submit" loading={pending} className="h-11 w-full">
        Continue
      </Button>
    </form>
  );
}

// --- Step 4: the first few people ------------------------------------------

interface PersonDraft {
  firstName: string;
  lastName: string;
  categoryId: string;
}

const EMPTY_PERSON: PersonDraft = { firstName: "", lastName: "", categoryId: "" };

export function FirstPeopleStep({
  save,
  pending,
  categories,
}: StepProps & { categories: Array<{ id: string; label: string }> }) {
  const [people, setPeople] = React.useState<PersonDraft[]>([{ ...EMPTY_PERSON }]);

  const update = (index: number, patch: Partial<PersonDraft>) =>
    setPeople((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const onSubmit = async () => {
    const named = people.filter((person) => person.firstName.trim());
    if (named.length === 0) return;

    await save(async () => {
      // Sequential rather than parallel: each create recomputes activity, and a
      // partial failure should stop rather than race.
      for (const person of named) {
        const form = new FormData();
        form.set("firstName", person.firstName);
        if (person.lastName.trim()) form.set("lastName", person.lastName);
        if (person.categoryId) form.set("categoryId", person.categoryId);

        const result = await createContact(form);
        if (!result.ok) return result;
      }
      return { ok: true };
    });
  };

  const anyNamed = people.some((person) => person.firstName.trim());

  return (
    <form action={onSubmit} className="grid gap-4">
      <div className="grid gap-3">
        {people.map((person, index) => (
          <div key={index} className="grid gap-2 rounded-lg border border-border p-3">
            <div className="grid grid-cols-2 gap-2">
              <Input
                aria-label={`First name ${index + 1}`}
                placeholder="First name"
                value={person.firstName}
                onChange={(event) => update(index, { firstName: event.target.value })}
              />
              <Input
                aria-label={`Last name ${index + 1}`}
                placeholder="Last name"
                value={person.lastName}
                onChange={(event) => update(index, { lastName: event.target.value })}
              />
            </div>
            <select
              aria-label={`Relationship ${index + 1}`}
              value={person.categoryId}
              onChange={(event) => update(index, { categoryId: event.target.value })}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="">How do you know them?</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {people.length < 3 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          onClick={() => setPeople((rows) => [...rows, { ...EMPTY_PERSON }])}
        >
          <UserPlus className="size-4" />
          Add another
        </Button>
      ) : null}

      <Button type="submit" loading={pending} disabled={!anyNamed} className="h-11 w-full">
        {anyNamed ? "Add and continue" : "Add someone to continue"}
      </Button>
    </form>
  );
}

// --- Step 5: install -------------------------------------------------------

export function InstallStep({ onDone, pending }: { onDone: () => void; pending: boolean }) {
  return (
    <div className="grid gap-4">
      <InstallApp />
      <Button onClick={onDone} loading={pending} variant="secondary" className="h-11 w-full">
        Finish setup
      </Button>
    </div>
  );
}
