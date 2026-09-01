import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Says out loud that a list was cut short.
 *
 * The lists in this app draw a bounded window rather than paginating, which is
 * the right trade at personal scale — but a full page and a truncated page look
 * identical, and a person cannot tell a contact they never added from one the
 * cap swallowed. Rendered below the list, where reaching it means you have run
 * out of rows and deserve to know why.
 */
export function ListCapNotice({
  shown,
  total,
  noun,
  hint,
  className,
}: {
  /** How many rows are actually on the page. */
  shown: number;
  /** The real total, when the page already counts it. Omitted otherwise. */
  total?: number;
  /** Plural noun for the rows, e.g. "people". */
  noun: string;
  /** What the reader can do about it, when there is something. */
  hint?: string;
  className?: string;
}) {
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        Showing the first {shown}
        {total === undefined ? "" : ` of ${total}`} {noun}.{hint ? ` ${hint}` : ""}
      </span>
    </p>
  );
}
