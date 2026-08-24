import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Columns2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/server/user/context";
import { listPipeline } from "@/server/queries/dating";
import { canSeeDating } from "@/server/privacy/filter";
import { getPrivacyState } from "@/server/privacy/lock";
import { PipelineList } from "@/components/dating/pipeline-list";
import { calendarDateInTz } from "@/lib/dates";

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

  const pipeline = await listPipeline(user.id);
  const today = calendarDateInTz(new Date(), timezone);

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
    </div>
  );
}
