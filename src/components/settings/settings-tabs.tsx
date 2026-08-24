"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icon } from "@/components/nav/icon";

const TABS = [
  { value: "appearance", label: "Look", icon: "Palette" },
  { value: "fields", label: "Fields", icon: "SlidersHorizontal" },
  { value: "taxonomies", label: "Types", icon: "Tags" },
  { value: "dashboard", label: "Home", icon: "LayoutDashboard" },
  { value: "quickadd", label: "Quick add", icon: "Zap" },
  { value: "privacy", label: "Privacy", icon: "Lock" },
] as const;

/**
 * The settings sections.
 *
 * The tab strip scrolls horizontally inside its own container rather than
 * wrapping, so five tabs fit at 375px without pushing the page wide.
 */
export function SettingsTabs({
  appearance,
  fields,
  taxonomies,
  dashboard,
  quickadd,
  privacy,
}: Record<(typeof TABS)[number]["value"], React.ReactNode>) {
  const panels = { appearance, fields, taxonomies, dashboard, quickadd, privacy };

  return (
    <Tabs defaultValue="appearance" className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        <TabsList className="w-max">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="shrink-0">
              <Icon name={tab.icon} className="size-4" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {TABS.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="min-w-0">
          {panels[tab.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
