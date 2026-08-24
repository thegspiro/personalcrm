import Link from "next/link";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Ideas" };
export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const { user } = await getUserContext();

  const ideas = await prisma.idea.findMany({
    where: { ownerId: user.id, status: "OPEN" },
    include: { contact: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Conversation ideas</h2>
        <p className="text-xs text-muted-foreground">Things you meant to bring up.</p>
      </div>

      {ideas.length === 0 ? (
        <EmptyState
          icon={<Icon name="Lightbulb" />}
          title="No ideas saved"
          description="Add them from a person's page as you think of them."
        />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {ideas.map((idea) => (
            <li key={idea.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
              <p className="text-sm">{idea.content}</p>
              {idea.contact ? (
                <Link
                  href={`/people/${idea.contact.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {displayName(idea.contact)}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">General</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
