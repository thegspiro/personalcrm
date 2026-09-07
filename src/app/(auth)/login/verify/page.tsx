import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/session";
import { readPendingTwoFactor } from "@/server/auth/pending-two-factor";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Two-factor" };
export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  // Already through: nothing to verify.
  if (await getCurrentUser()) redirect("/");
  // Reached without a password step, or after the window closed. Back to the
  // start rather than a form that cannot succeed.
  if (!(await readPendingTwoFactor())) redirect("/login");

  return (
    <Card className="shadow-lg">
      <CardContent className="pt-5">
        <VerifyForm />
      </CardContent>
    </Card>
  );
}
