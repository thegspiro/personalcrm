import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { getContact } from "@/server/queries/contacts";
import { listTermsByKind } from "@/server/taxonomy/queries";
import { ContactForm } from "@/components/contacts/contact-form";
import { fieldsFor } from "@/server/queries/custom-fields";
import { plainDateFromDb, plainDateKey } from "@/lib/dates";
import { displayName } from "@/lib/utils";

export const metadata: Metadata = { title: "Edit" };
export const dynamic = "force-dynamic";

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getUserContext();
  const { id } = await params;

  const contact = await getContact(user.id, id);
  if (!contact) notFound();

  const [terms, customFields] = await Promise.all([
    listTermsByKind(user.id, ["CONTACT_CATEGORY", "MEETING_SOURCE"]),
    fieldsFor(user.id, "CONTACT", contact.id, { categoryId: contact.categoryId }),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Edit {displayName(contact)}</h2>
      </div>
      <ContactForm
        categories={terms.CONTACT_CATEGORY}
        meetingSources={terms.MEETING_SOURCE}
        contact={{
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          nickname: contact.nickname,
          pronouns: contact.pronouns,
          categoryId: contact.categoryId,
          occupation: contact.occupation,
          employer: contact.employer,
          city: contact.city,
          summary: contact.summary,
          howWeMet: contact.howWeMet,
          whereWeMet: contact.whereWeMet,
          meetingSourceId: contact.meetingSourceId,
          birthDate: contact.birthDate ? plainDateKey(plainDateFromDb(contact.birthDate)) : null,
          birthDatePrecision: contact.birthDatePrecision,
          metOn: contact.metOn ? plainDateKey(plainDateFromDb(contact.metOn)) : null,
          metOnPrecision: contact.metOnPrecision,
          cadenceDays: contact.cadenceDays,
          isFavorite: contact.isFavorite,
          isRomantic: contact.isRomantic,
        }}
        customFields={customFields}
      />
    </div>
  );
}
