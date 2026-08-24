import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/session";
import { needsFirstRunSetup, signupsAllowed } from "@/server/auth/provision";
import { signupAction } from "@/server/actions/auth";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await needsFirstRunSetup()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  if (!(await signupsAllowed())) redirect("/login");

  return (
    <Card className="shadow-lg">
      <CardContent className="pt-5">
        <RegisterForm
          action={signupAction}
          heading="Create an account"
          subheading="Your contacts are yours alone — nothing is shared between accounts."
          submitLabel="Create account"
        />
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Already have one?{" "}
          <Link href="/login" className="font-medium text-accent-11 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
