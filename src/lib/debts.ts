/**
 * Outstanding balances, summarised.
 *
 * Pure, so the arithmetic that decides what a page claims you are owed can be
 * tested without a database.
 */
export type DebtDirection = "THEY_OWE_ME" | "I_OWE_THEM";

export interface DebtRow {
  direction: DebtDirection;
  /** Null when what was lent was a thing rather than a sum. */
  amountCents: number | null;
  currency: string;
  /** True once it has been paid back. Settled debts keep their row. */
  settled: boolean;
}

export interface CurrencyBalance {
  currency: string;
  /** Owed to you, in cents. Always positive. */
  theyOweCents: number;
  /** Owed by you, in cents. Always positive. */
  youOweCents: number;
  /**
   * Positive when you are up overall, negative when you are down. Null unless
   * there is something outstanding in both directions — with debt running one
   * way, the net is just the gross again, and printing it twice invites the
   * reader to think two different things were measured.
   */
  netCents: number | null;
}

export interface DebtSummary {
  balances: CurrencyBalance[];
  /** Outstanding loans with no sum attached, counted but never valued. */
  itemCount: number;
  settledCount: number;
}

export function summarizeDebts(rows: readonly DebtRow[]): DebtSummary {
  const outstanding = rows.filter((row) => !row.settled);

  // Split before grouping, not inside the sum. An object loan still carries a
  // currency column — it defaults to USD like every other row — so grouping
  // first would conjure a $0.00 balance out of a borrowed drill.
  const money = outstanding.filter((row) => row.amountCents !== null);
  const items = outstanding.filter((row) => row.amountCents === null);

  const byCurrency = new Map<string, { theyOweCents: number; youOweCents: number }>();
  for (const row of money) {
    const bucket = byCurrency.get(row.currency) ?? { theyOweCents: 0, youOweCents: 0 };
    if (row.direction === "THEY_OWE_ME") bucket.theyOweCents += row.amountCents ?? 0;
    else bucket.youOweCents += row.amountCents ?? 0;
    byCurrency.set(row.currency, bucket);
  }

  const balances = [...byCurrency.entries()]
    .map(([currency, bucket]) => ({
      currency,
      ...bucket,
      // Never across currencies: a single number spanning dollars and euros is
      // not a smaller answer, it is a wrong one.
      netCents:
        bucket.theyOweCents > 0 && bucket.youOweCents > 0
          ? bucket.theyOweCents - bucket.youOweCents
          : null,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    balances,
    itemCount: items.length,
    settledCount: rows.length - outstanding.length,
  };
}
