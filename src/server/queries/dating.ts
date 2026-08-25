import "server-only";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere, privacyScope } from "@/server/privacy/filter";
import { isTerminalStage, listTerms, pipelineOrder, type Term } from "@/server/taxonomy/queries";

/**
 * Reads for the dating module.
 *
 * The pipeline is keyed on `Contact.isRomantic`, never on whether a
 * RomanticProfile row exists. Converting someone to an ordinary friend clears
 * the flag but keeps their profile, dates and flags, so filtering on the
 * profile would drag ex-partners back into the pipeline forever.
 */

export interface PipelinePerson {
  id: string;
  firstName: string;
  lastName: string | null;
  avatarPath: string | null;
  city: string | null;
  occupation: string | null;
  lastInteractionAt: Date | null;
  stageId: string | null;
  sourceLabel: string | null;
  overallRating: number | null;
  chemistryScore: number | null;
  exclusive: boolean;
  matchedOn: Date | null;
  firstDateOn: Date | null;
  endedOn: Date | null;
  dateCount: number;
  lastDateOn: Date | null;
  greenFlags: number;
  redFlags: number;
  dealbreakers: number;
}

export interface PipelineStage {
  term: Term;
  terminal: boolean;
  people: PipelinePerson[];
}

export interface Pipeline {
  stages: PipelineStage[];
  /** Romantic contacts with no stage set yet. */
  unstaged: PipelinePerson[];
  total: number;
}

/** Per-contact aggregates, gathered in three queries rather than N per person. */
async function gatherAggregates(ownerId: string, contactIds: string[]) {
  if (contactIds.length === 0) {
    return { dates: new Map<string, { count: number; last: Date | null }>(), flags: new Map<string, { green: number; red: number; dealbreaker: number }>() };
  }

  const [dateRows, flagRows] = await Promise.all([
    prisma.dateEntry.findMany({
      where: { ownerId, contactId: { in: contactIds } },
      select: { contactId: true, interaction: { select: { occurredAt: true } } },
    }),
    prisma.flag.groupBy({
      by: ["contactId", "kind"],
      where: { ownerId, contactId: { in: contactIds } },
      _count: { _all: true },
    }),
  ]);

  const dates = new Map<string, { count: number; last: Date | null }>();
  for (const row of dateRows) {
    const current = dates.get(row.contactId) ?? { count: 0, last: null };
    current.count += 1;
    const when = row.interaction.occurredAt;
    if (!current.last || when > current.last) current.last = when;
    dates.set(row.contactId, current);
  }

  const flags = new Map<string, { green: number; red: number; dealbreaker: number }>();
  for (const row of flagRows) {
    const current = flags.get(row.contactId) ?? { green: 0, red: 0, dealbreaker: 0 };
    const count = row._count._all;
    if (row.kind === "GREEN") current.green += count;
    else if (row.kind === "RED") current.red += count;
    else current.dealbreaker += count;
    flags.set(row.contactId, current);
  }

  return { dates, flags };
}

type RomanticRow = Awaited<ReturnType<typeof fetchRomanticContacts>>[number];

async function fetchRomanticContacts(ownerId: string, includeArchived: boolean) {
  const privacy = await privacyScope();
  return prisma.contact.findMany({
    where: {
      ownerId,
      isRomantic: true,
      ...(includeArchived ? {} : { isArchived: false }),
      ...contactPrivacyWhere(privacy),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatarPath: true,
      city: true,
      occupation: true,
      lastInteractionAt: true,
      romanticProfile: { include: { source: true } },
    },
    orderBy: [{ firstName: "asc" }],
  });
}

function toPerson(
  row: RomanticRow,
  dates: Map<string, { count: number; last: Date | null }>,
  flags: Map<string, { green: number; red: number; dealbreaker: number }>,
): PipelinePerson {
  const profile = row.romanticProfile;
  const dateStats = dates.get(row.id) ?? { count: 0, last: null };
  const flagStats = flags.get(row.id) ?? { green: 0, red: 0, dealbreaker: 0 };

  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    avatarPath: row.avatarPath,
    city: row.city,
    occupation: row.occupation,
    lastInteractionAt: row.lastInteractionAt,
    stageId: profile?.stageId ?? null,
    sourceLabel: profile?.source?.label ?? null,
    overallRating: profile?.overallRating ?? null,
    chemistryScore: profile?.chemistryScore ?? null,
    exclusive: profile?.exclusive ?? false,
    matchedOn: profile?.matchedOn ?? null,
    firstDateOn: profile?.firstDateOn ?? null,
    endedOn: profile?.endedOn ?? null,
    dateCount: dateStats.count,
    lastDateOn: dateStats.last,
    greenFlags: flagStats.green,
    redFlags: flagStats.red,
    dealbreakers: flagStats.dealbreaker,
  };
}

export async function listPipeline(
  ownerId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Pipeline> {
  const [stageTerms, rows] = await Promise.all([
    listTerms(ownerId, "DATING_STAGE"),
    fetchRomanticContacts(ownerId, options.includeArchived ?? false),
  ]);

  const { dates, flags } = await gatherAggregates(ownerId, rows.map((r) => r.id));
  const people = rows.map((row) => toPerson(row, dates, flags));

  // Stage order comes from the taxonomy's own metadata, so reordering stages in
  // settings reorders the pipeline without a code change.
  const ordered = [...stageTerms].sort((a, b) => pipelineOrder(a) - pipelineOrder(b));

  const byStage = new Map<string, PipelinePerson[]>();
  const unstaged: PipelinePerson[] = [];
  for (const person of people) {
    if (!person.stageId) {
      unstaged.push(person);
      continue;
    }
    const bucket = byStage.get(person.stageId) ?? [];
    bucket.push(person);
    byStage.set(person.stageId, bucket);
  }

  return {
    stages: ordered.map((term) => ({
      term,
      terminal: isTerminalStage(term),
      people: byStage.get(term.id) ?? [],
    })),
    unstaged,
    total: people.length,
  };
}

export interface CompareRow extends PipelinePerson {
  stageLabel: string | null;
  avgRating: number | null;
  avgChemistry: number | null;
  totalSpentCents: number;
  wantsKids: string;
  distanceKm: number | null;
  relationshipStyle: string | null;
  livingSituation: string | null;
  religion: string | null;
  politics: string | null;
  mbti: string | null;
  heightCm: number | null;
  birthYear: number | null;
}

/** Everyone in the pipeline with the aggregates the compare view sorts on. */
export async function listForCompare(ownerId: string): Promise<CompareRow[]> {
  const [stageTerms, rows] = await Promise.all([
    listTerms(ownerId, "DATING_STAGE"),
    fetchRomanticContacts(ownerId, false),
  ]);
  const stageLabels = new Map(stageTerms.map((term) => [term.id, term.label]));

  const contactIds = rows.map((r) => r.id);
  const { dates, flags } = await gatherAggregates(ownerId, contactIds);

  const entries = contactIds.length
    ? await prisma.dateEntry.findMany({
        where: { ownerId, contactId: { in: contactIds } },
        select: { contactId: true, rating: true, chemistry: true, costCents: true },
      })
    : [];

  const stats = new Map<
    string,
    { ratings: number[]; chemistry: number[]; spent: number }
  >();
  for (const entry of entries) {
    const current = stats.get(entry.contactId) ?? { ratings: [], chemistry: [], spent: 0 };
    if (entry.rating !== null) current.ratings.push(entry.rating);
    if (entry.chemistry !== null) current.chemistry.push(entry.chemistry);
    current.spent += entry.costCents ?? 0;
    stats.set(entry.contactId, current);
  }

  const mean = (values: number[]): number | null =>
    values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

  return rows.map((row) => {
    const base = toPerson(row, dates, flags);
    const profile = row.romanticProfile;
    const stat = stats.get(row.id) ?? { ratings: [], chemistry: [], spent: 0 };

    return {
      ...base,
      stageLabel: base.stageId ? (stageLabels.get(base.stageId) ?? null) : null,
      avgRating: mean(stat.ratings),
      avgChemistry: mean(stat.chemistry),
      totalSpentCents: stat.spent,
      wantsKids: profile?.wantsKids ?? "UNKNOWN",
      distanceKm: profile?.distanceKm ?? null,
      relationshipStyle: profile?.relationshipStyle ?? null,
      livingSituation: profile?.livingSituation ?? null,
      religion: profile?.religion ?? null,
      politics: profile?.politics ?? null,
      mbti: profile?.mbti ?? null,
      heightCm: profile?.heightCm ?? null,
      birthYear: profile?.birthYear ?? null,
    };
  });
}

export interface DatingSummary {
  active: number;
  stageCounts: Array<{ label: string; icon: string | null; color: string | null; count: number }>;
  quiet: PipelinePerson[];
  upcoming: Array<{ id: string; title: string; occurredAt: Date; contactName: string }>;
}

/** The dashboard widget's data. */
export async function getDatingSummary(ownerId: string, quietAfterDays = 10): Promise<DatingSummary> {
  const pipeline = await listPipeline(ownerId);
  const privacy = await privacyScope();

  const activeStages = pipeline.stages.filter((stage) => !stage.terminal);
  const active = activeStages.reduce((sum, stage) => sum + stage.people.length, 0);

  const cutoff = Date.now() - quietAfterDays * 86_400_000;
  const quiet = activeStages
    .flatMap((stage) => stage.people)
    .filter((person) => !person.lastInteractionAt || person.lastInteractionAt.getTime() < cutoff)
    .sort((a, b) => (a.lastInteractionAt?.getTime() ?? 0) - (b.lastInteractionAt?.getTime() ?? 0))
    .slice(0, 5);

  const upcomingRows = await prisma.interaction.findMany({
    where: {
      ownerId,
      occurredAt: { gt: new Date() },
      dateEntry: { isNot: null },
      ...(privacy.unlocked ? {} : { isPrivate: false }),
    },
    include: {
      participants: { include: { contact: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { occurredAt: "asc" },
    take: 5,
  });

  return {
    active,
    stageCounts: activeStages
      .filter((stage) => stage.people.length > 0)
      .map((stage) => ({
        label: stage.term.label,
        icon: stage.term.icon,
        color: stage.term.color,
        count: stage.people.length,
      })),
    quiet,
    upcoming: upcomingRows.map((row) => ({
      id: row.id,
      title: row.title ?? "Date",
      occurredAt: row.occurredAt,
      contactName: row.participants[0]?.contact.firstName ?? "Someone",
    })),
  };
}

/**
 * Saved date ideas.
 *
 * `contactId` narrows to one person *plus* the ideas saved against nobody,
 * because "go to the observatory" is worth offering whoever you are looking
 * at. Omit it for the whole list.
 *
 * Ordered by status first — an enum column sorts by its declaration order,
 * which is OPEN, PLANNED, DONE, ARCHIVED, exactly the order a list of ideas
 * wants — then newest first within each.
 */
export async function listDateIdeas(
  ownerId: string,
  options: { contactId?: string; includeDone?: boolean } = {},
) {
  const scope = await privacyScope();

  return prisma.dateIdea.findMany({
    where: {
      ownerId,
      ...(options.contactId
        ? { OR: [{ contactId: options.contactId }, { contactId: null }] }
        : // A general idea has no contact to be private, so it is always visible.
          scope.unlocked
          ? {}
          : { OR: [{ contactId: null }, { contact: { isPrivate: false } }] }),
      ...(options.includeDone ? {} : { status: { in: ["OPEN", "PLANNED"] } }),
    },
    include: {
      category: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

/** Dates for one person, newest first. */
export async function listDateEntries(ownerId: string, contactId: string) {
  return prisma.dateEntry.findMany({
    where: { ownerId, contactId },
    include: {
      activityType: true,
      interaction: { select: { id: true, occurredAt: true, notes: true, sentiment: true } },
    },
    orderBy: { sequence: "desc" },
  });
}
