"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icon } from "@/components/nav/icon";

const TABS = [
  { value: "account", label: "Account", icon: "UserRound" },
  { value: "appearance", label: "Look", icon: "Palette" },
  { value: "fields", label: "Fields", icon: "SlidersHorizontal" },
  { value: "taxonomies", label: "Types", icon: "Tags" },
  { value: "dashboard", label: "Home", icon: "LayoutDashboard" },
  { value: "notifications", label: "Reminders", icon: "Bell" },
  { value: "quickadd", label: "Quick add", icon: "Zap" },
  { value: "places", label: "Places", icon: "MapPin" },
  { value: "privacy", label: "Privacy", icon: "Lock" },
  { value: "app", label: "App", icon: "Smartphone" },
] as const;

/**
 * The settings sections.
 *
 * The tab strip scrolls horizontally inside its own container rather than
 * wrapping, so they fit at 375px without pushing the page wide.
 */
export function SettingsTabs({
  appearance,
  account,
  fields,
  taxonomies,
  dashboard,
  notifications,
  quickadd,
  places,
  privacy,
  app,
}: Record<(typeof TABS)[number]["value"], React.ReactNode>) {
  // Every entry in TABS needs one here, or its tab renders empty. Two branches
  // each adding a tab is exactly how one goes missing.
  const panels = {
    account,
    appearance,
    fields,
    taxonomies,
    dashboard,
    notifications,
    quickadd,
    places,
    privacy,
    app,
  };

  return (
    <Tabs
      defaultValue="appearance"
      className="grid grid-cols-[minmax(0,1fr)] gap-4"
    >
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
