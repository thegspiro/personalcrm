import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({
  ownerId: "",
  secured: false,
  securingFails: false,
  cookieRotated: false,
  // Fires once immediately before the next write, then clears itself. The
  // window a racing password change lands in is between confirming the old
  // password and writing the new one, and no dependency of the action is
  // consulted inside it.
  beforeWrite: null as null | (() => Promise<void>),
}));
const WRITES = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
vi.mock("@/server/db/client", async () => ({
  prisma: (await import("./db")).prisma.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        const interleaved = state.beforeWrite;
        if (interleaved && WRITES.includes(operation)) {
          state.beforeWrite = null;
          await interleaved();
        }
        return query(args);
      },
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
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
  // Returns the callback that writes the re-keyed cookie, exactly as the real
  // one does. The action must invoke it after the transaction commits, not
  // inside: a rollback that had already rewritten the cookie would sign this
  // browser out of an account whose password did not change.
  secureSessionsAfterPasswordChange: async () => {
    if (state.securingFails) throw new Error("deadlock");
    state.secured = true;
    return async () => {
      state.cookieRotated = true;
    };
  },
}));

const { changePassword, updateDisplayName, updateEmail } =
  await import("@/server/actions/account");
// In-process counters, so they outlive a test unless cleared.
const { resetLoginAttempts } = await import("@/server/auth/login-throttle");
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
    state.securingFails = false;
    state.cookieRotated = false;
    state.beforeWrite = null;
    resetLoginAttempts();
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
    // The surviving session is re-keyed, so the cookie has to be rewritten —
    // and only once the transaction carrying the new token has committed.
    expect(state.cookieRotated).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: state.ownerId },
    });
    expect(await verifyPassword("NewPassword2!", user.passwordHash)).toBe(true);
  });
  it("says which field is wrong instead of highlighting nothing", async () => {
    // Both schemas are bare strings, so their issues carry an empty path and
    // `invalid()` drops those — the form said to check the highlighted fields
    // and highlighted none, with no word about the length or the syntax.
    const long = await updateEmail(
      form({ email: `${"a".repeat(190)}@example.com`, currentPassword: "OldPassword1!" }),
    );
    expect(long.ok).toBe(false);
    expect(long.fieldErrors?.email).toMatch(/191/);

    const malformed = await updateEmail(
      form({ email: "not-an-email", currentPassword: "OldPassword1!" }),
    );
    expect(malformed.ok).toBe(false);
    expect(malformed.fieldErrors?.email).toBeTruthy();

    const blank = await updateDisplayName(form({ name: "   " }));
    expect(blank.ok).toBe(false);
    expect(blank.fieldErrors?.name).toBeTruthy();
  });

  it("throttles guesses at the current password, as signing in is throttled", async () => {
    // Reauthentication stands between a stolen session and the two changes
    // that make the theft permanent. Ungated it took unlimited guesses, each
    // costing a bcrypt comparison, so it was also a way to spend the machine.
    const wrong = form({
      currentPassword: "WrongPassword1!",
      newPassword: "NewPassword2!",
      confirmPassword: "NewPassword2!",
    });
    let throttled: string | undefined;
    for (let attempt = 0; attempt < 12 && !throttled; attempt += 1) {
      const result = await changePassword(wrong);
      expect(result.ok).toBe(false);
      const message = result.fieldErrors?.currentPassword;
      if (message && /again|attempts/i.test(message)) throttled = message;
    }
    expect(throttled).toBeTruthy();

    // The real password is refused too while the backoff stands, so the gate
    // is not merely cosmetic.
    expect(
      (await changePassword(form({
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword2!",
        confirmPassword: "NewPassword2!",
      }))).fieldErrors?.currentPassword,
    ).toMatch(/again|attempts/i);
  });

  it("does not leave the password changed when securing the sessions fails", async () => {
    // Two commits meant a deadlock or a dropped connection in the second one
    // left the new password in place with every other session still signed
    // in — while the action reported failure, and the old password no longer
    // worked to try again. One transaction, so the failure takes both back.
    state.securingFails = true;
    await expect(
      changePassword(
        form({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword2!",
          confirmPassword: "NewPassword2!",
        }),
      ),
    ).rejects.toThrow(/deadlock/);
    // Nothing was committed, so nothing may have been written to the browser.
    expect(state.cookieRotated).toBe(false);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: state.ownerId },
    });
    expect(await verifyPassword("OldPassword1!", user.passwordHash)).toBe(true);
    expect(await verifyPassword("NewPassword2!", user.passwordHash)).toBe(false);

    // And the owner can still change it once the database is well again.
    state.securingFails = false;
    expect(
      (await changePassword(
        form({
          currentPassword: "OldPassword1!",
          newPassword: "NewPassword2!",
          confirmPassword: "NewPassword2!",
        }),
      )).ok,
    ).toBe(true);
    expect(state.secured).toBe(true);
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

  it("will not move the sign-in address on a credential that has been replaced", async () => {
    // A password change is how an account is taken back, and it ends the other
    // sessions. An email change already in flight on one of those — the copied
    // cookie the whole policy is about — had confirmed the old password a
    // moment earlier, and wrote regardless: the address the account signs in
    // with could still be moved after the credential authorising it was gone.
    const winner = await hashPassword("SomebodyElse3!");
    state.beforeWrite = async () => {
      await prisma.user.update({
        where: { id: state.ownerId },
        data: { passwordHash: winner },
      });
    };

    const before = await prisma.user.findUniqueOrThrow({
      where: { id: state.ownerId },
    });
    const result = await updateEmail(
      form({ email: "moved@example.com", currentPassword: "OldPassword1!" }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.currentPassword).toBe(
      "Current password is incorrect.",
    );
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: state.ownerId } }))
        .email,
    ).toBe(before.email);
  });

  it("changes nothing when the password moved after the confirmation", async () => {
    // Two changes racing both confirm the old password before either
    // transaction opens, and the window is a whole bcrypt comparison wide.
    // Written unconditionally, the second overwrote the first — and its
    // session sweep saw the first request's freshly re-keyed row as *another*
    // session and deleted it, while its own stale cookie matched nothing left
    // to re-key. Two tabs, and the owner is signed out of an account both
    // requests reported as updated.
    const winner = await hashPassword("SomebodyElse3!");
    state.beforeWrite = async () => {
      await prisma.user.update({
        where: { id: state.ownerId },
        data: { passwordHash: winner },
      });
    };

    const result = await changePassword(
      form({
        currentPassword: "OldPassword1!",
        newPassword: "NewPassword2!",
        confirmPassword: "NewPassword2!",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.fieldErrors?.currentPassword).toBe(
      "Current password is incorrect.",
    );
    // The winner's password stands, and the loser wrote nothing — neither the
    // password nor the sessions, which is what kept the winner signed in.
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: state.ownerId },
    });
    expect(user.passwordHash).toBe(winner);
    expect(state.secured).toBe(false);
    expect(state.cookieRotated).toBe(false);
  });
});
