"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { cn, displayName, initialsOf } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/nav/icon";
import { RatingDisplay } from "@/components/form/rating-input";
import { EmptyState } from "@/components/ui/empty-state";
import { termColorClasses } from "@/lib/format";
import { diffPlainDays, calendarDateInTz, type PlainDate } from "@/lib/dates";
import { setDatingStage } from "@/server/actions/dating";

export interface PipelinePersonView {
  id: string;
  firstName: string;
  lastName: string | null;
  avatarPath: string | null;
  city: string | null;
  stageId: string | null;
  sourceLabel: string | null;
  overallRating: number | null;
  chemistryScore: number | null;
  exclusive: boolean;
  dateCount: number;
  lastInteractionAt: Date | null;
  greenFlags: number;
  redFlags: number;
  dealbreakers: number;
}

export interface StageView {
  id: string;
  label: string;
  icon: string | null;
  color: string | null;
  terminal: boolean;
  people: PipelinePersonView[];
}

/**
 * The pipeline as grouped sections rather than a drag-and-drop board.
 *
 * A stage picker on each person works identically with a thumb and a mouse,
 * and the terminal stage becomes just another section instead of needing its
 * own hiding rules.
 */
export function PipelineList({
  stages,
  unstaged,
  timezone,
  today,
}: {
  stages: StageView[];
  unstaged: PipelinePersonView[];
  timezone: string;
  today: PlainDate;
}) {
  const allStages = React.useMemo(
    () => stages.map((s) => ({ id: s.id, label: s.label })),
    [stages],
  );

  const sections = [
    ...(unstaged.length > 0
      ? [{ id: "", label: "No stage yet", icon: "CircleDashed", color: null, terminal: false, people: unstaged }]
      : []),
    ...stages.filter((stage) => stage.people.length > 0),
  ];

  if (sections.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="Heart" />}
        title="Nobody in the pipeline"
        description="Mark someone as dating or interested on their page and they'll show up here."
      />
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {sections.map((section) => (
        <section key={section.id || "unstaged"} className="grid min-w-0 gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full",
                termColorClasses(section.color),
              )}
            >
              <Icon name={section.icon ?? "CircleDot"} className="size-3.5" />
            </span>
            <h3
              className={cn(
                "text-sm font-semibold",
                section.terminal && "text-muted-foreground",
              )}
            >
              {section.label}
            </h3>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {section.people.length}
            </span>
          </div>

          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {section.people.map((person) => (
              <li key={person.id}>
                <PipelineCard
                  person={person}
                  stages={allStages}
                  timezone={timezone}
                  today={today}
                  dimmed={section.terminal}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PipelineCard({
  person,
  stages,
  timezone,
  today,
  dimmed,
}: {
  person: PipelinePersonView;
  stages: Array<{ id: string; label: string }>;
  timezone: string;
  today: PlainDate;
  dimmed: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const daysQuiet = person.lastInteractionAt
    ? -diffPlainDays(today, calendarDateInTz(person.lastInteractionAt, timezone))
    : null;

  async function move(stageId: string) {
    setPending(true);
    const result = await setDatingStage(person.id, stageId || null);
    setPending(false);
    if (!result.ok) {
      toast.error(result.error ?? "Could not move them.");
      return;
    }
    toast.success("Moved");
    router.refresh();
  }

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5",
        dimmed && "opacity-70",
      )}
    >
      <Link href={`/people/${person.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="size-10 shrink-0">
          {person.avatarPath ? <AvatarImage src={person.avatarPath} alt="" /> : null}
          <AvatarFallback>{initialsOf(person.firstName, person.lastName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium">{displayName(person)}</span>
            {person.exclusive ? <Badge variant="success">Exclusive</Badge> : null}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {person.dateCount} {person.dateCount === 1 ? "date" : "dates"}
            </span>
            {daysQuiet !== null ? (
              <span className={cn(daysQuiet >= 10 && "text-[var(--warning)]")}>
                {daysQuiet === 0 ? "spoke today" : `${daysQuiet}d quiet`}
              </span>
            ) : (
              <span>no contact logged</span>
            )}
            {person.sourceLabel ? <span className="truncate">{person.sourceLabel}</span> : null}
            {person.greenFlags > 0 ? (
              <span className="text-[var(--success)]">{person.greenFlags}↑</span>
            ) : null}
            {person.redFlags > 0 ? (
              <span className="text-[var(--warning)]">{person.redFlags}↓</span>
            ) : null}
            {person.dealbreakers > 0 ? (
              <span className="text-destructive">{person.dealbreakers}✕</span>
            ) : null}
          </div>

          {person.overallRating ? (
            <div className="mt-1">
              <RatingDisplay value={person.overallRating} label="Overall" />
            </div>
          ) : null}
        </div>
      </Link>

      <div className="relative shrink-0">
        <select
          aria-label={`Stage for ${displayName(person)}`}
          value={person.stageId ?? ""}
          disabled={pending}
          onChange={(event) => void move(event.target.value)}
          className="h-9 w-[7.5rem] appearance-none rounded-lg border border-border bg-card pl-2.5 pr-7 text-xs disabled:opacity-50"
        >
          <option value="">No stage</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    </div>
  );
}
