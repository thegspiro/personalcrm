/**
 * What a person cannot, or will not, eat.
 *
 * The whole module exists to keep one line honest: `mustAvoid`. Everything the
 * UI renders about a dietary need goes through it, so the page only ever shows
 * two groups — must avoid, and prefers to avoid. Four kinds are recorded
 * because "lactose intolerant" and "milk allergy" are genuinely different notes
 * to have written down, but they must never render as four escalating tiers.
 * A visible gradient is a severity scale wearing a different hat, and the
 * reason there is no severity scale is in the schema comment on `DietaryNeed`.
 */
export const DIETARY_KINDS = ["ALLERGY", "INTOLERANCE", "MEDICAL", "PREFERENCE"] as const;

export type DietaryKind = (typeof DIETARY_KINDS)[number];

export const DIETARY_KIND_LABELS: Record<DietaryKind, string> = {
  ALLERGY: "Allergy",
  INTOLERANCE: "Intolerance",
  MEDICAL: "Medical",
  PREFERENCE: "Preference",
};

/**
 * The only distinction the interface is allowed to draw.
 *
 * Anything that isn't a stated preference is treated as a hard avoid, which is
 * the safe direction to be wrong in: serving someone food they merely dislike
 * is a bad evening, and the other mistake is a hospital.
 */
export function mustAvoid(kind: DietaryKind): boolean {
  return kind !== "PREFERENCE";
}

/** Display order, stated explicitly rather than inherited from the enum. */
export const DIETARY_GROUPS = [
  { id: "avoid", heading: "Must avoid", kinds: DIETARY_KINDS.filter(mustAvoid) },
  { id: "preference", heading: "Prefers to avoid", kinds: (["PREFERENCE"] as const) },
] as const;

export function dietaryKindOf(value: string | undefined): DietaryKind {
  return DIETARY_KINDS.includes(value as DietaryKind) ? (value as DietaryKind) : "ALLERGY";
}
