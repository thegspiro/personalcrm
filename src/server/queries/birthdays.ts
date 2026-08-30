import "server-only";

import type { DatePrecision, Prisma } from "@prisma/client";
import { plainDateFromDb, type PlainDate } from "@/lib/dates";
import { prisma } from "@/server/db/client";
import { contactPrivacyWhere, type PrivacyScope } from "@/server/privacy/where";

/** Stable namespace: a birthday is not an ImportantDate database row. */
export const birthdayProjectionId = (contactId: string) => `contact-birthday:${contactId}`;

export interface BirthdayProjection {
  id: string;
  contactId: string;
  label: "Birthday";
  date: PlainDate;
  precision: DatePrecision;
  recurrence: "ANNUAL";
  typeId: string | null;
  notes: string | null;
  reminderDaysBefore: unknown;
  type: { label: string; icon: string | null; color: string | null } | null;
  contact: { id: string; firstName: string; lastName: string | null };
  canonicalBirthday: true;
}

export interface BirthdayContactRow {
  id: string;
  firstName: string;
  lastName: string | null;
  birthDate: Date | null;
  birthDatePrecision: DatePrecision;
  importantDates?: Array<{
    typeId: string | null;
    notes: string | null;
    reminderDaysBefore: unknown;
    type: { slug: string; label: string; icon: string | null; color: string | null } | null;
  }>;
}

export const birthdayContactSelect = {
  id: true,
  firstName: true,
  lastName: true,
  birthDate: true,
  birthDatePrecision: true,
  importantDates: {
    where: { type: { slug: "birthday", kind: "DATE_TYPE" } },
    select: {
      typeId: true,
      notes: true,
      reminderDaysBefore: true,
      type: { select: { slug: true, label: true, icon: true, color: true } },
    },
    take: 1,
  },
} satisfies Prisma.ContactSelect;

/**
 * Present Contact.birthDate like an annual ImportantDate without duplicating it.
 * A legacy birthday row is retained in storage and lends its reminder settings,
 * notes and taxonomy styling to the projection. This keeps existing reminders
 * safe while suppressing that row anywhere the canonical birthday is shown.
 */
export function projectContactBirthday(contact: BirthdayContactRow): BirthdayProjection | null {
  if (!contact.birthDate) return null;
  const legacy = contact.importantDates?.find((date) => date.type?.slug === "birthday") ?? null;
  return {
    id: birthdayProjectionId(contact.id),
    contactId: contact.id,
    label: "Birthday",
    date: plainDateFromDb(contact.birthDate),
    precision: contact.birthDatePrecision,
    recurrence: "ANNUAL",
    typeId: legacy?.typeId ?? null,
    notes: legacy?.notes ?? null,
    reminderDaysBefore: legacy?.reminderDaysBefore ?? null,
    type: legacy?.type
      ? { label: legacy.type.label, icon: legacy.type.icon, color: legacy.type.color }
      : { label: "Birthday", icon: "Cake", color: "pink" },
    contact: { id: contact.id, firstName: contact.firstName, lastName: contact.lastName },
    canonicalBirthday: true,
  };
}

/** Owner-, archive-, and privacy-scoped birthday source for shared feeds. */
export async function fetchContactBirthdays(
  ownerId: string,
  scope: PrivacyScope,
  options: { contactId?: string; activeOnly?: boolean } = {},
) {
  const contacts = await prisma.contact.findMany({
    where: {
      ownerId,
      ...(options.activeOnly === false ? {} : { isArchived: false }),
      ...(options.contactId ? { id: options.contactId } : {}),
      birthDate: { not: null },
      ...contactPrivacyWhere(scope),
    },
    select: birthdayContactSelect,
  });
  return contacts.map(projectContactBirthday).filter((row): row is BirthdayProjection => row !== null);
}

export function isBirthdayImportantDate(row: { type?: { slug: string } | null }): boolean {
  return row.type?.slug === "birthday";
}
