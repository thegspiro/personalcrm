import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { getPrivacyState } from "@/server/privacy/lock";
import { UnlockForm } from "@/components/dating/unlock-form";

export const metadata: Metadata = { title: "Locked" };
export const dynamic = "force-dynamic";

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const state = await getPrivacyState();
  if (!state.enabled || state.unlocked) redirect("/");

  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  // Only ever come back to a path inside this app.
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dating";

  return (
    <div className="mx-auto grid w-full max-w-sm gap-4 pt-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-accent-3 text-accent-11">
          <Lock className="size-5" />
        </div>
        <h2 className="text-lg font-semibold tracking-tight">Locked</h2>
        <p className="text-xs text-muted-foreground">
          Enter your PIN to see your dating notes and anything marked private.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <UnlockForm next={next} retryAfterSeconds={state.retryAfterSeconds} />
        </CardContent>
      </Card>
    </div>
  );
}
