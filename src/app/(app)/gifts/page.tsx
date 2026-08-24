import Link from "next/link";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { displayName } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Gifts" };
export const dynamic = "force-dynamic";

export default async function GiftsPage() {
  const { user } = await getUserContext();

  const gifts = await prisma.gift.findMany({
    where: { ownerId: user.id },
    include: {
      occasion: true,
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
  });

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Gifts</h2>
        <p className="text-xs text-muted-foreground">Ideas, and what you&apos;ve already given.</p>
      </div>

      {gifts.length === 0 ? (
        <EmptyState
          icon={<Icon name="Gift" />}
          title="No gifts yet"
          description="Save ideas from a person's page so you're not stuck in December."
        />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {gifts.map((gift) => (
            <li
              key={gift.id}
              className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{gift.name}</p>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <Link href={`/people/${gift.contact.id}`} className="hover:text-foreground">
                    {displayName(gift.contact)}
                  </Link>
                  {gift.occasion ? <span>{gift.occasion.label}</span> : null}
                  {formatMoney(gift.priceCents, gift.currency) ? (
                    <span>{formatMoney(gift.priceCents, gift.currency)}</span>
                  ) : null}
                </div>
              </div>
              <Badge variant={gift.status === "GIVEN" ? "success" : "muted"}>
                {gift.status.toLowerCase()}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
