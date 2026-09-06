import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, hasTestDatabase, prisma, reset } from "./db";

/**
 * Informal calendar information, end to end through the real actions.
 *
 * The parts worth guarding are the ones a unit test cannot reach: that the
 * follow-up task is created, re-dated and stood down in step with the
 * happening, that a follow-up you already completed survives every one of
 * those, that the privacy lock withholds a private person's plans from the
 * queries as well as the writes, and that a taxonomy term belonging to someone
 * else is refused rather than rendered under a label that was never yours.
 */

const state = vi.hoisted(() => ({ ownerId: "", enabled: false, unlocked: true }));

const TZ = "America/New_York";

vi.mock("@/server/db/client", async () => {
  const { prisma: client } = await import("./db");
  return { prisma: client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/server/user/context", () => ({
  getUserContext: async () => ({ user: { id: state.ownerId }, prefs: {}, timezone: TZ }),
}));

vi.mock("@/server/privacy/lock", () => ({
  getPrivacyState: async () => ({
    pinSet: state.enabled,
    enabled: state.enabled,
    unlocked: state.unlocked,
    retryAfterSeconds: 0,
  }),
  recordProtectedReadActivity: async () => {},
  requireUnlocked: async () =>
    state.enabled && !state.unlocked
      ? { ok: false, error: "Unlock to continue." }
      : { ok: true },
}));

const {
  acknowledgeHappening,
  createHappening,
  deleteHappening,
  updateHappening,
} = await import("@/server/actions/details");
const { getHappeningsDigest, listContactHappenings } = await import(
  "@/server/queries/happenings"
);

function form(values: Record<string, string | undefined>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) data.set(key, value);
  }
  return data;
}

/** Today in the fixed test timezone, so the fixtures sit where they are meant to. */
function todayKey(offsetDays = 0): string {
  const now = new Date();
  const local = new Date(now.getTime() + offsetDays * 86_400_000);
  return local.toLocaleDateString("en-CA", { timeZone: TZ });
}

describe.skipIf(!hasTestDatabase)("happenings", () => {
  let ownerId: string;
  let strangerId: string;
  let danaId: string;
  let samId: string;

  beforeEach(async () => {
    await reset();
    const [user, stranger] = await Promise.all([createTestUser(), createTestUser()]);
    ownerId = user.id;
    strangerId = stranger.id;
    state.ownerId = user.id;
    state.enabled = false;
    state.unlocked = true;

    const [dana, sam] = await Promise.all([
      prisma.contact.create({ data: { ownerId, firstName: "Dana" } }),
      prisma.contact.create({ data: { ownerId, firstName: "Sam" } }),
    ]);
    danaId = dana.id;
    samId = sam.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const trip = (overrides: Record<string, string | undefined> = {}) =>
    form({
      contactId: danaId,
      title: "Trip to Portugal",
      date: "2026-09-12",
      datePrecision: "DAY",
      endDate: "2026-09-19",
      endDatePrecision: "DAY",
      availability: "AWAY",
      ...overrides,
    });

  // --- the record itself ---------------------------------------------------

  it("stores the whole informal record, vagueness included", async () => {
    const result = await createHappening(
      trip({
        source: "Mentioned it at dinner",
        notes: "Somewhere on the coast",
        isTentative: "true",
      }),
    );

    expect(result.ok).toBe(true);
    const row = await prisma.happening.findUniqueOrThrow({ where: { id: result.data!.id } });
    expect(row.title).toBe("Trip to Portugal");
    expect(row.source).toBe("Mentioned it at dinner");
    expect(row.availability).toBe("AWAY");
    expect(row.isTentative).toBe(true);
    expect(row.followUpTaskId).toBeNull();
  });

  it("keeps a month-precision date a month rather than inventing a day", async () => {
    const result = await createHappening(
      trip({ date: "2026-10-14", datePrecision: "MONTH", endDate: undefined }),
    );

    const row = await prisma.happening.findUniqueOrThrow({ where: { id: result.data!.id } });
    // Normalised to the start of the period it means, not the day that
    // happened to be in the picker.
    expect(row.date.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(row.precision).toBe("MONTH");
  });

  it("refuses an end before the start and writes nothing", async () => {
    const result = await createHappening(
      trip({ date: "2026-09-19", endDate: "2026-09-12" }),
    );

    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.endDate).toBeTruthy();
    expect(await prisma.happening.count({ where: { ownerId } })).toBe(0);
  });

  it("refuses an availability value that is not one of the three", async () => {
    const result = await createHappening(trip({ availability: "VANISHED" }));

    expect(result.ok).toBe(false);
    expect(await prisma.happening.count({ where: { ownerId } })).toBe(0);
  });

  it("refuses a taxonomy term of the wrong kind or another owner's", async () => {
    const [wrongKind, theirs] = await Promise.all([
      prisma.taxonomyTerm.findFirstOrThrow({ where: { ownerId, kind: "GIFT_OCCASION" } }),
      prisma.taxonomyTerm.findFirstOrThrow({
        where: { ownerId: strangerId, kind: "HAPPENING_TYPE" },
      }),
    ]);

    expect((await createHappening(trip({ typeId: wrongKind.id }))).ok).toBe(false);
    expect((await createHappening(trip({ typeId: theirs.id }))).ok).toBe(false);
    expect(await prisma.happening.count({ where: { ownerId } })).toBe(0);
  });

  // --- the follow-up task --------------------------------------------------

  it("creates the follow-up as an ordinary task, due the day after it ends", async () => {
    const result = await createHappening(trip({ followUp: "true" }));

    const row = await prisma.happening.findUniqueOrThrow({ where: { id: result.data!.id } });
    expect(row.followUpTaskId).not.toBeNull();

    const task = await prisma.task.findUniqueOrThrow({ where: { id: row.followUpTaskId! } });
    expect(task.contactId).toBe(danaId);
    expect(task.ownerId).toBe(ownerId);
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe("2026-09-20");
    expect(task.title).toContain("Trip to Portugal");
  });

  it("waits for the whole period before asking about a vague happening", async () => {
    // Asking on 2 October would be asking about a trip not yet taken.
    const result = await createHappening(
      trip({ date: "2026-10-01", datePrecision: "MONTH", endDate: undefined, followUp: "true" }),
    );

    const row = await prisma.happening.findUniqueOrThrow({ where: { id: result.data!.id } });
    const task = await prisma.task.findUniqueOrThrow({ where: { id: row.followUpTaskId! } });
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("re-dates the same task when the happening moves, rather than adding another", async () => {
    const created = await createHappening(trip({ followUp: "true" }));
    const before = await prisma.happening.findUniqueOrThrow({
      where: { id: created.data!.id },
    });

    const result = await updateHappening(
      trip({ id: created.data!.id, endDate: "2026-09-26", followUp: "true" }),
    );

    expect(result.ok).toBe(true);
    const after = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(after.followUpTaskId).toBe(before.followUpTaskId);
    expect(await prisma.task.count({ where: { ownerId } })).toBe(1);

    const task = await prisma.task.findUniqueOrThrow({ where: { id: after.followUpTaskId! } });
    expect(task.dueDate?.toISOString().slice(0, 10)).toBe("2026-09-27");
  });

  it("stands down an unfinished follow-up when the box is cleared", async () => {
    const created = await createHappening(trip({ followUp: "true" }));

    await updateHappening(trip({ id: created.data!.id }));

    const row = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(row.followUpTaskId).toBeNull();
    expect(await prisma.task.count({ where: { ownerId } })).toBe(0);
  });

  it("keeps a follow-up you already did, however the happening changes", async () => {
    // Asking how the trip went is a thing that happened. A status change on the
    // happening has no business destroying that record.
    const created = await createHappening(trip({ followUp: "true" }));
    const row = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });
    await prisma.task.update({
      where: { id: row.followUpTaskId! },
      data: { completedAt: new Date() },
    });

    await updateHappening(trip({ id: created.data!.id }));
    expect(await prisma.task.count({ where: { ownerId } })).toBe(1);

    await deleteHappening(created.data!.id);
    const survivor = await prisma.task.findFirstOrThrow({ where: { ownerId } });
    expect(survivor.completedAt).not.toBeNull();
  });

  it("takes an unfinished follow-up with the happening when it is deleted", async () => {
    const created = await createHappening(trip({ followUp: "true" }));

    expect((await deleteHappening(created.data!.id)).ok).toBe(true);
    expect(await prisma.happening.count({ where: { ownerId } })).toBe(0);
    expect(await prisma.task.count({ where: { ownerId } })).toBe(0);
  });

  it("survives its follow-up task being deleted by hand", async () => {
    const created = await createHappening(trip({ followUp: "true" }));
    const row = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });

    await prisma.task.delete({ where: { id: row.followUpTaskId! } });

    const after = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(after.followUpTaskId).toBeNull();
    expect(after.title).toBe("Trip to Portugal");
  });

  // --- acknowledging -------------------------------------------------------

  it("acknowledges without destroying anything", async () => {
    const created = await createHappening(trip());

    expect((await acknowledgeHappening(created.data!.id)).ok).toBe(true);

    const row = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(row.acknowledgedAt).not.toBeNull();
    expect(row.title).toBe("Trip to Portugal");
  });

  // --- ownership and the lock ----------------------------------------------

  it("refuses to touch another account's happening", async () => {
    const theirContact = await prisma.contact.create({
      data: { ownerId: strangerId, firstName: "Nobody" },
    });
    const theirs = await prisma.happening.create({
      data: {
        ownerId: strangerId,
        contactId: theirContact.id,
        title: "Their trip",
        date: new Date("2026-09-12T00:00:00Z"),
      },
    });

    expect((await updateHappening(trip({ id: theirs.id }))).error).toBe("Not found.");
    expect((await deleteHappening(theirs.id)).error).toBe("Not found.");
    expect((await acknowledgeHappening(theirs.id)).error).toBe("Not found.");
    expect(await prisma.happening.count({ where: { ownerId: strangerId } })).toBe(1);
  });

  it("will not attach a happening to a contact hidden by the lock", async () => {
    await prisma.contact.update({ where: { id: danaId }, data: { isPrivate: true } });
    state.enabled = true;
    state.unlocked = false;

    // An id remembered from an unlocked session is not permission to write.
    const result = await createHappening(trip());
    expect(result.ok).toBe(false);
    expect(await prisma.happening.count({ where: { ownerId } })).toBe(0);
  });

  it("withholds a private person's plans from the reads while locked", async () => {
    const mine = await createHappening(trip({ contactId: samId, followUp: undefined }));
    const hidden = await createHappening(trip({ contactId: danaId }));
    expect(mine.ok && hidden.ok).toBe(true);

    await prisma.contact.update({ where: { id: danaId }, data: { isPrivate: true } });
    state.enabled = true;
    state.unlocked = false;

    // Filtered in the query: a server component would otherwise have serialised
    // the row into the payload before deciding not to render it.
    expect(await listContactHappenings(ownerId, danaId, TZ)).toEqual([]);
    const locked = await getHappeningsDigest(ownerId, TZ, {
      windowDays: 3650,
      lookBackDays: 3650,
      limit: 20,
    });
    expect([...locked.ahead, ...locked.justEnded].map((row) => row.contactId)).not.toContain(
      danaId,
    );

    state.unlocked = true;
    expect(await listContactHappenings(ownerId, danaId, TZ)).toHaveLength(1);
  });

  // --- the dashboard digest ------------------------------------------------

  it("separates what is ahead from what wants asking about", async () => {
    const ahead = await createHappening(
      trip({ title: "Sam's exams", contactId: samId, date: todayKey(3), endDate: todayKey(6) }),
    );
    const ongoing = await createHappening(
      trip({ title: "Visitors staying", date: todayKey(-1), endDate: todayKey(1) }),
    );
    const ended = await createHappening(
      trip({ title: "Conference", date: todayKey(-5), endDate: todayKey(-2) }),
    );
    const longGone = await createHappening(
      trip({ title: "Last year's move", date: todayKey(-400), endDate: todayKey(-390) }),
    );
    expect([ahead, ongoing, ended, longGone].every((row) => row.ok)).toBe(true);

    const digest = await getHappeningsDigest(ownerId, TZ, {
      windowDays: 21,
      lookBackDays: 14,
      limit: 8,
    });

    expect(digest.ahead.map((row) => row.title)).toEqual(["Visitors staying", "Sam's exams"]);
    expect(digest.justEnded.map((row) => row.title)).toEqual(["Conference"]);
  });

  it("drops a finished happening from the follow-up list once acknowledged", async () => {
    const ended = await createHappening(
      trip({ title: "Conference", date: todayKey(-5), endDate: todayKey(-2) }),
    );

    await acknowledgeHappening(ended.data!.id);

    const digest = await getHappeningsDigest(ownerId, TZ, {
      windowDays: 21,
      lookBackDays: 14,
      limit: 8,
    });
    expect(digest.justEnded).toEqual([]);
  });

  it("keeps a long happening that is still running in the ahead list", async () => {
    // Its start is over a year outside the look-back window, but it has not
    // finished.
    // Bounding the query on the start date alone dropped exactly this row —
    // the sabbatical that answers "are they even around at the moment?".
    const created = await createHappening(
      trip({ title: "Sabbatical", date: todayKey(-500), endDate: todayKey(40) }),
    );
    expect(created.ok).toBe(true);

    const digest = await getHappeningsDigest(ownerId, TZ, {
      windowDays: 21,
      lookBackDays: 14,
      limit: 8,
    });

    expect(digest.ahead.map((row) => row.title)).toContain("Sabbatical");
    expect(digest.ahead.find((row) => row.title === "Sabbatical")?.phase).toBe("ongoing");
  });

  it("asks again about a dismissed happening once it is moved to new dates", async () => {
    const created = await createHappening(
      trip({ title: "Conference", date: todayKey(-5), endDate: todayKey(-2) }),
    );
    await acknowledgeHappening(created.data!.id);

    // Moved later, so it has not happened yet — and the prompt has to come back
    // when it does, rather than staying dismissed for ever.
    await updateHappening(
      trip({ id: created.data!.id, title: "Conference", date: todayKey(-3), endDate: todayKey(-1) }),
    );

    const row = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(row.acknowledgedAt).toBeNull();

    const digest = await getHappeningsDigest(ownerId, TZ, {
      windowDays: 21,
      lookBackDays: 14,
      limit: 8,
    });
    expect(digest.justEnded.map((r) => r.title)).toContain("Conference");
  });

  it("leaves a dismissal alone when only the wording is corrected", async () => {
    const created = await createHappening(
      trip({ title: "Conference", date: todayKey(-5), endDate: todayKey(-2) }),
    );
    await acknowledgeHappening(created.data!.id);

    await updateHappening(
      trip({
        id: created.data!.id,
        title: "Conference in Lisbon",
        date: todayKey(-5),
        endDate: todayKey(-2),
      }),
    );

    const row = await prisma.happening.findUniqueOrThrow({ where: { id: created.data!.id } });
    expect(row.acknowledgedAt).not.toBeNull();
    expect(row.title).toBe("Conference in Lisbon");
  });

  it("keeps a vague happening in the digest for the period it could mean", async () => {
    // Stored as the 1st of this month; a comparison against the anchor alone
    // would call it over as soon as the 2nd came round.
    const [year, month] = todayKey().split("-");
    const created = await createHappening(
      trip({
        title: "Somewhere this month",
        date: `${year}-${month}-01`,
        datePrecision: "MONTH",
        endDate: undefined,
      }),
    );
    expect(created.ok).toBe(true);

    const digest = await getHappeningsDigest(ownerId, TZ, {
      windowDays: 21,
      lookBackDays: 14,
      limit: 8,
    });
    expect(digest.ahead.map((row) => row.title)).toContain("Somewhere this month");
  });

  it("orders one person's list soonest first and marks where each one sits", async () => {
    await createHappening(trip({ title: "Later", date: todayKey(10), endDate: todayKey(12) }));
    await createHappening(trip({ title: "Now", date: todayKey(-1), endDate: todayKey(1) }));
    await createHappening(trip({ title: "Over", date: todayKey(-9), endDate: todayKey(-8) }));

    const rows = await listContactHappenings(ownerId, danaId, TZ);

    expect(rows.map((row) => row.title)).toEqual(["Over", "Now", "Later"]);
    expect(rows.map((row) => row.phase)).toEqual(["ended", "ongoing", "upcoming"]);
  });
});
