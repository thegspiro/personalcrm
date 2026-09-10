import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
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

vi.mock("node:dns/promises", () => ({
  // A public answer for everything, so no test depends on the network — except
  // one name that answers with nothing, which is how a destination that cannot
  // be resolved reaches the code under test.
  // One name answers with the loopback, so a test can stand up a server and
  // drive a delivery that actually succeeds — the only way to cover what
  // happens *after* a send works, which is where a pause is lifted.
  lookup: async (hostname: string) =>
    hostname.includes("unresolvable")
      ? []
      : hostname.includes("loopback")
        ? [{ address: "127.0.0.1", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }],
}));

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
  resumeChannel,
  sendTestNotification,
  setChannelEnabled,
  updateChannel,
} = await import("@/server/actions/notifications");
const { channelHealth, listChannelsForSettings } = await import("@/server/queries/notifications");
const { pruneReminderLog } = await import("@/server/services/reminders");
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

  it("stores a secret exactly as typed, whitespace and all", async () => {
    // A password may legitimately begin or end with a space. Trimmed, the
    // channel saves happily and then authenticates with different bytes than
    // were pasted — failing every send with nothing on screen to explain it.
    const created = await createChannel(
      form({ ...AUTHED, pass: "  spaced secret  " }),
    );
    expect(created.ok).toBe(true);

    const row = await prisma.notificationChannel.findFirstOrThrow();
    expect(resolveChannelSecrets(row as never)).toMatchObject({
      ok: true,
      config: { pass: "  spaced secret  " },
    });
  });

  it("still treats an all-whitespace secret as blank, which means keep", async () => {
    const created = await createChannel(form({ ...AUTHED, pass: "original-password" }));
    const id = (created as { data: { id: string } }).data.id;

    await updateChannel(form({ id, ...AUTHED, pass: "   " }));
    const after = await prisma.notificationChannel.findFirstOrThrow({ where: { id } });
    expect(resolveChannelSecrets(after as never)).toMatchObject({
      ok: true,
      config: { pass: "original-password" },
    });
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

  /** Capture one Gotify delivery without leaving the process. */
  async function gotifySend(
    config: Record<string, unknown>,
    data: Parameters<typeof deliverToChannel>[4] = null,
  ) {
    const channel = await prisma.notificationChannel.create({
      data: { ownerId, kind: "GOTIFY", name: "Gotify", config: config as never },
    });
    const sent: Array<{ url: URL; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const http = vi.fn(async (input: { url: URL; headers: Record<string, string>; body: string }) => {
      sent.push({ url: input.url, headers: input.headers, body: JSON.parse(input.body) });
      return { status: 200 };
    });
    await deliverToChannel(
      channel,
      "subject",
      "body",
      {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        isAdministrator: async () => true,
        http,
      },
      data,
    );
    return sent[0];
  }


  /**
   * Delivery health, which nothing read back until this existed.
   *
   * A channel that has quietly stopped working is the one failure this app
   * cannot report through the thing that broke, so the ledger it was already
   * writing had to start reaching the settings page.
   */
  describe("channel health", () => {
    async function ledger(
      channelId: string,
      rows: Array<{ ok: boolean; at: Date; attempts?: number; error?: string; policy?: string }>,
    ) {
      let key = 0;
      for (const row of rows) {
        key += 1;
        await prisma.reminderLog.create({
          data: {
            ownerId,
            entityType: "CADENCE",
            entityId: `entity-${key}`,
            schedulingPolicy: row.policy ?? "OVERDUE_CADENCE",
            dedupKey: `health-fixture-${channelId}-${key}`,
            scheduledFor: new Date("2026-09-01"),
            channelId,
            ok: row.ok,
            sentAt: row.ok ? row.at : null,
            lastAttemptAt: row.at,
            attemptCount: row.attempts ?? (row.ok ? 1 : 5),
            nextAttemptAt: null,
            error: row.ok ? null : row.error ?? "Channel returned HTTP 401.",
          },
        });
      }
    }

    async function channel(overrides: Record<string, unknown> = {}) {
      return prisma.notificationChannel.create({
        data: {
          ownerId,
          kind: "GOTIFY",
          name: "Gotify",
          config: { url: "https://gotify.example/message", token: "t" },
          ...overrides,
        },
      });
    }

    it("says nothing has been tried rather than reporting a new channel as healthy", async () => {
      await channel();
      const [only] = await listChannelsForSettings(ownerId);
      // A channel added a minute ago has delivered nothing and failed at
      // nothing, which is also the state one that will never work is in.
      expect(only.health).toMatchObject({
        lastOkAt: null,
        lastFailureAt: null,
        abandoned: 0,
        pausedAt: null,
      });
    });

    it("counts only what has been given up on since the last success", async () => {
      const row = await channel();
      await ledger(row.id, [
        { ok: false, at: new Date("2026-09-01T10:00:00Z") },
        { ok: true, at: new Date("2026-09-02T10:00:00Z") },
        { ok: false, at: new Date("2026-09-03T10:00:00Z"), error: "connect ECONNREFUSED" },
        { ok: false, at: new Date("2026-09-04T10:00:00Z"), error: "connect ECONNREFUSED" },
      ]);

      const health = await channelHealth(row);
      // A channel that failed in March and has worked every day since is not
      // broken; counting a lifetime total would eventually condemn every one.
      expect(health.abandoned).toBe(2);
      expect(health.lastOkAt).toBe("2026-09-02T10:00:00.000Z");
      expect(health.lastFailureAt).toBe("2026-09-04T10:00:00.000Z");
      expect(health.lastError).toBe("connect ECONNREFUSED");
    });

    it("does not count a cancelled reminder as a delivery failure", async () => {
      const row = await channel();
      // Cancelled rows have the same empty nextAttemptAt as an abandoned one —
      // a completed task, a contact made private. They are not failures, and
      // the scheduler puts them back on the retry path when they are owed
      // again, so counting them would report a working channel as broken.
      await ledger(row.id, [
        { ok: false, at: new Date("2026-09-03T10:00:00Z"), attempts: 2, error: "Delivery cancelled." },
      ]);
      expect((await channelHealth(row)).abandoned).toBe(0);
    });

    it("carries the pause and its reason to the settings page", async () => {
      const row = await channel({
        pausedAt: new Date("2026-09-05T10:00:00Z"),
        pauseReason: "Channel returned HTTP 401.",
      });
      const health = await channelHealth(row);
      expect(health.pausedAt).toBe("2026-09-05T10:00:00.000Z");
      expect(health.pauseReason).toBe("Channel returned HTTP 401.");
    });

    it("resumes a paused channel without touching the switch or the ledger", async () => {
      const row = await channel({
        isEnabled: true,
        pausedAt: new Date("2026-09-05T10:00:00Z"),
        pauseReason: "nope",
        lastProbeAt: new Date("2026-09-05T11:00:00Z"),
      });
      await ledger(row.id, [{ ok: false, at: new Date("2026-09-05T10:00:00Z") }]);

      expect((await resumeChannel(row.id)).ok).toBe(true);
      const after = await prisma.notificationChannel.findFirstOrThrow({ where: { id: row.id } });
      expect(after.pausedAt).toBeNull();
      expect(after.pauseReason).toBeNull();
      expect(after.lastProbeAt).toBeNull();
      expect(after.isEnabled).toBe(true);
      // History is left alone: if it is still broken, the next run of failures
      // pauses it again rather than starting from a clean slate that hides it.
      expect(await prisma.reminderLog.count({ where: { channelId: row.id } })).toBe(1);
    });

    it("refuses to resume another account's channel", async () => {
      const stranger = await createTestUser();
      const theirs = await prisma.notificationChannel.create({
        data: {
          ownerId: stranger.id,
          kind: "NTFY",
          name: "Theirs",
          config: { url: "https://ntfy.sh/theirs" },
          pausedAt: new Date("2026-09-05T10:00:00Z"),
        },
      });
      expect((await resumeChannel(theirs.id)).ok).toBe(false);
      expect(
        (await prisma.notificationChannel.findFirstOrThrow({ where: { id: theirs.id } })).pausedAt,
      ).not.toBeNull();
    });

    it("lifts a pause when a test send gets through", async () => {
      const server = createServer((_request: IncomingMessage, response: ServerResponse) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
      try {
        await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
        const port = (server.address() as AddressInfo).port;
        const row = await channel({
          config: { url: `http://loopback.test:${port}/message`, token: "t" },
          pausedAt: new Date("2026-09-05T10:00:00Z"),
          pauseReason: "Channel returned HTTP 401.",
        });

        // Fixing the token and pressing test is the same evidence a probe
        // would have produced; needing to also remember to resume afterwards
        // is a second step nobody would find.
        expect((await sendTestNotification(row.id)).ok).toBe(true);
        const after = await prisma.notificationChannel.findFirstOrThrow({ where: { id: row.id } });
        expect(after.pausedAt).toBeNull();
        expect(after.pauseReason).toBeNull();
        expect(after.lastProbeAt).toBeNull();
      } finally {
        await new Promise<void>((done) => server.close(() => done()));
      }
    });
  });

  describe("pruning the ledger", () => {
    async function delivered(policy: string, sentAt: Date, scheduledFor: Date, key: string) {
      const row = await prisma.notificationChannel.create({
        data: { ownerId, kind: "NTFY", name: key, config: { url: "https://ntfy.sh/x" } },
      });
      return prisma.reminderLog.create({
        data: {
          ownerId,
          entityType: "DIGEST",
          entityId: `entity-${key}`,
          schedulingPolicy: policy,
          dedupKey: `prune-${key}`,
          scheduledFor,
          channelId: row.id,
          ok: true,
          sentAt,
          lastAttemptAt: sentAt,
          attemptCount: 1,
        },
      });
    }

    const now = new Date("2026-09-09T12:00:00Z");
    const ancient = new Date("2026-01-01T12:00:00Z");

    it("never deletes a row whose reminder would simply be sent again", async () => {
      // The ledger row is the only thing stopping a second send, and an overdue
      // cadence keys on a `nextTouchAt` that does not move until an interaction
      // is logged — so the same candidate is regenerated on the very next
      // hourly pass. Deleting it does not tidy history; it re-sends.
      const cadence = await delivered("OVERDUE_CADENCE", ancient, ancient, "cadence");
      const task = await delivered("INCOMPLETE_TASK_DUE", ancient, ancient, "task");

      expect(await pruneReminderLog(now, { db: prisma })).toBe(0);
      expect(await prisma.reminderLog.count({ where: { id: { in: [cadence.id, task.id] } } })).toBe(2);
    });

    it("deletes delivered rows whose occurrence cannot come round again", async () => {
      const digest = await delivered("DAILY_DIGEST", ancient, ancient, "digest");
      const date = await delivered("IMPORTANT_DATE_OFFSET", ancient, ancient, "date");
      const plan = await delivered("SCHEDULED_PLAN", ancient, ancient, "plan");

      expect(await pruneReminderLog(now, { db: prisma })).toBe(3);
      expect(await prisma.reminderLog.count({ where: { id: { in: [digest.id, date.id, plan.id] } } }))
        .toBe(0);
    });

    it("keeps a row whose occurrence is still ahead of the window", async () => {
      // A reminder can be sent up to a year before the day it is about, so the
      // send being old does not mean the occurrence is. Both bounds have to be
      // past before the row is safe to lose.
      const early = await delivered("IMPORTANT_DATE_OFFSET", ancient, new Date("2026-12-25"), "early");
      expect(await pruneReminderLog(now, { db: prisma })).toBe(0);
      expect(await prisma.reminderLog.count({ where: { id: early.id } })).toBe(1);
    });

    it("keeps failures whatever their age, because health is read from them", async () => {
      const row = await prisma.notificationChannel.create({
        data: { ownerId, kind: "NTFY", name: "Old", config: { url: "https://ntfy.sh/x" } },
      });
      await prisma.reminderLog.create({
        data: {
          ownerId,
          entityType: "DIGEST",
          entityId: "entity-failed",
          schedulingPolicy: "DAILY_DIGEST",
          dedupKey: "prune-failed",
          scheduledFor: ancient,
          channelId: row.id,
          ok: false,
          lastAttemptAt: ancient,
          attemptCount: 5,
          nextAttemptAt: null,
          error: "Channel returned HTTP 500.",
        },
      });
      expect(await pruneReminderLog(now, { db: prisma })).toBe(0);
      expect(await prisma.reminderLog.count()).toBe(1);
    });
  });

  /**
   * Every request one Gotify delivery makes, with the endpoint deciding what
   * each POST is answered with. Separate from `gotifySend` because the whole
   * point of these cases is the second request, which a helper returning only
   * the first cannot see.
   */
  async function gotifyAttempts(
    config: Record<string, unknown>,
    answer: (path: string) => number,
  ): Promise<{ paths: string[]; error: string | null }> {
    const channel = await prisma.notificationChannel.create({
      data: { ownerId, kind: "GOTIFY", name: "Gotify", config: config as never },
    });
    const paths: string[] = [];
    const http = vi.fn(async (input: { url: URL }) => {
      paths.push(input.url.pathname);
      return { status: answer(input.url.pathname) };
    });
    const error = await deliverToChannel(channel, "subject", "body", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      isAdministrator: async () => true,
      http,
    }).then(() => null, (thrown: unknown) => (thrown as Error).message);
    return { paths, error };
  }

  it("authenticates Gotify with its own header, not a bearer token", async () => {
    const sent = await gotifySend({ url: "https://gotify.example/message", token: "app-token" });

    // Gotify rejects a bearer token, so sharing ntfy's scheme meant the channel
    // was offered and never delivered.
    expect(sent.headers["x-gotify-key"]).toBe("app-token");
    expect(sent.headers.authorization).toBeUndefined();
  });

  it("posts to /message when the saved address is a bare host", async () => {
    // The address off the browser's bar is what people paste, and Gotify
    // answers a POST to its root with 404 — a channel that saved cleanly and
    // then failed every send.
    const bare = await gotifySend({ url: "https://gotify.example", token: "t" });
    expect(bare.url.href).toBe("https://gotify.example/message");

    const slash = await gotifySend({ url: "https://gotify.example/", token: "t" });
    expect(slash.url.href).toBe("https://gotify.example/message");

    // A path the operator typed is theirs — a reverse proxy subpath included.
    const proxied = await gotifySend({ url: "https://host.example/gotify/message", token: "t" });
    expect(proxied.url.href).toBe("https://host.example/gotify/message");

    // Gotify's router answers `/message/` with a redirect, which is not
    // followed — the same paste failing as a 307 instead of a 404.
    const trailing = await gotifySend({ url: "https://gotify.example/message/", token: "t" });
    expect(trailing.url.href).toBe("https://gotify.example/message");
  });

  it("finds the message endpoint under a reverse-proxy subpath after a 404", async () => {
    // `https://home.example/gotify` is the whole of what a proxied Gotify
    // shows in the browser's bar, and it is what gets pasted. Filling in
    // `/message` unconditionally would take away an alias that maps straight
    // onto the endpoint and works today, so it is tried only once the server
    // has said it does not recognise the path.
    for (const typed of ["/gotify", "/gotify/"]) {
      const attempt = await gotifyAttempts(
        { url: `https://home.example${typed}`, token: "t" },
        (path) => (path === "/gotify/message" ? 200 : 404),
      );
      expect(attempt.paths).toEqual(["/gotify", "/gotify/message"]);
      expect(attempt.error).toBeNull();
    }
  });

  it("asks once, and keeps the real reason when the endpoint answers", async () => {
    // An alias that already is the message endpoint answers the first POST, so
    // nothing further is asked and the message cannot be delivered twice.
    const working = await gotifyAttempts(
      { url: "https://home.example/notify", token: "t" },
      () => 200,
    );
    expect(working.paths).toEqual(["/notify"]);

    // A wrong token at the endpoint beneath the typed path is worth far more
    // than the 404 the typed path produced, so it is what gets reported.
    const wrongToken = await gotifyAttempts(
      { url: "https://home.example/gotify", token: "t" },
      (path) => (path === "/gotify/message" ? 401 : 404),
    );
    expect(wrongToken.paths).toEqual(["/gotify", "/gotify/message"]);
    expect(wrongToken.error).toBe("Channel returned HTTP 401.");

    // Nothing anywhere: the path was never the problem, and the message says
    // which endpoint was looked for rather than only the code.
    const nothing = await gotifyAttempts(
      { url: "https://home.example/gotify", token: "t" },
      () => 404,
    );
    expect(nothing.paths).toEqual(["/gotify", "/gotify/message"]);
    expect(nothing.error).toContain("/gotify/message");

    // An address already at `/message` has nothing further to try.
    const already = await gotifyAttempts(
      { url: "https://gotify.example/message", token: "t" },
      () => 404,
    );
    expect(already.paths).toEqual(["/message"]);
  });

  it("sends a priority Gotify's clients will alert on, and honours a stored one", async () => {
    // Gotify defaults an absent priority to 0, which its clients file away
    // without a sound: the reminder arrives and is never seen.
    const unset = await gotifySend({ url: "https://gotify.example/message", token: "t" });
    expect(unset.body.priority).toBe(5);

    const quiet = await gotifySend({ url: "https://gotify.example/message", token: "t", priority: 0 });
    expect(quiet.body.priority).toBe(0);

    const urgent = await gotifySend({ url: "https://gotify.example/message", token: "t", priority: 9 });
    expect(urgent.body.priority).toBe(9);

    // Nonsense in the stored JSON is not a reason to send nothing at all.
    const junk = await gotifySend({ url: "https://gotify.example/message", token: "t", priority: "high" });
    expect(junk.body.priority).toBe(5);
  });

  it("carries the reminder as fields as well as prose, and never an identifier", async () => {
    const sent = await gotifySend({ url: "https://gotify.example/message", token: "t" }, {
      policy: "OVERDUE_CADENCE",
      date: "2030-06-12",
      daysAway: -3,
      contactName: "Alex Example",
    });

    const extras = sent.body.extras as Record<string, unknown>;
    // Declared markdown so the digest's headings and bullets render as such.
    expect(extras["client::display"]).toEqual({ contentType: "text/markdown" });
    expect(extras["personalcrm::reminder"]).toEqual({
      policy: "OVERDUE_CADENCE",
      date: "2030-06-12",
      daysAway: -3,
      contactName: "Alex Example",
    });
    // The prose is unchanged: the fields are alongside it, not instead of it.
    expect(sent.body.title).toBe("subject");
    expect(sent.body.message).toBe("body");
    expect(JSON.stringify(sent.body)).not.toMatch(/\bid\b|contactId|entityId/);
  });

  it("links back only to an address the operator has published", async () => {
    const previous = process.env.APP_URL;
    try {
      process.env.APP_URL = "https://crm.example.com/";
      const linked = await gotifySend({ url: "https://gotify.example/message", token: "t" });
      expect((linked.body.extras as Record<string, unknown>)["client::notification"]).toEqual({
        click: { url: "https://crm.example.com" },
      });

      // Unset, there is nothing to link to: the scheduler runs without a
      // request, so a host header cannot stand in for one.
      delete process.env.APP_URL;
      const unlinked = await gotifySend({ url: "https://gotify.example/message", token: "t" });
      expect((unlinked.body.extras as Record<string, unknown>)["client::notification"]).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = previous;
    }
  });

  it("delivers over a real socket to a server that answers as Gotify does", async () => {
    // Everything above replaces the HTTP adapter. This one does not: the
    // request is built, the socket is opened and the answer is read, so a
    // payload Gotify would reject — a missing token, a body it cannot parse,
    // the wrong path — fails here rather than in production an hour later.
    const seen: Array<{ method: string; path: string; token: unknown; body: Record<string, unknown> }> = [];
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk as Buffer));
      request.on("end", () => {
        const path = (request.url ?? "").split("?")[0];
        const token = request.headers["x-gotify-key"];
        let body: Record<string, unknown> | null = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        } catch {
          body = null;
        }
        seen.push({ method: request.method ?? "", path, token, body: body ?? {} });
        // gotify/server's own refusals, in the order it applies them.
        const answer = request.method !== "POST" || path !== "/message" ? 404
          : !token ? 401
          : typeof body?.message !== "string" || body.message === "" ? 400
          : 200;
        response.writeHead(answer, { "content-type": "application/json" });
        response.end(JSON.stringify(answer === 200 ? { id: 1, ...body } : { error: "no" }));
      });
    });
    try {
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const port = (server.address() as AddressInfo).port;
      const channel = await prisma.notificationChannel.create({
        data: {
          ownerId,
          kind: "GOTIFY",
          name: "Gotify",
          // No path, so this also proves the endpoint is filled in on the wire.
          config: { url: `http://127.0.0.1:${port}`, token: "app-token", priority: 7 },
        },
      });

      await deliverToChannel(channel, "Your Personal CRM daily digest", "Keep in touch\n- Alex Example", {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        isAdministrator: async () => true,
      }, { policy: "DAILY_DIGEST", date: "2030-06-15", daysAway: 0, items: [], hiddenItems: 0 });

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ method: "POST", path: "/message", token: "app-token" });
      expect(seen[0].body).toMatchObject({
        title: "Your Personal CRM daily digest",
        message: "Keep in touch\n- Alex Example",
        priority: 7,
      });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
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

  it("saves a name whatever it resolves to, so the form cannot enumerate DNS", async () => {
    // Refusing a name that resolves somewhere non-public — while a name that
    // resolves nowhere saved cleanly — answered the question the boundary
    // exists to protect: an internal host and a spelling nobody registered
    // could be told apart from an ordinary account. The two must look the
    // same here, and the delivery-time block is what actually stops the send.
    state.role = "MEMBER";
    const internal = await createChannel(
      form({ kind: "NTFY", name: "Guess", url: "https://nas.corp.example/topic" }),
    );
    const nowhere = await createChannel(
      form({ kind: "NTFY", name: "Nowhere", url: "https://unresolvable.example.com/other" }),
    );

    expect(internal.ok).toBe(true);
    expect(nowhere.ok).toBe(true);
    expect(await prisma.notificationChannel.count()).toBe(2);

    // A literal address is a different matter: refusing it tells its author
    // only what they just typed, so it stays refused on the field.
    const literal = await createChannel(
      form({ kind: "NTFY", name: "Direct", url: "http://10.0.0.5/hook" }),
    );
    expect(literal.ok).toBe(false);
    expect(literal.fieldErrors).toMatchObject({ url: expect.any(String) });
  });

  it("saves a destination that does not resolve, and refuses to send to it", async () => {
    // Saving must not depend on DNS answering. A name is unresolvable for
    // reasons that say nothing about where it points — the resolver is down,
    // the box is offline, the host is internal and not in DNS yet — and
    // refusing those would make configuring a channel a network operation.
    state.role = "MEMBER";
    const saved = await createChannel(
      form({ kind: "NTFY", name: "Not yet", url: "https://unresolvable.example.com/topic" }),
    );
    expect(saved.ok).toBe(true);

    // Nothing is lost by allowing it: the check runs again before the send,
    // where it is a failure on the row rather than a message gone astray.
    const channel = await prisma.notificationChannel.findFirstOrThrow();
    await expect(
      deliverToChannel(channel, "subject", "body", {
        isAdministrator: async () => false,
        http: async () => {
          throw new Error("must not be reached");
        },
      }),
    ).rejects.toThrow(/did not resolve/);
  });

  it("applies the same boundary to an SMTP host, which is not a URL", async () => {
    // The guard read `url`, and an email channel has none — so the hole it
    // left was exactly the size of a host plus any port, opened from the
    // server by nodemailer.
    state.role = "MEMBER";

    const inward = await createChannel(form({ ...EMAIL, host: "127.0.0.1" }));
    expect(inward.ok).toBe(false);
    expect(inward.fieldErrors).toMatchObject({ host: expect.any(String) });
    expect(await prisma.notificationChannel.count()).toBe(0);

    expect((await createChannel(form(EMAIL))).ok).toBe(true);

    state.role = "ADMIN";
    expect((await createChannel(form({ ...EMAIL, name: "LAN mail", host: "10.0.0.25" }))).ok).toBe(true);
  });

  it("does not follow a redirect to somewhere the boundary would refuse", async () => {
    const channel = await prisma.notificationChannel.create({
      data: {
        ownerId,
        kind: "WEBHOOK",
        name: "Redirector",
        config: { url: "https://public.example/hook" },
      },
    });

    const seen: string[] = [];
    const http = vi.fn(async (input: { url: URL }) => {
      seen.push(String(input.url));
      return { status: 307 };
    });
    await expect(deliverToChannel(channel, "subject", "body", {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      isAdministrator: async () => false,
      http,
    })).rejects.toThrow(/redirect/i);

    // Only the configured address was contacted; the redirect was not taken.
    expect(seen).toEqual(["https://public.example/hook"]);
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
        schedulingPolicy: "IMPORTANT_DATE_OFFSET",
        dedupKey: "deleted-channel-ledger-fixture",
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
