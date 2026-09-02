import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processImportantDateReminders } from "@/server/services/reminders";
import { encryptSecret } from "@/server/crypto/secrets";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * The real client with one ledger method replaced, so a test can stand in for
 * a process that dies mid-way, or count how often a path is taken.
 */
function withLedger(overrides: Partial<Record<keyof typeof prisma.reminderLog, unknown>>): typeof prisma {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property !== "reminderLog") return Reflect.get(target, property, receiver);
      return new Proxy(target.reminderLog, {
        get(ledger, method, ledgerReceiver) {
          const override = overrides[method as keyof typeof overrides];
          return override ?? Reflect.get(ledger, method, ledgerReceiver);
        },
      });
    },
  });
}

describe.skipIf(!hasTestDatabase)("important-date delivery", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  it("creates one idempotent delivery and excludes archived and locked-private contacts", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "America/Los_Angeles", privacyLockEnabled: true, digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contacts = await Promise.all([
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Visible" } }),
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Archived", isArchived: true } }),
      prisma.contact.create({ data: { ownerId: user.id, firstName: "Private", isPrivate: true } }),
    ]);
    for (const contact of contacts) {
      await prisma.importantDate.create({ data: {
        ownerId: user.id,
        contactId: contact.id,
        label: "Birthday",
        date: new Date("2000-08-29T00:00:00Z"),
        recurrence: "ANNUAL",
        reminderDaysBefore: [0],
      } });
    }
    const send = vi.fn(async () => undefined);
    // Still Aug 28 in Los Angeles; nothing is due at this UTC boundary.
    await processImportantDateReminders(new Date("2026-08-29T01:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();

    const now = new Date("2026-08-29T18:00:00Z");
    await processImportantDateReminders(now, { db: prisma, send });
    await processImportantDateReminders(now, { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: true, attemptCount: 1, offsetDays: 0 });
  });

  it("delivers through the real sender for encrypted and legacy plaintext rows alike", async () => {
    // Two shapes exist in the wild: rows written by the settings form, which
    // store the token encrypted, and rows hand-inserted before there was one.
    // Both have to reach the network, so this drives deliverToChannel itself
    // rather than the injected fake.
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.createMany({
      data: [
        {
          ownerId: user.id,
          kind: "WEBHOOK",
          name: "Encrypted",
          config: {
            url: "https://hook.example/encrypted",
            tokenEnc: encryptSecret("secret-token", "personalcrm-channel-secret"),
          },
        },
        {
          ownerId: user.id,
          kind: "WEBHOOK",
          name: "Legacy",
          config: { url: "https://hook.example/legacy", token: "legacy-token" },
        },
      ],
    });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Dana" } });
    await prisma.importantDate.create({ data: {
      ownerId: user.id,
      contactId: contact.id,
      label: "Anniversary",
      date: new Date("2026-08-29T00:00:00Z"),
      recurrence: "NONE",
      reminderDaysBefore: [0],
    } });

    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("authorization") ?? undefined });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await processImportantDateReminders(new Date("2026-08-29T12:00:00Z"), { db: prisma });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(calls).toHaveLength(2);
    // Both carry their credential; neither goes out bare.
    expect(calls.find((c) => c.url.endsWith("/encrypted"))?.auth).toBe("Bearer secret-token");
    expect(calls.find((c) => c.url.endsWith("/legacy"))?.auth).toBe("Bearer legacy-token");
    expect(await prisma.reminderLog.count({ where: { ok: true } })).toBe(2);
  });

  it("records an unreadable secret as a failure rather than sending without it", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: {
      ownerId: user.id,
      kind: "WEBHOOK",
      name: "Rotated",
      // What a rotated AUTH_SECRET leaves behind.
      config: { url: "https://hook.example/rotated", tokenEnc: "v1.bm90LWEtcmVhbC1jaXBoZXJ0ZXh0" },
    } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Dana" } });
    await prisma.importantDate.create({ data: {
      ownerId: user.id,
      contactId: contact.id,
      label: "Anniversary",
      date: new Date("2026-08-29T00:00:00Z"),
      recurrence: "NONE",
      reminderDaysBefore: [0],
    } });

    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await processImportantDateReminders(new Date("2026-08-29T12:00:00Z"), { db: prisma });
    } finally {
      vi.unstubAllGlobals();
    }

    // The request must not leave at all. Sending it minus its Authorization
    // header would be a silent downgrade, so the failure is recorded instead.
    expect(fetchMock).not.toHaveBeenCalled();
    const log = await prisma.reminderLog.findFirstOrThrow();
    expect(log.ok).toBe(false);
    expect(log.error).toMatch(/AUTH_SECRET/);
  });

  it("retries failures without creating a duplicate ledger row", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Sam" } });
    await prisma.importantDate.create({ data: { ownerId: user.id, contactId: contact.id, label: "Date", date: new Date("2026-08-29T00:00:00Z"), recurrence: "NONE", reminderDaysBefore: [0] } });
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const first = new Date("2026-08-29T12:00:00Z");
    await processImportantDateReminders(first, { db: prisma, send });
    await processImportantDateReminders(new Date(first.getTime() + 61_000), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: true, attemptCount: 2 });
  });

  it("delivers cadence, task, and one daily digest across channels without crossing owners", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    await prisma.userPreference.createMany({ data: [
      { userId: owner.id, timezone: "America/New_York", digestEnabled: true, digestHour: 8 },
      { userId: other.id, timezone: "America/New_York", digestEnabled: false, digestHour: 8 },
    ] });
    await prisma.notificationChannel.createMany({ data: [
      { ownerId: owner.id, kind: "WEBHOOK", name: "Owner email", config: { url: "https://example.invalid/a" } },
      { ownerId: owner.id, kind: "NTFY", name: "Owner phone", config: { url: "https://example.invalid/b" } },
      { ownerId: other.id, kind: "WEBHOOK", name: "Other", config: { url: "https://example.invalid/c" } },
    ] });
    const due = new Date("2026-09-02T00:00:00Z");
    const contact = await prisma.contact.create({ data: { ownerId: owner.id, firstName: "Alex", nextTouchAt: due } });
    const otherContact = await prisma.contact.create({ data: { ownerId: other.id, firstName: "Other", nextTouchAt: due } });
    await prisma.task.createMany({ data: [
      { ownerId: owner.id, contactId: contact.id, title: "Call Alex", dueDate: due },
      { ownerId: other.id, contactId: otherContact.id, title: "Other task", dueDate: due },
    ] });
    const send = vi.fn(async () => undefined);
    const now = new Date("2026-09-02T13:00:00Z"); // 09:00 in New York
    await processImportantDateReminders(now, { db: prisma, send });
    await processImportantDateReminders(now, { db: prisma, send });

    // Two channels receive cadence + task + digest exactly once; the other owner gets only its own two items.
    expect(send).toHaveBeenCalledTimes(8);
    expect(await prisma.reminderLog.count({ where: { ownerId: owner.id } })).toBe(6);
    for (const entityType of ["CADENCE", "TASK", "DIGEST"] as const) {
      expect(await prisma.reminderLog.count({ where: { ownerId: owner.id, entityType } })).toBe(2);
    }
    expect(await prisma.reminderLog.count({ where: { ownerId: other.id } })).toBe(2);
  });

  it("cancels retries when task state or contact privacy changes", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", privacyLockEnabled: true, digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Taylor", nextTouchAt: new Date("2026-09-02T00:00:00Z") } });
    const task = await prisma.task.create({ data: { ownerId: user.id, contactId: contact.id, title: "Follow up", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async () => { throw new Error("offline"); });
    const first = new Date("2026-09-02T12:00:00Z");
    await processImportantDateReminders(first, { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);

    await prisma.task.update({ where: { id: task.id }, data: { completedAt: first } });
    await prisma.contact.update({ where: { id: contact.id }, data: { isPrivate: true } });
    await processImportantDateReminders(new Date(first.getTime() + 61_000), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.reminderLog.count({ where: { nextAttemptAt: null, error: { contains: "cancelled" } } })).toBe(2);
  });

  it("counts a cadence due later in the local day as due, like every other overdue reading", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "America/New_York", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    // 7pm and 1am (the next day) in New York.
    await prisma.contact.create({ data: { ownerId: user.id, firstName: "Evening", nextTouchAt: new Date("2026-09-02T23:00:00Z") } });
    await prisma.contact.create({ data: { ownerId: user.id, firstName: "Tomorrow", nextTouchAt: new Date("2026-09-03T05:00:00Z") } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string) => undefined);

    await processImportantDateReminders(new Date("2026-09-02T13:00:00Z"), { db: prisma, send }); // 9am
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe("Time to reach out to Evening");
  });

  it("keeps retrying a reminder after the day it was owed on has ended, worded for the day it goes out", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Sam" } });
    await prisma.importantDate.create({ data: { ownerId: user.id, contactId: contact.id, label: "Birthday", date: new Date("2026-09-01T00:00:00Z"), recurrence: "NONE", reminderDaysBefore: [0] } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string): Promise<void> => { throw new Error("offline"); });

    // The last pass of the day fails; the first pass of the next day is the retry.
    await processImportantDateReminders(new Date("2026-09-01T23:30:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2]).toBe("Birthday for Sam is today (2026-09-01).");

    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-02T00:30:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][2]).toBe("Birthday for Sam was yesterday (2026-09-01).");
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: true, attemptCount: 2, nextAttemptAt: null });
  });

  it("cancels a retry when the date it was for has since been corrected", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Sam" } });
    const date = await prisma.importantDate.create({ data: { ownerId: user.id, contactId: contact.id, label: "Birthday", date: new Date("2026-09-01T00:00:00Z"), recurrence: "NONE", reminderDaysBefore: [0] } });
    const send = vi.fn(async () => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-01T23:30:00Z"), { db: prisma, send });
    await prisma.importantDate.update({ where: { id: date.id }, data: { date: new Date("2026-09-20T00:00:00Z") } });
    await processImportantDateReminders(new Date("2026-09-02T00:30:00Z"), { db: prisma, send });

    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: false, nextAttemptAt: null, error: expect.stringContaining("cancelled") });
  });

  it("retries a digest within its day and drops it once the day has ended", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: true, digestHour: 8 } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string): Promise<void> => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-02T22:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe("Your Personal CRM daily digest");

    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-02T22:30:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.reminderLog.findFirst({ where: { entityType: "DIGEST" } })).toMatchObject({ ok: true, attemptCount: 2 });

    // The next day's failure is not retried on the day after: that digest is
    // stale, and the day after's own digest is what goes out instead.
    send.mockImplementation(async () => { throw new Error("offline"); });
    await processImportantDateReminders(new Date("2026-09-03T23:30:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(3);
    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-04T00:30:00Z"), { db: prisma, send }); // before the digest hour
    expect(send).toHaveBeenCalledTimes(3);
    expect(await prisma.reminderLog.count({ where: { entityType: "DIGEST", ok: false, nextAttemptAt: null, error: { contains: "cancelled" } } })).toBe(1);
  });

  it("re-reads a retried digest's counts rather than resending what it first said", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: true, digestHour: 8 } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string): Promise<void> => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    expect(send.mock.calls[0][2]).toBe("0 cadence reminders and 0 due tasks need attention today.");

    await prisma.task.create({ data: { ownerId: user.id, title: "Call the plumber", dueDate: new Date("2026-09-02T00:00:00Z") } });
    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-02T09:30:00Z"), { db: prisma, send });
    // The task itself, then the digest retry that now counts it.
    const bodies = send.mock.calls.slice(1).map((call) => call[2]);
    expect(bodies).toContain("Call the plumber was due 2026-09-02.");
    expect(bodies).toContain("0 cadence reminders and 1 due task need attention today.");
  });

  it("still sends a reminder whose process died between the ledger insert and the send", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Renew the passport", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string) => undefined);

    // The row is written, the send happens, and the process is gone before the
    // row can say so. Before the deadline was seeded on insert this row was
    // never retried, and the unique key stopped it ever being created again.
    const dying = withLedger({ update: () => Promise.reject(new Error("process died")) });
    const first = new Date("2026-09-02T09:00:00Z");
    await expect(processImportantDateReminders(first, { db: dying, send })).rejects.toThrow("process died");
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: false, attemptCount: 0, nextAttemptAt: expect.any(Date) });

    // Not before the lease is up: a slow sender is not a dead one.
    await processImportantDateReminders(new Date(first.getTime() + 4 * 60_000), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    await processImportantDateReminders(new Date(first.getTime() + 6 * 60_000), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][2]).toBe("Renew the passport was due 2026-09-02.");
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ ok: true, attemptCount: 1, nextAttemptAt: null });
  });

  it("waits for a digest hour moved later rather than retrying early or giving up", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: true, digestHour: 8 } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const send = vi.fn(async (): Promise<void> => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    const failed = await prisma.reminderLog.findFirstOrThrow();
    await prisma.userPreference.update({ where: { userId: user.id }, data: { digestHour: 12 } });

    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-02T10:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: false, nextAttemptAt: failed.nextAttemptAt, error: "offline" });

    await processImportantDateReminders(new Date("2026-09-02T12:30:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: true, attemptCount: 2 });
  });

  it("does not attempt an insert for anything the ledger already holds", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.createMany({ data: [
      { ownerId: user.id, kind: "WEBHOOK", name: "A", config: { url: "https://example.invalid/a" } },
      { ownerId: user.id, kind: "NTFY", name: "B", config: { url: "https://example.invalid/b" } },
    ] });
    await prisma.contact.create({ data: { ownerId: user.id, firstName: "Overdue", nextTouchAt: new Date("2026-08-01T00:00:00Z") } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Still open", dueDate: new Date("2026-08-01T00:00:00Z") } });
    const send = vi.fn(async () => undefined);
    const create = vi.fn(prisma.reminderLog.create.bind(prisma.reminderLog));
    const counted = withLedger({ create });

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: counted, send });
    expect(create).toHaveBeenCalledTimes(4);

    // An overdue cadence and an open task stay candidates every hour; the
    // second pass must know they are sent without trying to write them again.
    await processImportantDateReminders(new Date("2026-09-02T10:00:00Z"), { db: counted, send });
    expect(create).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("lets exactly one of two overlapping schedulers send a retry", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Book the dentist", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async (): Promise<void> => { throw new Error("offline"); });
    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);

    // Both passes select the same due row; only the one whose claim lands sends.
    send.mockImplementation(async () => undefined);
    const later = new Date("2026-09-02T09:02:00Z");
    await Promise.all([
      processImportantDateReminders(later, { db: prisma, send }),
      processImportantDateReminders(later, { db: prisma, send }),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: true, attemptCount: 2, nextAttemptAt: null });
  });

  it("delivers a cancelled reminder after all once its task is reopened", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const task = await prisma.task.create({ data: { ownerId: user.id, title: "Return the library books", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string): Promise<void> => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    await prisma.task.update({ where: { id: task.id }, data: { completedAt: new Date("2026-09-02T09:30:00Z") } });
    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-02T10:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: false, nextAttemptAt: null });

    // Reopened with the same due date: the same key, which used to mean "already handled".
    await prisma.task.update({ where: { id: task.id }, data: { completedAt: null } });
    await processImportantDateReminders(new Date("2026-09-02T11:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][2]).toBe("Return the library books was due 2026-09-02.");
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: true, attemptCount: 2, error: null });
  });

  it("sends nothing for an owner whose preference row is missing, whatever else they have", async () => {
    // A partial import can leave a PIN and channels without the row that
    // says whether the lock is on. Reading that as "off" would send a
    // private person's name out; the scheduler leaves the owner alone.
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.id }, data: { privacyPinHash: "pin" } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    await prisma.contact.create({ data: { ownerId: user.id, firstName: "Secret", isPrivate: true, nextTouchAt: new Date("2026-08-01T00:00:00Z") } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Open task", dueDate: new Date("2026-08-01T00:00:00Z") } });
    const send = vi.fn(async () => undefined);

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.count()).toBe(0);

    // The row exists again: the next pass picks the owner up, lock honoured.
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", privacyLockEnabled: true, digestEnabled: false } });
    await processImportantDateReminders(new Date("2026-09-02T10:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ entityType: "TASK" });
  });

  it("keeps retrying a cadence reminder after the owner changes timezone", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    // 18:00 UTC on the 2nd is already the 3rd fourteen hours east.
    await prisma.contact.create({ data: { ownerId: user.id, firstName: "Alex", nextTouchAt: new Date("2026-09-02T18:00:00Z") } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string): Promise<void> => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-02T20:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    await prisma.userPreference.update({ where: { userId: user.id }, data: { timezone: "Pacific/Kiritimati" } });

    // The cadence has not moved; only the calendar it is read against has.
    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-02T21:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][2]).toBe("Alex's keep-in-touch cadence has been due since 2026-09-03.");
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: true, attemptCount: 2 });
  });

  it("honours a lock switched on during the pass, before a retry is sent", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.id }, data: { privacyPinHash: "pin" } });
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", privacyLockEnabled: false, digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Secret", isPrivate: true } });
    await prisma.task.create({ data: { ownerId: user.id, contactId: contact.id, title: "Private errand", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async (): Promise<void> => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);

    // The lock goes on after the pass has read its owners and before it
    // reaches the retries — which is where the retry query is the seam.
    const findMany = prisma.reminderLog.findMany.bind(prisma.reminderLog);
    const lockingMidPass = withLedger({
      findMany: async (args: Parameters<typeof findMany>[0]) => {
        if (args?.where && "ok" in args.where) {
          await prisma.userPreference.update({ where: { userId: user.id }, data: { privacyLockEnabled: true } });
        }
        return findMany(args);
      },
    });
    send.mockImplementation(async () => undefined);
    await processImportantDateReminders(new Date("2026-09-02T10:00:00Z"), { db: lockingMidPass, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: false, nextAttemptAt: null, error: expect.stringContaining("cancelled") });
  });

  it("honours a lock switched on during the pass, before a first send", async () => {
    const user = await createTestUser();
    await prisma.user.update({ where: { id: user.id }, data: { privacyPinHash: "pin" } });
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", privacyLockEnabled: false, digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Secret", isPrivate: true } });
    await prisma.task.create({ data: { ownerId: user.id, contactId: contact.id, title: "Private errand", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async () => undefined);

    // The candidate was read with the lock off; the lock goes on as its
    // ledger row is written, which is the last moment before the send.
    const create = prisma.reminderLog.create.bind(prisma.reminderLog);
    const lockingBeforeSend = withLedger({
      create: async (args: Parameters<typeof create>[0]) => {
        await prisma.userPreference.update({ where: { userId: user.id }, data: { privacyLockEnabled: true } });
        return create(args);
      },
    });
    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: lockingBeforeSend, send });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: false, attemptCount: 0, nextAttemptAt: null, error: expect.stringContaining("cancelled") });

    // And once the lock is off again, the same row is re-armed and sent.
    await prisma.userPreference.update({ where: { userId: user.id }, data: { privacyLockEnabled: false } });
    await processImportantDateReminders(new Date("2026-09-02T10:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.count()).toBe(1);
  });

  it("stamps a lease from the moment the row is written, not from the start of the pass", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Slow pass", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async () => undefined);

    // A pass that began at 09:00 reaches this row ten minutes in, and the
    // process dies after the send. A lease stamped from the pass's start
    // would already be spent, and a 09:06 pass could take the row mid-send.
    const dying = withLedger({ update: () => Promise.reject(new Error("process died")) });
    await expect(processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), {
      db: dying, send, clock: () => new Date("2026-09-02T09:10:00Z"),
    })).rejects.toThrow("process died");
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ nextAttemptAt: new Date("2026-09-02T09:15:00Z") });

    await processImportantDateReminders(new Date("2026-09-02T09:06:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    await processImportantDateReminders(new Date("2026-09-02T09:16:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not send a first attempt before its day has arrived in a timezone chosen mid-pass", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Water the plants", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async () => undefined);

    // Ten minutes into the 2nd in UTC the task is due; in Los Angeles it is
    // still the evening of the 1st. The owner moves there as the row is written.
    const create = prisma.reminderLog.create.bind(prisma.reminderLog);
    const movingWest = withLedger({
      create: async (args: Parameters<typeof create>[0]) => {
        await prisma.userPreference.update({ where: { userId: user.id }, data: { timezone: "America/Los_Angeles" } });
        return create(args);
      },
    });
    await processImportantDateReminders(new Date("2026-09-02T00:10:00Z"), { db: movingWest, send });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.count()).toBe(1);

    // Still the 1st there at 22:00 local; due at the first pass on the 2nd.
    await processImportantDateReminders(new Date("2026-09-02T05:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();
    await processImportantDateReminders(new Date("2026-09-02T08:00:00Z"), { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.count()).toBe(1);
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: true });
  });

  it("never sends another owner's contact through a task that points at them", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    await prisma.userPreference.createMany({ data: [
      { userId: owner.id, timezone: "UTC", digestEnabled: false },
      { userId: other.id, timezone: "UTC", digestEnabled: false },
    ] });
    await prisma.notificationChannel.create({ data: { ownerId: owner.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    // The two foreign keys are independent, so a repaired or imported row can
    // do this; the other owner's name must not leave through this owner's channel.
    const strangers = await prisma.contact.create({ data: { ownerId: other.id, firstName: "Somebody", lastName: "Else" } });
    await prisma.task.create({ data: { ownerId: owner.id, contactId: strangers.id, title: "Call them", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async (_channel: unknown, _subject: string, _body: string) => undefined);

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.count()).toBe(0);
  });

  it("never retries through a channel that belongs to another owner", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    await prisma.userPreference.createMany({ data: [
      { userId: owner.id, timezone: "UTC", digestEnabled: false },
      { userId: other.id, timezone: "UTC", digestEnabled: false },
    ] });
    const theirs = await prisma.notificationChannel.create({ data: { ownerId: other.id, kind: "WEBHOOK", name: "Theirs", config: { url: "https://example.invalid/theirs" } } });
    const task = await prisma.task.create({ data: { ownerId: owner.id, title: "Renew the lease", dueDate: new Date("2026-09-02T00:00:00Z") } });
    // The ledger's owner and channel are independent keys; a repaired or
    // imported row can point one owner's reminder at another's endpoint.
    await prisma.reminderLog.create({ data: {
      ownerId: owner.id, entityType: "TASK", entityId: task.id, schedulingPolicy: "INCOMPLETE_TASK_DUE",
      dedupKey: "imported-row", scheduledFor: new Date("2026-09-02T00:00:00Z"), offsetDays: 0,
      channelId: theirs.id, attemptCount: 1, nextAttemptAt: new Date("2026-09-02T08:00:00Z"), error: "offline",
    } });
    const send = vi.fn(async () => undefined);

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: false, nextAttemptAt: null, error: expect.stringContaining("channel") });
  });

  it("does not send to a channel switched off between the candidate query and the send", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    const channel = await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Feed the cat", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async () => undefined);

    const create = prisma.reminderLog.create.bind(prisma.reminderLog);
    const switchingOff = withLedger({
      create: async (args: Parameters<typeof create>[0]) => {
        await prisma.notificationChannel.update({ where: { id: channel.id }, data: { isEnabled: false } });
        return create(args);
      },
    });
    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: switchingOff, send });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: false, nextAttemptAt: null, error: expect.stringContaining("channel") });
  });

  it("cancels a queued retry whose channel is switched off, rather than holding it until the channel returns", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    const channel = await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" }, isEnabled: false } });
    const task = await prisma.task.create({ data: { ownerId: user.id, title: "Return the book", dueDate: new Date("2026-09-02T00:00:00Z") } });
    await prisma.reminderLog.create({ data: {
      ownerId: user.id, entityType: "TASK", entityId: task.id, schedulingPolicy: "INCOMPLETE_TASK_DUE",
      dedupKey: "failed-before-the-channel-was-switched-off", scheduledFor: new Date("2026-09-02T00:00:00Z"), offsetDays: 0,
      channelId: channel.id, attemptCount: 1, nextAttemptAt: new Date("2026-09-02T08:00:00Z"), error: "offline",
    } });
    const send = vi.fn(async () => undefined);

    // Off before the pass: the row must still be selected so it can be cancelled.
    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ ok: false, nextAttemptAt: null, error: expect.stringContaining("channel") });

    // Switching the channel back on does not revive it.
    await prisma.notificationChannel.update({ where: { id: channel.id }, data: { isEnabled: true } });
    await processImportantDateReminders(new Date("2026-09-02T10:00:00Z"), { db: prisma, send });
    expect(send).not.toHaveBeenCalled();
  });

  it("schedules the retry after a failure from the clock at the failure", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC", digestEnabled: false } });
    await prisma.notificationChannel.create({ data: { ownerId: user.id, kind: "WEBHOOK", name: "Test", config: { url: "https://example.invalid" } } });
    await prisma.task.create({ data: { ownerId: user.id, title: "Slow pass, failed send", dueDate: new Date("2026-09-02T00:00:00Z") } });
    const send = vi.fn(async (): Promise<void> => { throw new Error("offline"); });

    await processImportantDateReminders(new Date("2026-09-02T09:00:00Z"), {
      db: prisma, send, clock: () => new Date("2026-09-02T09:10:00Z"),
    });
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ attemptCount: 1, nextAttemptAt: new Date("2026-09-02T09:11:00Z") });

    // A second failure, reached twenty minutes into its pass, backs off from then.
    await processImportantDateReminders(new Date("2026-09-02T09:12:00Z"), {
      db: prisma, send, clock: () => new Date("2026-09-02T09:32:00Z"),
    });
    expect(await prisma.reminderLog.findFirstOrThrow()).toMatchObject({ attemptCount: 2, nextAttemptAt: new Date("2026-09-02T09:34:00Z") });
  });
});
