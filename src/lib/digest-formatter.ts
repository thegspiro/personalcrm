import { plainDateKey, type PlainDate } from "./dates";

export interface DailyDigestSection {
  heading: string;
  entries: readonly string[];
}

export interface ReminderMessage {
  subject: string;
  body: string;
}

export interface DailyDigestContent {
  date?: PlainDate;
  sections: readonly DailyDigestSection[];
  heading?: string;
  note?: string;
  maxEntriesPerSection?: number;
}

/** The shared, bounded plain-text layout used for production and sample digests. */
export function formatDailyDigest(content: DailyDigestContent): ReminderMessage {
  const limit = Math.max(1, Math.floor(content.maxEntriesPerSection ?? 5));
  const heading = content.heading ?? "Your Personal CRM daily digest";
  const lines = content.date ? [heading, plainDateKey(content.date)] : [heading];
  if (content.note) lines.push("", content.note);
  for (const section of content.sections) {
    lines.push("", section.heading);
    for (const entry of section.entries.slice(0, limit)) lines.push(`- ${entry}`);
    if (section.entries.length > limit) lines.push(`- …and ${section.entries.length - limit} more`);
    if (section.entries.length === 0) lines.push("- None");
  }
  return { subject: heading, body: lines.join("\n") };
}

