import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/server/user/context";
import { unitOf } from "@/lib/geo";
import { listForCompare } from "@/server/queries/dating";
import { canSeeDating } from "@/server/privacy/filter";
import { getPrivacyState } from "@/server/privacy/lock";
import { CompareView } from "@/components/dating/compare-view";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const { user, prefs } = await getUserContext();

  if (prefs.hideDating) redirect("/");
  if (!(await canSeeDating(prefs.hideDating))) {
    const { enabled } = await getPrivacyState();
    redirect(enabled ? "/unlock?next=/dating/compare" : "/");
  }

  const rows = await listForCompare(user.id);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to dating">
          <Link href="/dating">
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Compare</h2>
          <p className="text-xs text-muted-foreground">
            Sort the table, or tick people to hold them side by side.
          </p>
        </div>
      </div>

      <CompareView rows={rows} now={new Date()} unit={unitOf(prefs.distanceUnit)} />
    </div>
  );
}
