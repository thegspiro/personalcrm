import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { getContact, listContactOptions } from "@/server/queries/contacts";
import { buildTimeline } from "@/server/queries/timeline";
import { listTermsByKind } from "@/server/taxonomy/queries";
import { ContactHeader } from "@/components/contacts/contact-header";
import {
  DatesSection,
  FactsSection,
  GiftsSection,
  IdeasSection,
  LifeEventsSection,
  RelationshipsSection,
  TasksSection,
} from "@/components/contacts/contact-sections";
import { TimelineList } from "@/components/timeline/timeline-list";
import { SectionCard } from "@/components/contacts/section-card";
import { calendarDateInTz, plainDateFromDb } from "@/lib/dates";
import { cadenceMessage } from "@/lib/format";
import { cadenceStatus, daysSinceLastInteraction, daysUntilTouch } from "@/lib/cadence";
import { displayName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { user } = await getUserContext();
  const { id } = await params;
  const contact = await getContact(user.id, id);
  return { title: contact ? displayName(contact) : "Person" };
}

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, timezone } = await getUserContext();
  const { id } = await params;

  const contact = await getContact(user.id, id);
  if (!contact) notFound();

  const [terms, timeline, contactOptions] = await Promise.all([
    listTermsByKind(user.id, [
      "INTERACTION_TYPE",
      "FACT_CATEGORY",
      "DATE_TYPE",
      "LIFE_EVENT_TYPE",
      "RELATIONSHIP_TYPE",
      "GIFT_OCCASION",
    ]),
    buildTimeline(user.id, timezone, { contactId: id, take: 40 }),
    listContactOptions(user.id),
  ]);

  const today = calendarDateInTz(new Date(), timezone);
  const daysSince = daysSinceLastInteraction(contact.lastInteractionAt, timezone);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="grid min-w-0 gap-4 lg:col-span-2">
        <ContactHeader
          contact={{
            ...contact,
            birthDate: contact.birthDate ? plainDateFromDb(contact.birthDate) : null,
            category: contact.category
              ? {
                  label: contact.category.label,
                  icon: contact.category.icon,
                  color: contact.category.color,
                }
              : null,
          }}
          cadence={{
            status: cadenceStatus(contact.nextTouchAt, timezone),
            message: cadenceMessage(daysUntilTouch(contact.nextTouchAt, timezone)),
            lastSeen:
              daysSince === null
                ? null
                : daysSince === 0
                  ? "Spoke today"
                  : daysSince === 1
                    ? "Spoke yesterday"
                    : `Last spoke ${daysSince} days ago`,
          }}
          interactionTypes={terms.INTERACTION_TYPE}
          contacts={contactOptions}
        />
      </div>

      <div className="grid min-w-0 gap-3">
        <SectionCard title="Timeline" icon="History" count={timeline.length}>
          <TimelineList
            entries={timeline}
            today={today}
            timezone={timezone}
            showContacts={false}
            emptyTitle="Nothing logged yet"
            emptyDescription="Log an interaction, or backfill what you remember."
          />
        </SectionCard>
      </div>

      <div className="grid min-w-0 gap-3">
        <FactsSection
          contactId={contact.id}
          facts={contact.facts.map((fact) => ({
            id: fact.id,
            content: fact.content,
            importance: fact.importance,
            category: fact.category
              ? { label: fact.category.label, icon: fact.category.icon, color: fact.category.color }
              : null,
          }))}
          categories={terms.FACT_CATEGORY}
        />

        <IdeasSection
          contactId={contact.id}
          ideas={contact.ideas.map((idea) => ({
            id: idea.id,
            content: idea.content,
            status: idea.status,
          }))}
        />

        <DatesSection
          contactId={contact.id}
          dates={contact.importantDates.map((item) => ({
            id: item.id,
            label: item.label,
            date: plainDateFromDb(item.date),
            precision: item.precision,
            recurrence: item.recurrence,
            type: item.type
              ? { label: item.type.label, icon: item.type.icon, color: item.type.color }
              : null,
          }))}
          types={terms.DATE_TYPE}
        />

        <LifeEventsSection
          contactId={contact.id}
          events={contact.lifeEvents.map((event) => ({
            id: event.id,
            title: event.title,
            description: event.description,
            date: plainDateFromDb(event.date),
            precision: event.precision,
            endDate: event.endDate ? plainDateFromDb(event.endDate) : null,
            endPrecision: event.endPrecision,
            isMilestone: event.isMilestone,
            type: event.type
              ? { label: event.type.label, icon: event.type.icon, color: event.type.color }
              : null,
          }))}
          types={terms.LIFE_EVENT_TYPE}
        />

        <TasksSection
          contactId={contact.id}
          tasks={contact.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            dueDate: task.dueDate ? plainDateFromDb(task.dueDate) : null,
            completedAt: task.completedAt,
            priority: task.priority,
          }))}
        />

        <RelationshipsSection
          contactId={contact.id}
          relationships={contact.relationsFrom.map((relationship) => ({
            id: relationship.id,
            type: {
              label: relationship.type.label,
              icon: relationship.type.icon,
              color: relationship.type.color,
            },
            other: relationship.toContact,
          }))}
          types={terms.RELATIONSHIP_TYPE}
          contacts={contactOptions}
        />

        <GiftsSection
          contactId={contact.id}
          gifts={contact.gifts.map((gift) => ({
            id: gift.id,
            name: gift.name,
            status: gift.status,
            priceCents: gift.priceCents,
            currency: gift.currency,
            occasion: gift.occasion ? { label: gift.occasion.label } : null,
          }))}
          occasions={terms.GIFT_OCCASION}
        />
      </div>
    </div>
  );
}
