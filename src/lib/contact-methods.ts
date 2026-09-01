/**
 * Turning a stored contact method into something tappable.
 *
 * The whole reason to keep someone's number in a phone-shaped app is to press
 * it and have the phone dial. That needs a scheme, and the only clue available
 * is the taxonomy term the user filed it under.
 *
 * Which makes this best-effort by construction: `typeId` is nullable, and every
 * term is renameable and deletable by the account that owns it. A slug that
 * means nothing here is not an error — the value renders as plain text, which
 * is exactly what it was before it had a type at all.
 */

/** Slugs shipped in `CONTACT_METHOD_TYPE` defaults that dial. */
const TEL_SLUGS = new Set(["mobile", "home-phone", "work-phone", "phone", "fax"]);

/** Slugs shipped in `CONTACT_METHOD_TYPE` defaults that open a mail client. */
const MAIL_SLUGS = new Set(["email", "work-email", "personal-email"]);

/** Where a handle on a named service can be resolved to a profile URL. */
const HANDLE_HOSTS: Record<string, string> = {
  instagram: "https://instagram.com/",
  telegram: "https://t.me/",
  snapchat: "https://snapchat.com/add/",
  linkedin: "https://linkedin.com/in/",
  x: "https://x.com/",
  facebook: "https://facebook.com/",
};

export type MethodLinkKind = "tel" | "mailto" | "url" | "none";

export interface MethodLink {
  kind: MethodLinkKind;
  /** Null whenever the value cannot be turned into a link worth offering. */
  href: string | null;
}

/**
 * Everything a phone will dial, minus everything it will not.
 *
 * `tel:` tolerates spaces and brackets in principle, but strips far better in
 * practice, and the parts removed here carry no digits. `+` is kept because
 * dropping it turns an international number into a local one.
 */
function telHref(value: string): string | null {
  const dialable = value.replace(/[^\d+;,*#]/g, "");
  // A "+" and nothing else is somebody's typo, not a number.
  return /\d/.test(dialable) ? `tel:${dialable}` : null;
}

function mailHref(value: string): string | null {
  // Deliberately not a validating regex. The point is to avoid offering a
  // mailto: for something plainly not an address, not to adjudicate RFC 5322.
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed) ? `mailto:${trimmed}` : null;
}

function webHref(value: string): string | null {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // A bare domain is a website; anything else is a handle, and guessing a host
  // for it would invent a profile that may not exist.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(trimmed) ? `https://${trimmed}` : null;
}

function handleHref(host: string, value: string): string | null {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "");
  // Handles are a narrow alphabet everywhere this table covers. Anything else
  // is a display name or a note, and appending it to a host builds a 404.
  return /^[A-Za-z0-9._-]+$/.test(handle) ? `${host}${handle}` : null;
}

/**
 * The link to offer for a stored method, given the slug it is filed under.
 *
 * `slug` is null when the method has no type, or its type was deleted.
 */
export function methodLink(slug: string | null | undefined, value: string): MethodLink {
  const raw = value.trim();
  if (!raw) return { kind: "none", href: null };

  // An explicit URL wins over the slug's opinion: someone who pasted a full
  // link meant that link.
  if (/^https?:\/\//i.test(raw) && !TEL_SLUGS.has(slug ?? "")) {
    return { kind: "url", href: raw };
  }

  if (!slug) return { kind: "none", href: null };
  if (TEL_SLUGS.has(slug)) return { kind: "tel", href: telHref(raw) };
  if (MAIL_SLUGS.has(slug)) return { kind: "mailto", href: mailHref(raw) };

  // WhatsApp and Signal are reached by number, not by handle, and both accept
  // a plain tel: — which is also what you want if the app is not installed.
  if (slug === "whatsapp" || slug === "signal") {
    const tel = telHref(raw);
    if (tel) return { kind: "tel", href: tel };
    return { kind: "none", href: null };
  }

  if (slug === "website") return { kind: "url", href: webHref(raw) };

  const host = HANDLE_HOSTS[slug];
  if (host) return { kind: "url", href: handleHref(host, raw) };

  // Discord tags, and anything the user added themselves.
  return { kind: "none", href: null };
}
