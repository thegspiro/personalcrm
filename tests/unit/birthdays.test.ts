import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("contact birthday projection", () => {
  let projectContactBirthday: typeof import("@/server/queries/birthdays").projectContactBirthday;

  beforeAll(async () => {
    ({ projectContactBirthday } = await import("@/server/queries/birthdays"));
  });

  it("projects full and unknown-year birthdays without changing precision", () => {
    const full = projectContactBirthday({
      id: "one", firstName: "Ada", lastName: "Lovelace",
      birthDate: new Date("1815-12-10T00:00:00.000Z"), birthDatePrecision: "DAY",
      importantDates: [],
    });
    const partial = projectContactBirthday({
      id: "two", firstName: "Sam", lastName: null,
      birthDate: new Date("1904-02-29T00:00:00.000Z"), birthDatePrecision: "MONTH_DAY",
      importantDates: [],
    });
    expect(full).toMatchObject({ id: "contact-birthday:one", date: { year: 1815, month: 12, day: 10 }, precision: "DAY", recurrence: "ANNUAL" });
    expect(partial).toMatchObject({ date: { year: 1904, month: 2, day: 29 }, precision: "MONTH_DAY" });
  });

  it("inherits reminder settings from a suppressed legacy birthday row", () => {
    const reminders = [30, 7, 0];
    const birthday = projectContactBirthday({
      id: "two", firstName: "Sam", lastName: null,
      birthDate: new Date("1904-02-29T00:00:00.000Z"), birthDatePrecision: "MONTH_DAY",
      importantDates: [{ typeId: "term", notes: "Call", reminderDaysBefore: reminders,
        type: { slug: "birthday", label: "Birthday", icon: "Cake", color: "pink" } }],
    });
    expect(birthday).toMatchObject({ notes: "Call", reminderDaysBefore: reminders });
  });
});
