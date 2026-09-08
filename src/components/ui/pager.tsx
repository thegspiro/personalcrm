import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { pageHref, type PageInfo } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/**
 * Moving between pages of a list.
 *
 * Links, not buttons: each one is a navigation to a URL that means something on
 * its own, so it can be opened in a new tab, bookmarked or shared. A button
 * driving `router.push` would look identical and do none of that.
 *
 * A server component, because everything it needs is already in the URL. The
 * ends are rendered as plain text rather than disabled links — there is no
 * destination, and a disabled control that still takes focus is a keyboard trap
 * with nothing behind it.
 *
 * Renders nothing at all for a list that fits on one page. A pager that only
 * ever says "1 of 1" is furniture.
 */
export function Pager({
  info,
  pathname,
  params,
  label,
  className,
}: {
  info: PageInfo;
  pathname: string;
  params: Record<string, string | string[] | undefined>;
  /** What is being counted, plural — "people", "entries". */
  label: string;
  className?: string;
}) {
  // Nothing to move between. For a counted list that is one page; for a feed,
  // a first page with nothing after it.
  if (info.pageCount !== null ? info.pageCount <= 1 : !info.hasPrevious && !info.hasNext) {
    return null;
  }

  const step = "inline-flex h-9 items-center gap-1 rounded-md border border-border px-3 text-sm";

  return (
    <nav
      aria-label={`${label} pages`}
      className={cn("flex min-w-0 flex-wrap items-center justify-between gap-3", className)}
    >
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {info.total === null
          ? `${label.charAt(0).toUpperCase()}${label.slice(1)} ${info.from}–${info.to}`
          : `${info.from}–${info.to} of ${info.total} ${label}`}
      </p>

      <div className="flex items-center gap-2">
        {info.hasPrevious ? (
          <Link href={pageHref(pathname, params, info.page - 1)} className={step} rel="prev">
            <ChevronLeft className="size-4" />
            Previous
          </Link>
        ) : (
          <span className={cn(step, "text-muted-foreground opacity-60")} aria-hidden="true">
            <ChevronLeft className="size-4" />
            Previous
          </span>
        )}

        <span className="text-xs text-muted-foreground">
          {info.pageCount === null ? `Page ${info.page}` : `Page ${info.page} of ${info.pageCount}`}
        </span>

        {info.hasNext ? (
          <Link href={pageHref(pathname, params, info.page + 1)} className={step} rel="next">
            Next
            <ChevronRight className="size-4" />
          </Link>
        ) : (
          <span className={cn(step, "text-muted-foreground opacity-60")} aria-hidden="true">
            Next
            <ChevronRight className="size-4" />
          </span>
        )}
      </div>
    </nav>
  );
}
