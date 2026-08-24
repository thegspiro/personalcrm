import type { Metadata } from "next";
import { getUserContext } from "@/server/user/context";
import { listTermsByKind } from "@/server/taxonomy/queries";
import { ContactForm } from "@/components/contacts/contact-form";
import { fieldsFor } from "@/server/queries/custom-fields";

export const metadata: Metadata = { title: "Add someone" };
export const dynamic = "force-dynamic";

export default async function NewContactPage() {
  const { user, prefs } = await getUserContext();
  const [terms, customFields] = await Promise.all([
    listTermsByKind(user.id, ["CONTACT_CATEGORY", "MEETING_SOURCE"]),
    // No category picked yet, so only unscoped fields show; the rest appear
    // once they have been sorted into a category and the page is re-rendered.
    fieldsFor(user.id, "CONTACT", null),
  ]);

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Add someone</h2>
        <p className="text-xs text-muted-foreground">
          Only a first name is required — everything else can come later.
        </p>
      </div>
      <ContactForm
        categories={terms.CONTACT_CATEGORY}
        meetingSources={terms.MEETING_SOURCE}
        defaultCadenceDays={prefs.defaultCadenceDays}
        customFields={customFields}
      />
    </div>
  );
}
