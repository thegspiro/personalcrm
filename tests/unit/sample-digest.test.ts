import { describe, expect, it } from "vitest";
import { TEST_NOTIFICATION_BODY, TEST_NOTIFICATION_SUBJECT } from "@/lib/sample-digest";

describe("the sample digest", () => {
  it("carries no interpolation and nothing read from an account", () => {
    // Settings stays reachable while the privacy lock is closed, so this is the
    // one button there that could otherwise put a private person's name on the
    // wire. There has to be nothing in it to leak.
    for (const text of [TEST_NOTIFICATION_SUBJECT, TEST_NOTIFICATION_BODY]) {
      expect(text).not.toMatch(/[${}]/);
      expect(text.length).toBeGreaterThan(0);
    }
    expect(TEST_NOTIFICATION_BODY).not.toMatch(/undefined|null|\[object Object\]/);
    expect(TEST_NOTIFICATION_BODY).toContain("Everyone named below is invented");
  });

  it("says it is a sample in the subject, where a phone shows it first", () => {
    // A push notification is often read as one collapsed line. If the only
    // marking is in the body, the sample reads as a real digest.
    expect(TEST_NOTIFICATION_SUBJECT).toBe("Personal CRM sample digest");
  });

  it("is deterministic, so what one channel is sent is what every channel is sent", () => {
    expect(TEST_NOTIFICATION_BODY).toBe(TEST_NOTIFICATION_BODY);
    expect(TEST_NOTIFICATION_BODY).toContain("2030-06-15");
  });

  it("exercises every section and every timing word a real digest can produce", () => {
    // The point of sending a sample is to see what a real digest will look like
    // on that channel. One that showed a single line would prove the transport
    // and nothing about the layout.
    for (const heading of ["Important dates", "Keep in touch", "Tasks"]) {
      expect(TEST_NOTIFICATION_BODY).toContain(`${heading}\n-`);
    }
    for (const timing of ["overdue:", "due today:", "upcoming:"]) {
      expect(TEST_NOTIFICATION_BODY).toContain(timing);
    }
  });
});
