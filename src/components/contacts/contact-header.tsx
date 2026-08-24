"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, BellOff, EyeOff, History, MoreVertical, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { cn, displayName, initialsOf } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogInteractionSheet } from "./log-interaction";
import type { TermOption } from "@/components/form/term-select";
import type { PickerContact } from "@/components/form/contact-picker";
import { cadenceMessage, termColorClasses } from "@/lib/format";
import { cadenceLabel } from "@/lib/cadence";
import { formatPartialDate, type DatePrecision } from "@/lib/date-precision";
import type { PlainDate } from "@/lib/dates";
import { deleteContact, patchContact, setContactArchived, snoozeContact } from "@/server/actions/contacts";
import { setPrivate } from "@/server/actions/privacy";

const STATUS_STYLES: Record<string, string> = {
  overdue: "bg-destructive/12 text-destructive",
  "due-soon": "bg-[color-mix(in_oklab,var(--warning)_18%,transparent)] text-[var(--warning)]",
  ok: "bg-muted text-muted-foreground",
};

export function ContactHeader({
  contact,
  cadence,
  interactionTypes,
  contacts,
}: {
  contact: {
    id: string;
    firstName: string;
    lastName: string | null;
    nickname: string | null;
    pronouns: string | null;
    avatarPath: string | null;
    occupation: string | null;
    employer: string | null;
    city: string | null;
    summary: string | null;
    isFavorite: boolean;
    isArchived: boolean;
    isRomantic: boolean;
    isPrivate: boolean;
    cadenceDays: number | null;
    birthDate: PlainDate | null;
    birthDatePrecision: DatePrecision;
    category: { label: string; icon: string | null; color: string | null } | null;
  };
  cadence: { status: string; message: string | null; lastSeen: string | null };
  interactionTypes: TermOption[];
  contacts: PickerContact[];
}) {
  const router = useRouter();
  const [logging, setLogging] = React.useState(false);

  async function run(action: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    const result = await action();
    if (!result.ok) {
      toast.error(result.error ?? "Something went wrong.");
      return;
    }
    toast.success(message);
    router.refresh();
  }

  const subtitle = [
    contact.occupation && contact.employer
      ? `${contact.occupation} at ${contact.employer}`
      : contact.occupation || contact.employer,
    contact.city,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <Avatar className="size-16 shrink-0 text-lg">
          {contact.avatarPath ? <AvatarImage src={contact.avatarPath} alt="" /> : null}
          <AvatarFallback>{initialsOf(contact.firstName, contact.lastName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">
              {displayName(contact)}
            </h2>
            {contact.isFavorite ? (
              <Star className="size-4 shrink-0 fill-[var(--warning)] text-[var(--warning)]" />
            ) : null}
          </div>

          {contact.nickname || contact.pronouns ? (
            <p className="text-xs text-muted-foreground">
              {[contact.nickname ? `“${contact.nickname}”` : null, contact.pronouns]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {contact.category ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  termColorClasses(contact.category.color),
                )}
              >
                {contact.category.label}
              </span>
            ) : null}
            {cadence.message ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  STATUS_STYLES[cadence.status] ?? "bg-muted text-muted-foreground",
                )}
              >
                {cadence.message}
              </span>
            ) : null}
            {contact.isArchived ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                Archived
              </span>
            ) : null}
            {contact.isPrivate ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-3 px-2 py-0.5 text-[11px] font-medium text-accent-11">
                <EyeOff className="size-3" />
                Private
              </span>
            ) : null}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Contact actions">
              <MoreVertical className="size-[18px]" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem asChild>
              <Link href={`/people/${contact.id}/edit`}>
                <Pencil />
                Edit details
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/people/${contact.id}/backfill`}>
                <History />
                Backfill history
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void run(
                  () => patchContact(contact.id, { isFavorite: !contact.isFavorite }),
                  contact.isFavorite ? "Removed from favourites" : "Added to favourites",
                )
              }
            >
              <Star />
              {contact.isFavorite ? "Remove favourite" : "Make favourite"}
            </DropdownMenuItem>

            {contact.cadenceDays ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Snooze reminders</DropdownMenuLabel>
                {[7, 30, 90].map((days) => (
                  <DropdownMenuItem
                    key={days}
                    onSelect={() =>
                      void run(() => snoozeContact(contact.id, days), `Snoozed ${days} days`)
                    }
                  >
                    <BellOff />
                    {days} days
                  </DropdownMenuItem>
                ))}
              </>
            ) : null}

            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() =>
                void run(
                  () => setPrivate("contact", contact.id, !contact.isPrivate),
                  contact.isPrivate ? "Visible again" : "Marked private",
                )
              }
            >
              <EyeOff />
              {contact.isPrivate ? "Remove private mark" : "Mark private"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                void run(
                  () => setContactArchived(contact.id, !contact.isArchived),
                  contact.isArchived ? "Restored" : "Archived",
                )
              }
            >
              <Archive />
              {contact.isArchived ? "Restore" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                if (!confirm(`Delete ${displayName(contact)} and everything logged about them?`)) {
                  return;
                }
                void deleteContact(contact.id).then((result) => {
                  if (!result.ok) {
                    toast.error(result.error ?? "Could not delete.");
                    return;
                  }
                  toast.success("Deleted");
                  router.push("/people");
                  router.refresh();
                });
              }}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {contact.summary ? <p className="text-sm text-muted-foreground">{contact.summary}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setLogging(true)}>
          <Plus />
          Log interaction
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`/people/${contact.id}/backfill`}>
            <History />
            Backfill
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">
          {cadence.lastSeen ?? "Nothing logged yet"}
          {contact.cadenceDays ? ` · ${cadenceLabel(contact.cadenceDays)}` : ""}
        </span>
      </div>

      {contact.birthDate ? (
        <p className="text-xs text-muted-foreground">
          Birthday {formatPartialDate(contact.birthDate, contact.birthDatePrecision)}
        </p>
      ) : null}

      <LogInteractionSheet
        open={logging}
        onOpenChange={setLogging}
        contacts={contacts}
        types={interactionTypes}
        defaultContactIds={[contact.id]}
      />
    </div>
  );
}
