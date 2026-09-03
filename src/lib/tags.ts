/**
 * Stable key behind Tag's `(ownerId, slug)` unique constraint.
 *
 * Letters and numbers in any script, not only ASCII. Folding to `[a-z0-9]`
 * left a tag written entirely in one — 朋友, Друзья, أصدقاء — with an empty
 * slug, and the action refused a perfectly good name with "Use at least one
 * letter or number."
 *
 * Latin accents still fold, because the decomposition and the combining-mark
 * strip run first, so "Café" and "Cafe" remain one tag. That strip stays
 * deliberately limited to the Latin range: a combining mark carries a vowel or
 * a virama in plenty of scripts, and removing those would merge words that are
 * not the same word. Marks are therefore kept rather than turned into
 * separators, which is also what keeps the hamza in أصدقاء from splitting it.
 *
 * The slug never appears in a URL — it is an identity key, and every tag route
 * goes by id — so widening it costs nothing there.
 */
export function normalizeTagSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // Sliced by code point, not by UTF-16 unit: a letter outside the basic plane
  // is a surrogate pair, and cutting between its halves leaves a lone
  // surrogate that utf8mb4 cannot store.
  return [...slug].slice(0, 96).join("").replace(/-+$/g, "");
}
