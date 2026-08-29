import { describe, expect, it } from "vitest";
import { householdPrivacyWhere, type PrivacyScope } from "@/server/privacy/where";

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
