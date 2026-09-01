import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { processImportantDateReminders } from "@/server/services/reminders";
import { encryptSecret } from "@/server/crypto/secrets";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

describe.skipIf(!hasTestDatabase)("important-date delivery", () => {
  beforeEach(reset);
  afterAll(() => prisma.$disconnect());

  it("creates one idempotent delivery and excludes archived and locked-private contacts", async () => {
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "America/Los_Angeles", privacyLockEnabled: true } });
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

  it("does not re-send an occurrence when its channel is deleted and recreated", async () => {
    // The uniqueness key includes channelId, and deleting a channel nulls it on
    // the ledger row. A replacement therefore gets a fresh key, so nothing in
    // the constraint stops the same occurrence going out twice inside one due
    // window. The orphaned row is what proves it was already sent.
    const user = await createTestUser();
    await prisma.userPreference.create({
      data: { userId: user.id, timezone: "America/Los_Angeles" },
    });
    const first = await prisma.notificationChannel.create({
      data: { ownerId: user.id, kind: "WEBHOOK", name: "First", config: { url: "https://example.invalid" } },
    });
    const contact = await prisma.contact.create({ data: { ownerId: user.id, firstName: "Visible" } });
    await prisma.importantDate.create({
      data: {
        ownerId: user.id,
        contactId: contact.id,
        label: "Birthday",
        date: new Date("2000-08-29T00:00:00Z"),
        recurrence: "ANNUAL",
        reminderDaysBefore: [0],
      },
    });

    const now = new Date("2026-08-29T18:00:00Z");
    const send = vi.fn(async () => undefined);
    await processImportantDateReminders(now, { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);

    // Same due window: delete the channel and add another one.
    await prisma.notificationChannel.delete({ where: { id: first.id } });
    expect(await prisma.reminderLog.findFirst()).toMatchObject({ channelId: null, ok: true });
    await prisma.notificationChannel.create({
      data: { ownerId: user.id, kind: "WEBHOOK", name: "Second", config: { url: "https://example.invalid" } },
    });

    await processImportantDateReminders(now, { db: prisma, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(await prisma.reminderLog.count()).toBe(1);
  });

  it("delivers through the real sender for encrypted and legacy plaintext rows alike", async () => {
    // Two shapes exist in the wild: rows written by the settings form, which
    // store the token encrypted, and rows hand-inserted before there was one.
    // Both have to reach the network, so this drives deliverToChannel itself
    // rather than the injected fake.
    const user = await createTestUser();
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC" } });
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
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC" } });
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
    await prisma.userPreference.create({ data: { userId: user.id, timezone: "UTC" } });
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
});
