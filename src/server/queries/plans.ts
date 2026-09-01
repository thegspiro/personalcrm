import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { privacyScope } from "@/server/privacy/filter";

/**
 * Reads for saved plans — the things you mean to do with people.
 *
 * Not a dating query, which is why it does not live in `dating.ts`: the same
 * rows hold a hike with a friend, a first date, and the ones saved against
 * nobody at all.
 */

/**
 * Plans, newest first within each status.
 *
 * `contactId` narrows to one person *plus* the ones saved against nobody,
 * because "go to the observatory" is worth offering whoever you are looking
 * at. `romanticOnly` is the dating page's view of the same list.
 *
 * Status leads the ordering: an enum column sorts by its declaration order,
 * which is OPEN, PLANNED, DONE, ARCHIVED — exactly the order a list of plans
 * wants.
 */
export async function listPlans(
  ownerId: string,
  options: {
    contactId?: string;
    romanticOnly?: boolean;
    includeDone?: boolean;
    /** Row cap. Callers that want to detect truncation ask for one more. */
    take?: number;
  } = {},
) {
  const scope = await privacyScope();

  // Every clause is a separate OR, so they are ANDed explicitly rather than
  // spread into one object — a second `OR` key would silently replace the first.
  const clauses: Prisma.PlanWhereInput[] = [];

  if (options.contactId) {
    clauses.push({ OR: [{ contactId: options.contactId }, { contactId: null }] });
  }
  if (options.romanticOnly) {
    clauses.push({ OR: [{ contactId: null }, { contact: { isRomantic: true } }] });
  }
  // A plan carries no privacy marker of its own; it inherits the one belonging
  // to the person it names, the way a gift does. Saved against nobody, there is
  // no one to be private, so it always shows.
  if (!scope.unlocked) {
    clauses.push({ OR: [{ contactId: null }, { contact: { isPrivate: false } }] });
  }

  return prisma.plan.findMany({
    where: {
      ownerId,
      ...(clauses.length > 0 ? { AND: clauses } : {}),
      ...(options.includeDone ? {} : { status: { in: ["OPEN", "PLANNED"] } }),
    },
    include: {
      category: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: options.take ?? 200,
  });
}
