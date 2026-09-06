import { describe, expect, it } from "vitest";
import { vcardDate, vcardDocument, vcardFor, type VCardContact } from "@/lib/export/vcard";
import { anchorDate, icsDocument, icsEvent, type IcsEvent } from "@/lib/export/ics";

const STAMP = new Date(Date.UTC(2026, 8, 2, 14, 0, 0));

function contact(overrides: Partial<VCardContact> = {}): VCardContact {
  return {
    id: "c1",
    firstName: "Dave",
    lastName: "Kim",
    nickname: null,
    birthDate: null,
    birthDatePrecision: "DAY",
    occupation: null,
    employer: null,
    summary: null,
    category: null,
    methods: [],
    addresses: [],
    ...overrides,
  };
}

describe("vcardDate", () => {
  const date = { year: 1990, month: 4, day: 15 };

  it("writes a full date plainly", () => {
    expect(vcardDate(date, "DAY")).toBe("19900415");
  });

  it("keeps a birthday whose year nobody knows", () => {
    // The whole reason this app stores precision: "the fifteenth of April,
    // year unknown" must not become 1990 on the way into a phone.
    expect(vcardDate(date, "MONTH_DAY")).toBe("--0415");
  });

  it("hyphenates year-and-month, which would otherwise read as a day", () => {
    expect(vcardDate(date, "MONTH")).toBe("1990-04");
  });

  it("gives up rather than inventing a day", () => {
    // A bare year is not a birthday, and picking one would be the confident
    // lie the precision column exists to prevent.
    expect(vcardDate(date, "YEAR")).toBe("1990");
  });
});

describe("vcardFor", () => {
  it("writes the structured name with its parts escaped separately", () => {
    const lines = vcardFor(contact({ lastName: "Kim; Jr" }));
    // String.raw, because "\;" in an ordinary string literal collapses to ";"
    // and the assertion then quietly checks the wrong thing.
    expect(lines).toContain(String.raw`N:Kim\; Jr;Dave;;;`);
    expect(lines).toContain(String.raw`FN:Dave Kim\; Jr`);
  });

  it("gives every card a stable identifier", () => {
    // So a second export updates the card rather than duplicating the person.
    expect(vcardFor(contact())).toContain("UID:personalcrm-c1");
  });

  it("maps the methods a vCard has a property for", () => {
    const lines = vcardFor(
      contact({
        methods: [
          { kind: "email", value: "dave@example.com", label: null },
          { kind: "mobile", value: "+15550104477", label: null },
        ],
      }),
    );
    expect(lines).toContain("EMAIL;TYPE=home:dave@example.com");
    expect(lines).toContain("TEL;TYPE=cell:+15550104477");
  });

  it("keeps a method it cannot map instead of dropping it", () => {
    // Silently losing someone's handle on export is the failure this format
    // is meant to prevent, so it goes in the note rather than nowhere.
    const lines = vcardFor(
      contact({ methods: [{ kind: "signal", value: "@dave", label: "Signal" }] }),
    );
    expect(lines.join("\n")).toContain("Signal: @dave");
  });

  it("lays the address out in the seven fields the format defines", () => {
    const lines = vcardFor(
      contact({
        addresses: [
          {
            label: "home",
            line1: "123 Main St",
            line2: null,
            city: "Springfield",
            region: "IL",
            postalCode: "62704",
            country: "USA",
          },
        ],
      }),
    );
    expect(lines).toContain("ADR;TYPE=home:;;123 Main St;Springfield;IL;62704;USA");
  });

  it("omits a birthday it cannot express rather than emitting an empty one", () => {
    const lines = vcardFor(contact({ birthDate: null }));
    expect(lines.some((l) => l.startsWith("BDAY"))).toBe(false);
  });
});

describe("vcardDocument", () => {
  it("opens and closes every card", () => {
    const doc = vcardDocument([contact(), contact({ id: "c2", firstName: "Ada" })]);
    expect(doc.match(/BEGIN:VCARD/g)).toHaveLength(2);
    expect(doc.match(/END:VCARD/g)).toHaveLength(2);
  });
});

function event(overrides: Partial<IcsEvent> = {}): IcsEvent {
  return {
    uid: "d1@personalcrm",
    summary: "Dave's birthday",
    description: null,
    date: { year: 1990, month: 4, day: 15 },
    precision: "DAY",
    recurrence: "ANNUAL",
    ...overrides,
  };
}

describe("anchorDate", () => {
  it("leaves a dated event where it is", () => {
    expect(anchorDate({ year: 1990, month: 4, day: 15 }, "DAY", 2026)).toEqual({
      year: 1990,
      month: 4,
      day: 15,
    });
  });

  it("places a year-less date in the anchor year and lets it recur", () => {
    expect(anchorDate({ year: 1904, month: 4, day: 15 }, "MONTH_DAY", 2026)).toEqual({
      year: 2026,
      month: 4,
      day: 15,
    });
  });

  it("refuses a date with no day to land on", () => {
    expect(anchorDate({ year: 1990, month: 4, day: 1 }, "MONTH", 2026)).toBeNull();
    expect(anchorDate({ year: 1990, month: 1, day: 1 }, "YEAR", 2026)).toBeNull();
  });
});

describe("icsEvent", () => {
  it("writes an all-day event with an exclusive end", () => {
    // Readers disagree about a missing end, so it is always stated, and the
    // end of an all-day event is the following day.
    const lines = icsEvent(event(), 2026, STAMP)!;
    expect(lines).toContain("DTSTART;VALUE=DATE:19900415");
    expect(lines).toContain("DTEND;VALUE=DATE:19900416");
  });

  it("rolls the exclusive end over a month boundary", () => {
    const lines = icsEvent(event({ date: { year: 1990, month: 4, day: 30 } }), 2026, STAMP)!;
    expect(lines).toContain("DTEND;VALUE=DATE:19900501");
  });

  it("rolls over a leap day correctly", () => {
    const lines = icsEvent(event({ date: { year: 2024, month: 2, day: 29 } }), 2026, STAMP)!;
    expect(lines).toContain("DTEND;VALUE=DATE:20240301");
  });

  it("carries the recurrence the date was stored with", () => {
    expect(icsEvent(event(), 2026, STAMP)!).toContain("RRULE:FREQ=YEARLY");
    expect(icsEvent(event({ recurrence: "MONTHLY" }), 2026, STAMP)!).toContain(
      "RRULE:FREQ=MONTHLY",
    );
    expect(icsEvent(event({ recurrence: "NONE" }), 2026, STAMP)!.join()).not.toContain("RRULE");
  });

  it("stamps every event, which the format requires", () => {
    expect(icsEvent(event(), 2026, STAMP)!).toContain("DTSTAMP:20260902T140000Z");
  });

  it("returns nothing for a date that cannot be placed", () => {
    expect(icsEvent(event({ precision: "YEAR" }), 2026, STAMP)).toBeNull();
  });
});

describe("icsDocument", () => {
  it("wraps the events in a calendar", () => {
    const doc = icsDocument([event()], 2026, STAMP);
    expect(doc.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(doc.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(doc).toContain("VERSION:2.0");
  });

  it("leaves out what it cannot place rather than faking a day", () => {
    const doc = icsDocument([event({ precision: "YEAR" })], 2026, STAMP);
    expect(doc).not.toContain("BEGIN:VEVENT");
  });
});
