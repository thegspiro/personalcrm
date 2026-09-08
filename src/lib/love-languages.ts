/**
 * The five love languages, as a closed list.
 *
 * Deliberately not a `TaxonomyTerm` kind. The house rule is that a new "type" is
 * a taxonomy row rather than a constant, but that rule is about types the
 * account extends and renames — stages, categories, activity types. This is a
 * fixed set of five from one book: making it a taxonomy would mean a new
 * `TaxonomyKind` enum member, which is a schema migration, to gain an
 * extensibility nobody wants.
 *
 * The column already stores whatever `upsertRomanticProfile` was handed, and
 * nothing ever validated it, so the reader keeps only values it recognises.
 */
export const LOVE_LANGUAGES = [
  "Words of affirmation",
  "Quality time",
  "Acts of service",
  "Physical touch",
  "Receiving gifts",
] as const;

export type LoveLanguage = (typeof LOVE_LANGUAGES)[number];

function isLoveLanguage(value: unknown): value is LoveLanguage {
  return typeof value === "string" && (LOVE_LANGUAGES as readonly string[]).includes(value);
}

/**
 * Known values only, in the order above rather than the order they were
 * submitted, and never the same one twice — a checkbox group cannot produce a
 * duplicate, but a direct POST can.
 */
export function readLoveLanguages(value: unknown): LoveLanguage[] {
  if (!Array.isArray(value)) return [];
  const chosen = new Set(value.filter(isLoveLanguage));
  return LOVE_LANGUAGES.filter((language) => chosen.has(language));
}
