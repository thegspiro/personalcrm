/** Matching rule shared by writes and documented migration backfill. */
export function normalizeLocationName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}
