import type { Metadata } from "next";
import { Settings2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { getUserContext } from "@/server/user/context";
import { PrivacySettings } from "@/components/dating/privacy-settings";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { user, prefs } = await getUserContext();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Settings</h2>

      <PrivacySettings
        pinSet={Boolean(user.privacyPinHash)}
        privacyLockEnabled={prefs.privacyLockEnabled}
        hideDating={prefs.hideDating}
        blurPrivateNotes={prefs.blurPrivateNotes}
      />

      <EmptyState
        icon={<Settings2 />}
        title="More settings coming"
        description="Custom fields, editable taxonomies, dashboard layout, and appearance arrive in the next phase."
      />
    </div>
  );
}
