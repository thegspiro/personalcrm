import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

const {
  beginEnrolment,
  confirmEnrolment,
  disableTwoFactor,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  requiresTwoFactor,
  verifySecondFactor,
} = await import("@/server/auth/two-factor");
const { totpCode } = await import("@/server/crypto/totp");

/**
 * Two-factor enrolment and verification against real rows.
 *
 * The properties worth guarding are the ones an imitation leaves out: that an
 * unconfirmed enrolment gates nothing, that a code cannot be replayed inside
 * its own window, that a recovery code is spent exactly once, and that the
 * secret is never stored where a database dump would carry it.
 */
describe.skipIf(!hasTestDatabase)("two-factor sign-in", () => {
  let userId: string;

  beforeEach(async () => {
    await reset();
    userId = (await createTestUser()).id;
  });
  afterAll(() => prisma.$disconnect());

  async function enrol(): Promise<{ secret: string; codes: string[] }> {
    const secret = await beginEnrolment(userId);
    if (!secret) throw new Error("enrolment did not start");
    const codes = await confirmEnrolment(userId, totpCode(secret));
    if (!codes) throw new Error("enrolment did not confirm");
    return { secret, codes };
  }

  describe("enrolment", () => {
    it("gates nothing until a code has proved the authenticator", async () => {
      // The property that stops a typo locking somebody out permanently, on an
      // app with no password recovery.
      await beginEnrolment(userId);
      expect(await requiresTwoFactor(userId)).toBe(false);
      expect((await getTwoFactorStatus(userId)).pending).toBe(true);
    });

    it("gates sign-in once confirmed", async () => {
      await enrol();
      expect(await requiresTwoFactor(userId)).toBe(true);
      const status = await getTwoFactorStatus(userId);
      expect(status.enabled).toBe(true);
      expect(status.recoveryCodesLeft).toBe(10);
    });

    it("refuses a wrong code and stays unconfirmed", async () => {
      await beginEnrolment(userId);
      expect(await confirmEnrolment(userId, "000000")).toBeNull();
      expect(await requiresTwoFactor(userId)).toBe(false);
    });

    it("issues a fresh secret if enrolment is restarted", async () => {
      const first = await beginEnrolment(userId);
      const second = await beginEnrolment(userId);
      expect(second).not.toBe(first);
      // The abandoned one must not still work.
      expect(await confirmEnrolment(userId, totpCode(first!))).toBeNull();
    });

    it("refuses to restart once confirmed, so it cannot be silently replaced", async () => {
      await enrol();
      expect(await beginEnrolment(userId)).toBeNull();
    });

    it("never stores the secret in the clear", async () => {
      const { secret } = await enrol();
      const row = await prisma.twoFactor.findUniqueOrThrow({ where: { userId } });
      expect(row.secret).not.toContain(secret);
    });
  });

  describe("verifying at sign-in", () => {
    // Enrolment spends the step of the code that confirmed it, so signing in
    // has to be a step later — which is the replay guard working, not a quirk
    // of the test. Two minutes ahead puts it clear of the drift window too.
    const later = () => new Date(Date.now() + 120_000);

    it("accepts a current code", async () => {
      const { secret } = await enrol();
      const at = later();
      expect(await verifySecondFactor(userId, totpCode(secret, at), at)).toBe("ok");
    });

    it("refuses the code that completed enrolment, which is already spent", async () => {
      const { secret } = await enrol();
      expect(await verifySecondFactor(userId, totpCode(secret))).toBe("rejected");
    });

    it("refuses the same code twice inside its own window", async () => {
      // A code stays valid for its whole step, so one seen over a shoulder
      // would otherwise still work.
      const { secret } = await enrol();
      const at = later();
      const code = totpCode(secret, at);
      expect(await verifySecondFactor(userId, code, at)).toBe("ok");
      expect(await verifySecondFactor(userId, code, at)).toBe("rejected");
    });

    it("refuses a wrong code", async () => {
      await enrol();
      expect(await verifySecondFactor(userId, "000000", later())).toBe("rejected");
    });

    it("says so when the account has no second factor", async () => {
      expect(await verifySecondFactor(userId, "123456")).toBe("not-enrolled");
    });
  });

  describe("recovery codes", () => {
    it("accepts one in place of a code from the app", async () => {
      const { codes } = await enrol();
      expect(await verifySecondFactor(userId, codes[0]!)).toBe("ok");
    });

    it("spends it, so it works exactly once", async () => {
      const { codes } = await enrol();
      expect(await verifySecondFactor(userId, codes[0]!)).toBe("ok");
      expect(await verifySecondFactor(userId, codes[0]!)).toBe("rejected");
      expect((await getTwoFactorStatus(userId)).recoveryCodesLeft).toBe(9);
    });

    it("leaves the others usable", async () => {
      const { codes } = await enrol();
      await verifySecondFactor(userId, codes[0]!);
      expect(await verifySecondFactor(userId, codes[1]!)).toBe("ok");
    });

    it("forgives the case and spacing somebody types off a printout", async () => {
      const { codes } = await enrol();
      const typed = codes[0]!.toLowerCase().replace("-", " ");
      expect(await verifySecondFactor(userId, typed)).toBe("ok");
    });

    it("never stores a code in the clear", async () => {
      const { codes } = await enrol();
      const rows = await prisma.recoveryCode.findMany({ where: { ownerId: userId } });
      for (const row of rows) {
        expect(codes).not.toContain(row.codeHash);
      }
    });

    it("replaces every code when regenerated", async () => {
      const { codes } = await enrol();
      const replacements = await regenerateRecoveryCodes(userId);
      expect(replacements).toHaveLength(10);
      expect(replacements).not.toContain(codes[0]);
      expect(await verifySecondFactor(userId, codes[0]!)).toBe("rejected");
      expect(await verifySecondFactor(userId, replacements![0]!)).toBe("ok");
    });

    it("cannot be regenerated for an account that has not enrolled", async () => {
      expect(await regenerateRecoveryCodes(userId)).toBeNull();
    });
  });

  describe("turning it off", () => {
    it("takes the secret and every recovery code with it", async () => {
      const { codes } = await enrol();
      await disableTwoFactor(userId);

      expect(await requiresTwoFactor(userId)).toBe(false);
      expect(await prisma.twoFactor.count({ where: { userId } })).toBe(0);
      expect(await prisma.recoveryCode.count({ where: { ownerId: userId } })).toBe(0);
      expect(await verifySecondFactor(userId, codes[0]!)).toBe("not-enrolled");
    });

    it("goes with the account when it is deleted", async () => {
      await enrol();
      await prisma.user.delete({ where: { id: userId } });
      expect(await prisma.twoFactor.count()).toBe(0);
      expect(await prisma.recoveryCode.count()).toBe(0);
    });
  });

  describe("owner scoping", () => {
    it("never accepts one account's code for another", async () => {
      const { secret } = await enrol();
      const other = await createTestUser();
      const otherSecret = await beginEnrolment(other.id);
      await confirmEnrolment(other.id, totpCode(otherSecret!));
      const at = new Date(Date.now() + 120_000);
      expect(await verifySecondFactor(other.id, totpCode(secret, at), at)).toBe("rejected");
    });

    it("never accepts one account's recovery code for another", async () => {
      const { codes } = await enrol();
      const other = await createTestUser();
      const otherSecret = await beginEnrolment(other.id);
      await confirmEnrolment(other.id, totpCode(otherSecret!));
      expect(await verifySecondFactor(other.id, codes[0]!)).toBe("rejected");
    });
  });
});
