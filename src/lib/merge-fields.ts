/**
 * Which columns the merge screen asks about, and how to show them.
 *
 * Only fields that *differ* are ever asked about — the whole point of asking is
 * that something would otherwise be discarded, and a screen listing twenty
 * identical rows buries the two that matter.
 */

export interface MergeFieldSpec {
  field: string;
  label: string;
  /** Rendering hint; the screen shows a date differently from a note. */
  kind: "text" | "date" | "boolean" | "number" | "reference";
}

export const MERGE_FIELDS: readonly MergeFieldSpec[] = [
  { field: "firstName", label: "First name", kind: "text" },
  { field: "lastName", label: "Last name", kind: "text" },
  { field: "nickname", label: "Nickname", kind: "text" },
  { field: "pronouns", label: "Pronouns", kind: "text" },
  { field: "avatarPath", label: "Photo", kind: "reference" },
  { field: "categoryId", label: "Category", kind: "reference" },
  { field: "birthDate", label: "Birthday", kind: "date" },
  { field: "occupation", label: "Occupation", kind: "text" },
  { field: "employer", label: "Employer", kind: "text" },
  { field: "city", label: "City", kind: "text" },
  { field: "region", label: "Region", kind: "text" },
  { field: "country", label: "Country", kind: "text" },
  { field: "timezone", label: "Timezone", kind: "text" },
  { field: "howWeMet", label: "How you met", kind: "text" },
  { field: "whereWeMet", label: "Where you met", kind: "text" },
  { field: "metOn", label: "Met on", kind: "date" },
  { field: "summary", label: "Summary", kind: "text" },
  { field: "cadenceDays", label: "Reach out every", kind: "number" },
  { field: "isFavorite", label: "Favourite", kind: "boolean" },
];

/** Precision travels with the date it qualifies, never as its own question. */
const PAIRED: Record<string, string> = {
  birthDate: "birthDatePrecision",
  metOn: "metOnPrecision",
  categoryId: "categoryId",
};

export function pairedField(field: string): string | null {
  const paired = PAIRED[field];
  return paired && paired !== field ? paired : null;
}

function comparable(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * Whether a field genuinely differs between the two records.
 *
 * A value one side simply does not have is not a conflict: it fills in from the
 * other, and asking would be asking somebody to confirm that something beats
 * nothing. Only two *different* answers are a question.
 */
export function isConflict(a: unknown, b: unknown): boolean {
  const left = comparable(a);
  const right = comparable(b);
  if (left === "" || right === "") return false;
  return left !== right;
}

/** A field only one side answered, which fills in without being asked about. */
export function isFilledFromOther(winner: unknown, loser: unknown): boolean {
  return comparable(winner) === "" && comparable(loser) !== "";
}
