import { describe, expect, it } from "vitest";
import {
  TAXONOMY_KIND_LABELS,
  TAXONOMY_KIND_ORDER,
  TAXONOMY_SEEDS,
} from "@/server/taxonomy/defaults";

/**
 * The starter taxonomies.
 *
 * Adding a kind means touching three places — the seeds, the settings labels
 * and the settings order — and forgetting one of them fails quietly: the terms
 * exist but the user can never see or edit them.
 */
describe("taxonomy seeds", () => {
  const kinds = Object.keys(TAXONOMY_SEEDS) as Array<keyof typeof TAXONOMY_SEEDS>;

  it("every kind has terms, a label and a place in the settings order", () => {
    for (const kind of kinds) {
      expect(TAXONOMY_SEEDS[kind].length, `${kind} has no seeds`).toBeGreaterThan(0);
      expect(TAXONOMY_KIND_LABELS[kind], `${kind} has no settings label`).toBeDefined();
      expect(TAXONOMY_KIND_ORDER, `${kind} is missing from the settings order`).toContain(kind);
    }
  });

  it("slugs are unique within a kind", () => {
    for (const kind of kinds) {
      const slugs = TAXONOMY_SEEDS[kind].map((seed) => seed.slug);
      expect(new Set(slugs).size, `${kind} has a duplicate slug`).toBe(slugs.length);
    }
  });

  /**
   * Date ideas are only useful if the list covers the shapes an idea actually
   * takes — somewhere to go, something to watch, something to try — so those
   * are asserted rather than left to whoever edits the seeds next.
   */
  it("date idea categories cover places, films and things to try", () => {
    const slugs = TAXONOMY_SEEDS.DATE_IDEA_CATEGORY.map((seed) => seed.slug);

    expect(slugs).toEqual(
      expect.arrayContaining([
        "place",
        "restaurant",
        "movie",
        "show",
        "outdoors",
        "activity",
        "museum",
        "trip",
        "at-home",
        "thing-to-try",
        "other",
      ]),
    );
  });

  it("every date idea category carries an icon and a colour", () => {
    for (const seed of TAXONOMY_SEEDS.DATE_IDEA_CATEGORY) {
      expect(seed.icon, `${seed.slug} has no icon`).toBeTruthy();
      expect(seed.color, `${seed.slug} has no colour`).toBeTruthy();
    }
  });
});
