#!/usr/bin/env node
/**
 * Refuse a pull request that still has unaddressed findings from a review bot.
 *
 * This exists because of one pull request. #106 merged ninety minutes after an
 * automated review posted seven findings on it. None had been addressed, and
 * every one turned out to be real — including an accessibility regression in
 * the *default* configuration, where the results of a lookup could not be
 * reached from a keyboard at all. CI was fully green the whole time and caught
 * none of them, because none of them are the kind of thing a type checker or a
 * test suite knows to look for.
 *
 * The changelog guard next door was written after the same lesson: an
 * instruction nothing enforces is not a control. "Wait for the review" is an
 * instruction. This is the control.
 *
 * ## What blocks
 *
 * An unresolved review thread whose first comment was written by a bot. That is
 * deliberately narrow:
 *
 * - **Bots only.** An unresolved thread from a person is usually a conversation
 *   still in progress, and a reviewer who is finished can approve or resolve.
 *   Blocking on those would make this noise, and a check people learn to
 *   override is worse than no check at all. `BLOCK_HUMAN_THREADS` is the one
 *   line to change if that judgement ever needs revisiting.
 * - **Threads, not summaries.** A bot's overall "here is what I looked at"
 *   comment is an issue comment, carries no finding, and is not a review
 *   thread — so it never blocks.
 * - **Outdated threads still block.** A finding does not stop being true
 *   because the line moved. If it genuinely no longer applies, resolving it
 *   says so.
 *
 * ## Resolving is the point
 *
 * Nothing here judges whether a finding is correct — it cannot. What it insists
 * on is that somebody looked and decided. Fixing the code resolves the thread;
 * so does replying "not this, because…" and resolving it by hand. Either is a
 * decision. Merging past it unread is the thing being prevented.
 *
 *   node scripts/check-review-threads.mjs <pr-number>
 *
 * Needs `GITHUB_TOKEN` with `pull-requests: read` and `GITHUB_REPOSITORY`.
 */

import { pathToFileURL } from "node:url";

/** Whether an unresolved thread from a person should block too. */
export const BLOCK_HUMAN_THREADS = false;

const PAGE = 100;

/** The first line of a finding, for a message somebody can act on. */
export function summarise(body) {
  const line = (body ?? "")
    .split("\n")
    // A review bot's headline arrives wrapped in a severity badge, nested
    // <sub> tags and three levels of emphasis. Strip whole constructs in order
    // — image, then tag, then emphasis — because dropping the angle brackets
    // alone leaves the tag *names* behind as words.
    .map((text) =>
      text
        .replace(/!?\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/[*_`]/g, "")
        .trim(),
    )
    .find((text) => text.length > 0);
  if (!line) return "(no text)";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

/**
 * The threads that should stop a merge, from a page of GraphQL nodes.
 *
 * Pure, so the rule can be tested against recorded shapes without a network —
 * the same arrangement `geo-providers.test.ts` uses for provider replies.
 */
export function blockingThreads(nodes, { blockHumanThreads = BLOCK_HUMAN_THREADS } = {}) {
  const blocking = [];
  for (const thread of nodes ?? []) {
    if (thread?.isResolved) continue;

    const first = thread?.comments?.nodes?.[0];
    // A thread whose comments have all been deleted has nothing to address.
    if (!first) continue;

    const isBot = first.author?.__typename === "Bot";
    if (!isBot && !blockHumanThreads) continue;

    blocking.push({
      who: first.author?.login ?? "unknown",
      where: thread.path ?? "the pull request",
      outdated: Boolean(thread.isOutdated),
      url: first.url,
      what: summarise(first.body),
    });
  }
  return blocking;
}

const QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: ${PAGE}, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            isOutdated
            path
            comments(first: 1) {
              nodes {
                url
                body
                author { login __typename }
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchPage({ token, owner, repo, number, cursor }) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // GitHub rejects a request with no User-Agent.
      "User-Agent": "personalcrm-review-guard",
    },
    body: JSON.stringify({ query: QUERY, variables: { owner, repo, number, cursor } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub replied ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  // A GraphQL error arrives with a 200, so the status alone proves nothing.
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }
  const pr = payload.data?.repository?.pullRequest;
  if (!pr) throw new Error(`No pull request #${number} in ${owner}/${repo}.`);
  return pr.reviewThreads;
}

async function main() {
  const number = Number(process.argv[2]);
  const token = process.env.GITHUB_TOKEN;
  const slug = process.env.GITHUB_REPOSITORY;

  if (!Number.isInteger(number) || number <= 0) {
    console.error("Usage: node scripts/check-review-threads.mjs <pr-number>");
    return 2;
  }
  // Failing loudly rather than skipping. A check that quietly passes when it
  // cannot see anything is the same false reassurance this exists to remove.
  if (!token) {
    console.error("GITHUB_TOKEN is not set, so review threads cannot be read.");
    return 2;
  }
  if (!slug || !slug.includes("/")) {
    console.error("GITHUB_REPOSITORY is not set to owner/repo.");
    return 2;
  }

  const [owner, repo] = slug.split("/");
  const blocking = [];
  let cursor = null;
  let seen = 0;

  do {
    const page = await fetchPage({ token, owner, repo, number, cursor });
    seen += page.nodes.length;
    blocking.push(...blockingThreads(page.nodes));
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  if (blocking.length === 0) {
    console.log(`No unresolved review-bot findings on #${number} (${seen} thread(s) checked).`);
    return 0;
  }

  console.error(`\n${blocking.length} unresolved review finding(s) on #${number}:\n`);
  for (const item of blocking) {
    console.error(`  ${item.where}${item.outdated ? " (outdated)" : ""} — ${item.who}`);
    console.error(`    ${item.what}`);
    console.error(`    ${item.url}\n`);
  }
  console.error(
    "Fix each one, or reply saying why it does not apply — then resolve the\n" +
      "thread. Resolving is what this checks for: it does not judge whether a\n" +
      "finding is right, only that somebody read it and decided.\n",
  );
  return 1;
}

// Only when run as a command, so the rules above can be imported and tested.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
