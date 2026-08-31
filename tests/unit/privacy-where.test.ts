import { describe, expect, it } from "vitest";
import {
  householdPrivacyWhere,
  interactionPrivacyWhere,
  viaOptionalContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/where";

const LOCKED: PrivacyScope = { enabled: true, unlocked: false };
const UNLOCKED: PrivacyScope = { enabled: true, unlocked: true };
const OFF: PrivacyScope = { enabled: false, unlocked: true };

describe("household privacy where-fragment", () => {
  it("excludes every household with a private member while locked", () => {
    expect(householdPrivacyWhere(LOCKED)).toEqual({
      members: { none: { contact: { isPrivate: true } } },
    });
  });

  it("does not filter households while unlocked or when the lock is off", () => {
    expect(householdPrivacyWhere(UNLOCKED)).toEqual({});
    expect(householdPrivacyWhere(OFF)).toEqual({});
  });
});

describe("interaction privacy where-fragment", () => {
  it("withholds interactions that expose a private attendee or mentioned person", () => {
    expect(interactionPrivacyWhere(LOCKED)).toEqual({
      isPrivate: false,
      participants: { none: { contact: { isPrivate: true } } },
      mentions: { none: { contact: { isPrivate: true } } },
    });
  });
});

describe("optional-contact privacy where-fragment", () => {
  it("keeps unattached rows alongside public ones while locked", () => {
    expect(viaOptionalContactPrivacyWhere(LOCKED)).toEqual({
      OR: [{ contactId: null }, { contact: { isPrivate: false } }],
    });
  });

  // The fragment has to be empty, not an `OR` containing an empty member: an
  // empty member matches nothing, which emptied Follow-ups and Bring this up
  // for every account that had never switched the lock on.
  it("filters nothing at all while unlocked or when the lock is off", () => {
    expect(viaOptionalContactPrivacyWhere(UNLOCKED)).toEqual({});
    expect(viaOptionalContactPrivacyWhere(OFF)).toEqual({});
  });
});
