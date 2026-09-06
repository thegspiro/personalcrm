/**
 * vCard 4.0 (RFC 6350) — contacts, for an address book.
 *
 * The reason this format is worth the trouble rather than exporting CSV alone:
 * vCard can carry a birthday whose year nobody knows. This app stores a
 * `DatePrecision` on every historical date precisely so that "some time in
 * April" is never written down as the fifteenth, and the reduced-accuracy
 * dates of ISO 8601 let that survive the trip into a phone rather than being
 * rounded into a confident-looking lie.
 */
import { hasKnownDay, hasKnownMonth, hasKnownYear, type DatePrecision } from "@/lib/date-precision";
import type { PlainDate } from "@/lib/dates";
import { escapeValue, joinLines } from "./text";

export interface VCardMethod {
  /** Taxonomy slug: `email`, `mobile`, `phone`, `url`, … */
  kind: string | null;
  value: string;
  label: string | null;
}

export interface VCardAddress {
  label: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface VCardContact {
  id: string;
  firstName: string;
  lastName: string | null;
  nickname: string | null;
  birthDate: PlainDate | null;
  birthDatePrecision: DatePrecision;
  occupation: string | null;
  employer: string | null;
  summary: string | null;
  category: string | null;
  methods: readonly VCardMethod[];
  addresses: readonly VCardAddress[];
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * A birthday at whatever accuracy is actually known.
 *
 * Returns null when the date says too little to be a birthday at all — a bare
 * year has no day to put in a calendar, and inventing one is the thing the
 * precision column exists to prevent.
 */
export function vcardDate(date: PlainDate, precision: DatePrecision): string | null {
  const year = hasKnownYear(precision);
  const month = hasKnownMonth(precision);
  const day = hasKnownDay(precision);

  if (year && month && day) return `${pad(date.year, 4)}${pad(date.month, 2)}${pad(date.day, 2)}`;
  // Reduced accuracy, month and day only: the leading `--` is how ISO 8601
  // says "this year is deliberately absent", not "unknown data".
  if (!year && month && day) return `--${pad(date.month, 2)}${pad(date.day, 2)}`;
  // Year and month need the hyphen; without it `199004` reads as a day.
  if (year && month && !day) return `${pad(date.year, 4)}-${pad(date.month, 2)}`;
  if (year && !month) return pad(date.year, 4);
  return null;
}

/** Map a contact-method slug onto the vCard property and TYPE that carry it. */
function methodProperty(kind: string | null): { property: string; type?: string } | null {
  switch (kind) {
    case "email":
    case "work-email":
      return { property: "EMAIL", type: kind === "work-email" ? "work" : "home" };
    case "mobile":
      return { property: "TEL", type: "cell" };
    case "phone":
    case "home-phone":
      return { property: "TEL", type: "home" };
    case "work-phone":
      return { property: "TEL", type: "work" };
    case "url":
    case "website":
      return { property: "URL" };
    default:
      // Anything else — a handle on some app — has no vCard property that
      // means the same thing. It is kept, as a labelled note, rather than
      // dropped silently or forced into a field that would misrepresent it.
      return null;
  }
}

function line(property: string, value: string, parameters?: string): string {
  return `${property}${parameters ? `;${parameters}` : ""}:${escapeValue(value)}`;
}

/** One card. */
export function vcardFor(contact: VCardContact): string[] {
  const full = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    // Stable across exports, so re-importing updates a card rather than
    // duplicating the person.
    line("UID", `personalcrm-${contact.id}`),
    line("FN", full),
    // Structured name: family;given;additional;prefix;suffix — the semicolons
    // are the structure, so the parts are escaped individually.
    `N:${escapeValue(contact.lastName ?? "")};${escapeValue(contact.firstName)};;;`,
  ];

  if (contact.nickname) lines.push(line("NICKNAME", contact.nickname));

  if (contact.birthDate) {
    const bday = vcardDate(contact.birthDate, contact.birthDatePrecision);
    if (bday) lines.push(`BDAY:${bday}`);
  }

  if (contact.employer || contact.occupation) {
    if (contact.employer) lines.push(line("ORG", contact.employer));
    if (contact.occupation) lines.push(line("TITLE", contact.occupation));
  }

  const unmapped: string[] = [];
  for (const method of contact.methods) {
    const mapped = methodProperty(method.kind);
    if (!mapped) {
      unmapped.push(`${method.label ?? method.kind ?? "contact"}: ${method.value}`);
      continue;
    }
    lines.push(line(mapped.property, method.value, mapped.type ? `TYPE=${mapped.type}` : undefined));
  }

  for (const address of contact.addresses) {
    // post-office-box;extended;street;locality;region;postal-code;country
    const parts = [
      "",
      address.line2 ?? "",
      address.line1 ?? "",
      address.city ?? "",
      address.region ?? "",
      address.postalCode ?? "",
      address.country ?? "",
    ].map(escapeValue);
    lines.push(`ADR${address.label ? `;TYPE=${escapeValue(address.label)}` : ""}:${parts.join(";")}`);
  }

  if (contact.category) lines.push(line("CATEGORIES", contact.category));

  const notes = [contact.summary, ...unmapped].filter(Boolean).join("\n");
  if (notes) lines.push(line("NOTE", notes));

  lines.push("END:VCARD");
  return lines;
}

/** Every card in one file, which is how address books expect to receive them. */
export function vcardDocument(contacts: readonly VCardContact[]): string {
  return joinLines(contacts.flatMap(vcardFor));
}
