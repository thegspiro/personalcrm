"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, ok, owner } from "./helpers";
import {
  normalizeDashboardLayout,
  WIDGET_IDS,
  WIDGET_REGISTRY,
  defaultDashboardLayout,
  type WidgetId,
  type WidgetLayoutEntry,
} from "@/lib/dashboard";

/**
 * Arranging the home screen.
 *
 * Every write goes back through `normalizeDashboardLayout`, so a stored layout
 * is always reconciled against the registry: unknown ids are dropped and newly
 * shipped widgets are appended. That is what keeps a saved layout working
 * across an upgrade that adds or removes a widget.
 */

function touch() {
  revalidatePath("/");
  revalidatePath("/settings");
}

async function currentLayout(ownerId: string): Promise<WidgetLayoutEntry[]> {
  const row = await prisma.dashboardLayout.findUnique({ where: { userId: ownerId } });
  return normalizeDashboardLayout(row?.widgets);
}

async function save(ownerId: string, layout: WidgetLayoutEntry[]): Promise<void> {
  const widgets = layout as unknown as Prisma.InputJsonValue;
  await prisma.dashboardLayout.upsert({
    where: { userId: ownerId },
    create: { userId: ownerId, widgets },
    update: { widgets },
  });
}

function isWidgetId(value: string): value is WidgetId {
  return (WIDGET_IDS as readonly string[]).includes(value);
}

export async function setWidgetEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!isWidgetId(id)) return fail("Unknown widget.");

  const layout = await currentLayout(ownerId);
  await save(
    ownerId,
    layout.map((entry) => (entry.id === id ? { ...entry, enabled } : entry)),
  );

  touch();
  return ok();
}

export async function moveWidget(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!isWidgetId(id)) return fail("Unknown widget.");

  const layout = await currentLayout(ownerId);
  const index = layout.findIndex((entry) => entry.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  // Already at the end — not an error, just nothing to do.
  if (index === -1 || target < 0 || target >= layout.length) return ok();

  const next = [...layout];
  [next[index], next[target]] = [next[target], next[index]];
  await save(ownerId, next);

  touch();
  return ok();
}

/**
 * Change one widget's setting — how many rows it shows, how far ahead it looks.
 *
 * Values are clamped rather than rejected: this is a number input on a
 * settings page, and silently keeping it sane beats an error message.
 */
export async function setWidgetSetting(
  id: string,
  key: string,
  value: number,
): Promise<ActionResult> {
  const { ownerId } = await owner();
  if (!isWidgetId(id)) return fail("Unknown widget.");

  const defaults = WIDGET_REGISTRY[id].defaultSettings ?? {};
  if (!(key in defaults)) return fail("Unknown setting.");
  if (!Number.isFinite(value)) return fail("That isn't a number.");

  const clamped = Math.max(1, Math.min(365, Math.round(value)));
  const layout = await currentLayout(ownerId);
  await save(
    ownerId,
    layout.map((entry) =>
      entry.id === id ? { ...entry, settings: { ...entry.settings, [key]: clamped } } : entry,
    ),
  );

  touch();
  return ok();
}

/** Put the home screen back to how it shipped. */
export async function resetDashboardLayout(): Promise<ActionResult> {
  const { ownerId } = await owner();
  await save(ownerId, defaultDashboardLayout());

  touch();
  return ok();
}
