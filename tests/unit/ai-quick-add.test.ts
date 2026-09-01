import { describe, expect, it, vi } from "vitest";
import type { ParseContact, ParseLocation, ParseType } from "@/lib/quick-parse";

/**
 * The guarantee that makes the assisted reading safe to have at all.
 *
 * `src/server/ai/` is optional and deletable, but while it is switched on its
 * answer is folded into the local one — and the rule is that it may not do
 * anything the local parser refuses to. People and places come back through
 * the local matcher, the type must exist in the user's own taxonomy, and the
 * date must survive strict parsing. Until now that rule was asserted only in
 * prose, which is a thin guard for the one place a model's output reaches a
 * write path.
 *
 * The provider is stubbed, so nothing here touches a network.
 */

const completeJson = vi.hoisted(() => vi.fn());

vi.mock("@/server/ai/config", () => ({
  assistanceAvailable: async () => true,
  currentProviderConfig: async () => ({
    provider: "custom",
    baseUrl: "http://localhost:11434/v1",
    model: "test",
    apiKey: "",
  }),
}));

vi.mock("@/server/ai/providers", () => ({
  completeJson,
  verifyProvider: async () => ({ ok: true }),
}));

const { assistedQuickParse } = await import("@/server/ai/quick-add");
const { quickParse } = await import("@/lib/quick-parse");

const NOW = new Date("2026-03-11T14:30:00Z");
const TZ = "America/New_York";

const CONTACTS: ParseContact[] = [
  { id: "sarah", firstName: "Sarah", lastName: "Whitfield" },
  { id: "uncle", firstName: "John", lastName: "Whitfield" },
  { id: "cousin", firstName: "John", lastName: "Bell" },
];
const TYPES: ParseType[] = [{ id: "t-coffee", slug: "coffee", label: "Coffee" }];
const LOCATIONS: ParseLocation[] = [{ id: "l-north", name: "Northside Cafe" }];

const context = { contacts: CONTACTS, types: TYPES, locations: LOCATIONS, now: NOW, timeZone: TZ };

function local(input: string) {
  return quickParse(input, context);
}

async function assist(input: string, answer: unknown) {
  completeJson.mockResolvedValueOnce(answer);
  return assistedQuickParse(input, "owner", local(input), context);
}

describe("folding an assisted reading into the local one", () => {
  it("resolves the model's place against the account's own, never by id", () => {
    // The model returns a venue as written. Whether that is a place we have is
    // decided here, not there — it never sees or returns a row id.
    return assist("coffee with Sarah at the cafe", {
      people: ["Sarah"],
      typeSlug: "coffee",
      date: null,
      place: "Northside Cafe",
      title: "Coffee",
      notes: null,
    }).then((result) => {
      expect(result?.place?.location?.id).toBe("l-north");
      expect(result?.place?.via).toBe("known");
    });
  });

  it("keeps a place it cannot match as a proposal rather than inventing one", async () => {
    const result = await assist("coffee with Sarah somewhere", {
      people: ["Sarah"],
      typeSlug: null,
      date: null,
      place: "Somewhere Else",
      title: "Coffee",
      notes: null,
    });

    expect(result?.place?.location).toBeNull();
    expect(result?.place?.matchedText).toBe("Somewhere Else");
  });

  it("still refuses to choose between two people who share a name", async () => {
    const result = await assist("coffee with John", {
      people: ["John"],
      typeSlug: "coffee",
      date: null,
      place: null,
      title: "Coffee",
      notes: null,
    });

    // An assisted parse must not be able to do what the local parse refuses to.
    expect(result?.contacts).toEqual([]);
    expect(result?.ambiguous).toHaveLength(1);
    expect(result?.ambiguous[0].candidates.map((c) => c.id).sort()).toEqual([
      "cousin",
      "uncle",
    ]);
  });

  it("ignores a person the model invented", async () => {
    const result = await assist("coffee with Sarah", {
      people: ["Sarah", "Mallory"],
      typeSlug: null,
      date: null,
      place: null,
      title: "Coffee",
      notes: null,
    });

    expect(result?.contacts.map((m) => m.contact.id)).toEqual(["sarah"]);
    // Offered as someone to create, which needs a tick — never silently matched.
    expect(result?.contacts.some((m) => m.contact.id === "Mallory")).toBe(false);
  });

  it("rejects a type slug that is not in the user's taxonomy", async () => {
    const result = await assist("coffee with Sarah", {
      people: ["Sarah"],
      typeSlug: "not-a-real-slug",
      date: null,
      place: null,
      title: "Coffee",
      notes: null,
    });

    expect(result?.type?.id).toBe("t-coffee");
  });

  it("rejects a date that is not a real calendar day", async () => {
    const result = await assist("coffee with Sarah yesterday", {
      people: ["Sarah"],
      typeSlug: null,
      date: "2026-02-30",
      place: null,
      title: "Coffee",
      notes: null,
    });

    // Falls back to the local reading rather than storing a rolled-over date.
    expect(result?.date).toEqual({ year: 2026, month: 3, day: 10 });
  });

  it("keeps the local reading when the answer carries none of the fields", async () => {
    // Every field on the schema has a default, so an object with nothing
    // recognisable in it parses rather than failing — and each defaulted value
    // then falls back to the local reading. The outcome is the same as a
    // refusal; it just arrives by degrading instead of bailing out.
    const result = await assist("coffee with Sarah", { unexpected: true });

    expect(result?.contacts.map((m) => m.contact.id)).toEqual(["sarah"]);
    expect(result?.type?.id).toBe("t-coffee");
    expect(result?.title).toBe(local("coffee with Sarah").title);
  });

  it("keeps the local reading when the answer is not an object at all", async () => {
    expect(await assist("coffee with Sarah", ["nope"])).toBeNull();
  });

  it("keeps the local reading when the provider returns nothing", async () => {
    expect(await assist("coffee with Sarah", null)).toBeNull();
  });
});
