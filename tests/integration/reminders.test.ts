import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processImportantDateReminders } from "@/server/services/reminders";
import { encryptSecret } from "@/server/crypto/secrets";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

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
});
