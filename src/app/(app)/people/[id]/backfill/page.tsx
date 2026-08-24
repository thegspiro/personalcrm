import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUserContext } from "@/server/user/context";
import { getContact } from "@/server/queries/contacts";
import { listTermsByKind } from "@/server/taxonomy/queries";
import { BackfillPanel } from "@/components/contacts/backfill-panel";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Backfill history" };
export const dynamic = "force-dynamic";

export default async function BackfillPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getUserContext();
  const { id } = await params;

  const contact = await getContact(user.id, id);
  if (!contact) notFound();

  const terms = await listTermsByKind(user.id, [
    "INTERACTION_TYPE",
    "LIFE_EVENT_TYPE",
    "FACT_CATEGORY",
    "DATE_TYPE",
  ]);

  const name = displayName(contact);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to contact">
          <Link href={`/people/${contact.id}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Backfill {name}</h2>
          <p className="text-xs text-muted-foreground">
            Add history one entry at a time — the date and type stay put between saves.
          </p>
        </div>
      </div>

      <BackfillPanel
        contactId={contact.id}
        contactName={contact.firstName}
        interactionTypes={terms.INTERACTION_TYPE}
        lifeEventTypes={terms.LIFE_EVENT_TYPE}
        factCategories={terms.FACT_CATEGORY}
        dateTypes={terms.DATE_TYPE}
      />
    </div>
  );
}
