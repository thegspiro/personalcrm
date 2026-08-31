/**
 * Demo content for local development and end-to-end tests.
 * Opt in with SEED_DEMO=1. Refuses to run if any contacts already exist.
 */
import type { PrismaClient, Prisma, TaxonomyKind } from "@prisma/client";
import bcrypt from "bcryptjs";
import { provisionTaxonomies } from "../src/server/taxonomy/provision";
import { defaultDashboardLayout } from "../src/lib/dashboard";
import { computeNextTouchAt } from "../src/lib/cadence";

const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? "demo@example.com";
const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "demo-password-123";
const TZ = "America/New_York";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function dateOnly(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  const existingContacts = await prisma.contact.count();
  if (existingContacts > 0) {
    console.log("  demo skipped — contacts already exist");
    return;
  }

  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: DEMO_EMAIL,
          name: "Demo User",
          passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
          role: "ADMIN",
        },
      });
      await tx.userPreference.create({ data: { userId: created.id, timezone: TZ } });
      await tx.dashboardLayout.create({
        data: { userId: created.id, widgets: defaultDashboardLayout() as never },
      });
      await provisionTaxonomies(tx, created.id);
      return created;
    });
    console.log(`  created demo account ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  }

  const ownerId = user.id;
  const terms = await prisma.taxonomyTerm.findMany({ where: { ownerId } });
  const term = (kind: TaxonomyKind, slug: string): string => {
    const found = terms.find((t) => t.kind === kind && t.slug === slug);
    if (!found) throw new Error(`missing taxonomy term ${kind}:${slug}`);
    return found.id;
  };

  interface DemoContact {
    firstName: string;
    lastName: string;
    category: string;
    cadenceDays: number | null;
    lastDaysAgo: number | null;
    birth?: [number, number, number];
    occupation?: string;
    city?: string;
    howWeMet?: string;
    meetingSource?: string;
    favorite?: boolean;
  }

  const people: DemoContact[] = [
    { firstName: "Sarah", lastName: "Whitfield", category: "close-friend", cadenceDays: 14, lastDaysAgo: 26, birth: [1991, 6, 5], occupation: "Pediatric nurse", city: "Arlington", howWeMet: "Roommates our sophomore year of college.", meetingSource: "school", favorite: true },
    { firstName: "Marcus", lastName: "Bell", category: "close-friend", cadenceDays: 30, lastDaysAgo: 5, birth: [1989, 11, 22], occupation: "Structural engineer", city: "Falls Church", howWeMet: "Pickup basketball at the rec center.", meetingSource: "gym" },
    { firstName: "Priya", lastName: "Raman", category: "colleague", cadenceDays: 60, lastDaysAgo: 71, birth: [1993, 3, 14], occupation: "Product manager", city: "Reston", howWeMet: "She onboarded me on my first day.", meetingSource: "work" },
    { firstName: "Dad", lastName: "", category: "family", cadenceDays: 7, lastDaysAgo: 9, birth: [1961, 4, 2], city: "Richmond", favorite: true },
    { firstName: "Mom", lastName: "", category: "family", cadenceDays: 7, lastDaysAgo: 2, birth: [1963, 8, 19], city: "Richmond", favorite: true },
    { firstName: "Jenna", lastName: "Okoye", category: "friend", cadenceDays: 45, lastDaysAgo: 12, birth: [1990, 1, 30], occupation: "Graphic designer", city: "Washington", howWeMet: "Through Marcus at his birthday thing.", meetingSource: "mutual-friend" },
    { firstName: "Tom", lastName: "Hargrove", category: "neighbor", cadenceDays: 90, lastDaysAgo: 140, occupation: "Retired", city: "Falls Church", howWeMet: "He lent me a ladder the week I moved in.", meetingSource: "neighborhood" },
    { firstName: "Dr. Alice", lastName: "Nakamura", category: "professional", cadenceDays: null, lastDaysAgo: 200, occupation: "Dentist", city: "Arlington" },
    { firstName: "Devon", lastName: "Price", category: "friend", cadenceDays: 30, lastDaysAgo: 33, birth: [1992, 9, 8], occupation: "Bartender", city: "Washington", howWeMet: "Trivia night regulars.", meetingSource: "event" },
    // Extended family, so /family has more than one generation to band and the
    // suggestion engine has something real to infer from.
    { firstName: "Walter", lastName: "", category: "family", cadenceDays: 30, lastDaysAgo: 40, birth: [1936, 2, 11], occupation: "Retired machinist", city: "Richmond" },
    { firstName: "Ruth", lastName: "", category: "family", cadenceDays: 21, lastDaysAgo: 18, birth: [1939, 10, 4], city: "Richmond", favorite: true },
    { firstName: "Ray", lastName: "", category: "family", cadenceDays: 60, lastDaysAgo: 64, birth: [1958, 7, 30], occupation: "Long-haul driver", city: "Roanoke" },
    { firstName: "Kayla", lastName: "", category: "family", cadenceDays: 45, lastDaysAgo: 51, birth: [1995, 3, 22], occupation: "Physical therapist", city: "Roanoke" },
  ];

  const romantics: Array<
    DemoContact & { stage: string; source: string; matchedDaysAgo: number; rating?: number; chemistry?: number }
  > = [
    { firstName: "Elena", lastName: "Vasquez", category: "romantic", cadenceDays: 3, lastDaysAgo: 1, birth: [1994, 5, 17], occupation: "Veterinarian", city: "Alexandria", stage: "dating", source: "hinge", matchedDaysAgo: 54, rating: 5, chemistry: 5, howWeMet: "Matched on Hinge — she opened with a joke about my bookshelf photo." },
    { firstName: "Nadia", lastName: "Fournier", category: "romantic", cadenceDays: 5, lastDaysAgo: 8, birth: [1992, 12, 3], occupation: "Policy analyst", city: "Washington", stage: "talking", source: "bumble", matchedDaysAgo: 11, rating: 3, chemistry: 3, howWeMet: "Bumble match, still mostly texting." },
    { firstName: "Claire", lastName: "Dunn", category: "romantic", cadenceDays: null, lastDaysAgo: 96, birth: [1990, 7, 25], occupation: "Architect", city: "Bethesda", stage: "ended", source: "mutual-friend", matchedDaysAgo: 210, rating: 2, chemistry: 2, howWeMet: "Set up by Jenna. Nice, but no spark." },
  ];

  const contactIds = new Map<string, string>();

  type RomanticSeed = (typeof romantics)[number];
  const isRomanticSeed = (c: DemoContact | RomanticSeed): c is RomanticSeed => "stage" in c;

  const allPeople: Array<DemoContact | RomanticSeed> = [...people, ...romantics];
  for (const [index, p] of allPeople.entries()) {
    const isRomantic = isRomanticSeed(p);
    const lastInteractionAt = p.lastDaysAgo === null ? null : daysAgo(p.lastDaysAgo);
    const createdAt = daysAgo(240 - index * 5);

    const contact = await prisma.contact.create({
      data: {
        ownerId,
        firstName: p.firstName,
        lastName: p.lastName || null,
        categoryId: term("CONTACT_CATEGORY", p.category),
        occupation: p.occupation ?? null,
        city: p.city ?? null,
        timezone: TZ,
        howWeMet: p.howWeMet ?? null,
        meetingSourceId: p.meetingSource
          ? term("MEETING_SOURCE", p.meetingSource)
          : isRomanticSeed(p)
            ? term("MEETING_SOURCE", p.source)
            : null,
        birthDate: p.birth ? dateOnly(...p.birth) : null,
        isFavorite: p.favorite ?? false,
        isRomantic,
        cadenceDays: p.cadenceDays,
        lastInteractionAt,
        nextTouchAt: computeNextTouchAt({
          cadenceDays: p.cadenceDays,
          lastInteractionAt,
          snoozedUntil: null,
          createdAt,
        }),
        createdAt,
      },
    });
    contactIds.set(p.firstName, contact.id);

    if (isRomanticSeed(p)) {
      const r = p;
      await prisma.romanticProfile.create({
        data: {
          ownerId,
          contactId: contact.id,
          stageId: term("DATING_STAGE", r.stage),
          sourceId: term("MEETING_SOURCE", r.source),
          matchedOn: dateOnly(
            new Date(daysAgo(r.matchedDaysAgo)).getUTCFullYear(),
            new Date(daysAgo(r.matchedDaysAgo)).getUTCMonth() + 1,
            new Date(daysAgo(r.matchedDaysAgo)).getUTCDate(),
          ),
          birthYear: r.birth?.[0] ?? null,
          overallRating: r.rating ?? null,
          chemistryScore: r.chemistry ?? null,
          exclusive: r.stage === "exclusive",
          wantsKids: r.stage === "dating" ? "OPEN" : "UNKNOWN",
        },
      });
    }
  }

  // ---- Interactions -------------------------------------------------------
  const interactionSeeds: Array<{
    person: string;
    type: string;
    daysAgo: number;
    title: string;
    notes?: string;
    sentiment?: number;
    reachedOutBy?: "ME" | "THEM" | "MUTUAL";
  }> = [
    { person: "Mom", type: "call", daysAgo: 2, title: "Sunday catch-up", notes: "Garden is taking over the back fence. Dad's knee is better.", sentiment: 1, reachedOutBy: "THEM" },
    { person: "Marcus", type: "drinks", daysAgo: 5, title: "Beers at Dogwood", notes: "He's interviewing at a firm in Ballston. Nervous but excited.", sentiment: 2, reachedOutBy: "ME" },
    { person: "Dad", type: "call", daysAgo: 9, title: "Checked in about the car", sentiment: 1, reachedOutBy: "ME" },
    { person: "Jenna", type: "coffee", daysAgo: 12, title: "Coffee downtown", notes: "Showed me the rebrand work. Asked about hiking in the fall.", sentiment: 1, reachedOutBy: "THEM" },
    { person: "Sarah", type: "text", daysAgo: 26, title: "Long text thread", notes: "She's stressed about night shifts.", sentiment: 0, reachedOutBy: "ME" },
    { person: "Devon", type: "event", daysAgo: 33, title: "Trivia night", sentiment: 1, reachedOutBy: "MUTUAL" },
    { person: "Priya", type: "meal", daysAgo: 71, title: "Lunch after the offsite", sentiment: 1 },
    { person: "Tom", type: "ran-into", daysAgo: 140, title: "Chatted in the driveway", sentiment: 0 },
  ];

  for (const s of interactionSeeds) {
    const contactId = contactIds.get(s.person);
    if (!contactId) continue;
    await prisma.interaction.create({
      data: {
        ownerId,
        typeId: term("INTERACTION_TYPE", s.type),
        occurredAt: daysAgo(s.daysAgo),
        title: s.title,
        notes: s.notes ?? null,
        sentiment: s.sentiment ?? null,
        reachedOutBy: s.reachedOutBy ?? "UNSPECIFIED",
        participants: { create: [{ contactId }] },
      },
    });
  }

  // ---- Dates with Elena and Nadia ----------------------------------------
  const dateSeeds: Array<{
    person: string;
    daysAgo: number;
    activity: string;
    venue: string;
    rating: number;
    chemistry: number;
    whoPaid: "ME" | "THEM" | "SPLIT";
    costCents?: number;
    notes: string;
  }> = [
    { person: "Elena", daysAgo: 47, activity: "coffee", venue: "Northside Social", rating: 4, chemistry: 4, whoPaid: "ME", costCents: 1400, notes: "Two hours, felt like twenty minutes. She's very direct, which I liked." },
    { person: "Elena", daysAgo: 33, activity: "dinner", venue: "Thip Khao", rating: 5, chemistry: 5, whoPaid: "SPLIT", costCents: 9200, notes: "Told me about the clinic she wants to open. Walked to the metro the long way." },
    { person: "Elena", daysAgo: 18, activity: "walk", venue: "Theodore Roosevelt Island", rating: 5, chemistry: 5, whoPaid: "SPLIT", notes: "Easy, no phones the whole time." },
    { person: "Elena", daysAgo: 1, activity: "at-home", venue: "Her place", rating: 5, chemistry: 5, whoPaid: "THEM", notes: "She cooked. Met the cat, who hates me." },
    { person: "Nadia", daysAgo: 8, activity: "drinks", venue: "Left Door", rating: 3, chemistry: 3, whoPaid: "ME", costCents: 4600, notes: "Good conversation but a lot of work-talk. Unclear read." },
    { person: "Claire", daysAgo: 180, activity: "dinner", venue: "Rasika", rating: 2, chemistry: 2, whoPaid: "SPLIT", costCents: 12000, notes: "Pleasant, no spark. Both knew it." },
  ];

  const sequenceByPerson = new Map<string, number>();
  for (const d of [...dateSeeds].reverse().reverse()) {
    const contactId = contactIds.get(d.person);
    if (!contactId) continue;
    const seq = (sequenceByPerson.get(d.person) ?? 0) + 1;
    sequenceByPerson.set(d.person, seq);

    const interaction = await prisma.interaction.create({
      data: {
        ownerId,
        typeId: term("INTERACTION_TYPE", "date"),
        occurredAt: daysAgo(d.daysAgo),
        title: `Date ${seq} — ${d.venue}`,
        notes: d.notes,
        sentiment: d.rating >= 4 ? 2 : d.rating >= 3 ? 1 : 0,
        location: d.venue,
        participants: { create: [{ contactId }] },
      },
    });

    await prisma.dateEntry.create({
      data: {
        ownerId,
        contactId,
        interactionId: interaction.id,
        sequence: seq,
        activityTypeId: term("DATE_ACTIVITY_TYPE", d.activity),
        venue: d.venue,
        whoPaid: d.whoPaid,
        costCents: d.costCents ?? null,
        rating: d.rating,
        chemistry: d.chemistry,
        notes: d.notes,
      },
    });
  }

  // ---- Plans: things to do -------------------------------------------------
  const planSeeds: Array<{
    person: string | null;
    title: string;
    category: string;
    location?: string;
    city?: string;
    url?: string;
    costCents?: number;
    plannedInDays?: number;
    notes?: string;
  }> = [
    { person: "Elena", title: "Cherry blossoms at dawn", category: "outdoors", location: "Tidal Basin", city: "Washington", plannedInDays: 6, notes: "Before the crowds — she said 6am or not at all." },
    { person: "Elena", title: "Late showing at the Alamo", category: "movie", location: "Alamo Drafthouse", city: "Arlington", costCents: 4400 },
    { person: "Nadia", title: "Rooftop at the Wharf", category: "bar-cafe", location: "Whiskey Charlie", city: "Washington", costCents: 6000, notes: "Go early, no reservations after seven." },
    { person: "Devon", title: "Monday night pottery class", category: "class", location: "Del Ray Artisans", city: "Alexandria", costCents: 5500, notes: "Only works early week — they close the bar Thursdays." },
    { person: "Marcus", title: "Hike Old Rag before it gets hot", category: "outdoors", location: "Old Rag Mountain", city: "Sperryville", notes: "Start at six or fight for parking." },
    { person: "Jenna", title: "The Tana French adaptation", category: "movie", location: "AFI Silver", city: "Silver Spring", costCents: 2800 },
    { person: "Dad", title: "Cars & Coffee at the airfield", category: "event", location: "Manassas Regional", city: "Manassas", plannedInDays: 12 },
    { person: null, title: "Renwick Gallery, whatever is up", category: "museum", location: "Renwick Gallery", city: "Washington" },
    { person: null, title: "Kayak the Potomac from Key Bridge", category: "outdoors", location: "Key Bridge Boathouse", city: "Arlington", costCents: 3200 },
    { person: null, title: "That Georgian place everyone keeps mentioning", category: "restaurant", location: "Supra", city: "Washington" },
  ];
  for (const plan of planSeeds) {
    await prisma.plan.create({
      data: {
        ownerId,
        contactId: plan.person ? contactIds.get(plan.person) ?? null : null,
        title: plan.title,
        categoryId: term("PLAN_CATEGORY", plan.category),
        location: plan.location ?? null,
        address: plan.city ?? null,
        url: plan.url ?? null,
        estimatedCostCents: plan.costCents ?? null,
        notes: plan.notes ?? null,
        status: plan.plannedInDays === undefined ? "OPEN" : "PLANNED",
        plannedFor:
          plan.plannedInDays === undefined
            ? null
            : new Date(Date.now() + plan.plannedInDays * 86_400_000),
      },
    });
  }

  // ---- Facts, ideas, tasks, gifts, flags, relationships -------------------
  const factSeeds: Array<[string, string, string, number]> = [
    ["Sarah", "work", "Works nights at Virginia Hospital Center, pediatric ward.", 1],
    ["Sarah", "hobby", "Been learning bread baking. Obsessed with sourdough starter.", 1],
    ["Marcus", "family", "Younger sister Dana lives in Denver, they're close.", 1],
    ["Marcus", "goal", "Wants to be out of consulting within two years.", 2],
    ["Priya", "preference", "Prefers Slack over email, always.", 1],
    ["Mom", "health", "Cardiologist follow-up every March.", 2],
    ["Dad", "hobby", "Restoring a '72 BMW 2002. Ask about the carburetor saga.", 1],
    ["Jenna", "media", "Loves anything Tana French. Recommend her the new one.", 1],
    ["Elena", "pet", "Cat named Miso, 11 years old, deeply unfriendly.", 1],
    ["Elena", "family", "Two older brothers, both in Texas. Very close to her mom.", 1],
    ["Devon", "logistics", "Works Thursday through Sunday nights — only free early week.", 2],
  ];
  for (const [person, category, content, importance] of factSeeds) {
    const contactId = contactIds.get(person);
    if (!contactId) continue;
    await prisma.fact.create({
      data: { ownerId, contactId, categoryId: term("FACT_CATEGORY", category), content, importance },
    });
  }

  const ideaSeeds: Array<[string | null, string]> = [
    ["Sarah", "Ask how the sourdough starter survived the move."],
    ["Marcus", "Follow up on the Ballston interview."],
    ["Priya", "She mentioned a book on pricing — ask for the title."],
    ["Elena", "She mentioned wanting to see the cherry blossoms early, before crowds."],
    ["Dad", "Ask whether the carburetor rebuild actually fixed the stall."],
    [null, "Plan a group dinner in the fall — Marcus, Jenna, Devon."],
  ];
  for (const [person, content] of ideaSeeds) {
    await prisma.idea.create({
      data: { ownerId, contactId: person ? contactIds.get(person) ?? null : null, content },
    });
  }

  const taskSeeds: Array<[string | null, string, number | null, "LOW" | "NORMAL" | "HIGH"]> = [
    ["Sarah", "Send her the bakery recommendation", 3, "NORMAL"],
    ["Tom", "Return the ladder, finally", -12, "HIGH"],
    ["Mom", "Book flights for Thanksgiving", 21, "HIGH"],
    ["Elena", "Look up that vegetarian place in Del Ray", 5, "NORMAL"],
    [null, "Back up the CRM database", 1, "LOW"],
  ];
  for (const [person, title, dueInDays, priority] of taskSeeds) {
    const due = dueInDays === null ? null : new Date(Date.now() + dueInDays * 86_400_000);
    await prisma.task.create({
      data: {
        ownerId,
        contactId: person ? contactIds.get(person) ?? null : null,
        title,
        priority,
        dueDate: due ? dateOnly(due.getUTCFullYear(), due.getUTCMonth() + 1, due.getUTCDate()) : null,
      },
    });
  }

  await prisma.dietaryNeed.createMany({
    data: [
      { ownerId, contactId: contactIds.get("Marcus")!, kind: "ALLERGY", allergyCategory: "FOOD", label: "Shellfish", notes: "Carries a pen. Ask before anywhere with a raw bar.", carriesEpinephrine: true },
      { ownerId, contactId: contactIds.get("Sarah")!, kind: "ALLERGY", allergyCategory: "MEDICATION", label: "Penicillin", notes: "Confirm alternatives with her clinician." },
      { ownerId, contactId: contactIds.get("Priya")!, kind: "ALLERGY", allergyCategory: "ENVIRONMENTAL", label: "Pollen" },
      { ownerId, contactId: contactIds.get("Sarah")!, kind: "INTOLERANCE", label: "Dairy", notes: "Fine with hard cheese, not with cream." },
      { ownerId, contactId: contactIds.get("Priya")!, kind: "PREFERENCE", label: "Vegetarian" },
      { ownerId, contactId: contactIds.get("Mom")!, kind: "MEDICAL", label: "Low sodium", notes: "Blood pressure — since the spring." },
      { ownerId, contactId: contactIds.get("Elena")!, kind: "PREFERENCE", label: "Vegetarian", notes: "Eats fish occasionally." },
    ] as Prisma.DietaryNeedCreateManyInput[],
  });

  await prisma.debt.createMany({
    data: [
      { ownerId, contactId: contactIds.get("Marcus")!, direction: "THEY_OWE_ME", description: "Covered his half of the tab", amountCents: 4200, incurredOn: dateOnly(2026, 7, 18) },
      { ownerId, contactId: contactIds.get("Marcus")!, direction: "I_OWE_THEM", description: "He got the concert tickets", amountCents: 9000, incurredOn: dateOnly(2026, 8, 2) },
      // No sum: the case a money-only model would have missed entirely.
      { ownerId, contactId: contactIds.get("Tom")!, direction: "THEY_OWE_ME", description: "My cordless drill", incurredOn: dateOnly(2026, 5, 9) },
      { ownerId, contactId: contactIds.get("Jenna")!, direction: "THEY_OWE_ME", description: "Spotted her for the deposit", amountCents: 15000, incurredOn: dateOnly(2026, 3, 1), settledOn: dateOnly(2026, 4, 12) },
    ] as Prisma.DebtCreateManyInput[],
  });

  await prisma.gift.createMany({
    data: [
      { ownerId, contactId: contactIds.get("Sarah")!, name: "Banneton proofing basket set", url: "https://example.com/banneton", priceCents: 3200, occasionId: term("GIFT_OCCASION", "birthday"), status: "IDEA" },
      { ownerId, contactId: contactIds.get("Dad")!, name: "Shop light for the garage", priceCents: 8900, occasionId: term("GIFT_OCCASION", "holiday"), status: "PURCHASED" },
      { ownerId, contactId: contactIds.get("Mom")!, name: "Framed print of the old house", occasionId: term("GIFT_OCCASION", "birthday"), status: "GIVEN", occurredOn: dateOnly(2025, 8, 19), rating: 5 },
    ] as Prisma.GiftCreateManyInput[],
  });

  await prisma.flag.createMany({
    data: [
      { ownerId, contactId: contactIds.get("Elena")!, kind: "GREEN", text: "Says what she means without being unkind.", severity: 3 },
      { ownerId, contactId: contactIds.get("Elena")!, kind: "GREEN", text: "Close with her family and it seems healthy.", severity: 2 },
      { ownerId, contactId: contactIds.get("Elena")!, kind: "RED", text: "Very tied to her work schedule — hard to plan ahead.", severity: 1 },
      { ownerId, contactId: contactIds.get("Nadia")!, kind: "RED", text: "Cancelled twice with short notice.", severity: 2 },
      { ownerId, contactId: contactIds.get("Claire")!, kind: "DEALBREAKER", text: "Wants to move back to the west coast within a year.", severity: 3 },
    ] as Prisma.FlagCreateManyInput[],
  });

  // Relationships (both directions, sharing a pairId).
  const relSeeds: Array<[string, string, string]> = [
    ["Mom", "Dad", "spouse"],
    ["Dad", "Marcus", "friend"],
    ["Jenna", "Marcus", "friend"],
    // Deliberately partial: Dad's side is recorded, Mom's in-law links and
    // Dad's niece are not, so the suggestion cards have work to do.
    ["Dad", "Walter", "parent"],
    ["Dad", "Ruth", "parent"],
    ["Dad", "Ray", "sibling"],
    ["Kayla", "Ray", "parent"],
  ];
  for (const [from, to, slug] of relSeeds) {
    const fromId = contactIds.get(from);
    const toId = contactIds.get(to);
    if (!fromId || !toId) continue;
    const typeTerm = terms.find((t) => t.kind === "RELATIONSHIP_TYPE" && t.slug === slug)!;
    const inverseId = typeTerm.inverseTermId ?? typeTerm.id;
    const pairId = Math.random().toString(36).slice(2, 14);
    await prisma.relationship.createMany({
      data: [
        { ownerId, fromContactId: fromId, toContactId: toId, typeId: typeTerm.id, pairId },
        { ownerId, fromContactId: toId, toContactId: fromId, typeId: inverseId, pairId },
      ],
    });
  }

  // ---- Households -------------------------------------------------------
  const householdSeeds: Array<[string, string | null, Array<[string, string | null]>]> = [
    ["Mom and Dad's place", "Sunday lunch, most weeks.", [["Mom", null], ["Dad", null]]],
    ["Richmond grandparents", null, [["Ruth", "Gran"], ["Walter", "Grandad"]]],
    ["Ray's house", null, [["Ray", null], ["Kayla", null]]],
  ];
  for (const [name, notes, members] of householdSeeds) {
    const rows = members
      .map(([who, role], index) => ({ contactId: contactIds.get(who), role, sortOrder: index }))
      .filter((row): row is { contactId: string; role: string | null; sortOrder: number } =>
        Boolean(row.contactId),
      );
    if (rows.length === 0) continue;
    await prisma.household.create({
      data: { ownerId, name, notes, members: { create: rows } },
    });
  }

// ---- Life events (deliberately at mixed precision) ----------------------
  const lifeEventSeeds: Array<[string, string, string, string, "DAY" | "MONTH" | "YEAR", string?]> = [
    ["Sarah", "new-job", "Started at Virginia Hospital Center", "2021-09-01", "MONTH"],
    ["Sarah", "moved", "Moved to Arlington", "2019-01-01", "YEAR", "Left the Richmond place after the split."],
    ["Marcus", "graduated", "Finished his masters", "2018-05-19", "DAY"],
    ["Marcus", "moved", "Bought the Falls Church house", "2022-03-01", "MONTH"],
    ["Priya", "promotion", "Made senior PM", "2024-01-01", "YEAR"],
    ["Jenna", "started-business", "Went freelance", "2023-06-01", "MONTH", "Left the agency after six years."],
    ["Dad", "retired", "Retired from the county", "2020-01-01", "YEAR"],
    ["Elena", "new-job", "Joined the Alexandria practice", "2023-11-01", "MONTH"],
    ["Elena", "new-pet", "Adopted Miso", "2015-01-01", "YEAR", "Eleven years old and still hates everyone."],
    ["Devon", "moved", "Moved to Petworth", "2024-08-01", "MONTH"],
  ];

  for (const [person, type, title, dateKey, precision, description] of lifeEventSeeds) {
    const contactId = contactIds.get(person);
    if (!contactId) continue;
    const [year, month, day] = dateKey.split("-").map(Number);
    await prisma.lifeEvent.create({
      data: {
        ownerId,
        contactId,
        typeId: term("LIFE_EVENT_TYPE", type),
        title,
        description: description ?? null,
        date: dateOnly(year, month, day),
        precision,
      },
    });
  }

// ---- Dating detail: ratings, notes, and one ended relationship ---------
  const romanticDetail: Record<string, {
    notes: string;
    wantsKids: "UNKNOWN" | "WANTS" | "DOES_NOT_WANT" | "OPEN" | "HAS_AND_DONE";
    style?: string;
    living?: string;
    distanceKm?: number;
    religion?: string;
    politics?: string;
    drinking?: string;
    mbti?: string;
    endedReason?: string;
    retrospective?: string;
  }> = {
    Elena: {
      notes: "Easiest person to be quiet around that I've met in years. Slightly worried I'm the one doing all the planning.",
      wantsKids: "OPEN",
      style: "Monogamous",
      living: "Own place, no roommates",
      distanceKm: 12,
      religion: "Lapsed Catholic",
      politics: "Left",
      drinking: "Socially",
      mbti: "INFJ",
    },
    Nadia: {
      notes: "Sharp and funny over text, harder to read in person. Might just be nerves.",
      wantsKids: "UNKNOWN",
      style: "Monogamous",
      distanceKm: 8,
      drinking: "Socially",
    },
    Claire: {
      notes: "Genuinely lovely. Just nothing there.",
      wantsKids: "WANTS",
      distanceKm: 22,
      endedReason: "She's moving back to Portland in the spring, and neither of us wanted to pretend otherwise.",
      retrospective: "I knew by the second date and let it run three more anyway. Say the thing sooner next time.",
    },
  };

  for (const [name, detail] of Object.entries(romanticDetail)) {
    const contactId = contactIds.get(name);
    if (!contactId) continue;
    await prisma.romanticProfile.update({
      where: { contactId },
      data: {
        privateNotes: detail.notes,
        wantsKids: detail.wantsKids,
        relationshipStyle: detail.style ?? null,
        livingSituation: detail.living ?? null,
        distanceKm: detail.distanceKm ?? null,
        religion: detail.religion ?? null,
        politics: detail.politics ?? null,
        drinking: detail.drinking ?? null,
        mbti: detail.mbti ?? null,
        endedReason: detail.endedReason ?? null,
        retrospective: detail.retrospective ?? null,
        endedOn: detail.endedReason ? dateOnly(2026, 2, 14) : null,
      },
    });
  }

  console.log(`  demo data created for ${DEMO_EMAIL}`);
}
