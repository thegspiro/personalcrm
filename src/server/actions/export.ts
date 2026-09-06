"use server";

import { prisma } from "@/server/db/client";
import { getUserContext } from "@/server/user/context";
import { getPrivacyState } from "@/server/privacy/lock";
import { todayInTz, plainDateKey, plainDateFromDb, type PlainDate } from "@/lib/dates";
import type { DatePrecision } from "@/lib/date-precision";
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

/**
 * A birthday at its own accuracy, in the reduced forms ISO 8601 defines and
 * this app's importer reads back.
 */
function csvBirthDate(date: PlainDate, precision: DatePrecision): string | null {
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  switch (precision) {
    case "DAY":
      return `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}`;
    case "MONTH_DAY":
      return `--${pad(date.month, 2)}-${pad(date.day, 2)}`;
    case "MONTH":
      return `${pad(date.year, 4)}-${pad(date.month, 2)}`;
    case "YEAR":
      return pad(date.year, 4);
  }
}

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
      // Written at the accuracy it is held at. `plainDateKey` would print the
      // sentinel year the database stores for a year-less birthday — 1904 —
      // and a spreadsheet reader has no reason to doubt it, whatever the
      // precision column beside it says. The vCard forms round-trip through
      // this app's own import.
      contact.birthDate
        ? csvBirthDate(plainDateFromDb(contact.birthDate), contact.birthDatePrecision)
        : null,
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

  // Refused whenever the lock is shut, without asking how much is behind it.
  //
  // An earlier version allowed the export when nothing carried the `isPrivate`
  // marker, reasoning that there was then nothing to leave out. That modelled
  // the lock as the marker, and it is more than the marker: the dating layer is
  // gated by the lock in its own right, so an account with a romantic profile
  // and no marked rows would have exported private notes, date entries and
  // flags — exactly the content the PIN exists to hold back — in a file. And
  // branching on a count is itself a disclosure, since being refused or not
  // would have answered whether anything private exists.
  if (privacy.enabled && !privacy.unlocked) {
    return fail(
      "Unlock first. An export taken behind a closed lock would either leave out what the lock is hiding, and look complete anyway, or carry it out of the app in a file.",
    );
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
