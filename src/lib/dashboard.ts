/**
 * Dashboard widget registry.
 *
 * A user's `DashboardLayout.widgets` is an ordered list of { id, enabled,
 * settings }. Unknown ids are ignored on render and registry entries missing
 * from a stored layout are appended, so adding a widget in a later release
 * never breaks an existing layout.
 */
export const WIDGET_IDS = [
  "quick-add",
  "overdue",
  "upcoming-dates",
  "recent-interactions",
  "open-tasks",
  "dating-pipeline",
  "idea-bank",
  "stats",
] as const;

export type WidgetId = (typeof WIDGET_IDS)[number];

export interface WidgetDefinition {
  id: WidgetId;
  title: string;
  description: string;
  icon: string;
  defaultEnabled: boolean;
  /** Spans both columns on desktop. */
  wide?: boolean;
  defaultSettings?: Record<string, unknown>;
}

export const WIDGET_REGISTRY: Record<WidgetId, WidgetDefinition> = {
  "quick-add": {
    id: "quick-add",
    title: "Quick add",
    description: "One-tap tiles for the things you log most.",
    icon: "Zap",
    defaultEnabled: true,
    wide: true,
  },
  overdue: {
    id: "overdue",
    title: "Time to reach out",
    description: "People whose keep-in-touch cadence has come due.",
    icon: "BellRing",
    defaultEnabled: true,
    defaultSettings: { limit: 8 },
  },
  "upcoming-dates": {
    id: "upcoming-dates",
    title: "Coming up",
    description: "Birthdays and important dates in the next few weeks.",
    icon: "CalendarDays",
    defaultEnabled: true,
    defaultSettings: { windowDays: 45, limit: 8 },
  },
  "recent-interactions": {
    id: "recent-interactions",
    title: "Recent activity",
    description: "The last things you logged.",
    icon: "History",
    defaultEnabled: true,
    defaultSettings: { limit: 8 },
  },
  "open-tasks": {
    id: "open-tasks",
    title: "Things to do",
    description: "Manual tasks, soonest due first.",
    icon: "CircleCheck",
    defaultEnabled: true,
    defaultSettings: { limit: 8 },
  },
  "dating-pipeline": {
    id: "dating-pipeline",
    title: "Dating pipeline",
    description: "Who's at which stage right now.",
    icon: "Heart",
    defaultEnabled: true,
    wide: true,
  },
  "idea-bank": {
    id: "idea-bank",
    title: "Bring this up",
    description: "Conversation ideas you've been meaning to raise.",
    icon: "Lightbulb",
    defaultEnabled: true,
    defaultSettings: { limit: 6 },
  },
  stats: {
    id: "stats",
    title: "At a glance",
    description: "Counts of people, interactions, and streaks.",
    icon: "ChartNoAxesColumn",
    defaultEnabled: false,
    wide: true,
  },
};

export interface WidgetLayoutEntry {
  id: WidgetId;
  enabled: boolean;
  settings?: Record<string, unknown>;
}

export const DEFAULT_WIDGET_ORDER: WidgetId[] = [
  "quick-add",
  "overdue",
  "upcoming-dates",
  "dating-pipeline",
  "recent-interactions",
  "open-tasks",
  "idea-bank",
  "stats",
];

export function defaultDashboardLayout(): WidgetLayoutEntry[] {
  return DEFAULT_WIDGET_ORDER.map((id) => ({
    id,
    enabled: WIDGET_REGISTRY[id].defaultEnabled,
    settings: WIDGET_REGISTRY[id].defaultSettings,
  }));
}

/**
 * Reconcile a stored layout against the registry: drop widgets that no longer
 * exist, keep the user's order and toggles, and append anything newly added.
 */
export function normalizeDashboardLayout(stored: unknown): WidgetLayoutEntry[] {
  const known = new Set<string>(WIDGET_IDS);
  const seen = new Set<string>();
  const out: WidgetLayoutEntry[] = [];

  if (Array.isArray(stored)) {
    for (const raw of stored) {
      if (!raw || typeof raw !== "object") continue;
      const id = (raw as { id?: unknown }).id;
      if (typeof id !== "string" || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      const settings = (raw as { settings?: unknown }).settings;
      out.push({
        id: id as WidgetId,
        enabled: (raw as { enabled?: unknown }).enabled !== false,
        settings:
          settings && typeof settings === "object"
            ? { ...WIDGET_REGISTRY[id as WidgetId].defaultSettings, ...(settings as Record<string, unknown>) }
            : WIDGET_REGISTRY[id as WidgetId].defaultSettings,
      });
    }
  }

  for (const id of DEFAULT_WIDGET_ORDER) {
    if (seen.has(id)) continue;
    out.push({
      id,
      enabled: WIDGET_REGISTRY[id].defaultEnabled,
      settings: WIDGET_REGISTRY[id].defaultSettings,
    });
  }

  return out;
}

export function widgetSetting<T>(entry: WidgetLayoutEntry, key: string, fallback: T): T {
  const value = entry.settings?.[key];
  return value === undefined ? fallback : (value as T);
}
