import { NextResponse } from "next/server";
import { buildCalendarFeed } from "@/server/queries/calendar-feed";
import { resolveFeed } from "@/server/services/calendar-feed";
import { createLogger } from "@/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("calendar-feed");

/**
 * The subscribable calendar, addressed by a token rather than a session.
 *
 * This is the third route handler in the app and the first with no session at
 * all, because the fetch is made by Google or Apple on the user's behalf and
 * there is nobody present to sign in. Two things follow from that, and both
 * are load-bearing:
 *
 *  - **The privacy lock is treated as permanently closed.** There is no
 *    session to have unlocked one, so `buildCalendarFeed` reads under a shut
 *    scope and private contacts and private rows never reach the document. The
 *    URL is stored on a third party's servers indefinitely; what it can
 *    retrieve is a strict subset of what a locked browser already shows —
 *    which does include a plan naming a romantic contact, because plans are
 *    not behind the lock. See docs/privacy.md.
 *  - **Every refusal is the same `404`.** An unknown token, a regenerated one,
 *    a deactivated account — distinguishing them would confirm which URLs once
 *    existed, the same reason the avatar route answers `404` to everything.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Calendar clients are happier with a URL that ends in a calendar file, and
  // some refuse one that does not, so the suffix is accepted and stripped
  // rather than being a second route.
  const presented = token.endsWith(".ics") ? token.slice(0, -".ics".length) : token;

  const feed = await resolveFeed(presented);
  if (!feed) return new NextResponse(null, { status: 404 });

  try {
    const document = await buildCalendarFeed(feed.ownerId, feed.timezone);
    return new NextResponse(document, {
      status: 200,
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="personal-crm.ics"',
        // Nothing between here and the subscriber should keep a copy: the
        // token is in the URL, so a shared cache keyed on it would be holding
        // one account's calendar under a guessable-looking key.
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    // The token was good, so this is the server's fault rather than the
    // caller's, and a subscribed client should retry rather than unsubscribe.
    log.error("could not build the feed", error, { ownerId: feed.ownerId });
    return new NextResponse(null, { status: 503 });
  }
}
