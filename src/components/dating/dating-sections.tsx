"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Flag, HeartCrack, ShieldAlert, ThumbsUp, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { DateField, DateTimeField } from "@/components/form/date-field";
import { RatingInput, RatingDisplay } from "@/components/form/rating-input";
import { TermChips, TermSelect, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import { PrivateText } from "./private-text";
import { EndRelationshipSheet } from "./end-relationship-sheet";
import { formatMoney } from "@/lib/format";
import { formatPartialDate } from "@/lib/date-precision";
import { plainDateFromDb } from "@/lib/dates";
import type { ActionResult } from "@/server/actions/helpers";
import {
  convertToFriend,
  createDateEntry,
  createFlag,
  deleteDateEntry,
  deleteFlag,
  upsertRomanticProfile,
} from "@/server/actions/dating";

function useRun() {
  const router = useRouter();
  return React.useCallback(
    async (run: () => Promise<ActionResult<unknown>>, message?: string) => {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return false;
      }
      if (message) toast.success(message);
      router.refresh();
      return true;
    },
    [router],
  );
}

// --- profile ---------------------------------------------------------------

export interface RomanticProfileValues {
  stageId: string | null;
  sourceId: string | null;
  sourceDetail: string | null;
  matchedOn: string | null;
  firstDateOn: string | null;
  endedOn: Date | null;
  endedReason: string | null;
  retrospective: string | null;
  birthYear: number | null;
  heightCm: number | null;
  distanceKm: number | null;
  livingSituation: string | null;
  relationshipStyle: string | null;
  wantsKids: string;
  hasKids: boolean | null;
  religion: string | null;
  politics: string | null;
  smoking: string | null;
  drinking: string | null;
  mbti: string | null;
  enneagram: string | null;
  exclusive: boolean;
  overallRating: number | null;
  chemistryScore: number | null;
  privateNotes: string | null;
}

const KIDS_OPTIONS = [
  { value: "UNKNOWN", label: "Not discussed" },
  { value: "WANTS", label: "Wants kids" },
  { value: "DOES_NOT_WANT", label: "Doesn't want kids" },
  { value: "OPEN", label: "Open either way" },
  { value: "HAS_AND_DONE", label: "Has kids, done" },
];

export function RomanticSection({
  contactId,
  contactName,
  profile,
  stages,
  sources,
  blurPrivate,
}: {
  contactId: string;
  contactName: string;
  profile: RomanticProfileValues | null;
  stages: TermOption[];
  sources: TermOption[];
  blurPrivate: boolean;
}) {
  const run = useRun();
  const router = useRouter();
  const [editing, setEditing] = React.useState(!profile);
  const [ending, setEnding] = React.useState(false);

  async function save(form: FormData) {
    form.set("contactId", contactId);
    const okResult = await run(() => upsertRomanticProfile(form), "Saved");
    if (okResult) setEditing(false);
  }

  const stageLabel = stages.find((s) => s.id === profile?.stageId)?.label;

  return (
    <SectionCard title="Dating" icon="Heart" defaultOpen>
      {editing ? (
        <form action={save} className="grid gap-3">
          <TermChips name="stageId" label="Stage" terms={stages} defaultValue={profile?.stageId} emptyLabel="No stage" />

          <div className="grid gap-3 sm:grid-cols-2">
            <TermSelect name="sourceId" label="Where you met" terms={sources} defaultValue={profile?.sourceId} placeholder="Not sure" />
            <Field label="Details" htmlFor="sourceDetail">
              <Input id="sourceDetail" name="sourceDetail" defaultValue={profile?.sourceDetail ?? ""} placeholder="Opened with a joke about my bookshelf" />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <DateField name="matchedOn" label="Matched" defaultValue={profile?.matchedOn} allowPrecision={false} presets={["today", "lastWeek", "lastMonth"]} />
            <DateField name="firstDateOn" label="First date" defaultValue={profile?.firstDateOn} allowPrecision={false} presets={["today", "lastWeek", "lastMonth"]} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <RatingInput name="overallRating" label="Overall" defaultValue={profile?.overallRating} />
            <RatingInput name="chemistryScore" label="Chemistry" defaultValue={profile?.chemistryScore} />
          </div>

          <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Compatibility
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Wants kids" htmlFor="wantsKids">
              <select id="wantsKids" name="wantsKids" defaultValue={profile?.wantsKids ?? "UNKNOWN"} className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm">
                {KIDS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Relationship style" htmlFor="relationshipStyle">
              <Input id="relationshipStyle" name="relationshipStyle" defaultValue={profile?.relationshipStyle ?? ""} placeholder="Monogamous" />
            </Field>
            <Field label="Living situation" htmlFor="livingSituation">
              <Input id="livingSituation" name="livingSituation" defaultValue={profile?.livingSituation ?? ""} placeholder="Own place, no roommates" />
            </Field>
            <Field label="Distance (km)" htmlFor="distanceKm">
              <Input id="distanceKm" name="distanceKm" type="number" inputMode="numeric" min={0} defaultValue={profile?.distanceKm ?? ""} />
            </Field>
            <Field label="Birth year" htmlFor="birthYear">
              <Input id="birthYear" name="birthYear" type="number" inputMode="numeric" min={1900} max={2100} defaultValue={profile?.birthYear ?? ""} />
            </Field>
            <Field label="Height (cm)" htmlFor="heightCm">
              <Input id="heightCm" name="heightCm" type="number" inputMode="numeric" min={0} defaultValue={profile?.heightCm ?? ""} />
            </Field>
            <Field label="Religion" htmlFor="religion">
              <Input id="religion" name="religion" defaultValue={profile?.religion ?? ""} />
            </Field>
            <Field label="Politics" htmlFor="politics">
              <Input id="politics" name="politics" defaultValue={profile?.politics ?? ""} />
            </Field>
            <Field label="Drinking" htmlFor="drinking">
              <Input id="drinking" name="drinking" defaultValue={profile?.drinking ?? ""} placeholder="Socially" />
            </Field>
            <Field label="Smoking" htmlFor="smoking">
              <Input id="smoking" name="smoking" defaultValue={profile?.smoking ?? ""} placeholder="Never" />
            </Field>
            <Field label="MBTI" htmlFor="mbti">
              <Input id="mbti" name="mbti" maxLength={8} defaultValue={profile?.mbti ?? ""} />
            </Field>
            <Field label="Enneagram" htmlFor="enneagram">
              <Input id="enneagram" name="enneagram" maxLength={16} defaultValue={profile?.enneagram ?? ""} />
            </Field>
          </div>

          <Field label="Private notes" htmlFor="privateNotes" hint="Only you ever see this.">
            <Textarea id="privateNotes" name="privateNotes" rows={3} defaultValue={profile?.privateNotes ?? ""} />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="exclusive" value="true" defaultChecked={profile?.exclusive ?? false} className="size-4" />
            Exclusive
          </label>

          <div className="flex gap-2">
            <SubmitButton size="sm" className="flex-1">Save</SubmitButton>
            {profile ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {stageLabel ? <Badge variant="default">{stageLabel}</Badge> : null}
            {profile?.exclusive ? <Badge variant="success">Exclusive</Badge> : null}
            {profile?.endedOn ? (
              <Badge variant="muted">
                Ended {formatPartialDate(plainDateFromDb(profile.endedOn), "DAY", { short: true })}
              </Badge>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {profile?.overallRating ? (
              <span className="inline-flex items-center gap-1">
                Overall <RatingDisplay value={profile.overallRating} />
              </span>
            ) : null}
            {profile?.chemistryScore ? (
              <span className="inline-flex items-center gap-1">
                Chemistry <RatingDisplay value={profile.chemistryScore} />
              </span>
            ) : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <Detail label="Wants kids" value={KIDS_OPTIONS.find((k) => k.value === profile?.wantsKids)?.label} />
            <Detail label="Style" value={profile?.relationshipStyle} />
            <Detail label="Living" value={profile?.livingSituation} />
            <Detail label="Distance" value={profile?.distanceKm ? `${profile.distanceKm} km` : null} />
            <Detail label="Religion" value={profile?.religion} />
            <Detail label="Politics" value={profile?.politics} />
            <Detail label="Drinking" value={profile?.drinking} />
            <Detail label="Smoking" value={profile?.smoking} />
            <Detail label="MBTI" value={profile?.mbti} />
            <Detail label="Born" value={profile?.birthYear ? String(profile.birthYear) : null} />
          </dl>

          {profile?.privateNotes ? (
            <div className="rounded-lg border border-border/70 p-2.5">
              <p className="pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Private notes
              </p>
              <PrivateText enabled={blurPrivate} className="whitespace-pre-line text-sm">
                {profile.privateNotes}
              </PrivateText>
            </div>
          ) : null}

          {profile?.endedReason || profile?.retrospective ? (
            <div className="grid gap-2 rounded-lg border border-border/70 p-2.5">
              {profile.endedReason ? (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Why it ended
                  </p>
                  <PrivateText enabled={blurPrivate} className="text-sm">
                    {profile.endedReason}
                  </PrivateText>
                </div>
              ) : null}
              {profile.retrospective ? (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Looking back
                  </p>
                  <PrivateText enabled={blurPrivate} className="text-sm">
                    {profile.retrospective}
                  </PrivateText>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEnding(true)}>
              <HeartCrack />
              End it
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (!confirm(`Keep ${contactName} as a normal contact? Every date, flag and note stays.`)) return;
                void run(() => convertToFriend(contactId), "Moved to contacts").then((done) => {
                  if (done) router.refresh();
                });
              }}
            >
              <UserMinus />
              Just a friend
            </Button>
          </div>
        </div>
      )}

      <EndRelationshipSheet
        open={ending}
        onOpenChange={setEnding}
        contactId={contactId}
        contactName={contactName}
        defaults={{ endedReason: profile?.endedReason ?? null, retrospective: profile?.retrospective ?? null }}
      />
    </SectionCard>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

// --- date log --------------------------------------------------------------

export interface DateLogItem {
  id: string;
  sequence: number | null;
  occurredAt: Date;
  venue: string | null;
  city: string | null;
  whoPaid: "UNSPECIFIED" | "ME" | "THEM" | "SPLIT";
  costCents: number | null;
  rating: number | null;
  chemistry: number | null;
  conversationQuality: number | null;
  notes: string | null;
  activityLabel: string | null;
}

const WHO_PAID_LABELS: Record<string, string> = {
  ME: "I paid",
  THEM: "They paid",
  SPLIT: "Split",
  UNSPECIFIED: "",
};

export function DateLogSection({
  contactId,
  dates,
  activityTypes,
  blurPrivate,
}: {
  contactId: string;
  dates: DateLogItem[];
  activityTypes: TermOption[];
  blurPrivate: boolean;
}) {
  const run = useRun();

  function add(close: () => void) {
    return async (form: FormData) => {
      form.set("contactId", contactId);
      if (await run(() => createDateEntry(form), "Date logged")) close();
    };
  }

  return (
    <SectionCard
      title="Dates"
      icon="CalendarHeart"
      count={dates.length}
      addLabel="Log a date"
      form={(close) => (
        <form action={add(close)} className="grid gap-2.5">
          <TermChips name="activityTypeId" label="What did you do?" terms={activityTypes} allowEmpty={false} />
          <DateTimeField
            name="occurredAt"
            label="When"
            hint="Logging one you forgot? Set it back — it won't disturb your cadence."
          />
          <Field label="Where" htmlFor="date-venue">
            <Input id="date-venue" name="venue" placeholder="Northside Social" />
          </Field>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <RatingInput name="rating" label="How was it?" />
            <RatingInput name="chemistry" label="Chemistry" />
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Who paid" htmlFor="whoPaid">
              <select id="whoPaid" name="whoPaid" defaultValue="UNSPECIFIED" className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm">
                <option value="UNSPECIFIED">Not noted</option>
                <option value="ME">I paid</option>
                <option value="THEM">They paid</option>
                <option value="SPLIT">Split</option>
              </select>
            </Field>
            <Field label="Cost" htmlFor="date-cost">
              <Input id="date-cost" name="cost" type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" />
            </Field>
          </div>
          <Field label="Notes" htmlFor="date-notes">
            <Textarea id="date-notes" name="notes" rows={2} placeholder="What did you talk about? How did it feel?" />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="isPrivate" value="true" className="size-4" />
            Hide this behind the privacy lock
          </label>
          <SubmitButton size="sm">Log it</SubmitButton>
        </form>
      )}
    >
      {dates.length === 0 ? (
        <SectionEmpty>No dates logged yet.</SectionEmpty>
      ) : (
        dates.map((entry) => (
          <SectionRow
            key={entry.id}
            onDelete={() => void run(() => deleteDateEntry(entry.id), "Removed")}
            deleteLabel="Delete date"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {entry.sequence ? `Date ${entry.sequence}` : "Date"}
                {entry.venue ? ` — ${entry.venue}` : ""}
              </span>
              <RatingDisplay value={entry.rating} label="Rating" />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{formatPartialDate({
                year: entry.occurredAt.getFullYear(),
                month: entry.occurredAt.getMonth() + 1,
                day: entry.occurredAt.getDate(),
              }, "DAY", { short: true })}</span>
              {entry.activityLabel ? <span>{entry.activityLabel}</span> : null}
              {WHO_PAID_LABELS[entry.whoPaid] ? <span>{WHO_PAID_LABELS[entry.whoPaid]}</span> : null}
              {formatMoney(entry.costCents) ? <span>{formatMoney(entry.costCents)}</span> : null}
            </div>
            {entry.notes ? (
              <PrivateText enabled={blurPrivate} className="mt-1 block whitespace-pre-line text-xs text-muted-foreground">
                {entry.notes}
              </PrivateText>
            ) : null}
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}

// --- flags -----------------------------------------------------------------

export interface FlagItem {
  id: string;
  kind: "GREEN" | "RED" | "DEALBREAKER";
  text: string;
  severity: number;
}

const FLAG_META: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  GREEN: {
    label: "Green flags",
    className: "text-[var(--success)]",
    icon: <ThumbsUp className="size-3.5" />,
  },
  RED: { label: "Red flags", className: "text-[var(--warning)]", icon: <Flag className="size-3.5" /> },
  DEALBREAKER: {
    label: "Dealbreakers",
    className: "text-destructive",
    icon: <ShieldAlert className="size-3.5" />,
  },
};

export function FlagsSection({
  contactId,
  flags,
  blurPrivate,
}: {
  contactId: string;
  flags: FlagItem[];
  blurPrivate: boolean;
}) {
  const run = useRun();
  const [kind, setKind] = React.useState<"GREEN" | "RED" | "DEALBREAKER">("GREEN");

  function add(close: () => void) {
    return async (form: FormData) => {
      form.set("contactId", contactId);
      form.set("kind", kind);
      if (await run(() => createFlag(form), "Noted")) close();
    };
  }

  const grouped = (["GREEN", "RED", "DEALBREAKER"] as const).map((k) => ({
    kind: k,
    items: flags.filter((flag) => flag.kind === k),
  }));

  return (
    <SectionCard
      title="Flags"
      icon="Flag"
      count={flags.length}
      addLabel="Add a flag"
      form={(close) => (
        <form action={add(close)} className="grid gap-2.5">
          <div className="flex gap-1.5">
            {(["GREEN", "RED", "DEALBREAKER"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={cn(
                  "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors",
                  kind === k ? "border-accent-8 bg-accent-3 text-accent-11" : "border-border hover:bg-muted",
                )}
              >
                {FLAG_META[k].icon}
                {k === "DEALBREAKER" ? "Dealbreaker" : k === "GREEN" ? "Green" : "Red"}
              </button>
            ))}
          </div>
          <Field label="What did you notice?" htmlFor="flag-text">
            <Textarea id="flag-text" name="text" rows={2} required placeholder="Says what she means without being unkind." />
          </Field>
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {flags.length === 0 ? (
        <SectionEmpty>Nothing flagged either way.</SectionEmpty>
      ) : (
        grouped
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <div key={group.kind} className="grid gap-1.5">
              <p className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", FLAG_META[group.kind].className)}>
                {FLAG_META[group.kind].icon}
                {FLAG_META[group.kind].label}
              </p>
              {group.items.map((flag) => (
                <SectionRow
                  key={flag.id}
                  onDelete={() => void run(() => deleteFlag(flag.id), "Removed")}
                  deleteLabel="Delete flag"
                >
                  <PrivateText enabled={blurPrivate} className="block text-sm">
                    {flag.text}
                  </PrivateText>
                </SectionRow>
              ))}
            </div>
          ))
      )}
    </SectionCard>
  );
}
