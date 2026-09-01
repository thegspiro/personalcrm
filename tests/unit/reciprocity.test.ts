import { describe, expect, it } from "vitest";
import { summarizeReciprocity, type ReachedOutBy, type ReciprocityRow } from "@/lib/reciprocity";

/**
 * The timezone every case below is read in.
 *
 * Fixed rather than inherited from the machine: the summary dates its span by
 * calendar month, so a suite that borrowed the runner's zone would assert a
 * different month depending on where it ran.
 */
const ZONE = "UTC";

/** Newest first, matching the query that feeds this. */
function rows(kinds: ReachedOutBy[]): ReciprocityRow[] {
  return kinds.map((reachedOutBy, index) => ({
    reachedOutBy,
    occurredAt: new Date(Date.UTC(2026, 5, 20 - index, 2)),
  }));
}

const repeat = (kind: ReachedOutBy, n: number) => Array.from({ length: n }, () => kind);

describe("summarizeReciprocity", () => {
  it("does not report 0% when nothing has been attributed", () => {
    // The upgrade case: every interaction logged before the column existed is
    // UNSPECIFIED, and a ratio built from those would be wrong for every
    // existing contact on day one.
    const summary = summarizeReciprocity([], 34, ZONE);

    expect(summary.text).toContain("Not enough noted yet");
    expect(summary.text).not.toContain("%");
    expect(summary.text).not.toContain("0 of");
    expect(summary.me).toBe(0);
    expect(summary.them).toBe(0);
  });

  it("says nothing conclusive below five attributed", () => {
    const summary = summarizeReciprocity(rows(["ME", "ME", "THEM", "ME"]), 4, ZONE);
    expect(summary.text).toContain("Not enough noted yet");
  });

  it("gives bare counts between five and nine, never a ratio", () => {
    const summary = summarizeReciprocity(rows([...repeat("ME", 4), ...repeat("THEM", 2)]), 6, ZONE);

    expect(summary.text).toContain("You got in touch 4 times");
    expect(summary.text).toContain("they got in touch 2");
    expect(summary.text).not.toContain("%");
    expect(summary.text).not.toMatch(/of the last/);
  });

  it("uses the singular for a single approach", () => {
    const summary = summarizeReciprocity(rows([...repeat("ME", 1), ...repeat("THEM", 4)]), 5, ZONE);
    expect(summary.text).toContain("You got in touch 1 time,");
  });

  it("gives a ratio at ten and above", () => {
    const summary = summarizeReciprocity(rows([...repeat("ME", 8), ...repeat("THEM", 2)]), 10, ZONE);
    expect(summary.text).toContain("You got in touch 8 of the last 10 times");
  });

  it("names them when they are the ones reaching out", () => {
    const summary = summarizeReciprocity(rows([...repeat("THEM", 7), ...repeat("ME", 3)]), 10, ZONE);
    expect(summary.text).toContain("They got in touch 7 of the last 10");
  });

  it("calls an even split even", () => {
    const summary = summarizeReciprocity(rows([...repeat("ME", 5), ...repeat("THEM", 5)]), 10, ZONE);
    expect(summary.text).toContain("Evenly split — 5 each");
  });

  it("keeps MUTUAL out of the ratio in both directions", () => {
    // Ten attributed plus five mutual: the ratio must stay over ten, not fifteen,
    // and neither side may absorb the mutual ones.
    const summary = summarizeReciprocity(
      rows([...repeat("ME", 8), ...repeat("THEM", 2), ...repeat("MUTUAL", 5)]),
      15,
      ZONE,
    );

    expect(summary.text).toContain("8 of the last 10");
    expect(summary.mutual).toBe(5);
  });

  it("counts MUTUAL toward coverage even though it is out of the ratio", () => {
    const summary = summarizeReciprocity(
      rows([...repeat("ME", 8), ...repeat("THEM", 2), ...repeat("MUTUAL", 2)]),
      12,
      ZONE,
    );

    expect(summary.coverage).toBeNull();
  });

  it("says how much of the history is attributed when some is not", () => {
    const summary = summarizeReciprocity(rows([...repeat("ME", 8), ...repeat("THEM", 2)]), 34, ZONE);
    expect(summary.coverage).toBe("10 of 34 logged have who-got-in-touch noted.");
  });

  it("dates the span in the reader's timezone, not the server's", () => {
    // The oldest row in the window is 1 June 2026 at 02:00 UTC. Read in Tokyo
    // that is mid-morning on 1 June; read in Honolulu it is still 31 May. The
    // summary used to format this with no zone at all, so it answered with
    // whatever the container's clock happened to be — the one clock in the
    // system that belongs to nobody.
    const history = rows([...repeat("ME", 12), ...repeat("THEM", 8)]);

    expect(summarizeReciprocity(history, 20, "Asia/Tokyo").text).toContain("June 2026");
    expect(summarizeReciprocity(history, 20, "Pacific/Honolulu").text).toContain("May 2026");
  });

  it("caps the window at twenty and dates the span from the oldest in it", () => {
    const summary = summarizeReciprocity(rows([...repeat("ME", 25), ...repeat("THEM", 5)]), 30, ZONE);

    expect(summary.me).toBe(20);
    expect(summary.them).toBe(0);
    expect(summary.text).toContain("of the last 20");
    // Twentieth row back from 20 June 2026 is 1 June — not the thirtieth.
    expect(summary.text).toContain("June 2026");
  });
});
