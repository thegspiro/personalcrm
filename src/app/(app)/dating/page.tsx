import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Columns2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/server/user/context";
import { listPipeline } from "@/server/queries/dating";
import { listPlans } from "@/server/queries/plans";
import { originsFor } from "@/server/queries/origins";
import { listTerms } from "@/server/taxonomy/queries";
import { canSeeDating } from "@/server/privacy/filter";
import { getPrivacyState } from "@/server/privacy/lock";
import { PipelineList } from "@/components/dating/pipeline-list";
import { PlansSection } from "@/components/plans/plans-section";
import { calendarDateInTz, plainDateFromDb } from "@/lib/dates";

export const metadata: Metadata = { title: "Dating" };
export const dynamic = "force-dynamic";

export default async function DatingPage() {
  const { user, prefs, timezone } = await getUserContext();

  // Gate before any dating data is fetched — a redirect after loading would
  // still have put the rows into the response.
  if (prefs.hideDating) redirect("/");
  if (!(await canSeeDating(prefs.hideDating))) {
    const { enabled } = await getPrivacyState();
    redirect(enabled ? "/unlock?next=/dating" : "/");
  }

  const origins = await originsFor(user.id);

  const [pipeline, plans, planCategories] = await Promise.all([
    listPipeline(user.id),
    // The same plans the rest of the app holds, filtered to the people this
    // page is about — plus the ones saved against nobody.
    // Nearest first once a home base is set. Without one every distance is null
    // and `withDistance` leaves the list in the order it arrived, which is the
    // status-then-newest order it has always been in.
    listPlans(user.id, {
      romanticOnly: true,
      origin: origins.home,
      unit: origins.unit,
      sortByDistance: Boolean(origins.home),
    }),
    listTerms(user.id, "PLAN_CATEGORY"),
  ]);
  const today = calendarDateInTz(new Date(), timezone);

  // Everyone still in the pipeline, for the "who with?" picker.
  const people = pipeline.stages
    .filter((stage) => !stage.terminal)
    .flatMap((stage) => stage.people)
    .concat(pipeline.unstaged)
    .map((person) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
    }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Dating</h2>
          <p className="text-xs text-muted-foreground">
            {pipeline.total} {pipeline.total === 1 ? "person" : "people"}
          </p>
        </div>
        {pipeline.total >= 2 ? (
          <Button asChild size="sm" variant="outline">
            <Link href="/dating/compare">
              <Columns2 />
              Compare
            </Link>
          </Button>
        ) : null}
      </div>

      <PipelineList
        stages={pipeline.stages.map((stage) => ({
          id: stage.term.id,
          label: stage.term.label,
          icon: stage.term.icon,
          color: stage.term.color,
          terminal: stage.terminal,
          people: stage.people,
        }))}
        unstaged={pipeline.unstaged}
        timezone={timezone}
        today={today}
      />

      <PlansSection
        title="Date ideas"
        plans={plans.map((plan) => ({
          distance: plan.distance,
          id: plan.id,
          title: plan.title,
          status: plan.status,
          location: plan.location,
          address: plan.address,
          url: plan.url,
          estimatedCostCents: plan.estimatedCostCents,
          currency: plan.currency,
          notes: plan.notes,
          checklist: plan.checklist,
          plannedFor: plan.plannedFor ? plainDateFromDb(plan.plannedFor) : null,
          plannedStartMinute: plan.plannedStartMinute,
          plannedDurationMinutes: plan.plannedDurationMinutes,
          categoryId: plan.categoryId,
          category: plan.category
            ? {
                label: plan.category.label,
                icon: plan.category.icon,
                color: plan.category.color,
              }
            : null,
          contact: plan.contact,
        }))}
        categories={planCategories}
        people={people}
        defaultOpen={plans.length > 0}
      />
    </div>
  );
}
