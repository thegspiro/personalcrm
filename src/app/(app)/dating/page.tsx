import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Columns2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/server/user/context";
import { listDateIdeas, listPipeline } from "@/server/queries/dating";
import { listTerms } from "@/server/taxonomy/queries";
import { canSeeDating } from "@/server/privacy/filter";
import { getPrivacyState } from "@/server/privacy/lock";
import { PipelineList } from "@/components/dating/pipeline-list";
import { DateIdeasSection } from "@/components/dating/date-ideas";
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

  const [pipeline, dateIdeas, ideaCategories] = await Promise.all([
    listPipeline(user.id),
    listDateIdeas(user.id),
    listTerms(user.id, "DATE_IDEA_CATEGORY"),
  ]);
  const today = calendarDateInTz(new Date(), timezone);

  // Everyone still in the pipeline, for the "who for?" picker.
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

      <DateIdeasSection
        ideas={dateIdeas.map((idea) => ({
          id: idea.id,
          title: idea.title,
          status: idea.status,
          location: idea.location,
          city: idea.city,
          url: idea.url,
          estimatedCostCents: idea.estimatedCostCents,
          currency: idea.currency,
          notes: idea.notes,
          plannedFor: idea.plannedFor ? plainDateFromDb(idea.plannedFor) : null,
          category: idea.category
            ? {
                label: idea.category.label,
                icon: idea.category.icon,
                color: idea.category.color,
              }
            : null,
          contact: idea.contact,
        }))}
        categories={ideaCategories}
        people={people}
        defaultOpen={dateIdeas.length > 0}
      />
    </div>
  );
}
