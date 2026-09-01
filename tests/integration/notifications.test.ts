import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * Configuring where reminders go.
 *
 * The delivery engine was complete for a long time with nothing able to create
 * a channel, so the hourly job always found none and sent nothing. These cover
 * the half that was missing, and in particular the two things that would be
 * silent if wrong: that a credential never reaches the browser, and that one
 * which cannot be decrypted stops delivery instead of sending the request
 * without it.
 */

const state = vi.hoisted(() => ({ ownerId: "" }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId },
    prefs: {},
    timezone: "America/New_York",
  }),
}));

const {
  createChannel,
  deleteChannel,
  setChannelEnabled,
  updateChannel,
} = await import("@/server/actions/notifications");
const { listChannelsForSettings } = await import("@/server/queries/notifications");
const { resolveChannelSecrets } = await import("@/server/notifications/config");
const { deliverToChannel } = await import("@/server/services/notify");

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

const EMAIL = {
  kind: "EMAIL",
  name: "Mail",
  host: "smtp.example.com",
  from: "crm@example.com",
  to: "me@example.com",
};

describe.skipIf(!hasTestDatabase)("notification channels", () => {
  let ownerId: string;
  let strangerId: string;

  beforeEach(async () => {
    await reset();
    const [owner, stranger] = await Promise.all([createTestUser(), createTestUser()]);
    ownerId = owner.id;
    strangerId = stranger.id;
    state.ownerId = ownerId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a password encrypted, and never in the clear", async () => {
    const created = await createChannel(form({ ...EMAIL, pass: "hunter2-but-longer" }));
    expect(created.ok).toBe(true);

    const row = await prisma.notificationChannel.findFirstOrThrow();
    const config = row.config as Record<string, unknown>;

    expect(config.pass).toBeUndefined();
    expect(typeof config.passEnc).toBe("string");
    expect(JSON.stringify(config)).not.toContain("hunter2");
    // Non-secret values stay readable, and the port is a number.
    expect(config.host).toBe("smtp.example.com");
    expect(config.port).toBe(587);
  });

  it("never sends a credential back to the browser", async () => {
    await createChannel(form({ ...EMAIL, pass: "hunter2-but-longer" }));
    const [channel] = await listChannelsForSettings(ownerId);

    expect(JSON.stringify(channel)).not.toContain("hunter2");
    // Not even a hint: the last four characters of an SMTP password are worth
    // nothing to its owner and something to anyone reading over their shoulder.
    expect(JSON.stringify(channel)).not.toContain("passEnc");
    expect(channel.secretsSet.pass).toBe(true);
    expect(channel.config.host).toBe("smtp.example.com");
  });

  it("keeps the stored password when the field is left blank", async () => {
    const created = await createChannel(form({ ...EMAIL, pass: "original-password" }));
    const id = (created as { data: { id: string } }).data.id;
    const before = (await prisma.notificationChannel.findFirstOrThrow({ where: { id } }))
      .config as Record<string, unknown>;

    await updateChannel(form({ id, ...EMAIL, name: "Renamed" }));

    const after = (await prisma.notificationChannel.findFirstOrThrow({ where: { id } }))
      .config as Record<string, unknown>;
    expect(after.passEnc).toBe(before.passEnc);
    expect(
      resolveChannelSecrets({ kind: "EMAIL", config: after }),
    ).toMatchObject({ ok: true, config: { pass: "original-password" } });
  });

  it("replaces the password when a new one is typed, and clears it on request", async () => {
    const created = await createChannel(form({ ...EMAIL, pass: "original-password" }));
    const id = (created as { data: { id: string } }).data.id;

    await updateChannel(form({ id, ...EMAIL, pass: "a-different-password" }));
    let config = (await prisma.notificationChannel.findFirstOrThrow({ where: { id } }))
      .config as Record<string, unknown>;
    expect(resolveChannelSecrets({ kind: "EMAIL", config })).toMatchObject({
      ok: true,
      config: { pass: "a-different-password" },
    });

    await updateChannel(form({ id, ...EMAIL, pass__clear: "true" }));
    config = (await prisma.notificationChannel.findFirstOrThrow({ where: { id } }))
      .config as Record<string, unknown>;
    expect(config.passEnc).toBeUndefined();
  });

  it("refuses to send when a stored secret cannot be decrypted", async () => {
    const created = await createChannel(form({ ...EMAIL, pass: "original-password" }));
    const id = (created as { data: { id: string } }).data.id;

    // What a rotated AUTH_SECRET looks like from here.
    await prisma.notificationChannel.update({
      where: { id },
      data: { config: { ...EMAIL, kind: undefined, name: undefined, passEnc: "v1.bm90LXJlYWxseS1jaXBoZXJ0ZXh0" } },
    });
    const channel = await prisma.notificationChannel.findFirstOrThrow({ where: { id } });

    expect(resolveChannelSecrets(channel as never)).toMatchObject({
      ok: false,
      reason: "unreadable-secret",
    });

    // The important half: it throws rather than falling back to an
    // unauthenticated send. Nodemailer would otherwise be handed auth:
    // undefined and try anyway, and a webhook POST would go out with its
    // Authorization header quietly missing.
    await expect(deliverToChannel(channel, "subject", "body")).rejects.toThrow(/AUTH_SECRET/);

    const [redacted] = await listChannelsForSettings(ownerId);
    expect(redacted.unreadableSecret).toBe(true);
  });

  it("still reads a plaintext secret written before there was a UI", async () => {
    // Rows hand-inserted through db:studio, which is how this was configurable
    // at all until now. They keep working, and the next save rewrites them.
    const channel = await prisma.notificationChannel.create({
      data: {
        ownerId,
        kind: "WEBHOOK",
        name: "Legacy",
        config: { url: "https://example.com/hook", token: "legacy-token" },
      },
    });

    expect(resolveChannelSecrets(channel as never)).toMatchObject({
      ok: true,
      config: { token: "legacy-token" },
    });

    await updateChannel(form({ id: channel.id, url: "https://example.com/hook" }));
    const after = (await prisma.notificationChannel.findFirstOrThrow({ where: { id: channel.id } }))
      .config as Record<string, unknown>;
    expect(after.token).toBeUndefined();
    expect(typeof after.tokenEnc).toBe("string");
    expect(resolveChannelSecrets({ kind: "WEBHOOK", config: after })).toMatchObject({
      ok: true,
      config: { token: "legacy-token" },
    });
  });

  it("refuses an invalid configuration rather than saving one the sender will reject", async () => {
    const missing = await createChannel(form({ kind: "EMAIL", name: "Broken" }));
    expect(missing.ok).toBe(false);
    expect(missing.fieldErrors).toMatchObject({ host: expect.any(String) });
    expect(await prisma.notificationChannel.count()).toBe(0);

    const badUrl = await createChannel(form({ kind: "NTFY", name: "Bad", url: "file:///etc/passwd" }));
    expect(badUrl.ok).toBe(false);
    expect(await prisma.notificationChannel.count()).toBe(0);
  });

  it("scopes every action by owner", async () => {
    const theirs = await prisma.notificationChannel.create({
      data: {
        ownerId: strangerId,
        kind: "WEBHOOK",
        name: "Theirs",
        config: { url: "https://example.com/theirs" },
      },
    });

    expect((await updateChannel(form({ id: theirs.id, url: "https://evil.example" }))).ok).toBe(false);
    expect((await setChannelEnabled(theirs.id, false)).ok).toBe(false);
    expect((await deleteChannel(theirs.id)).ok).toBe(false);

    const untouched = await prisma.notificationChannel.findFirstOrThrow({ where: { id: theirs.id } });
    expect((untouched.config as Record<string, unknown>).url).toBe("https://example.com/theirs");
    expect(untouched.isEnabled).toBe(true);

    expect(await listChannelsForSettings(ownerId)).toHaveLength(0);
  });

  it("keeps the ledger when a channel is deleted, so nothing re-sends", async () => {
    const created = await createChannel(form({ kind: "NTFY", name: "Phone", url: "https://ntfy.example.com/t" }));
    const id = (created as { data: { id: string } }).data.id;
    const contact = await prisma.contact.create({ data: { ownerId, firstName: "Dana" } });
    const date = await prisma.importantDate.create({
      data: { ownerId, contactId: contact.id, label: "Anniversary", date: new Date("2026-09-14") },
    });
    await prisma.reminderLog.create({
      data: {
        ownerId,
        entityType: "IMPORTANT_DATE",
        entityId: date.id,
        scheduledFor: new Date("2026-09-14"),
        offsetDays: 0,
        channelId: id,
        ok: true,
        sentAt: new Date(),
      },
    });

    expect((await deleteChannel(id)).ok).toBe(true);

    const log = await prisma.reminderLog.findFirstOrThrow();
    expect(log.channelId).toBeNull();
    expect(log.ok).toBe(true);
  });
});
