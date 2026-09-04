import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { prisma } from "@/server/db/client";
import { listContactOptions } from "@/server/queries/contacts";
import { listPlans } from "@/server/queries/plans";
import { listTerms } from "@/server/taxonomy/queries";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/nav/icon";
import { PlansSection } from "@/components/plans/plans-section";
import { IdeaList } from "@/components/lists/idea-list";
import { ListCapNotice } from "@/components/ui/list-cap-notice";
import { applyCap } from "@/lib/list-cap";
import { plainDateFromDb } from "@/lib/dates";
import { displayName } from "@/lib/utils";
import { privacyScope, viaOptionalContactPrivacyWhere } from "@/server/privacy/filter";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";

export const metadata: Metadata = { title: "Ideas" };
export const dynamic = "force-dynamic";

/** One more than each is fetched, so the page can tell a full list from a cut one. */
const IDEA_CAP = 200;
const PLAN_CAP = 200;

/**
 * The two halves of "I had an idea": something to say, and something to do.
 *
 * They are separate models because they end differently — an idea is used when
 * you say it, a plan when you do it — but they arrive in the same moment and
 * belong on the same page.
 */
export default async function IdeasPage() {
  const { user } = await getUserContext();
  const scope = await privacyScope();

  const [ideaRows, planRows, planCategories, contacts, cacheable] = await Promise.all([
    prisma.idea.findMany({
      where: {
        ownerId: user.id,
        status: "OPEN",
        ...viaOptionalContactPrivacyWhere(scope),
      },
      include: { contact: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: IDEA_CAP + 1,
    }),
    listPlans(user.id, { take: PLAN_CAP + 1 }),
    listTerms(user.id, "PLAN_CATEGORY"),
    listContactOptions(user.id),
    offlineCacheable(user.id),
  ]);

  const { items: ideas, truncated: ideasTruncated } = applyCap(ideaRows, IDEA_CAP);
  const { items: plans, truncated: plansTruncated } = applyCap(planRows, PLAN_CAP);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Ideas</h2>
        <p className="text-xs text-muted-foreground">
          Things you meant to bring up, and things you meant to do.
        </p>
      </div>

      <PlansSection
        plans={plans.map((plan) => ({
          id: plan.id,
          title: plan.title,
          status: plan.status,
          location: plan.location,
          address: plan.address,
          url: plan.url,
          estimatedCostCents: plan.estimatedCostCents,
          currency: plan.currency,
          notes: plan.notes,
          checklist: plan.checklist,
          plannedFor: plan.plannedFor ? plainDateFromDb(plan.plannedFor) : null,
          plannedStartMinute: plan.plannedStartMinute,
          plannedDurationMinutes: plan.plannedDurationMinutes,
          categoryId: plan.categoryId,
          category: plan.category
            ? {
                label: plan.category.label,
                icon: plan.category.icon,
                color: plan.category.color,
              }
            : null,
          contact: plan.contact,
        }))}
        categories={planCategories}
        people={contacts.map((contact) => ({
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
        }))}
      />
      {plansTruncated ? (
        <ListCapNotice
          shown={plans.length}
          noun="plans"
          hint="Mark some done or archived to see the rest."
        />
      ) : null}

      <div className="grid gap-2">
        <h3 className="text-sm font-semibold tracking-tight">Bring this up</h3>

        {ideas.length === 0 ? (
          <EmptyState
            icon={<Icon name="MessageSquareQuote" />}
            title="No conversation ideas saved"
            description="Add them from a person's page as you think of them."
          />
        ) : (
          <IdeaList
            ideas={ideas.map((idea) => ({
              id: idea.id,
              content: idea.content,
              contact: idea.contact,
            }))}
          />
        )}
        {ideasTruncated ? (
          <ListCapNotice
            shown={ideas.length}
            noun="ideas"
            hint="Mark some used to see the rest."
          />
        ) : null}
      </div>
      {cacheable ? <CacheThisPage /> : null}
    </div>
  );
}
