import { describe, expect, it } from "vitest";
// The guard script itself, imported for its pure rules — running it as a
// command is gated behind an `import.meta.url` check precisely so this works.
import { blockingThreads, summarise } from "../../scripts/check-review-threads.mjs";

/**
 * What stops a merge.
 *
 * The fixtures are the real shapes from pull request #106 — the one that merged
 * ninety minutes after a review posted seven findings on it, every one of them
 * real. Recorded rather than invented, so this tests the reply GitHub actually
 * sends, the same arrangement `geo-providers.test.ts` uses for a geocoder's.
 */

/** Verbatim from #106: a Codex finding, badge markup and all. */
const CODEX_FINDING = {
  isResolved: false,
  isOutdated: false,
  path: "src/components/locations/place-lookup.tsx",
  comments: {
    nodes: [
      {
        url: "https://github.com/thegspiro/personalcrm/pull/106#discussion_r3962802721",
        body: "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub>  Preserve keyboard access to manual lookup results**\n\nWhen typeahead is disabled—the default—`inputProps` is empty, but a button lookup still renders candidates as non-focusable `<li>` elements whose only activation handler is `onMouseDown`.\n\nUseful? React with 👍 / 👎.",
        author: { login: "chatgpt-codex-connector", __typename: "Bot" },
      },
    ],
  },
};

function thread(overrides: Record<string, unknown> = {}) {
  return { ...CODEX_FINDING, ...overrides };
}

function humanThread() {
  return thread({
    comments: {
      nodes: [
        {
          url: "https://example.test/1",
          body: "Could we pull this into its own function?",
          author: { login: "thegspiro", __typename: "User" },
        },
      ],
    },
  });
}

describe("deciding what stops a merge", () => {
  it("blocks an unresolved finding from a review bot", () => {
    // The case this exists for. Seven of these sat on #106 while it merged.
    const blocking = blockingThreads([thread()]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].who).toBe("chatgpt-codex-connector");
    expect(blocking[0].where).toBe("src/components/locations/place-lookup.tsx");
  });

  it("lets a resolved finding through", () => {
    // Resolving is the whole interface: it means somebody read it and decided,
    // whether the decision was to fix the code or to say why it does not apply.
    expect(blockingThreads([thread({ isResolved: true })])).toEqual([]);
  });

  it("still blocks a finding whose line has moved", () => {
    // A finding does not stop being true because the diff shifted under it.
    const blocking = blockingThreads([thread({ isOutdated: true })]);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].outdated).toBe(true);
  });

  it("ignores a conversation between people", () => {
    // An unresolved human thread is usually a discussion in progress, and a
    // reviewer who is finished can approve or resolve. Blocking on those makes
    // the check noise, and a check people learn to override is worse than none.
    expect(blockingThreads([humanThread()])).toEqual([]);
  });

  it("blocks a human thread when asked to", () => {
    expect(blockingThreads([humanThread()], { blockHumanThreads: true })).toHaveLength(1);
  });

  it("ignores a thread with nothing left in it", () => {
    // Every comment deleted: there is no finding left to address.
    expect(blockingThreads([thread({ comments: { nodes: [] } })])).toEqual([]);
  });

  it("survives a shape it does not recognise rather than throwing", () => {
    // This runs as a merge gate. Falling over on an unexpected reply would
    // block every pull request at once.
    expect(blockingThreads(undefined)).toEqual([]);
    expect(blockingThreads([null, {}, { comments: {} }])).toEqual([]);
  });

  it("reports several findings at once", () => {
    const blocking = blockingThreads([thread(), thread({ isResolved: true }), thread()]);
    expect(blocking).toHaveLength(2);
  });
});

describe("naming a finding in one line", () => {
  it("strips the badge image and the markdown around the headline", () => {
    // The log line has to be readable at a glance in a CI pane; a raw Codex
    // body opens with an image and three levels of emphasis.
    expect(summarise(CODEX_FINDING.comments.nodes[0].body)).toBe(
      "Preserve keyboard access to manual lookup results",
    );
  });

  it("takes the first line that says something", () => {
    expect(summarise("\n\n  \nThe actual finding\nmore detail")).toBe("The actual finding");
  });

  it("truncates a headline nobody would read to the end of", () => {
    const summary = summarise("x".repeat(400));
    expect(summary).toHaveLength(118);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("says so rather than printing nothing", () => {
    expect(summarise("")).toBe("(no text)");
    expect(summarise(undefined)).toBe("(no text)");
  });
});
