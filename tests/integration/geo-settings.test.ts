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

const { saveGeoConnection, updateGeoEnabled } = await import("@/server/actions/geo-settings");
const { getGeoStatus } = await import("@/server/geo/config");

/**
 * The address lookup's endpoint belongs to the installation, not to a person.
 *
 * That makes it the one setting in this area with nothing for `ownerId` to bite
 * on: a member who repoints it collects what *every* account looks up next. So
 * the guard is a role check rather than a scope, which is unusual here and
 * worth pinning down.
 */
describe.skipIf(!hasTestDatabase)("the address lookup connection", () => {
  beforeEach(async () => {
    await reset();
    const user = await createTestUser();
    state.userId = user.id;
    state.role = "ADMIN";
  });

  afterAll(() => prisma.$disconnect());

  function formFor(fields: Record<string, string>) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return form;
  }

  it("is off until someone turns it on", async () => {
    // Nothing is sent anywhere in the shipped state.
    const status = await getGeoStatus();
    expect(status.enabled).toBe(false);
  });

  it("lets an administrator point it somewhere and switch it on", async () => {
    expect(
      (await saveGeoConnection(formFor({ provider: "photon", baseUrl: "http://box.local:2322" })))
        .ok,
    ).toBe(true);
    expect((await updateGeoEnabled(true)).ok).toBe(true);

    const status = await getGeoStatus();
    expect(status.provider).toBe("photon");
    expect(status.baseUrl).toBe("http://box.local:2322");
    expect(status.enabled).toBe(true);
  });

  it("refuses a member, who would otherwise redirect everyone's lookups", async () => {
    await saveGeoConnection(formFor({ provider: "photon", baseUrl: "http://box.local:2322" }));

    state.role = "MEMBER";
    const repointed = await saveGeoConnection(
      formFor({ provider: "custom", baseUrl: "http://attacker.example" }),
    );
    const switched = await updateGeoEnabled(false);

    expect(repointed.ok).toBe(false);
    expect(switched.ok).toBe(false);
    // Unchanged: a member's post must not reach the stored setting at all.
    const status = await getGeoStatus();
    expect(status.baseUrl).toBe("http://box.local:2322");
  });

  it("keeps a pinned endpoint pinned whatever is posted", async () => {
    // Nominatim's address is not editable from the app, so a posted one is
    // ignored rather than trusted.
    await saveGeoConnection(
      formFor({ provider: "nominatim", baseUrl: "http://attacker.example" }),
    );
    expect((await getGeoStatus()).baseUrl).toBe("https://nominatim.openstreetmap.org");
  });

  it("refuses an endpoint that is not a web address", async () => {
    const result = await saveGeoConnection(
      formFor({ provider: "custom", baseUrl: "javascript:alert(1)" }),
    );
    expect(result.ok).toBe(false);
  });
});
