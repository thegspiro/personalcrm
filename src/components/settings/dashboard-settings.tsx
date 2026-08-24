"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/components/form/use-action";
import {
  WIDGET_REGISTRY,
  widgetSetting,
  type WidgetId,
  type WidgetLayoutEntry,
} from "@/lib/dashboard";
import {
  moveWidget,
  resetDashboardLayout,
  setWidgetEnabled,
  setWidgetSetting,
} from "@/server/actions/dashboard";

const SETTING_LABELS: Record<string, string> = {
  limit: "How many to show",
  windowDays: "How many days ahead",
};

/**
 * Arranging the home screen.
 *
 * Reordering is buttons rather than drag-and-drop, for the same reason the
 * dating pipeline is: dragging is fiddly on a phone, and this is the screen
 * you tune once.
 */
export function DashboardSettings({ layout }: { layout: WidgetLayoutEntry[] }) {
  const run = useAction();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          What shows on the home screen, and in what order.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => {
            if (!confirm("Put the home screen back to how it shipped?")) return;
            void run(() => resetDashboardLayout(), "Reset");
          }}
        >
          Reset
        </Button>
      </div>

      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {layout.map((entry, index) => (
          <WidgetRow
            key={entry.id}
            entry={entry}
            isFirst={index === 0}
            isLast={index === layout.length - 1}
          />
        ))}
      </ul>
    </div>
  );
}

function WidgetRow({
  entry,
  isFirst,
  isLast,
}: {
  entry: WidgetLayoutEntry;
  isFirst: boolean;
  isLast: boolean;
}) {
  const run = useAction();
  const definition = WIDGET_REGISTRY[entry.id as WidgetId];
  if (!definition) return null;

  const settingKeys = Object.keys(definition.defaultSettings ?? {});

  return (
    <li className="min-w-0 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <Icon name={definition.icon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", !entry.enabled && "text-muted-foreground")}>
            {definition.title}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">{definition.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label={`Move ${definition.title} up`}
            disabled={isFirst}
            onClick={() => void run(() => moveWidget(entry.id, "up"))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Icon name="ChevronUp" className="size-4" />
          </button>
          <button
            type="button"
            aria-label={`Move ${definition.title} down`}
            disabled={isLast}
            onClick={() => void run(() => moveWidget(entry.id, "down"))}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          >
            <Icon name="ChevronDown" className="size-4" />
          </button>
          <Switch
            checked={entry.enabled}
            aria-label={`Show ${definition.title}`}
            onCheckedChange={(checked) =>
              void run(() => setWidgetEnabled(entry.id, checked), checked ? "Shown" : "Hidden")
            }
          />
        </div>
      </div>

      {entry.enabled && settingKeys.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-3 border-t border-border/70 pt-2">
          {settingKeys.map((key) => (
            <NumberSetting
              key={key}
              widgetId={entry.id}
              settingKey={key}
              label={SETTING_LABELS[key] ?? key}
              value={widgetSetting(entry, key, 8)}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function NumberSetting({
  widgetId,
  settingKey,
  label,
  value,
}: {
  widgetId: string;
  settingKey: string;
  label: string;
  value: number;
}) {
  const run = useAction();
  const [draft, setDraft] = React.useState(String(value));
  const id = `${widgetId}-${settingKey}`;

  // Committed on blur rather than on every keystroke — one save per edit, not
  // one per digit.
  function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed) || parsed === value) {
      setDraft(String(value));
      return;
    }
    void run(() => setWidgetSetting(widgetId, settingKey, parsed));
  }

  return (
    <label htmlFor={id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
      {label}
      <input
        id={id}
        type="number"
        min={1}
        max={365}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        className="h-8 w-16 rounded-md border border-input bg-card px-2 text-sm text-foreground"
      />
    </label>
  );
}
