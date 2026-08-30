import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { privacyScope, viaContactPrivacyWhere } from "@/server/privacy/filter";
import { listTerms } from "@/server/taxonomy/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { GiftList } from "@/components/lists/gift-list";
import { plainDateFromDb } from "@/lib/dates";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const metadata: Metadata = { title: "Gifts" };
export const dynamic = "force-dynamic";

export default async function GiftsPage() {
  const { user } = await getUserContext();
  const scope = await privacyScope();

  const [gifts, occasions, cacheable] = await Promise.all([
    prisma.gift.findMany({
      // A gift names the person it is for, so listing one bought for a private
      // contact discloses that contact while the lock is closed.
      where: { ownerId: user.id, ...viaContactPrivacyWhere(scope) },
      include: {
        occasion: true,
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    listTerms(user.id, "GIFT_OCCASION"),
    offlineCacheable(user.id),
  ]);

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
        <GiftList
          gifts={gifts.map((gift) => ({
            id: gift.id,
            name: gift.name,
            description: gift.description,
            url: gift.url,
            status: gift.status,
            direction: gift.direction,
            occurredOn: gift.occurredOn ? plainDateFromDb(gift.occurredOn) : null,
            priceCents: gift.priceCents,
            currency: gift.currency,
            occasionId: gift.occasionId,
            occasion: gift.occasion ? { label: gift.occasion.label } : null,
            contact: gift.contact,
          }))}
          occasions={occasions}
        />
      )}
      {cacheable ? <CacheThisPage /> : null}
    </div>
  );
}
