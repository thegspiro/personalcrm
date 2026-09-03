"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, displayName, initialsOf } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Icon } from "@/components/nav/icon";
import { termColorClasses } from "@/lib/format";
import { generationLabel, groupFamilyBand, type FamilyTier } from "@/lib/family";

export interface TreePerson {
  id: string;
  firstName: string;
  lastName: string | null;
  nickname?: string | null;
  avatarPath?: string | null;
  isArchived: boolean;
  /** How they relate to the anchor, when there is a direct link. */
  terms: Array<{ label: string; icon: string | null; color: string | null }>;
  /** Closest tier among those links; null when the anchor has no direct link. */
  tier: FamilyTier | null;
  /** The relative the shortest path came through, when there is no direct link. */
  via: { id: string; name: string } | null;
  householdNames: string[];
}

export interface TreeBand {
  generation: number;
  people: TreePerson[];
}

/**
 * The family, banded by generation and grouped by closeness inside each band.
 *
 * Not a genealogical tree with drawn lines: on a phone those either scroll in
 * two directions or shrink to nothing, and a personal CRM records a lopsided
 * fragment of a family rather than a complete pedigree. Bands say the useful
 * thing — who is a generation up, who is a generation down — and stay readable
 * at 375px wide.
 *
 * A band on its own is not enough, though. A generation is not a relationship,
 * so banding alone sets a cousin, a sibling-in-law and a stepsister beside your
 * own sister — which is exactly the distinction the page exists to make. Each
 * band is therefore split by tier, and the people the anchor has no direct link
 * to are grouped under the relative they hang off rather than guessed into a
 * tier beside relationships that were actually recorded.
 *
 * Anyone with no path to the anchor still appears, in their own band, rather
 * than being dropped for not fitting the shape.
 */
export function FamilyTree({
  bands,
  anchorId,
  anchorName,
  anchorOptions = [],
}: {
  bands: TreeBand[];
  /**
   * Whose point of view the generations are measured from.
   *
   * The id, not the name. Matching the selected option by display name picked
   * the wrong person whenever two of them shared one — two cousins called Sam,
   * or anybody recorded twice under a nickname — and the picker then claimed
   * the tree was rooted on someone it was not.
   */
  anchorId: string | null;
  anchorName: string | null;
  /** Everyone in the tree, so it can be re-rooted on any of them. */
  anchorOptions?: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [rerooting, startTransition] = React.useTransition();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {anchorId && anchorOptions.length > 1 ? (
        <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Generations measured from</span>
          <select
            // Keyed on the server's answer so going back or forward resets the
            // control to the anchor the page is actually rendered for; an
            // uncontrolled select keeps whatever was last chosen otherwise.
            key={anchorId}
            defaultValue={anchorId}
            onChange={(event) => {
              const next = event.target.value;
              startTransition(() => router.push(`/family?anchor=${encodeURIComponent(next)}`));
            }}
            aria-label="Measure generations from"
            disabled={rerooting}
            className="h-9 w-full min-w-0 flex-1 basis-40 rounded-lg border border-input bg-card px-2 text-sm disabled:opacity-60"
          >
            {anchorOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {bands.map((band) => {
        // The anchor roots its own band rather than joining a group inside it:
        // there is no link from someone to themselves for a tier to come from.
        const anchor = band.people.find((person) => person.id === anchorId);
        const groups = groupFamilyBand(
          band.people.filter((person) => person.id !== anchorId),
          anchorName,
        );
        // Headings only where they separate something. A band of nothing but
        // immediate family — your parents, usually — reads better without one.
        // Any other lone group is worth naming: "Extended family" and "Through
        // Mum" both say something the cards themselves do not.
        const showHeadings = groups.length > 1 || groups[0]?.key !== "tier:immediate";

        return (
          <section key={band.generation} className="min-w-0 rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {generationLabel(band.generation, anchorName)}
              </h3>
              <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {band.people.length}
              </span>
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-3">
              {anchor ? (
                <ul className="grid gap-2 sm:grid-cols-2">
                  <PersonCard person={anchor} isAnchor />
                </ul>
              ) : null}

              {groups.map((group) => (
                <div key={group.key} className="grid grid-cols-[minmax(0,1fr)] gap-2">
                  {showHeadings ? (
                    <h4 className="truncate px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </h4>
                  ) : null}
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {group.people.map((person) => (
                      <PersonCard key={person.id} person={person} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function PersonCard({ person, isAnchor = false }: { person: TreePerson; isAnchor?: boolean }) {
  return (
    <li className="min-w-0">
      <Link
        href={`/people/${person.id}`}
        className="flex min-w-0 items-start gap-2 rounded-lg border border-border/70 px-3 py-2 transition-colors hover:bg-muted/50"
      >
        <Avatar className="size-8 shrink-0">
          {person.avatarPath ? <AvatarImage src={person.avatarPath} alt="" /> : null}
          <AvatarFallback className="text-[11px]">
            {initialsOf(person.firstName, person.lastName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium",
              person.isArchived && "text-muted-foreground",
            )}
          >
            {displayName(person)}
          </p>
          {isAnchor ? (
            <span className="mt-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              Measured from here
            </span>
          ) : null}
          {person.terms.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {person.terms.map((term) => (
                <span
                  key={term.label}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px]",
                    termColorClasses(term.color),
                  )}
                >
                  {term.icon ? <Icon name={term.icon} className="size-3 shrink-0" /> : null}
                  <span className="truncate">{term.label}</span>
                </span>
              ))}
            </div>
          ) : null}
          {person.householdNames.length > 0 ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {person.householdNames.join(" · ")}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}
