import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ ownerId: "", secured: false }));
vi.mock("@/server/db/client", async () => ({
  prisma: (await import("./db")).prisma,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "UTC",
  }),
}));
vi.mock("@/server/auth/session", () => ({
  revokeAllOtherSessions: vi.fn(),
  revokeOtherSession: vi.fn(),
  secureSessionsAfterPasswordChange: async () => {
    state.secured = true;
  },
}));

const { changePassword, updateDisplayName, updateEmail } =
  await import("@/server/actions/account");
const form = (values: Record<string, string>) => {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, value));
  return data;
};

describe.skipIf(!hasTestDatabase)("account actions", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.ownerId = user.id;
    state.secured = false;
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword("OldPassword1!") },
    });
  });
  afterAll(() => prisma.$disconnect());

  it("updates only the authenticated owner's display name", async () => {
    const other = await createTestUser();
    await updateDisplayName(form({ name: "New Name" }));
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: state.ownerId } }))
        .name,
    ).toBe("New Name");
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).name,
    ).toBe("Test User");
  });

  it("rejects an incorrect current password for email and password changes", async () => {
    expect(
      (
        await updateEmail(
          form({ email: "new@example.com", currentPassword: "wrong" }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await changePassword(
          form({
            currentPassword: "wrong",
            newPassword: "NewPassword2!",
            confirmPassword: "NewPassword2!",
          }),
        )
      ).ok,
    ).toBe(false);
  });

  it("normalizes email and rejects another account's address", async () => {
    const other = await createTestUser();
    const collision = await updateEmail(
      form({
        email: `  ${other.email.toUpperCase()} `,
        currentPassword: "OldPassword1!",
      }),
    );
    expect(collision.fieldErrors?.email).toMatch(/already exists/);
    const changed = await updateEmail(
      form({ email: "  NEW@Example.COM ", currentPassword: "OldPassword1!" }),
    );
    expect(changed.ok).toBe(true);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: state.ownerId } }))
        .email,
    ).toBe("new@example.com");
  });

  it("uses the shared password rules and applies the session security policy", async () => {
    const result = await changePassword(
      form({
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword2!",
        confirmPassword: "NewPassword2!",
      }),
    );
    expect(result.ok).toBe(true);
    expect(state.secured).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: state.ownerId },
    });
    expect(await verifyPassword("NewPassword2!", user.passwordHash)).toBe(true);
  });
  it("keeps the whitespace a password was chosen with, as signing in does", async () => {
    // Sign-in reads the field raw. Trimming it here meant an account whose
    // password has a leading or trailing space could sign in and then fail to
    // confirm that same password, and a new one would be stored without the
    // spaces its owner supplied.
    const padded = "  Spaced Password1!  ";
    await prisma.user.update({
      where: { id: state.ownerId },
      data: { passwordHash: await hashPassword(padded) },
    });
    expect((await updateEmail(form({ email: "moved@example.com", currentPassword: padded }))).ok).toBe(true);

    expect(
      (await changePassword(form({
        currentPassword: padded,
        newPassword: "  Another Password2!  ",
        confirmPassword: "  Another Password2!  ",
      }))).ok,
    ).toBe(true);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: state.ownerId } });
    expect(await verifyPassword("  Another Password2!  ", stored.passwordHash)).toBe(true);
    expect(await verifyPassword("Another Password2!", stored.passwordHash)).toBe(false);
  });

  it("refuses an email longer than the column rather than throwing at the update", async () => {
    const long = `${"a".repeat(180)}@example.com`;
    expect(long.length).toBeGreaterThan(191);
    const result = await updateEmail(form({ email: long, currentPassword: "OldPassword1!" }));
    expect(result.ok).toBe(false);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: state.ownerId } })).email,
    ).not.toBe(long);
  });
});
