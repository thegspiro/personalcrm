import { describe, expect, it } from "vitest";
import {
  associatePrivacyWhere,
  householdPrivacyWhere,
  interactionPrivacyWhere,
  lifeEventPrivacyWhere,
  viaOptionalContactPrivacyWhere,
  type PrivacyScope,
} from "@/server/privacy/where";

const LOCKED: PrivacyScope = { enabled: true, unlocked: false };
const UNLOCKED: PrivacyScope = { enabled: true, unlocked: true };
const OFF: PrivacyScope = { enabled: false, unlocked: true };

describe("associate privacy where-fragment", () => {
  it("withholds an entry marked private while locked", () => {
    expect(associatePrivacyWhere(LOCKED)).toEqual({ isPrivate: false });
  });

  it("does not filter entries while unlocked or when the lock is off", () => {
    // The empty object matters: spread into a where-clause it must widen
    // nothing, and dropped into an OR it would match nothing instead.
    expect(associatePrivacyWhere(UNLOCKED)).toEqual({});
    expect(associatePrivacyWhere(OFF)).toEqual({});
  });

  it("says nothing about the contact it hangs off", () => {
    // Deliberately only half the answer. The entry's own marker and the
    // person's are separate questions, and every caller spreads
    // viaContactPrivacyWhere beside this one; folding them together here
    // would be wrong inside `Contact.associates.some(...)`, where the
    // contact half is already applied to the outer query.
    expect(associatePrivacyWhere(LOCKED)).not.toHaveProperty("contact");
  });
});

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

describe("life event privacy where-fragment", () => {
  it("withholds an event whose anchor or any participant is private", () => {
    // The anchor alone is not enough. "Mum's wedding" is filed against Mum, who
    // is public; the person she married is the one behind the lock.
    expect(lifeEventPrivacyWhere(LOCKED)).toEqual({
      contact: { isPrivate: false },
      participants: { none: { contact: { isPrivate: true } } },
    });
  });

  it("does not filter life events while unlocked or when the lock is off", () => {
    expect(lifeEventPrivacyWhere(UNLOCKED)).toEqual({});
    expect(lifeEventPrivacyWhere(OFF)).toEqual({});
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
