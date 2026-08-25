import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { InstallApp } from "@/components/pwa/install";
import type { ChecklistState } from "@/lib/setup-checklist";

/**
 * What is left to do, while the app is still empty.
 *
 * Deliberately not a dashboard widget: a widget would be appended to every
 * existing layout on upgrade and would need dismissing. This shows only while
 * the account genuinely has nothing in it, and disappears on its own the moment
 * it does — which is also why nothing here needs a "dismiss" button.
 *
 * The rows are derived from real rows rather than from anything recorded during
 * the wizard, so skipping a step and then doing the thing anyway ticks it off.
 * Whether to show it at all is `needsSetupChecklist` in src/lib/setup-checklist.ts.
 */

function Row({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {done ? (
        <Check className="mt-0.5 size-4 shrink-0 text-accent-11" />
      ) : (
        <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
      )}
      <span className={done ? "text-muted-foreground line-through" : undefined}>{children}</span>
    </li>
  );
}

export function SetupChecklist({ hasPeople, hasInteractions, hasInstalled }: ChecklistState) {
  return (
    <Card>
      <CardContent className="grid gap-3 pt-4">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">Finish setting up</h3>
          <p className="text-xs text-muted-foreground">
            This disappears once you&apos;re up and running.
          </p>
        </div>

        <ul className="grid gap-2">
          <Row done={hasPeople}>
            <Link href="/people/new" className="font-medium text-accent-11 hover:underline">
              Add someone
            </Link>{" "}
            you want to keep in touch with.
          </Row>
          <Row done={hasInteractions}>
            Log something you did together — a call, a coffee, a text.
          </Row>
          <Row done={hasInstalled}>Put the app on your home screen.</Row>
        </ul>

        {hasInstalled ? null : (
          <div className="border-t border-border pt-3">
            <InstallApp />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
