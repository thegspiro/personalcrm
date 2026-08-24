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
    <Card className="shadow-lg">
      <CardContent className="pt-5">
        <RegisterForm
          action={setupAction}
          heading="Create your account"
          subheading="This first account is the administrator. Everything stays on your server."
          submitLabel="Create account & start"
        />
      </CardContent>
    </Card>
  );
}
