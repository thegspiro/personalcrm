import { z } from "zod";

export const planChecklistItemSchema = z.object({
  id: z.string().min(1).max(80),
  text: z.string().trim().min(1).max(191),
  completed: z.boolean(),
});

export const planChecklistSchema = z
  .array(planChecklistItemSchema)
  .max(25)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
    message: "Checklist item ids must be unique.",
  });

export type PlanChecklistItem = z.infer<typeof planChecklistItemSchema>;

export const STARTER_PLAN_CHECKLIST: readonly PlanChecklistItem[] = [
  { id: "starter-availability", text: "Confirm availability", completed: false },
  { id: "starter-reserve", text: "Reserve or buy tickets", completed: false },
  { id: "starter-travel", text: "Check travel time", completed: false },
  { id: "starter-budget", text: "Agree on budget", completed: false },
  { id: "starter-fallback", text: "Choose a fallback", completed: false },
];

/** JSON columns accept any shape; keep malformed values out of the UI. */
export function readPlanChecklist(value: unknown): PlanChecklistItem[] {
  const parsed = planChecklistSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}
