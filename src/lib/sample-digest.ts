import { digestMessage, type DigestItem } from "./reminder-schedule";
import type { PlainDate } from "./dates";

/**
 * The fixed body of the sample digest sent by Settings → Reminders.
 *
 * No interpolation, ever. Channels are configured on a page that stays
 * reachable while the privacy lock is closed, so this is the one path by which
 * a button there could push a private person's name off the machine. Every
 * name and date below is invented; there is nothing here to leak.
 *
 * It is rendered by `digestMessage()` — the same formatter the scheduler uses
 * — rather than by copy of its own, so what the button sends is what a real
 * digest looks like on that channel: the same sections, the same entry
 * wording, the same length. A layout that only the sample exercised would be
 * the one layout nobody had seen fail.
 */
const SAMPLE_TODAY: PlainDate = { year: 2030, month: 6, day: 15 };

const SAMPLE_ITEMS: DigestItem[] = [
  { kind: "IMPORTANT_DATE", label: "Anniversary", contactName: "Casey Example", date: { year: 2030, month: 6, day: 16 } },
  { kind: "CADENCE", contactName: "Alex Example", date: { year: 2030, month: 6, day: 12 } },
  { kind: "CADENCE", contactName: "Morgan Example", date: { year: 2030, month: 6, day: 15 } },
  { kind: "TASK", title: "Send a thank-you note", contactName: "Jordan Example", date: { year: 2030, month: 6, day: 15 } },
  { kind: "TASK", title: "Book a table for the reunion", contactName: null, date: { year: 2030, month: 6, day: 17 } },
];

const SAMPLE = digestMessage(SAMPLE_ITEMS, SAMPLE_TODAY);

export const TEST_NOTIFICATION_SUBJECT = "Personal CRM sample digest";
export const TEST_NOTIFICATION_BODY = [
  "This is a sample. Everyone named below is invented and no record from this account was read to build it.",
  "",
  SAMPLE.body,
].join("\n");
