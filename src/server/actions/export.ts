"use server";

import { prisma } from "@/server/db/client";
import { getUserContext } from "@/server/user/context";
import { getPrivacyState } from "@/server/privacy/lock";
import { countPrivateRows } from "@/server/privacy/counts";
import { todayInTz, plainDateKey, plainDateFromDb } from "@/lib/dates";
import { csvDocument } from "@/lib/export/csv";
import { vcardDocument } from "@/lib/export/vcard";
import { icsDocument } from "@/lib/export/ics";
import {
  gatherAccount,
  toCalendarEvents,
  toVCardContacts,
  type AccountExport,
} from "@/server/queries/export";
import { fail, ok, type ActionResult } from "./helpers";

/** The shape of the file the browser is asked to save. */
export interface ExportFile {
  filename: string;
  mimeType: string;
  content: string;
}

export type ExportFormat = "json" | "csv" | "vcard" | "ics";

const FORMATS = new Set<ExportFormat>(["json", "csv", "vcard", "ics"]);

/** Version the document, so a future import knows what it is reading. */
const SCHEMA_VERSION = 1;

function contactRows(account: AccountExport) {
  return account.contacts.map((contact) => {
    const method = (slug: string) =>
      contact.methods.find((m) => m.type?.slug === slug)?.value ?? null;
    return [
      contact.firstName,
      contact.lastName,
      contact.nickname,
      contact.category?.label ?? null,
      method("email"),
      method("mobile") ?? method("phone"),
      contact.city,
      contact.region,
      contact.country,
      contact.occupation,
      contact.employer,
      // Written at the accuracy it is held at, so a birthday with no known
      // year does not acquire one on the way into a spreadsheet.
      contact.birthDate ? plainDateKey(plainDateFromDb(contact.birthDate)) : null,
      contact.birthDatePrecision,
      contact.cadenceDays,
      contact.lastInteractionAt?.toISOString() ?? null,
      contact.isFavorite,
      contact.isArchived,
      contact.summary,
    ];
  });
}

const CONTACT_HEADER = [
  "first_name",
  "last_name",
  "nickname",
  "category",
  "email",
  "phone",
  "city",
  "region",
  "country",
  "occupation",
  "employer",
  "birth_date",
  "birth_date_precision",
  "cadence_days",
  "last_interaction_at",
  "is_favorite",
  "is_archived",
  "summary",
];

/**
 * Produce an export of this account.
 *
 * Returns the file rather than writing one: there is no route handler here by
 * design, so the browser assembles the download from what comes back. That
 * keeps `GET /api/health` the only route in the app and keeps the export out
 * of the service worker's way entirely.
 *
 * **The lock decides whether this runs at all.** Every read in this app hides
 * private rows while the lock is closed, which for a page is exactly right. An
 * export built the same way would be a file that claims to be everything and
 * silently is not — the same failure the list pages had, but written to disk
 * and carried somewhere else. So a closed lock over an account that holds
 * anything private refuses, and says why, rather than handing back a partial
 * file that looks complete.
 */
export async function exportAccount(format: string): Promise<ActionResult<ExportFile>> {
  if (!FORMATS.has(format as ExportFormat)) return fail("Unknown export format.");
  const chosen = format as ExportFormat;

  const { user, timezone } = await getUserContext();
  const privacy = await getPrivacyState();

  if (privacy.enabled && !privacy.unlocked) {
    const hidden = await countPrivateRows(prisma, user.id);
    if (hidden > 0) {
      return fail(
        "Unlock first. Some of your data is hidden right now, and an export taken behind a closed lock would look complete without being it.",
      );
    }
  }

  const account = await gatherAccount(user.id);
  const today = todayInTz(timezone);
  const stamp = plainDateKey(today);

  switch (chosen) {
    case "json":
      return ok({
        filename: `personalcrm-${stamp}.json`,
        mimeType: "application/json",
        content: JSON.stringify(
          {
            schemaVersion: SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            timezone,
            account,
          },
          // BigInt appears on Location.osmId and JSON.stringify throws on it
          // rather than skipping it, which would fail the whole export for one
          // optional field on one table.
          (_key, value) => (typeof value === "bigint" ? value.toString() : value),
          2,
        ),
      });

    case "csv":
      return ok({
        filename: `personalcrm-contacts-${stamp}.csv`,
        mimeType: "text/csv",
        content: csvDocument(CONTACT_HEADER, contactRows(account)),
      });

    case "vcard":
      return ok({
        filename: `personalcrm-contacts-${stamp}.vcf`,
        mimeType: "text/vcard",
        content: vcardDocument(toVCardContacts(account)),
      });

    case "ics":
      return ok({
        filename: `personalcrm-dates-${stamp}.ics`,
        mimeType: "text/calendar",
        content: icsDocument(toCalendarEvents(account), today.year, new Date()),
      });
  }
}
