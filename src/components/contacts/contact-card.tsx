import Link from "next/link";
import { Star } from "lucide-react";
import { cn, displayName, initialsOf } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Icon } from "@/components/nav/icon";
import { cadenceMessage, termColorClasses } from "@/lib/format";
import { cadenceStatus, daysUntilTouch } from "@/lib/cadence";
import type { ContactListItem } from "@/server/queries/contacts";

const STATUS_STYLES: Record<string, string> = {
  overdue: "bg-destructive/12 text-destructive",
  "due-soon": "bg-[color-mix(in_oklab,var(--warning)_18%,transparent)] text-[var(--warning)]",
  ok: "bg-muted text-muted-foreground",
  none: "",
};

export function ContactCard({
  contact,
  timezone,
}: {
  contact: ContactListItem;
  timezone: string;
}) {
  const status = cadenceStatus(contact.nextTouchAt, timezone);
  const days = daysUntilTouch(contact.nextTouchAt, timezone);
  const message = cadenceMessage(days);

  return (
    <Link
      href={`/people/${contact.id}`}
      className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/60"
    >
      <Avatar className="size-11 shrink-0">
        {contact.avatarPath ? <AvatarImage src={contact.avatarPath} alt="" /> : null}
        <AvatarFallback>{initialsOf(contact.firstName, contact.lastName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-sm font-medium">{displayName(contact)}</span>
          {contact.isFavorite ? (
            <Star className="size-3.5 shrink-0 fill-[var(--warning)] text-[var(--warning)]" />
          ) : null}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {contact.category ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
                termColorClasses(contact.category.color),
              )}
            >
              {contact.category.icon ? (
                <Icon name={contact.category.icon} className="size-3" />
              ) : null}
              {contact.category.label}
            </span>
          ) : null}
          {contact.occupation ? <span className="truncate">{contact.occupation}</span> : null}
          {contact.city ? <span className="truncate">{contact.city}</span> : null}
        </div>
      </div>

      {message && status !== "none" ? (
        <span
          className={cn(
            "shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium",
            STATUS_STYLES[status],
          )}
        >
          {message}
        </span>
      ) : null}
    </Link>
  );
}
