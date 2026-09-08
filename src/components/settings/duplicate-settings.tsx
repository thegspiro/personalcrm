"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissDuplicate } from "@/server/actions/duplicates";

export interface DuplicateSuggestionView {
  key: string;
  a: { id: string; name: string; detail: string };
  b: { id: string; name: string; detail: string };
  /** "the same email address", "the same phone number". */
  reason: string;
}

/**
 * People who might be the same person.
 *
 * The scan matches on a shared email address or phone number and nothing else —
 * never on a name. Merging cannot be undone, and two people who share an email
 * are almost always one person where two people who share a name very often are
 * not.
 *
 * Reviewing is a separate screen rather than a control here, because choosing
 * what survives is the actual decision and it does not belong behind a button
 * that could be pressed by accident.
 */
export function DuplicateSettings({
  suggestions,
  truncated,
  locked,
}: {
  suggestions: DuplicateSuggestionView[];
  truncated: boolean;
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  async function dismiss(suggestion: DuplicateSuggestionView) {
    setBusy(suggestion.key);
    try {
      const form = new FormData();
      form.set("aContactId", suggestion.a.id);
      form.set("bContactId", suggestion.b.id);
      const result = await dismissDuplicate(form);
      if (!result.ok) {
        toast.error(result.error ?? "That could not be saved.");
        return;
      }
      toast.success("Noted — they will not be suggested again.");
      router.refresh();
    } catch (error) {
      console.error("Dismissing a duplicate failed", error);
      toast.error("That could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Possible duplicates</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          People who share an email address or a phone number. Names are never compared —
          two people with the same name are usually two people, and merging cannot be
          undone.
        </p>
      </div>

      {locked ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Unlock with your PIN to review these. Merging can move private details, so it is
          not offered while they are hidden.
        </p>
      ) : null}

      {suggestions.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          <Users className="size-4 shrink-0" />
          Nobody here shares an email address or phone number with anybody else.
        </p>
      ) : (
        <ul className="grid gap-2">
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.key}
              className="grid min-w-0 gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {suggestion.a.name} · {suggestion.b.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{suggestion.reason}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {suggestion.a.detail} — {suggestion.b.detail}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm" variant="outline" disabled={locked}>
                  <Link href={`/people/merge?a=${suggestion.a.id}&b=${suggestion.b.id}`}>
                    Review
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === suggestion.key}
                  disabled={locked || busy !== null}
                  onClick={() => void dismiss(suggestion)}
                >
                  Not the same person
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {truncated ? (
        <p className="text-xs text-muted-foreground">
          Only the first 2,000 people were scanned.
        </p>
      ) : null}
    </section>
  );
}
