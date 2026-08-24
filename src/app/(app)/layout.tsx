import { AppearanceSync } from "@/components/providers/theme-provider";
import { BottomNav } from "@/components/nav/bottom-nav";
import { Sidebar } from "@/components/nav/sidebar";
import { TopBar } from "@/components/nav/top-bar";
import { getUserContext } from "@/server/user/context";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, prefs } = await getUserContext();

  return (
    <div className="min-h-dvh">
      <AppearanceSync accent={prefs.accent} density={prefs.density} />
      <Sidebar hideDating={prefs.hideDating} />
      <div className="lg:pl-60">
        <TopBar name={user.name} email={user.email} />
        <main className="pb-nav mx-auto w-full max-w-5xl px-4 pt-4 lg:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNav hideDating={prefs.hideDating} />
    </div>
  );
}
