import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { getContact, getReciprocity, listContactOptions } from "@/server/queries/contacts";
import { buildTimeline } from "@/server/queries/timeline";
import { listTermsByKind } from "@/server/taxonomy/queries";
import { listDateEntries } from "@/server/queries/dating";
import { listPlans } from "@/server/queries/plans";
import { canSeeDating } from "@/server/privacy/filter";
import { getContactFamily, listHouseholdOptions } from "@/server/queries/family";
import { fieldsFor } from "@/server/queries/custom-fields";
import { offlineCacheable } from "@/server/privacy/offline";
import { CacheThisPage } from "@/components/offline/offline";
import { CustomFieldValues } from "@/components/custom-fields/field-values";
import { familyMeta } from "@/lib/family";
import { FamilySection, ContactHouseholdsSection } from "@/components/family/family-section";
import { SuggestionList } from "@/components/family/suggestions";
import {
  DateLogSection,
  FlagsSection,
  RomanticSection,
} from "@/components/dating/dating-sections";
import { PlansSection } from "@/components/plans/plans-section";
import { ContactHeader } from "@/components/contacts/contact-header";
import { DatesSection } from "@/components/contacts/sections/dates";
import { DebtsSection } from "@/components/contacts/sections/debts";
import { DietarySection } from "@/components/contacts/sections/dietary";
import { FactsSection } from "@/components/contacts/sections/facts";
import { GiftsSection } from "@/components/contacts/sections/gifts";
import { IdeasSection } from "@/components/contacts/sections/ideas";
import { LifeEventsSection } from "@/components/contacts/sections/life-events";
import { RelationshipsSection } from "@/components/contacts/sections/relationships";
import { TasksSection } from "@/components/contacts/sections/tasks";
import { MilestonesSummary } from "@/components/contacts/milestones-summary";
import { TimelineList } from "@/components/timeline/timeline-list";
import { SectionCard } from "@/components/contacts/section-card";
import { calendarDateInTz, plainDateFromDb, plainDateKey } from "@/lib/dates";
import { cadenceMessage } from "@/lib/format";
import { cadenceStatus, daysSinceLastInteraction, daysUntilTouch } from "@/lib/cadence";
import { displayName } from "@/lib/utils";
import { getUpcomingDates } from "@/server/queries/dashboard";
import { UpcomingDatesWidget } from "@/components/dashboard/widgets";
import { isBirthdayImportantDate, projectContactBirthday } from "@/server/queries/birthdays";

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
  const { user, prefs, timezone } = await getUserContext();
  const { id } = await params;

  const contact = await getContact(user.id, id);
  if (!contact) notFound();

  // Gate before fetching: withholding the section in the component would still
  // have put the dates and notes into the payload sent to the browser.
  const showDating = contact.isRomantic && (await canSeeDating(prefs.hideDating));
  // This one person is the whole page, so their own marker decides it — plus
  // the dating sections, which are the most sensitive thing here.
  const cacheable =
    !contact.isPrivate && !showDating && (await offlineCacheable(user.id));

  const [
    terms,
    timeline,
    contactOptions,
    dateEntries,
    plans,
    family,
    allHouseholds,
    customFields,
    interactionFields,
    reciprocity,
    upcomingDates,
  ] = await Promise.all([
    listTermsByKind(user.id, [
      "INTERACTION_TYPE",
      "FACT_CATEGORY",
      "DATE_TYPE",
      "LIFE_EVENT_TYPE",
      "RELATIONSHIP_TYPE",
      "GIFT_OCCASION",
      "DATING_STAGE",
      "DATE_ACTIVITY_TYPE",
      "PLAN_CATEGORY",
      "MEETING_SOURCE",
    ]),
    buildTimeline(user.id, timezone, { contactId: id, take: 40 }),
    listContactOptions(user.id),
    showDating ? listDateEntries(user.id, id) : Promise.resolve([]),
    listPlans(user.id, { contactId: id }),
    getContactFamily(user.id, id),
    listHouseholdOptions(user.id),
    fieldsFor(user.id, "CONTACT", id, { categoryId: contact.categoryId }),
    fieldsFor(user.id, "INTERACTION", null),
    getReciprocity(user.id, id),
    getUpcomingDates(user.id, timezone, 366, 100, id),
  ]);

  // Family relationships get their own section, so "Connected people" is left
  // holding the friends, colleagues and neighbours it is actually useful for.
  const familyTypes = terms.RELATIONSHIP_TYPE.filter((term) => familyMeta(term) !== null);
  const otherTypes = terms.RELATIONSHIP_TYPE.filter((term) => familyMeta(term) === null);
  const familyTermIds = new Set(familyTypes.map((term) => term.id));

  const today = calendarDateInTz(new Date(), timezone);
  const daysSince = daysSinceLastInteraction(contact.lastInteractionAt, timezone);
  const birthday = projectContactBirthday(contact);

  // Mapped once and shared: the summary above the timeline and the full section
  // below it read the same rows, so a milestone cannot render one way in one
  // place and another way in the other.
  const lifeEvents = contact.lifeEvents.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    typeId: event.typeId,
    date: plainDateFromDb(event.date),
    precision: event.precision,
    endDate: event.endDate ? plainDateFromDb(event.endDate) : null,
    endPrecision: event.endPrecision,
    isMilestone: event.isMilestone,
    type: event.type
      ? { label: event.type.label, icon: event.type.icon, color: event.type.color }
      : null,
  }));

  // A summary, not a second home: the rows are already ordered newest first, and
  // every one of them still appears in the section below.
  const milestones = lifeEvents.filter((event) => event.isMilestone).slice(0, 3);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      {cacheable ? <CacheThisPage /> : null}
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
          interactionFields={interactionFields}
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
        <UpcomingDatesWidget dates={upcomingDates} />
        <MilestonesSummary milestones={milestones} />
        <SectionCard title="Timeline" icon="History" count={timeline.length}>
          {reciprocity.text ? (
            <div className="grid gap-0.5 px-1">
              <p className="text-xs text-muted-foreground">{reciprocity.text}</p>
              {reciprocity.coverage ? (
                <p className="text-[11px] text-muted-foreground/70">{reciprocity.coverage}</p>
              ) : null}
            </div>
          ) : null}
          <TimelineList
            entries={timeline}
            today={today}
            timezone={timezone}
            dateTypes={terms.DATE_TYPE}
            lifeEventTypes={terms.LIFE_EVENT_TYPE}
            showContacts={false}
            blurSensitive={prefs.blurPrivateNotes}
            emptyTitle="Nothing logged yet"
            emptyDescription="Log an interaction, or backfill what you remember."
          />
        </SectionCard>
      </div>

      <div className="grid min-w-0 gap-3">
        {showDating ? (
          <>
            <RomanticSection
              contactId={contact.id}
              contactName={contact.firstName}
              blurPrivate={prefs.blurPrivateNotes}
              stages={terms.DATING_STAGE}
              sources={terms.MEETING_SOURCE}
              profile={
                contact.romanticProfile
                  ? {
                      stageId: contact.romanticProfile.stageId,
                      sourceId: contact.romanticProfile.sourceId,
                      sourceDetail: contact.romanticProfile.sourceDetail,
                      matchedOn: contact.romanticProfile.matchedOn
                        ? plainDateKey(plainDateFromDb(contact.romanticProfile.matchedOn))
                        : null,
                      firstDateOn: contact.romanticProfile.firstDateOn
                        ? plainDateKey(plainDateFromDb(contact.romanticProfile.firstDateOn))
                        : null,
                      endedOn: contact.romanticProfile.endedOn,
                      endedReason: contact.romanticProfile.endedReason,
                      retrospective: contact.romanticProfile.retrospective,
                      birthYear: contact.romanticProfile.birthYear,
                      heightCm: contact.romanticProfile.heightCm,
                      distanceKm: contact.romanticProfile.distanceKm,
                      livingSituation: contact.romanticProfile.livingSituation,
                      relationshipStyle: contact.romanticProfile.relationshipStyle,
                      wantsKids: contact.romanticProfile.wantsKids,
                      hasKids: contact.romanticProfile.hasKids,
                      religion: contact.romanticProfile.religion,
                      politics: contact.romanticProfile.politics,
                      smoking: contact.romanticProfile.smoking,
                      drinking: contact.romanticProfile.drinking,
                      mbti: contact.romanticProfile.mbti,
                      enneagram: contact.romanticProfile.enneagram,
                      exclusive: contact.romanticProfile.exclusive,
                      overallRating: contact.romanticProfile.overallRating,
                      chemistryScore: contact.romanticProfile.chemistryScore,
                      privateNotes: contact.romanticProfile.privateNotes,
                    }
                  : null
              }
            />

            <DateLogSection
              contactId={contact.id}
              blurPrivate={prefs.blurPrivateNotes}
              activityTypes={terms.DATE_ACTIVITY_TYPE}
              plans={plans.map((plan) => ({
                id: plan.id,
                title: plan.title,
                location: plan.location,
              }))}
              dates={dateEntries.map((entry) => ({
                id: entry.id,
                sequence: entry.sequence,
                occurredAt: entry.interaction.occurredAt,
                venue: entry.venue,
                city: entry.city,
                whoPaid: entry.whoPaid,
                costCents: entry.costCents,
                rating: entry.rating,
                chemistry: entry.chemistry,
                conversationQuality: entry.conversationQuality,
                notes: entry.notes,
                isPrivate: entry.interaction.isPrivate,
                activityTypeId: entry.activityTypeId,
                activityLabel: entry.activityType?.label ?? null,
              }))}
            />

            <FlagsSection
              contactId={contact.id}
              blurPrivate={prefs.blurPrivateNotes}
              flags={contact.flags.map((flag) => ({
                id: flag.id,
                kind: flag.kind,
                text: flag.text,
                severity: flag.severity,
                noticedOn: flag.noticedOn ? plainDateFromDb(flag.noticedOn) : null,
              }))}
            />
          </>
        ) : null}

        <DietarySection
          contactId={contact.id}
          needs={contact.dietaryNeeds.map((need) => ({
            id: need.id,
            kind: need.kind,
            label: need.label,
            notes: need.notes,
            carriesEpinephrine: need.carriesEpinephrine,
          }))}
        />

        <FactsSection
          contactId={contact.id}
          facts={contact.facts.map((fact) => ({
            id: fact.id,
            content: fact.content,
            importance: fact.importance,
            isPrivate: fact.isPrivate,
            categoryId: fact.categoryId,
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

        <PlansSection
          contactId={contact.id}
          categories={terms.PLAN_CATEGORY}
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
        />

        <DatesSection
          contactId={contact.id}
          dates={[
            ...(birthday ? [birthday] : []),
            ...contact.importantDates.filter(
              (item) => !(contact.birthDate && isBirthdayImportantDate(item)),
            ),
          ].map((item) => ({
            id: item.id,
            label: item.label,
            date: "canonicalBirthday" in item ? item.date : plainDateFromDb(item.date),
            precision: item.precision,
            recurrence: item.recurrence,
            typeId: item.typeId,
            notes: item.notes,
            reminderDaysBefore: Array.isArray(item.reminderDaysBefore)
              ? item.reminderDaysBefore.filter((day): day is number => typeof day === "number")
              : null,
            type: item.type
              ? { label: item.type.label, icon: item.type.icon, color: item.type.color }
              : null,
            canonicalBirthday: "canonicalBirthday" in item,
          }))}
          types={terms.DATE_TYPE}
        />

        <LifeEventsSection
          contactId={contact.id}
          events={lifeEvents}
          types={terms.LIFE_EVENT_TYPE}
        />

        <TasksSection
          contactId={contact.id}
          tasks={contact.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            notes: task.notes,
            dueDate: task.dueDate ? plainDateFromDb(task.dueDate) : null,
            completedAt: task.completedAt,
            priority: task.priority,
          }))}
        />

        <CustomFieldValues fields={customFields} editHref={`/people/${contact.id}/edit`} />

        <FamilySection
          contactId={contact.id}
          tiers={family.tiers.map((group) => ({
            tier: group.tier,
            links: group.links.map((link) => ({
              id: link.id,
              person: link.person,
              term: link.term,
              notes: link.notes,
              canEnd: link.canEnd,
            })),
          }))}
          familyTypes={familyTypes}
          contacts={contactOptions}
        />

        <SuggestionList
          suggestions={family.suggestions.map((suggestion) => ({
            subjectId: suggestion.subjectId,
            personId: suggestion.personId,
            subjectName: displayName(suggestion.subject),
            personName: displayName(suggestion.person),
            reason: suggestion.reason,
            termId: suggestion.termId,
            termLabel: suggestion.termLabel,
          }))}
          types={familyTypes}
        />

        <ContactHouseholdsSection
          contactId={contact.id}
          households={family.households}
          allHouseholds={allHouseholds}
        />

        <RelationshipsSection
          contactId={contact.id}
          relationships={contact.relationsFrom
            .filter((relationship) => !familyTermIds.has(relationship.type.id))
            .map((relationship) => ({
              id: relationship.id,
              typeId: relationship.type.id,
              type: {
                label: relationship.type.label,
                icon: relationship.type.icon,
                color: relationship.type.color,
              },
              other: relationship.toContact,
            }))}
          types={otherTypes}
          contacts={contactOptions}
        />

        <DebtsSection
          contactId={contact.id}
          debts={contact.debts.map((debt) => ({
            id: debt.id,
            direction: debt.direction,
            description: debt.description,
            amountCents: debt.amountCents,
            currency: debt.currency,
            incurredOn: plainDateFromDb(debt.incurredOn),
            settledOn: debt.settledOn ? plainDateFromDb(debt.settledOn) : null,
            notes: debt.notes,
            isPrivate: debt.isPrivate,
          }))}
        />

        <GiftsSection
          contactId={contact.id}
          gifts={contact.gifts.map((gift) => ({
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
          }))}
          occasions={terms.GIFT_OCCASION}
        />
      </div>
    </div>
  );
}
