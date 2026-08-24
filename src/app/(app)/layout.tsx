import { AppearanceSync } from "@/components/providers/theme-provider";
import { BottomNav } from "@/components/nav/bottom-nav";
import { Sidebar } from "@/components/nav/sidebar";
import { TopBar } from "@/components/nav/top-bar";
import { getUserContext } from "@/server/user/context";
import { listContactOptions } from "@/server/queries/contacts";
import { listTerms } from "@/server/taxonomy/queries";
import { fieldsFor } from "@/server/queries/custom-fields";
import { QuickLogFab } from "@/components/nav/quick-log-fab";
import { OfflineBanner, ServiceWorkerRegistrar } from "@/components/offline/offline";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, prefs } = await getUserContext();

  // Loaded once for the whole shell so the floating log button works from any
  // screen without each page having to supply it.
  const [contacts, interactionTypes, interactionFields] = await Promise.all([
    listContactOptions(user.id),
    listTerms(user.id, "INTERACTION_TYPE"),
    fieldsFor(user.id, "INTERACTION", null),
  ]);

  return (
    <div className="min-h-dvh">
      <AppearanceSync accent={prefs.accent} density={prefs.density} />
      <Sidebar hideDating={prefs.hideDating} />
      <div className="lg:pl-60">
        <TopBar name={user.name} email={user.email} hideDating={prefs.hideDating} />
        <main className="pb-nav mx-auto w-full max-w-5xl px-4 pt-4 lg:px-6 lg:pb-10">
          {/* Rendered on the server, so it says how old this copy actually is
              rather than when the browser noticed it was offline. */}
          <OfflineBanner renderedAt={new Date().toISOString()} />
          {children}
        </main>
      </div>
      <ServiceWorkerRegistrar />
      <QuickLogFab
        contacts={contacts}
        types={interactionTypes}
        customFields={interactionFields}
      />
      <BottomNav hideDating={prefs.hideDating} />
    </div>
  );
}
