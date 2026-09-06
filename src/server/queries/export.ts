import "server-only";
import { prisma } from "@/server/db/client";
import { plainDateFromDb } from "@/lib/dates";
import type { VCardContact } from "@/lib/export/vcard";
import type { IcsEvent } from "@/lib/export/ics";

/**
 * Reads for the export.
 *
 * Deliberately *not* privacy-filtered here. Every other query in this app
 * excludes private rows by construction, which is right for a page — a hidden
 * section simply is not there. An export is the one place where quietly
 * leaving rows out produces a file that claims to be everything and is not,
 * which is the same silent-truncation failure the list pages had. So the
 * decision is made once, in the action, and it is binary: either the lock
 * permits a complete export or the export is refused. Nothing partial.
 *
 * Two things are left out on purpose, and both are named in docs/privacy.md so
 * the omission is stated rather than discovered. Notification channels hold
 * credentials — an SMTP password, a webhook nobody else should be able to
 * post to — and a file people are encouraged to keep copies of is the last
 * place those belong. Sessions and the password hash are not account content
 * at all; they are the means of reaching it.
 *
 * Everything else an account can hold is here. A table that gains rows a
 * person entered has to be added, or the export quietly stops being what it
 * says it is — the same failure the list caps had, written to a file.
 */

const CONTACT_INCLUDE = {
  category: { select: { label: true } },
  tags: { include: { tag: { select: { name: true, slug: true, color: true } } } },
  flags: true,
  associates: true,
  happenings: { include: { type: { select: { label: true } } } },
  meetingSource: { select: { label: true } },
  methods: { include: { type: { select: { slug: true, label: true } } } },
  addresses: true,
  facts: { include: { category: { select: { label: true } } } },
  importantDates: { include: { type: { select: { label: true } } } },
  lifeEvents: { include: { type: { select: { label: true } } } },
  gifts: { include: { occasion: { select: { label: true } } } },
  debts: true,
  dietaryNeeds: true,
  romanticProfile: {
    include: {
      stage: { select: { label: true } },
      source: { select: { label: true } },
    },
  },
} as const;

/** Everything in the account, for the full-fidelity export. */
export async function gatherAccount(ownerId: string) {
  const [
    contacts,
    interactions,
    relationships,
    households,
    ideas,
    tasks,
    plans,
    locations,
    taxonomyTerms,
    tags,
    customFieldDefinitions,
    customFieldValues,
    preference,
    dashboardLayout,
  ] = await Promise.all([
    prisma.contact.findMany({ where: { ownerId }, include: CONTACT_INCLUDE, orderBy: { createdAt: "asc" } }),
    prisma.interaction.findMany({
      where: { ownerId },
      include: {
        type: { select: { label: true } },
        participants: { select: { contactId: true } },
        mentions: { select: { contactId: true } },
        dateEntry: true,
      },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.relationship.findMany({ where: { ownerId }, include: { type: { select: { label: true } } } }),
    prisma.household.findMany({ where: { ownerId }, include: { members: true } }),
    prisma.idea.findMany({ where: { ownerId } }),
    prisma.task.findMany({ where: { ownerId } }),
    prisma.plan.findMany({ where: { ownerId }, include: { category: { select: { label: true } } } }),
    prisma.location.findMany({ where: { ownerId }, include: { locationAliases: true } }),
    prisma.taxonomyTerm.findMany({ where: { ownerId }, orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }),
    prisma.tag.findMany({ where: { ownerId } }),
    prisma.customFieldDefinition.findMany({ where: { ownerId } }),
    prisma.customFieldValue.findMany({ where: { ownerId } }),
    prisma.userPreference.findUnique({ where: { userId: ownerId } }),
    prisma.dashboardLayout.findUnique({ where: { userId: ownerId } }),
  ]);

  return {
    contacts,
    interactions,
    relationships,
    households,
    ideas,
    tasks,
    plans,
    locations,
    taxonomyTerms,
    tags,
    customFieldDefinitions,
    customFieldValues,
    preference,
    dashboardLayout,
  };
}

export type AccountExport = Awaited<ReturnType<typeof gatherAccount>>;

/** The contacts, shaped for a vCard. */
export function toVCardContacts(account: AccountExport): VCardContact[] {
  return account.contacts.map((contact) => ({
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    nickname: contact.nickname,
    birthDate: contact.birthDate ? plainDateFromDb(contact.birthDate) : null,
    birthDatePrecision: contact.birthDatePrecision,
    occupation: contact.occupation,
    employer: contact.employer,
    summary: contact.summary,
    category: contact.category?.label ?? null,
    methods: contact.methods.map((method) => ({
      kind: method.type?.slug ?? null,
      value: method.value,
      label: method.label ?? method.type?.label ?? null,
    })),
    addresses: contact.addresses.map((address) => ({
      label: address.label,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      region: address.region,
      postalCode: address.postalCode,
      country: address.country,
    })),
  }));
}

/**
 * The dates worth a calendar entry: everything on the important-dates list,
 * plus the birthdays stored on the contact record itself, which are the ones
 * people actually want in their phone.
 */
export function toCalendarEvents(account: AccountExport): IcsEvent[] {
  const events: IcsEvent[] = [];

  for (const contact of account.contacts) {
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    if (contact.birthDate) {
      events.push({
        uid: `personalcrm-birthday-${contact.id}`,
        summary: `${name}'s birthday`,
        description: null,
        date: plainDateFromDb(contact.birthDate),
        precision: contact.birthDatePrecision,
        recurrence: "ANNUAL",
      });
    }

    for (const date of contact.importantDates) {
      events.push({
        uid: `personalcrm-date-${date.id}`,
        summary: `${date.label} — ${name}`,
        description: date.notes,
        date: plainDateFromDb(date.date),
        precision: date.precision,
        recurrence: date.recurrence,
      });
    }
  }

  return events;
}
