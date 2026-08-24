import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/server/auth/session";
import { needsFirstRunSetup, signupsAllowed } from "@/server/auth/provision";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await needsFirstRunSetup()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const canSignUp = await signupsAllowed();

  return (
    <Card className="shadow-lg">
      <CardContent className="pt-5">
        <LoginForm />
        {canSignUp ? (
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Need an account?{" "}
            <Link href="/signup" className="font-medium text-accent-11 hover:underline">
              Create one
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
