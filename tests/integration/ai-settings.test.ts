import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

const state = vi.hoisted(() => ({ userId: "", role: "ADMIN" as "ADMIN" | "MEMBER" }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.userId, role: state.role },
    timezone: "America/New_York",
    prefs: {},
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { removeApiKey, updateAiEnabled } = await import("@/server/actions/ai-settings");
const { getAiStatus, setAiConnection, storeApiKey } = await import("@/server/ai/config");

/**
 * The assisted reading's provider belongs to the installation, not to a person.
 *
 * Exactly the shape the address lookup has, and it was missed here for longer:
 * a member who repoints the endpoint collects the lines every *other* account
 * types into quick add, and these actions also hold an API key. `ownerId` has
 * no row to scope by, so the guard is a role check.
 */
describe.skipIf(!hasTestDatabase)("the assisted reading connection", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.userId = user.id;
    state.role = "ADMIN";
  });

  afterAll(() => prisma.$disconnect());

  it("is off until someone turns it on", async () => {
    expect((await getAiStatus()).enabled).toBe(false);
  });

  it("lets an administrator switch it on", async () => {
    await setAiConnection({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    await storeApiKey("sk-test-key-long-enough");

    expect((await updateAiEnabled(true)).ok).toBe(true);
    expect((await getAiStatus()).enabled).toBe(true);
  });

  it("refuses a member, and changes nothing", async () => {
    await setAiConnection({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    await storeApiKey("sk-test-key-long-enough");
    await updateAiEnabled(true);

    state.role = "MEMBER";

    const toggled = await updateAiEnabled(false);
    expect(toggled).toMatchObject({ ok: false, error: "Only an administrator can change this." });
    // The refusal has to be a refusal, not a message over a completed write.
    expect((await getAiStatus()).enabled).toBe(true);

    const removed = await removeApiKey();
    expect(removed.ok).toBe(false);
    expect((await getAiStatus()).hasKey).toBe(true);
  });

  it("lets an administrator remove the stored key", async () => {
    await setAiConnection({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" });
    await storeApiKey("sk-test-key-long-enough");
    expect((await getAiStatus()).hasKey).toBe(true);

    expect((await removeApiKey()).ok).toBe(true);
    expect((await getAiStatus()).hasKey).toBe(false);
  });
});
