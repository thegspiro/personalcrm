"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarClock, Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  disableCalendarFeed,
  regenerateCalendarFeed,
} from "@/server/actions/calendar-feed";

export interface CalendarFeedView {
  createdAt: string;
  lastAccessedAt: string | null;
  token: string | null;
}

/**
 * The calendar subscription URL.
 *
 * Shown in full rather than once, because a subscription URL has to reach a
 * phone, a laptop and a web calendar, and a show-once secret is one people
 * regenerate — breaking the subscriptions they already made — until they give
 * up on the feature.
 *
 * `baseUrl` is resolved on the server — `APP_URL` when the operator has set
 * one, the request's own host otherwise — rather than from `window` here. That
 * keeps the first render identical to the server's, and it is the more correct
 * answer anyway: `APP_URL` is the address the operator has published, which is
 * the one a calendar service has to be able to reach.
 */
export function CalendarFeedSettings({
  feed,
  baseUrl,
  locked,
}: {
  feed: CalendarFeedView | null;
  baseUrl: string;
  locked: boolean;
}) {
  const [busy, setBusy] = React.useState<"create" | "disable" | null>(null);
  const [copied, setCopied] = React.useState(false);

  const url = feed?.token ? `${baseUrl}/api/calendar/${feed.token}.ics` : null;

  async function create() {
    setBusy("create");
    try {
      const result = await regenerateCalendarFeed();
      if (!result.ok) {
        toast.error(result.error ?? "The subscription could not be created.");
        return;
      }
      toast.success(feed ? "New address created. The old one has stopped working." : "Subscription created.");
    } catch (error) {
      console.error("Creating the calendar subscription failed", error);
      toast.error("The subscription could not be created.");
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy("disable");
    try {
      const result = await disableCalendarFeed();
      if (!result.ok) {
        toast.error(result.error ?? "The subscription could not be turned off.");
        return;
      }
      toast.success("Subscription turned off. The address no longer works.");
    } catch (error) {
      console.error("Turning off the calendar subscription failed", error);
      toast.error("The subscription could not be turned off.");
    } finally {
      setBusy(null);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused outside a secure context, which a
      // self-hosted install reached over plain http is. The field is
      // selectable, so say that rather than failing silently.
      toast.error("Copying was blocked. Select the address and copy it by hand.");
    }
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Calendar subscription</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A private web address your calendar app can subscribe to, so birthdays, important
          dates, plans, follow-ups and what people have on appear alongside everything else
          in your day. It updates on your calendar app&apos;s own schedule.
        </p>
      </div>

      <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Anyone you have marked private, anything you have marked private, and your date
        log are never included — whoever fetches this is not signed in and cannot unlock.
        Plans and follow-ups are included even when they name someone you are seeing, the
        same as they appear on your calendar here; mark a person private to keep them out
        altogether. Treat the address itself as a password: anyone who has it can read the
        rest.
      </p>

      {locked ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Unlock with your PIN to create or change the address.
        </p>
      ) : null}

      {feed && !feed.token ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          A subscription exists and is still working, but the address cannot be shown again
          because the server&apos;s secret has changed since it was created. Create a new
          one to get an address you can copy.
        </p>
      ) : null}

      {url ? (
        <div className="grid min-w-0 gap-2">
          <label className="text-xs font-medium" htmlFor="calendar-feed-url">
            Your address
          </label>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <input
              id="calendar-feed-url"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            />
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      ) : null}

      {feed ? (
        <p className="text-xs text-muted-foreground">
          Created {new Date(feed.createdAt).toLocaleDateString()}.{" "}
          {feed.lastAccessedAt
            ? `Last fetched ${new Date(feed.lastAccessedAt).toLocaleString()}.`
            : "Not fetched yet — calendar apps can take a few hours to check the first time."}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={feed ? "outline" : "default"}
          loading={busy === "create"}
          disabled={locked || busy !== null}
          onClick={() => void create()}
        >
          {feed ? <RefreshCw /> : <CalendarClock />}
          {feed ? "Create a new address" : "Create a subscription"}
        </Button>
        {feed ? (
          <Button
            size="sm"
            variant="outline"
            loading={busy === "disable"}
            disabled={locked || busy !== null}
            onClick={() => void disable()}
          >
            <Trash2 />
            Turn off
          </Button>
        ) : null}
      </div>

      {feed ? (
        <p className="text-xs text-muted-foreground">
          Creating a new address stops the old one working everywhere it is subscribed, which
          is how you revoke one that has been shared by mistake.
        </p>
      ) : null}
    </section>
  );
}
