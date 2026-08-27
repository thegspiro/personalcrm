import { describe, expect, it } from "vitest";
import {
  needsDisambiguation,
  quickParse,
  touchesPrivateContact,
  type ParseContact,
  type ParseType,
} from "@/lib/quick-parse";

/**
 * The local quick-add parser.
 *
 * Everything here runs on the user's own machine with no key and no network,
 * so these tests are the real coverage for the feature — the optional Claude
 * layer only ever produces a better reading of the same shape.
 */

/** A Wednesday, mid-morning in New York. */
const NOW = new Date("2026-03-11T14:30:00Z");
const TZ = "America/New_York";

const contact = (
  id: string,
  firstName: string,
  lastName: string | null = null,
  extra: Partial<ParseContact> = {},
): ParseContact => ({ id, firstName, lastName, ...extra });

const CONTACTS: ParseContact[] = [
  contact("sarah", "Sarah", "Whitfield"),
  contact("marcus", "Marcus", "Bell", { nickname: "Mars" }),
  contact("priya", "Priya", "Raman"),
];

const TYPES: ParseType[] = [
  { id: "t-coffee", slug: "coffee", label: "Coffee" },
  { id: "t-call", slug: "call", label: "Call" },
  { id: "t-video", slug: "video-call", label: "Video call" },
  { id: "t-meal", slug: "meal", label: "Meal" },
];

function parse(input: string, contacts: ParseContact[] = CONTACTS) {
  return quickParse(input, { contacts, types: TYPES, now: NOW, timeZone: TZ });
}

describe("people", () => {
  it("matches someone by first name", () => {
    const result = parse("coffee with Sarah");
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["sarah"]);
    expect(result.ambiguous).toEqual([]);
  });

  it("matches a full name in preference to a first name", () => {
    const result = parse("coffee with Sarah Whitfield");
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["sarah"]);
    expect(result.unknownNames).toEqual([]);
  });

  it("matches a nickname", () => {
    const result = parse("call with Mars");
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["marcus"]);
  });

  it("matches several people at once", () => {
    const result = parse("meal with Sarah and Priya");
    expect(result.contacts.map((m) => m.contact.id).sort()).toEqual(["priya", "sarah"]);
  });

  it("does not match a name embedded in another word", () => {
    // "Sarahs" is not Sarah, and "Marcusson" is not Marcus.
    const result = parse("read about Marcusson today");
    expect(result.contacts).toEqual([]);
  });

  it("offers an unrecognised name as someone new", () => {
    const result = parse("lunch with Nadia");
    expect(result.contacts).toEqual([]);
    expect(result.unknownNames).toEqual(["Nadia"]);
  });

  it("does not mistake ordinary words for names", () => {
    const result = parse("coffee with Sarah and we talked about the move");
    expect(result.unknownNames).toEqual([]);
  });
});

describe("people who share a name", () => {
  /** An uncle and a cousin, both John. */
  const JOHNS: ParseContact[] = [
    contact("uncle", "John", "Whitfield"),
    contact("cousin", "John", "Bell"),
    contact("sarah", "Sarah", "Whitfield"),
  ];

  it("refuses to choose between two people with the same first name", () => {
    const result = parse("coffee with John", JOHNS);

    // The wrong John would be filed silently and be nearly impossible to
    // notice later, so nothing is matched until you say which.
    expect(result.contacts).toEqual([]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].matchedText).toBe("John");
    expect(result.ambiguous[0].candidates.map((c) => c.id).sort()).toEqual(["cousin", "uncle"]);
    expect(needsDisambiguation(result)).toBe(true);
  });

  it("does not treat an ambiguous name as an unknown person", () => {
    // Offering to create a third John would be the worst of both worlds.
    const result = parse("coffee with John", JOHNS);
    expect(result.unknownNames).toEqual([]);
  });

  it("resolves when the surname is given", () => {
    const result = parse("coffee with John Bell", JOHNS);
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["cousin"]);
    expect(result.ambiguous).toEqual([]);
    expect(needsDisambiguation(result)).toBe(false);
  });

  it("resolves a bare name by elimination once the other is pinned", () => {
    const result = parse("dinner with John Whitfield and John", JOHNS);

    // Only two people answer to John and one has been named in full, so the
    // bare one is the other by elimination — a deduction, not a guess.
    expect(result.contacts.map((m) => m.contact.id).sort()).toEqual(["cousin", "uncle"]);
    expect(result.ambiguous).toEqual([]);
  });

  it("stays ambiguous when elimination still leaves a choice", () => {
    const three = [...JOHNS, contact("friend", "John", "Okoye")];
    const result = parse("dinner with John Whitfield and John", three);

    expect(result.contacts.map((m) => m.contact.id)).toEqual(["uncle"]);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates.map((c) => c.id).sort()).toEqual([
      "cousin",
      "friend",
    ]);
  });

  it("never offers to create a person whose name it already knows", () => {
    // Two unresolved Johns: the leftover must not come back as a stranger and
    // offer to add a third John to the address book.
    const result = parse("dinner with John and John", JOHNS);
    expect(result.unknownNames).toEqual([]);
    expect(result.ambiguous.length).toBeGreaterThan(0);
  });

  it("still matches an unambiguous name alongside an ambiguous one", () => {
    const result = parse("coffee with John and Sarah", JOHNS);
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["sarah"]);
    expect(result.ambiguous).toHaveLength(1);
  });
});

describe("dates", () => {
  it("reads yesterday", () => {
    const result = parse("coffee with Sarah yesterday");
    expect(result.date).toEqual({ year: 2026, month: 3, day: 10 });
    expect(result.dateText).toBe("yesterday");
  });

  it("reads a bare weekday as the one just gone", () => {
    // Backfilling is about the past — a bare "Monday" is not next Monday.
    const result = parse("call with Priya Monday");
    expect(result.date).toEqual({ year: 2026, month: 3, day: 9 });
  });

  it("prefers the longer date phrase", () => {
    // "last Tuesday" from a Wednesday reads as the Tuesday just gone. What
    // matters here is that the whole phrase is consumed rather than a bare
    // "Tuesday" being matched and "last" left in the title.
    const result = parse("coffee with Sarah last Tuesday");
    expect(result.dateText).toBe("last Tuesday");
    expect(result.date).toEqual({ year: 2026, month: 3, day: 10 });
    expect(result.title).not.toContain("last");
  });

  it("reads a relative span", () => {
    const result = parse("meal with Marcus 3 weeks ago");
    expect(result.date).toEqual({ year: 2026, month: 2, day: 18 });
  });

  it("does not let the date parser swallow a person's name", () => {
    // April, May and June are all names as well as months. Reading the month
    // would lose the person entirely and file the interaction against nobody.
    const seasonal = [contact("april", "April", "Nkemdirim")];
    const result = parse("coffee with April", seasonal);

    expect(result.contacts.map((m) => m.contact.id)).toEqual(["april"]);
    expect(result.date).toBeNull();
  });

  it("still reads a real date alongside a date-like name", () => {
    const seasonal = [contact("april", "April", "Nkemdirim")];
    const result = parse("coffee with April yesterday", seasonal);

    expect(result.contacts.map((m) => m.contact.id)).toEqual(["april"]);
    expect(result.date).toEqual({ year: 2026, month: 3, day: 10 });
  });

  it("leaves the date unset when the line has none", () => {
    const result = parse("coffee with Sarah");
    expect(result.date).toBeNull();
    expect(result.dateText).toBeNull();
  });

  it("resolves the date in the account's timezone, not the server's", () => {
    // 00:30 UTC on the 12th is still the 11th in New York. Reading this in the
    // wrong zone files the interaction a day out.
    const lateNight = new Date("2026-03-12T00:30:00Z");
    const result = quickParse("coffee with Sarah today", {
      contacts: CONTACTS,
      types: TYPES,
      now: lateNight,
      timeZone: TZ,
    });
    expect(result.date).toEqual({ year: 2026, month: 3, day: 11 });
  });

  it("survives a spring-forward boundary", () => {
    // US DST began on 2026-03-08. "3 days ago" from the 11th crosses it, and
    // naive millisecond arithmetic lands an hour — and sometimes a day — out.
    const result = parse("coffee with Sarah 3 days ago");
    expect(result.date).toEqual({ year: 2026, month: 3, day: 8 });
  });
});

describe("interaction types", () => {
  it("matches a type by label", () => {
    expect(parse("coffee with Sarah").type?.id).toBe("t-coffee");
  });

  it("prefers the longer type name", () => {
    // "video call" must not be read as "call".
    expect(parse("video call with Priya").type?.id).toBe("t-video");
  });

  it("matches a slug written with a space", () => {
    expect(parse("Video Call with Priya").type?.id).toBe("t-video");
  });

  it("matches a type the user renamed or invented", () => {
    const custom: ParseType[] = [{ id: "t-quiz", slug: "pub-quiz", label: "Pub quiz" }];
    const result = quickParse("pub quiz with Sarah", {
      contacts: CONTACTS,
      types: custom,
      now: NOW,
      timeZone: TZ,
    });
    expect(result.type?.id).toBe("t-quiz");
  });

  it("leaves the type unset when nothing matches", () => {
    expect(parse("wandered around with Sarah").type).toBeNull();
  });
});

describe("title and notes", () => {
  it("keeps commentary after a comma as notes", () => {
    const result = parse("coffee with Sarah yesterday, she got the promotion");
    expect(result.notes).toBe("she got the promotion");
    expect(result.title).not.toContain("promotion");
  });

  it("falls back to a readable title when the line is only a type and a person", () => {
    const result = parse("coffee with Sarah");
    expect(result.title).toBe("Coffee with Sarah");
  });

  it("keeps a real title when one was written", () => {
    const result = parse("coffee with Sarah about the house move");
    expect(result.title.toLowerCase()).toContain("house move");
  });

  it("does not leave dangling joining words in the title", () => {
    const result = parse("coffee with Sarah");
    expect(result.title).not.toMatch(/\bwith\s*$/);
  });
});

/**
 * A possessive name is grammar, not just a participant.
 *
 * Cutting it out the way a plain "with Sarah" is cut leaves "First time at 's
 * place" — a title with a hole in it that nothing downstream can repair, and
 * which the app had no way to correct after the fact.
 */
describe("possessive names", () => {
  it("keeps the person in the title when the name is possessive", () => {
    const result = parse("First time at Sarah's place");
    expect(result.title).toBe("First time at Sarah's place");
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["sarah"]);
  });

  it("keeps a possessive that ends in s without an extra one", () => {
    const withChris = [...CONTACTS, contact("chris", "Chris")];
    const result = parse("dinner at Chris' house", withChris);
    expect(result.title).toBe("dinner at Chris' house");
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["chris"]);
  });

  it("keeps a possessive written with a curly apostrophe", () => {
    const result = parse("lunch at Sarah\u2019s flat");
    expect(result.title).toBe("lunch at Sarah\u2019s flat");
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["sarah"]);
  });

  it("keeps an ambiguous possessive in the title while still asking who", () => {
    const twoJohns = [contact("j1", "John", "Reed"), contact("j2", "John", "Diaz")];
    const result = parse("hangout at John's place", twoJohns);
    expect(result.title).toBe("hangout at John's place");
    expect(needsDisambiguation(result)).toBe(true);
  });

  it("does not offer to create a contact named after the possessive", () => {
    const result = parse("party at Sarah's, met her sister");
    expect(result.unknownNames).not.toContain("Sarah's");
    expect(result.unknownNames).not.toContain("Sarah");
  });

  it("reads a stranger's possessive as the stranger, not as the possessive", () => {
    const result = parse("drinks at Bob's afterwards");
    expect(result.unknownNames).toEqual(["Bob"]);
  });

  it("still drops a plain participant name from the title", () => {
    const result = parse("coffee with Sarah about the house move");
    expect(result.title).not.toContain("Sarah");
    expect(result.title.toLowerCase()).toContain("house move");
  });

  it("does not let a month-named person become a date once kept in the title", () => {
    // The reason names are masked rather than left in place: chrono would read
    // the "April" in "April's place" as the first of April and file the
    // evening under a day nobody typed.
    const withApril = [contact("april", "April")];
    const result = parse("hangout at April's place", withApril);
    expect(result.title).toBe("hangout at April's place");
    expect(result.date).toBeNull();
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["april"]);
  });

  it("handles two possessives on one line", () => {
    const result = parse("started at Sarah's then on to Priya's");
    expect(result.title).toBe("started at Sarah's then on to Priya's");
    expect(result.contacts.map((m) => m.contact.id).sort()).toEqual(["priya", "sarah"]);
  });

  it("keeps a possessive nickname", () => {
    const result = parse("watched the game at Mars' flat");
    expect(result.title).toBe("watched the game at Mars' flat");
    expect(result.contacts.map((m) => m.contact.id)).toEqual(["marcus"]);
  });

  it("leaves no mask characters in the title or notes", () => {
    const result = parse("coffee with Sarah at Priya's yesterday, good chat");
    expect(result.title).not.toMatch(/[\ue000-\ue1ff]/);
    expect(result.notes ?? "").not.toMatch(/[\ue000-\ue1ff]/);
  });
});

describe("privacy", () => {
  it("flags a matched private contact", () => {
    const withPrivate = [contact("secret", "Robin", null, { isPrivate: true })];
    expect(touchesPrivateContact(parse("coffee with Robin", withPrivate))).toBe(true);
  });

  it("flags a private candidate even before you have chosen", () => {
    // Whichever John you pick, the line naming "John" must not be sent.
    const johns = [
      contact("a", "John", "Whitfield"),
      contact("b", "John", "Bell", { isPrivate: true }),
    ];
    const result = parse("coffee with John", johns);
    expect(result.ambiguous).toHaveLength(1);
    expect(touchesPrivateContact(result)).toBe(true);
  });

  it("says nothing is private when nobody is", () => {
    expect(touchesPrivateContact(parse("coffee with Sarah"))).toBe(false);
  });
});

describe("empty input", () => {
  it("returns an empty result rather than throwing", () => {
    const result = parse("   ");
    expect(result.contacts).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.title).toBe("");
    expect(needsDisambiguation(result)).toBe(false);
  });
});
