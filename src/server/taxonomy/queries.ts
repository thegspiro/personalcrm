import "server-only";
import type { TaxonomyKind, TaxonomyTerm } from "@prisma/client";
import { prisma } from "@/server/db/client";

export type Term = Pick<
  TaxonomyTerm,
  "id" | "kind" | "slug" | "label" | "icon" | "color" | "sortOrder" | "isSystem" | "isActive" | "inverseTermId" | "metadata"
>;

const TERM_SELECT = {
  id: true,
  kind: true,
  slug: true,
  label: true,
  icon: true,
  color: true,
  sortOrder: true,
  isSystem: true,
  isActive: true,
  inverseTermId: true,
  metadata: true,
} as const;

export async function listTerms(
  ownerId: string,
  kind: TaxonomyKind,
  opts: { includeInactive?: boolean } = {},
): Promise<Term[]> {
  return prisma.taxonomyTerm.findMany({
    where: { ownerId, kind, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: TERM_SELECT,
  });
}

/** Fetch several taxonomies in one round-trip, keyed by kind. */
export async function listTermsByKind(
  ownerId: string,
  kinds: TaxonomyKind[],
  opts: { includeInactive?: boolean } = {},
): Promise<Record<string, Term[]>> {
  const rows = await prisma.taxonomyTerm.findMany({
    where: { ownerId, kind: { in: kinds }, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: TERM_SELECT,
  });

  const out: Record<string, Term[]> = {};
  for (const kind of kinds) out[kind] = [];
  for (const row of rows) out[row.kind].push(row);
  return out;
}

export async function findTermBySlug(
  ownerId: string,
  kind: TaxonomyKind,
  slug: string,
): Promise<Term | null> {
  return prisma.taxonomyTerm.findUnique({
    where: { ownerId_kind_slug: { ownerId, kind, slug } },
    select: TERM_SELECT,
  });
}

/** Pipeline order for dating stages, falling back to sortOrder. */
export function pipelineOrder(term: Term): number {
  const meta = term.metadata as { pipelineOrder?: number } | null;
  return meta?.pipelineOrder ?? term.sortOrder;
}

export function isTerminalStage(term: Term): boolean {
  const meta = term.metadata as { terminal?: boolean } | null;
  return meta?.terminal === true;
}
