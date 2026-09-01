import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { listTerms } from "@/server/taxonomy/queries";
import { OnboardingWizard } from "@/components/onboarding/wizard";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

/**
 * Steps 2 to 5 of setting up.
 *
 * getUserContext() calls requireUser() underneath, so an unauthenticated visit
 * lands on /login rather than here. Once the wizard has been finished or
 * skipped this page has nothing left to say, so it sends you to the dashboard —
 * which is also what stops a bookmarked /welcome reopening it forever.
 */
export default async function WelcomePage() {
  const { user, prefs } = await getUserContext();
  if (prefs.onboardingCompletedAt) redirect("/");

  const categories = await listTerms(user.id, "CONTACT_CATEGORY");

  return (
    <OnboardingWizard
      name={user.name}
      timezone={prefs.timezone}
      accent={prefs.accent}
      density={prefs.density}
      defaultCadenceDays={prefs.defaultCadenceDays}
      hideDating={prefs.hideDating}
      privacyLockEnabled={prefs.privacyLockEnabled}
      blurPrivateNotes={prefs.blurPrivateNotes}
      categories={categories.map((term) => ({ id: term.id, label: term.label }))}
    />
  );
}
