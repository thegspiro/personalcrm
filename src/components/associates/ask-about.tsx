import Link from "next/link";
import { Icon } from "@/components/nav/icon";
import { formatPartialDate } from "@/lib/date-precision";
import type { AskAbout, AskAboutItem } from "@/server/queries/associates";

/** "Mar 3, 2026", or nothing when the update somehow carries no date. */
function asOf(item: AskAboutItem): string | null {
  return item.date ? formatPartialDate(item.date, item.precision, { short: true }) : null;
}

/** One thing to ask about: who, how this friend knows them, the news, and as of when. */
function AskAboutLine({ item }: { item: AskAboutItem }) {
  const date = asOf(item);
  return (
    <>
      <p className="min-w-0 break-words text-sm">
        <Link href={item.associate.href} className="font-medium underline-offset-2 hover:underline">
          {item.associate.name}
        </Link>
        {item.howTheyKnow ? (
          <span className="text-muted-foreground"> ({item.howTheyKnow})</span>
        ) : null}
        {" — "}
        {item.content}
      </p>
      {date ? <p className="text-xs text-muted-foreground">as of {date}</p> : null}
    </>
  );
}

/**
 * "Ask Alice about…" on a friend's profile: the latest news they told you
 * about the people in their life, so the next conversation can pick it up.
 *
 * Renders nothing when there is nothing to ask — an empty card on every
 * profile would be noise. Everything here was heard from this friend, which is
 * what makes it safe to raise with them; anything heard elsewhere stays in the
 * section below, muted.
 */
export function AskAboutCard({ firstName, askAbout }: { firstName: string; askAbout: AskAbout }) {
  if (askAbout.items.length === 0) return null;

  return (
    <section
      aria-label={`Ask ${firstName} about`}
      className="min-w-0 rounded-xl border border-accent-7/60 bg-accent-2/40 px-4 py-3"
    >
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <Icon name="MessageCircleQuestion" className="size-4 shrink-0 text-accent-11" />
        <h2 className="truncate text-sm font-semibold">Ask {firstName} about</h2>
        {askAbout.total > askAbout.items.length ? (
          <Link
            href="#people-in-their-life"
            className="ml-auto shrink-0 text-xs text-accent-11 hover:underline"
          >
            See all {askAbout.total}
          </Link>
        ) : null}
      </div>
      <ul className="grid gap-2">
        {askAbout.items.map((item) => (
          <li
            key={item.noteId}
            className="min-w-0 rounded-lg border border-border/70 bg-card px-3 py-2"
          >
            <AskAboutLine item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The same, folded into a planned meetup's row: what to bring up when you
 * see them. Plain text in the row's own small type, so a list of plans does
 * not turn into a list of cards.
 */
export function AskAboutOnPlan({ firstName, askAbout }: { firstName: string; askAbout: AskAbout }) {
  if (askAbout.items.length === 0) return null;

  return (
    <div className="mt-1.5 min-w-0 rounded-md bg-accent-2/40 px-2 py-1.5">
      <p className="text-[11px] font-medium text-accent-11">Ask {firstName} about</p>
      <ul className="mt-0.5 grid gap-1">
        {askAbout.items.map((item) => (
          <li key={item.noteId} className="min-w-0">
            <AskAboutLine item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}
