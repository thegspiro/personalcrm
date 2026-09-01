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

const state = vi.hoisted(() => ({ ownerId: "", role: "ADMIN" as "ADMIN" | "MEMBER" }));

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({
    user: { id: state.ownerId, role: state.role },
    prefs: {},
    timezone: "America/New_York",
  }),
}));

const {
  createChannel,
  deleteChannel,
  sendTestNotification,
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

/** A complete credential. Nodemailer needs both halves or it sends neither. */
const AUTHED = { ...EMAIL, user: "postmaster" };

describe.skipIf(!hasTestDatabase)("notification channels", () => {
  let ownerId: string;
  let strangerId: string;

  beforeEach(async () => {
    await reset();
    const [owner, stranger] = await Promise.all([createTestUser(), createTestUser()]);
    ownerId = owner.id;
    strangerId = stranger.id;
    state.ownerId = ownerId;
    state.role = "ADMIN";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a password encrypted, and never in the clear", async () => {
    const created = await createChannel(form({ ...AUTHED, pass: "hunter2-but-longer" }));
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
    await createChannel(form({ ...AUTHED, pass: "hunter2-but-longer" }));
    const [channel] = await listChannelsForSettings(ownerId);

    expect(JSON.stringify(channel)).not.toContain("hunter2");
    // Not even a hint: the last four characters of an SMTP password are worth
    // nothing to its owner and something to anyone reading over their shoulder.
    expect(JSON.stringify(channel)).not.toContain("passEnc");
    expect(channel.secretsSet.pass).toBe(true);
    expect(channel.config.host).toBe("smtp.example.com");
  });

  it("keeps the stored password when the field is left blank", async () => {
    const created = await createChannel(form({ ...AUTHED, pass: "original-password" }));
    const id = (created as { data: { id: string } }).data.id;
    const before = (await prisma.notificationChannel.findFirstOrThrow({ where: { id } }))
      .config as Record<string, unknown>;

    await updateChannel(form({ id, ...AUTHED, name: "Renamed" }));

    const after = (await prisma.notificationChannel.findFirstOrThrow({ where: { id } }))
      .config as Record<string, unknown>;
    expect(after.passEnc).toBe(before.passEnc);
    expect(
      resolveChannelSecrets({ kind: "EMAIL", config: after }),
    ).toMatchObject({ ok: true, config: { pass: "original-password" } });
  });

  it("replaces the password when a new one is typed, and clears it on request", async () => {
    const created = await createChannel(form({ ...AUTHED, pass: "original-password" }));
    const id = (created as { data: { id: string } }).data.id;

    await updateChannel(form({ id, ...AUTHED, pass: "a-different-password" }));
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
    const created = await createChannel(form({ ...AUTHED, pass: "original-password" }));
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

  it("refuses half an SMTP credential, in either direction", async () => {
    // deliverToChannel hands nodemailer `auth` only when both are strings, so
    // a channel saved with one of them sends unauthenticated and every
    // reminder is rejected by the relay, silently.
    const userOnly = await createChannel(form({ ...EMAIL, user: "postmaster" }));
    expect(userOnly.ok).toBe(false);
    expect(userOnly.fieldErrors).toMatchObject({ pass: expect.any(String) });

    const passOnly = await createChannel(form({ ...EMAIL, pass: "hunter2-but-longer" }));
    expect(passOnly.ok).toBe(false);
    expect(await prisma.notificationChannel.count()).toBe(0);

    // Both, or neither, are configurations.
    expect((await createChannel(form({ ...EMAIL, user: "postmaster", pass: "hunter2-but-longer" }))).ok).toBe(true);
    expect((await createChannel(form({ ...EMAIL, name: "No auth" }))).ok).toBe(true);
  });

  it("keeps an edit that leaves the password blank from breaking the pair", async () => {
    const created = await createChannel(
      form({ ...EMAIL, user: "postmaster", pass: "hunter2-but-longer" }),
    );
    const id = (created as { data: { id: string } }).data.id;

    // Blank means "keep the stored one", so the pair is still complete.
    expect((await updateChannel(form({ id, ...EMAIL, user: "postmaster" }))).ok).toBe(true);

    // Clearing the password while the username stays is not.
    const broken = await updateChannel(
      form({ id, ...EMAIL, user: "postmaster", pass__clear: "true" }),
    );
    expect(broken.ok).toBe(false);
    expect(
      resolveChannelSecrets(await prisma.notificationChannel.findFirstOrThrow({ where: { id } }) as never),
    ).toMatchObject({ ok: true, config: { pass: "hunter2-but-longer" } });
  });

  it("rate-limits the test button per account, not per channel", async () => {
    // Keyed by channel, the guard is reset by making another one.
    const first = await createChannel(form({ kind: "NTFY", name: "One", url: "https://127.0.0.1:1/a" }));
    const second = await createChannel(form({ kind: "NTFY", name: "Two", url: "https://127.0.0.1:1/b" }));
    const firstId = (first as { data: { id: string } }).data.id;
    const secondId = (second as { data: { id: string } }).data.id;

    await sendTestNotification(firstId);
    const immediate = await sendTestNotification(secondId);
    expect(immediate.ok).toBe(false);
    expect(immediate.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps a Discord webhook URL out of the browser, token and all", async () => {
    const created = await createChannel(
      form({
        kind: "DISCORD",
        name: "Chat",
        url: "https://discord.com/api/webhooks/123/super-secret-token",
      }),
    );
    expect(created.ok).toBe(true);

    const row = await prisma.notificationChannel.findFirstOrThrow();
    const config = row.config as Record<string, unknown>;
    // The token is in the path, so the whole URL is the credential.
    expect(config.url).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain("super-secret-token");
    expect(typeof config.urlEnc).toBe("string");

    const [redacted] = await listChannelsForSettings(ownerId);
    expect(JSON.stringify(redacted)).not.toContain("super-secret-token");
    expect(redacted.secretsSet.url).toBe(true);

    // The sender still gets a usable URL back.
    expect(resolveChannelSecrets({ kind: "DISCORD", config })).toMatchObject({
      ok: true,
      config: { url: "https://discord.com/api/webhooks/123/super-secret-token" },
    });
  });

  it("requires a webhook URL on create and keeps it on a blank edit", async () => {
    const missing = await createChannel(form({ kind: "DISCORD", name: "Chat" }));
    expect(missing.ok).toBe(false);
    expect(missing.fieldErrors).toMatchObject({ url: expect.any(String) });

    const created = await createChannel(
      form({ kind: "DISCORD", name: "Chat", url: "https://discord.com/api/webhooks/1/keep-me" }),
    );
    const id = (created as { data: { id: string } }).data.id;

    expect((await updateChannel(form({ id, name: "Renamed" }))).ok).toBe(true);
    const after = (await prisma.notificationChannel.findFirstOrThrow({ where: { id } }))
      .config as Record<string, unknown>;
    expect(resolveChannelSecrets({ kind: "DISCORD", config: after })).toMatchObject({
      ok: true,
      config: { url: "https://discord.com/api/webhooks/1/keep-me" },
    });
  });

  it("authenticates Gotify with its own header, not a bearer token", async () => {
    const channel = await prisma.notificationChannel.create({
      data: {
        ownerId,
        kind: "GOTIFY",
        name: "Gotify",
        config: { url: "https://gotify.example/message", token: "app-token" },
      },
    });

    const calls: Array<Record<string, string>> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push(Object.fromEntries(headers.entries()));
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await deliverToChannel(channel, "subject", "body");
    } finally {
      vi.unstubAllGlobals();
    }

    // Gotify rejects a bearer token, so sharing ntfy's scheme meant the channel
    // was offered and never delivered.
    expect(calls[0]["x-gotify-key"]).toBe("app-token");
    expect(calls[0].authorization).toBeUndefined();
  });

  it("keeps a member from aiming a channel at this network", async () => {
    // Not a block on the address — pointing ntfy at a box on your own network
    // is the documented use. It is a block on *whose* decision that is, since
    // the server makes the request and hands back what came out.
    state.role = "MEMBER";

    const inward = await createChannel(
      form({ kind: "NTFY", name: "Probe", url: "http://127.0.0.1:8080/hook" }),
    );
    expect(inward.ok).toBe(false);
    expect(inward.fieldErrors).toMatchObject({ url: expect.any(String) });
    expect(await prisma.notificationChannel.count()).toBe(0);

    // A public target is still theirs to add.
    expect(
      (await createChannel(form({ kind: "NTFY", name: "Phone", url: "https://ntfy.sh/mine" }))).ok,
    ).toBe(true);

    // And the administrator — the person who runs the box — is unaffected.
    state.role = "ADMIN";
    expect(
      (await createChannel(form({ kind: "NTFY", name: "LAN", url: "http://192.168.1.10/topic" }))).ok,
    ).toBe(true);
  });

  it("refuses a Gotify channel with no application token", async () => {
    const blank = await createChannel(
      form({ kind: "GOTIFY", name: "Gotify", url: "https://gotify.example.com/message" }),
    );
    expect(blank.ok).toBe(false);
    expect(blank.fieldErrors).toMatchObject({ token: expect.any(String) });

    const created = await createChannel(
      form({
        kind: "GOTIFY",
        name: "Gotify",
        url: "https://gotify.example.com/message",
        token: "app-token",
      }),
    );
    expect(created.ok).toBe(true);

    // Blank on an edit keeps the stored one rather than emptying it.
    const id = (created as { data: { id: string } }).data.id;
    expect(
      (await updateChannel(form({ id, name: "Renamed", url: "https://gotify.example.com/message" }))).ok,
    ).toBe(true);
  });

  it("refuses a name longer than the column holds", async () => {
    const long = await createChannel(
      form({ kind: "NTFY", name: "n".repeat(97), url: "https://ntfy.sh/topic" }),
    );
    expect(long.ok).toBe(false);
    expect(long.fieldErrors).toMatchObject({ name: expect.any(String) });
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
