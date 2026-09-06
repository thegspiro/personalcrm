/**
 * Splitting a name someone typed as one field into the two columns a contact
 * has.
 *
 * Only ever a starting point: it fills a form the owner then confirms, because
 * a name is not reliably two words in that order and guessing silently is how
 * "Maria del Carmen" becomes a surname of "del Carmen". The form is the place
 * that decides; this just saves retyping the common case.
 */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}
