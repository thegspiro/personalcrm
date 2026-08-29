import { describe, expect, it } from "vitest";
import { howLongAgo } from "@/components/offline/offline";

/**
 * How old a saved copy is.
 *
 * The whole point of the offline banner is that stale data must not look
 * live, so the number has to be right at the scale that matters — ten minutes
 * and twenty hours are both "today", and only one of them should worry you.
 */
const NOW = new Date("2026-03-11T14:30:00Z");
const ago = (seconds: number) => howLongAgo(new Date(NOW.getTime() - seconds * 1000), NOW);

describe("howLongAgo", () => {
  it("treats anything under a minute as just now", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(59)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(ago(60)).toMatch(/minute/);
    expect(ago(45 * 60)).toMatch(/45 minutes/);
    expect(ago(2 * 3600)).toMatch(/2 hours/);
    expect(ago(3 * 86400)).toMatch(/3 days/);
  });

  it("distinguishes ten minutes from twenty hours", () => {
    // Both are "today" to a day-granular formatter, which is exactly why this
    // does not reuse relativeInstant.
    expect(ago(10 * 60)).not.toBe(ago(20 * 3600));
  });

  it("keeps going past a week", () => {
    expect(ago(10 * 86400)).toMatch(/week/);
    expect(ago(60 * 86400)).toMatch(/month/);
  });

  it("does not throw on a bad timestamp", () => {
    expect(howLongAgo(new Date("nonsense"), NOW)).toBe("just now");
  });
});
