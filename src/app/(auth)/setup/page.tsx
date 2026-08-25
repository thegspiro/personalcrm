import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { needsFirstRunSetup } from "@/server/auth/provision";
import { setupAction } from "@/server/actions/auth";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!(await needsFirstRunSetup())) redirect("/login");

  return (
    <div className="grid gap-3">
      {/* Step 1 of the same five the wizard continues, so the two screens read
          as one sequence rather than a form followed by a surprise. */}
      <ol className="flex items-center gap-1.5" aria-label="Step 1 of 5">
        {[1, 2, 3, 4, 5].map((step) => (
          <li
            key={step}
            aria-current={step === 1 ? "step" : undefined}
            className={`h-1.5 flex-1 rounded-full ${step === 1 ? "bg-accent-8" : "bg-muted"}`}
          />
        ))}
      </ol>

      <Card className="shadow-lg">
        <CardContent className="grid gap-4 pt-5">
          <p className="text-xs font-medium text-accent-11">Step 1 of 5</p>
          <RegisterForm
            action={setupAction}
            heading="Create your account"
            subheading="This first account is the administrator. Everything stays on your server."
            submitLabel="Create account & continue"
          />
        </CardContent>
      </Card>
    </div>
  );
}
