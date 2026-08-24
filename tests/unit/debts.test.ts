import { describe, expect, it } from "vitest";
import { summarizeDebts, type DebtRow } from "@/lib/debts";

function row(over: Partial<DebtRow> = {}): DebtRow {
  return {
    direction: "THEY_OWE_ME",
    amountCents: 1000,
    currency: "USD",
    settled: false,
    ...over,
  };
}

describe("summarizeDebts", () => {
  it("returns nothing for no debts", () => {
    expect(summarizeDebts([])).toEqual({ balances: [], itemCount: 0, settledCount: 0 });
  });

  it("keeps currencies in separate buckets", () => {
    const summary = summarizeDebts([
      row({ amountCents: 5000, currency: "USD" }),
      row({ amountCents: 3000, currency: "EUR" }),
    ]);

    expect(summary.balances).toHaveLength(2);
    expect(summary.balances.map((b) => b.currency)).toEqual(["EUR", "USD"]);
    expect(summary.balances.find((b) => b.currency === "USD")?.theyOweCents).toBe(5000);
  });

  it("does not invent a currency bucket for a lent object", () => {
    // The regression that motivated splitting money from items before grouping:
    // an object loan still carries the default USD, so grouping first produced a
    // phantom $0.00 balance for a borrowed drill.
    const summary = summarizeDebts([row({ amountCents: null, currency: "USD" })]);

    expect(summary.balances).toEqual([]);
    expect(summary.itemCount).toBe(1);
  });

  it("counts lent objects without valuing them", () => {
    const summary = summarizeDebts([
      row({ amountCents: 2000 }),
      row({ amountCents: null }),
      row({ amountCents: null }),
    ]);

    expect(summary.itemCount).toBe(2);
    expect(summary.balances[0].theyOweCents).toBe(2000);
  });

  it("leaves settled debts out of the balance but still counts them", () => {
    const summary = summarizeDebts([
      row({ amountCents: 4000 }),
      row({ amountCents: 9900, settled: true }),
    ]);

    expect(summary.balances[0].theyOweCents).toBe(4000);
    expect(summary.settledCount).toBe(1);
  });

  it("reports both directions gross", () => {
    const summary = summarizeDebts([
      row({ direction: "THEY_OWE_ME", amountCents: 22000 }),
      row({ direction: "I_OWE_THEM", amountCents: 20000 }),
    ]);

    expect(summary.balances[0]).toMatchObject({
      theyOweCents: 22000,
      youOweCents: 20000,
      netCents: 2000,
    });
  });

  it("nets only when money is outstanding both ways", () => {
    const oneWay = summarizeDebts([row({ amountCents: 4000 })]);
    expect(oneWay.balances[0].netCents).toBeNull();
  });

  it("never nets across currencies", () => {
    const summary = summarizeDebts([
      row({ direction: "THEY_OWE_ME", amountCents: 5000, currency: "USD" }),
      row({ direction: "I_OWE_THEM", amountCents: 5000, currency: "EUR" }),
    ]);

    expect(summary.balances.every((b) => b.netCents === null)).toBe(true);
  });
});
