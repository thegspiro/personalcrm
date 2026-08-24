import type { Prisma } from "@prisma/client";
import { endedRole, familyMeta } from "@/lib/family";

type Tx = Prisma.TransactionClient;

export type EndPairResult =
  | { ok: true; changed: number }
  | { ok: false; reason: "not-found" | "cannot-end" | "no-former-term" };

/**
 * Re-type both halves of a relationship to their "former" counterparts.
 *
 * This is what a divorce or separation does in this app: nothing is deleted.
 * The `pairId` is kept, the people stay exactly where they were, and every
 * note, interaction and important date survives — because the whole reason to
 * record an ex-spouse or an ex-mother-in-law is that you still know them.
 *
 * Split out from the server action so it can be tested against a database
 * without a request context.
 */
export async function endFamilyPair(
  tx: Tx,
  ownerId: string,
  pairId: string,
  notes?: string | null,
): Promise<EndPairResult> {
  const rows = await tx.relationship.findMany({
    where: { ownerId, pairId },
    select: {
      id: true,
      fromContactId: true,
      toContactId: true,
      type: { select: { metadata: true } },
    },
  });
  if (rows.length === 0) return { ok: false, reason: "not-found" };

  const endable = rows.filter((row) => endedRole(familyMeta(row.type)?.role ?? null) !== null);
  // Blood relations have no "former" counterpart, and rightly so: a sibling
  // does not stop being one.
  if (endable.length === 0) return { ok: false, reason: "cannot-end" };

  const terms = await tx.taxonomyTerm.findMany({
    where: { ownerId, kind: "RELATIONSHIP_TYPE" },
    select: { id: true, metadata: true },
  });
  const byRole = new Map<string, string>();
  for (const term of terms) {
    const role = familyMeta(term)?.role;
    if (role && !byRole.has(role)) byRole.set(role, term.id);
  }

  let changed = 0;
  for (const row of endable) {
    const target = endedRole(familyMeta(row.type)?.role ?? null)!;
    const typeId = byRole.get(target);
    // A half whose "former" term the user has deleted is left alone rather
    // than dropped: a missing type would lose the link entirely.
    if (!typeId) continue;

    // The pair may already carry the target type — an ex-spouse recorded
    // separately, say. Re-typing onto it would break the uniqueness
    // constraint, so collapse into the existing row instead.
    const clash = await tx.relationship.findFirst({
      where: {
        ownerId,
        fromContactId: row.fromContactId,
        toContactId: row.toContactId,
        typeId,
        NOT: { id: row.id },
      },
      select: { id: true },
    });

    if (clash) {
      await tx.relationship.delete({ where: { id: row.id } });
      if (notes) await tx.relationship.update({ where: { id: clash.id }, data: { notes } });
    } else {
      await tx.relationship.update({
        where: { id: row.id },
        data: { typeId, ...(notes ? { notes } : {}) },
      });
    }
    changed += 1;
  }

  if (changed === 0) return { ok: false, reason: "no-former-term" };
  return { ok: true, changed };
}
