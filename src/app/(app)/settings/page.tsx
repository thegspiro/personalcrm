import type { Metadata } from "next";
import { Settings2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
      <EmptyState
        icon={<Settings2 />}
        title="Settings land in the next phase"
        description="Custom fields, editable taxonomies, dashboard layout, and appearance."
      />
    </div>
  );
}
