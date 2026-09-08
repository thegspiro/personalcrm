import { describe, expect, it } from "vitest";
import {
  findDuplicatePairs,
  normaliseEmail,
  normalisePhone,
  orderedPair,
  pairKey,
  type ContactMethods,
} from "@/lib/duplicates";

function person(contactId: string, ...methods: Array<[boolean, string]>): ContactMethods {
  return { contactId, methods: methods.map(([isEmail, value]) => ({ isEmail, value })) };
}
const email = (value: string): [boolean, string] => [true, value];
const phone = (value: string): [boolean, string] => [false, value];

describe("normalising an email for comparison", () => {
  it("ignores case and surrounding space", () => {
    expect(normaliseEmail("  Sam@Example.COM ")).toBe("sam@example.com");
  });

  it("does not apply one provider's routing rules as if they were address rules", () => {
    // Gmail treats these as the same mailbox. That is Gmail's policy, not a
    // fact about addresses, and applying it here would merge two people whose
    // addresses genuinely differ.
    expect(normaliseEmail("sam.smith@example.com")).not.toBe(normaliseEmail("samsmith@example.com"));
    expect(normaliseEmail("sam+work@example.com")).not.toBe(normaliseEmail("sam@example.com"));
  });

  it("refuses something that is not an address", () => {
    for (const value of ["", "   ", "sam", "sam@", "@example.com", "ask his wife"]) {
      expect(normaliseEmail(value), value).toBeNull();
    }
  });
});

describe("normalising a phone number for comparison", () => {
  it("ignores punctuation and spacing", () => {
    expect(normalisePhone("(555) 010-4477")).toBe("5550104477");
    expect(normalisePhone("555.010.4477")).toBe("5550104477");
  });

  it("does not decide that a shorter number is American", () => {
    // The mirror of why search does not normalise: matching these would mean
    // guessing a country nobody supplied, and guessing it for both of them.
    expect(normalisePhone("+1 555 010 4477")).not.toBe(normalisePhone("555 010 4477"));
  });

  it("refuses an extension, which everybody's number would otherwise match", () => {
    expect(normalisePhone("x210")).toBeNull();
    expect(normalisePhone("214")).toBeNull();
    expect(normalisePhone("555 0104")).toBe("5550104");
  });
});

describe("finding pairs", () => {
  it("pairs two people who share an address", () => {
    const pairs = findDuplicatePairs([
      person("a", email("sam@example.com")),
      person("b", email("SAM@example.com")),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.matches[0]!.kind).toBe("email");
  });

  it("never pairs a contact with itself, however it was filed", () => {
    // The same address entered twice on one record is not a duplicate person.
    expect(
      findDuplicatePairs([person("a", email("sam@example.com"), email("sam@example.com"))]),
    ).toEqual([]);
  });

  it("leaves people with nothing in common alone", () => {
    expect(
      findDuplicatePairs([
        person("a", email("sam@example.com"), phone("555 010 4477")),
        person("b", email("robin@example.com"), phone("555 010 9900")),
      ]),
    ).toEqual([]);
  });

  it("never pairs on a name, however identical", () => {
    // The whole reason the rule is this narrow: two Sarah Joneses are usually
    // two people, and a merge cannot be undone.
    expect(findDuplicatePairs([person("a"), person("b")])).toEqual([])
  });

  it("reports every detail a pair shares, so the screen can say why", () => {
    const pairs = findDuplicatePairs([
      person("a", email("sam@example.com"), phone("555 010 4477")),
      person("b", email("sam@example.com"), phone("(555) 010-4477")),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.matches.map((m) => m.kind).sort()).toEqual(["email", "phone"]);
  });

  it("gives a family on one landline every pair, as separate decisions", () => {
    // Four people, one number: six pairs. Dismissing one says nothing about
    // the others, which is right — they are different judgements.
    const pairs = findDuplicatePairs(
      ["a", "b", "c", "d"].map((id) => person(id, phone("555 010 4477"))),
    );
    expect(pairs).toHaveLength(6);
  });

  it("returns each pair once, whichever way round it was found", () => {
    const pairs = findDuplicatePairs([
      person("z", email("sam@example.com")),
      person("a", email("sam@example.com")),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.aContactId).toBe("a");
    expect(pairs[0]!.bContactId).toBe("z");
  });

  it("ignores values too vague to compare", () => {
    expect(
      findDuplicatePairs([person("a", phone("x210")), person("b", phone("x210"))]),
    ).toEqual([]);
    expect(
      findDuplicatePairs([person("a", email("ask him")), person("b", email("ask him"))]),
    ).toEqual([]);
  });
});

describe("pair ordering", () => {
  it("is the same whichever way round it is asked", () => {
    expect(orderedPair("b", "a")).toEqual(orderedPair("a", "b"));
    expect(pairKey("b", "a")).toBe(pairKey("a", "b"));
  });
});
