import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/db/client", () => ({ prisma: {} }));
vi.mock("@/server/auth/password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/server/auth/session", () => ({ SESSION_COOKIE: "pcrm_session" }));
vi.mock("@/server/user/context", () => ({ getUserContext: vi.fn() }));

const { IDLE_TIMEOUT_MS, isUnlockActive } =
  await import("@/server/privacy/lock");

describe("privacy unlock timeout", () => {
  const now = Date.UTC(2026, 7, 31, 12);

  it("remains open immediately before the idle boundary", () => {
    expect(isUnlockActive(new Date(now - IDLE_TIMEOUT_MS + 1), now)).toBe(true);
  });

  it("is closed exactly at and after the idle boundary", () => {
    expect(isUnlockActive(new Date(now - IDLE_TIMEOUT_MS), now)).toBe(false);
    expect(isUnlockActive(new Date(now - IDLE_TIMEOUT_MS - 1), now)).toBe(
      false,
    );
  });

  it("does not accept a future activity timestamp", () => {
    expect(isUnlockActive(new Date(now + 1), now)).toBe(false);
  });
});
