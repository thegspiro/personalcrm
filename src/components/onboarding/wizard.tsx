"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/server/actions/onboarding";
import type { ActionResult } from "@/server/actions/helpers";
import { AboutYouStep, FirstPeopleStep, InstallStep, PreferencesStep } from "./steps";

/**
 * The first-run wizard.
 *
 * Account creation is step 1 and happens at /setup, before there is a session
 * to hang anything on; this picks up immediately afterwards with a session in
 * hand. Numbering continues from there so the whole thing reads as one sequence
 * rather than two.
 *
 * Every step can be skipped. A skipped step is a decision, not an omission —
 * what is still outstanding turns up on the dashboard checklist afterwards,
 * derived from real rows rather than from anything recorded here.
 */

const TOTAL_STEPS = 5;

export interface WizardProps {
  name: string;
  timezone: string;
  accent: string;
  density: string;
  defaultCadenceDays: number | null;
  hideDating: boolean;
  privacyLockEnabled: boolean;
  blurPrivateNotes: boolean;
  categories: Array<{ id: string; label: string }>;
}

const STEPS = [
  {
    title: "A little about you",
    blurb: "Dates in the app are worked out in your zone, so this one matters.",
  },
  {
    title: "Make it yours",
    blurb: "None of this is permanent — all of it is in Settings later.",
  },
  {
    title: "Add your first few people",
    blurb: "Start with three you'd hate to lose touch with. The rest can come later.",
  },
  {
    title: "Put it on your home screen",
    blurb: "Personal CRM is built for a phone. Installed, it opens like any other app.",
  },
] as const;

export function OnboardingWizard(props: WizardProps) {
  const router = useRouter();
  const [index, setIndex] = React.useState(0);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const advance = React.useCallback(() => {
    setError(null);
    setIndex((current) => current + 1);
  }, []);

  /** Run a step's action; advance only if it worked, and say so if it didn't. */
  const save = React.useCallback(
    async (run: () => Promise<ActionResult<unknown>>): Promise<boolean> => {
      setPending(true);
      setError(null);
      try {
        const result = await run();
        if (!result.ok) {
          setError(result.error ?? "Something went wrong.");
          return false;
        }
        advance();
        return true;
      } finally {
        setPending(false);
      }
    },
    [advance],
  );

  /** Close the wizard and go to the dashboard. Used by Finish and by Skip. */
  const finish = React.useCallback(async () => {
    setPending(true);
    try {
      const result = await completeOnboarding();
      if (!result.ok) {
        setError(result.error ?? "Could not finish setting up.");
        return;
      }
      toast.success("You're all set.");
      // refresh() so the app shell re-reads onboardingCompletedAt and stops
      // bouncing back here; push() alone would race the stale layout.
      router.refresh();
      router.push("/");
    } finally {
      setPending(false);
    }
  }, [router]);

  const step = STEPS[Math.min(index, STEPS.length - 1)];
  const stepNumber = index + 2; // /setup was step 1.

  return (
    <div className="grid gap-3">
      <Progress current={stepNumber} total={TOTAL_STEPS} />

      <Card className="shadow-lg">
        <CardContent className="grid gap-4 pt-5">
          <div className="grid gap-1">
            <p className="text-xs font-medium text-accent-11">
              Step {stepNumber} of {TOTAL_STEPS}
            </p>
            <h2 className="text-base font-semibold">{step.title}</h2>
            <p className="text-xs text-muted-foreground">{step.blurb}</p>
          </div>

          {error ? (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}

          {index === 0 ? (
            <AboutYouStep
              save={save}
              pending={pending}
              name={props.name}
              timezone={props.timezone}
            />
          ) : null}

          {index === 1 ? (
            <PreferencesStep
              save={save}
              pending={pending}
              accent={props.accent}
              density={props.density}
              defaultCadenceDays={props.defaultCadenceDays}
              hideDating={props.hideDating}
              blurPrivateNotes={props.blurPrivateNotes}
            />
          ) : null}

          {index === 2 ? (
            <FirstPeopleStep save={save} pending={pending} categories={props.categories} />
          ) : null}

          {index >= 3 ? <InstallStep onDone={finish} pending={pending} /> : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIndex((current) => Math.max(0, current - 1))}
          disabled={index === 0 || pending}
        >
          Back
        </Button>

        {index >= 3 ? (
          <span className="text-xs text-muted-foreground">Last one</span>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={advance} disabled={pending}>
              Skip this
            </Button>
            <Button variant="ghost" size="sm" onClick={finish} disabled={pending}>
              Skip setup
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The step rail. Filled steps are done, the current one is outlined. */
function Progress({ current, total }: { current: number; total: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${current} of ${total}`}>
      {Array.from({ length: total }, (_, i) => i + 1).map((step) => (
        <li
          key={step}
          aria-current={step === current ? "step" : undefined}
          className={cn(
            "flex h-1.5 flex-1 items-center rounded-full",
            step < current && "bg-accent-9",
            step === current && "bg-accent-8",
            step > current && "bg-muted",
          )}
        >
          <span className="sr-only">
            {step < current ? "Done" : step === current ? "Current step" : "Not started"}
          </span>
        </li>
      ))}
    </ol>
  );
}
