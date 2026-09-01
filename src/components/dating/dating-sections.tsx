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
import {
  CollapsibleCustomFields,
  type RenderableField,
} from "@/components/custom-fields/field-renderer";
import { DateField, DateTimeField } from "@/components/form/date-field";
import { RatingInput, RatingDisplay } from "@/components/form/rating-input";
import { TermChips, TermSelect, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "@/components/contacts/section-card";
import { PrivateText } from "./private-text";
import { EndRelationshipSheet } from "./end-relationship-sheet";
import { formatMoney } from "@/lib/format";
import { formatPartialDate } from "@/lib/date-precision";
import { plainDateFromDb, plainDateKey, type PlainDate } from "@/lib/dates";
import type { ActionResult } from "@/server/actions/helpers";
import {
  convertToFriend,
  createDateEntry,
  createFlag,
  deleteDateEntry,
  deleteFlag,
  updateDateEntry,
  updateFlag,
  upsertRomanticProfile,
} from "@/server/actions/dating";
import { createPlan } from "@/server/actions/details";

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
  customFields = [],
}: {
  contactId: string;
  contactName: string;
  profile: RomanticProfileValues | null;
  stages: TermOption[];
  sources: TermOption[];
  blurPrivate: boolean;
  /** Defined under Settings → Fields → Dating profiles. */
  customFields?: RenderableField[];
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

          <CollapsibleCustomFields fields={customFields} />

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
  wouldDoAgain: boolean | null;
  nextTimeNotes: string | null;
  isPrivate: boolean;
  activityTypeId: string | null;
  activityLabel: string | null;
}

/** Just enough of a saved plan to pick one when logging the date it became. */
export interface PlanOption {
  id: string;
  title: string;
  location: string | null;
  /** Plan.city became the wider Plan.address; DateEntry keeps its own city. */
  address: string | null;
  notes: string | null;
}

const WHO_PAID_LABELS: Record<string, string> = {
  ME: "I paid",
  THEM: "They paid",
  SPLIT: "Split",
  UNSPECIFIED: "",
};

/**
 * Logging a date and correcting one, from one description.
 *
 * Every field is here, including the city and the conversation rating the row
 * does not render: `updateDateEntry` writes the whole form, so a field only the
 * add form carried would be cleared the first time the date was edited.
 *
 * The venue is controlled when adding, because picking a saved plan fills it
 * in, and uncontrolled when editing, where there is nothing to fill it from.
 */
function DateEntryFields({
  formId,
  activityTypes,
  entry,
  venue,
  onVenueChange,
  customFields = [],
}: {
  formId: string;
  activityTypes: TermOption[];
  entry?: DateLogItem;
  venue?: string;
  onVenueChange?: (value: string) => void;
  /**
   * Defined under Settings → Fields → Dates. Rendered here rather than on each
   * form, so the hidden "which fields were on screen" marker is present on
   * both — without it a save from the form that omits them clears every
   * boolean on the record.
   */
  customFields?: RenderableField[];
}) {
  return (
    <>
      <TermChips
        name="activityTypeId"
        label="What did you do?"
        terms={activityTypes}
        defaultValue={entry?.activityTypeId}
        allowEmpty={false}
      />
      <DateTimeField
        name="occurredAt"
        label="When"
        defaultValue={entry?.occurredAt}
        hint="Logging one you forgot? Set it back — it won't disturb your cadence."
      />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Where" htmlFor={`${formId}-venue`}>
          {onVenueChange ? (
            <Input
              id={`${formId}-venue`}
              name="venue"
              value={venue ?? ""}
              onChange={(event) => onVenueChange(event.target.value)}
              placeholder="Northside Social"
            />
          ) : (
            <Input
              id={`${formId}-venue`}
              name="venue"
              defaultValue={entry?.venue ?? ""}
              placeholder="Northside Social"
            />
          )}
        </Field>
        <Field label="City" htmlFor={`${formId}-city`}>
          <Input id={`${formId}-city`} name="city" defaultValue={entry?.city ?? ""} />
        </Field>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <RatingInput name="rating" label="How was it?" defaultValue={entry?.rating} />
        <RatingInput name="chemistry" label="Chemistry" defaultValue={entry?.chemistry} />
      </div>
      <RatingInput
        name="conversationQuality"
        label="Conversation"
        defaultValue={entry?.conversationQuality}
      />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Who paid" htmlFor={`${formId}-whoPaid`}>
          <select
            id={`${formId}-whoPaid`}
            name="whoPaid"
            defaultValue={entry?.whoPaid ?? "UNSPECIFIED"}
            className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            <option value="UNSPECIFIED">Not noted</option>
            <option value="ME">I paid</option>
            <option value="THEM">They paid</option>
            <option value="SPLIT">Split</option>
          </select>
        </Field>
        <Field label="Cost" htmlFor={`${formId}-cost`}>
          <Input
            id={`${formId}-cost`}
            name="cost"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            defaultValue={entry?.costCents == null ? "" : entry.costCents / 100}
            placeholder="0.00"
          />
        </Field>
      </div>
      <Field label="Notes" htmlFor={`${formId}-notes`}>
        <Textarea
          id={`${formId}-notes`}
          name="notes"
          rows={2}
          defaultValue={entry?.notes ?? ""}
          placeholder="What did you talk about? How did it feel?"
        />
      </Field>
      <fieldset className="grid gap-2 rounded-lg border border-border/70 p-3">
        <legend className="px-1 text-xs font-medium">Optional post-date reflection</legend>
        <span className="text-xs text-muted-foreground">Would you do this again?</span>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="wouldDoAgain" value="true" defaultChecked={entry?.wouldDoAgain === true} /> Yes
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="wouldDoAgain" value="false" defaultChecked={entry?.wouldDoAgain === false} /> No
          </label>
        </div>
        <Field label="Remember for next time" htmlFor={`${formId}-next-time`}>
          <Textarea id={`${formId}-next-time`} name="nextTimeNotes" rows={2} defaultValue={entry?.nextTimeNotes ?? ""} placeholder="What would make a repeat even better?" />
        </Field>
      </fieldset>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="isPrivate"
          value="true"
          defaultChecked={entry?.isPrivate ?? false}
          className="size-4"
        />
        Hide this behind the privacy lock
      </label>
      <CollapsibleCustomFields fields={customFields} />
    </>
  );
}

export function DateLogSection({
  contactId,
  dates,
  activityTypes,
  plans = [],
  blurPrivate,
  customFields = [],
  customFieldsByDate = {},
}: {
  contactId: string;
  dates: DateLogItem[];
  activityTypes: TermOption[];
  /** Plans saved for this person — picking one closes it out. */
  plans?: PlanOption[];
  blurPrivate: boolean;
  /** Field definitions for a new date, with no values yet. */
  customFields?: RenderableField[];
  /** The same definitions carrying each existing date's saved values. */
  customFieldsByDate?: Record<string, RenderableField[]>;
}) {
  const run = useRun();
  // The venue is prefilled from a picked idea, so it has to be controlled.
  const [venue, setVenue] = React.useState("");
  const [pickedPlan, setPickedPlan] = React.useState<PlanOption | null>(null);

  function add(close: () => void) {
    return async (form: FormData) => {
      form.set("contactId", contactId);
      if (await run(() => createDateEntry(form), "Date logged")) {
        setVenue("");
        setPickedPlan(null);
        close();
      }
    };
  }

  function edit(entry: DateLogItem, close: () => void) {
    return async (form: FormData) => {
      form.set("id", entry.id);
      if (await run(() => updateDateEntry(form), "Saved")) close();
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
          {plans.length > 0 ? (
            <Field label="From a saved idea" htmlFor="date-plan">
              <select
                id="date-plan"
                name="planId"
                defaultValue=""
                onChange={(event) => {
                  const picked = plans.find((plan) => plan.id === event.target.value);
                  setPickedPlan(picked ?? null);
                  if (picked) setVenue(picked.location ?? picked.title);
                }}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                <option value="">Not from the list</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.title}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          {pickedPlan ? (
            <div className="grid gap-1 rounded-lg border border-border/70 bg-muted/30 p-3 text-xs">
              <p className="font-medium">Planning context (not copied into your reflection)</p>
              {pickedPlan.location ? <p>Venue: {pickedPlan.location}</p> : null}
              {pickedPlan.address ? <p>Address: {pickedPlan.address}</p> : null}
              {pickedPlan.notes ? <p className="whitespace-pre-line">Preparation notes: {pickedPlan.notes}</p> : null}
            </div>
          ) : null}
          <DateEntryFields
            formId="date-new"
            activityTypes={activityTypes}
            venue={venue}
            onVenueChange={setVenue}
            customFields={customFields}
          />
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
            editLabel="Edit date"
            editForm={(close) => (
              <form action={edit(entry, close)} className="grid gap-2.5">
                <DateEntryFields
                  formId={`date-${entry.id}`}
                  activityTypes={activityTypes}
                  entry={entry}
                  customFields={customFieldsByDate[entry.id] ?? []}
                />
                <SubmitButton size="sm">Save</SubmitButton>
              </form>
            )}
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
            {entry.wouldDoAgain !== null ? (
              <Badge variant={entry.wouldDoAgain ? "success" : "muted"} className="mt-1">
                {entry.wouldDoAgain ? "Worth repeating" : "Would not repeat"}
              </Badge>
            ) : null}
            {entry.nextTimeNotes ? (
              <PrivateText enabled={blurPrivate} className="mt-1 block whitespace-pre-line text-xs text-muted-foreground">
                Next time: {entry.nextTimeNotes}
              </PrivateText>
            ) : null}
          </SectionRow>
        ))
      )}
      {dates.some((entry) => entry.wouldDoAgain) ? (
        <details className="rounded-lg border border-border/70 p-3">
          <summary className="cursor-pointer text-sm font-medium">Past dates worth repeating</summary>
          <div className="mt-3 grid gap-3">
            {dates.filter((entry) => entry.wouldDoAgain).map((entry) => (
              <form
                key={entry.id}
                action={async (form) => {
                  form.set("contactId", contactId);
                  form.set("title", form.has("copyActivity") ? (entry.activityLabel ?? "Repeat a great date") : "Repeat a great date");
                  if (form.has("copyVenue")) form.set("location", entry.venue ?? "");
                  if (form.has("copyAddress")) form.set("city", entry.city ?? "");
                  await run(() => createPlan(form), "Plan saved for next time");
                }}
                className="grid gap-2 rounded-md bg-muted/30 p-2 text-xs"
              >
                <p className="font-medium">{entry.activityLabel ?? "Date"}{entry.venue ? ` — ${entry.venue}` : ""}</p>
                {entry.city ? <p>Address / city: {entry.city}</p> : null}
                {entry.nextTimeNotes ? <PrivateText enabled={blurPrivate}>Remember: {entry.nextTimeNotes}</PrivateText> : null}
                <div className="flex flex-wrap gap-3">
                  <label><input type="checkbox" name="copyActivity" defaultChecked /> Activity</label>
                  <label><input type="checkbox" name="copyVenue" defaultChecked /> Venue</label>
                  <label><input type="checkbox" name="copyAddress" defaultChecked /> Address / city</label>
                </div>
                <p className="text-muted-foreground">Private reflection is never copied into planning notes.</p>
                <SubmitButton size="sm">Plan this again</SubmitButton>
              </form>
            ))}
          </div>
        </details>
      ) : null}
    </SectionCard>
  );
}

// --- flags -----------------------------------------------------------------

export interface FlagItem {
  id: string;
  kind: "GREEN" | "RED" | "DEALBREAKER";
  text: string;
  severity: number;
  noticedOn: PlainDate | null;
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

/**
 * Noting a flag and reconsidering one.
 *
 * The kind is editable, which is the point of being able to edit a flag at all:
 * a second look often moves something from red to green, and re-typing it keeps
 * the note and the date you first noticed it rather than starting over.
 */
function FlagFields({ formId, flag }: { formId: string; flag?: FlagItem }) {
  const [kind, setKind] = React.useState<FlagItem["kind"]>(flag?.kind ?? "GREEN");

  return (
    <>
      <input type="hidden" name="kind" value={kind} />
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
      <Field label="What did you notice?" htmlFor={`${formId}-text`}>
        <Textarea
          id={`${formId}-text`}
          name="text"
          rows={2}
          required
          defaultValue={flag?.text ?? ""}
          placeholder="Says what she means without being unkind."
        />
      </Field>
      <DateField
        name="noticedOn"
        idPrefix={`${formId}-noticedOn`}
        label="When you noticed"
        allowPrecision={false}
        presets={["today", "lastWeek"]}
        defaultValue={flag?.noticedOn ? plainDateKey(flag.noticedOn) : undefined}
      />
    </>
  );
}

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

  function add(close: () => void) {
    return async (form: FormData) => {
      form.set("contactId", contactId);
      if (await run(() => createFlag(form), "Noted")) close();
    };
  }

  function edit(flag: FlagItem, close: () => void) {
    return async (form: FormData) => {
      form.set("id", flag.id);
      if (await run(() => updateFlag(form), "Saved")) close();
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
          <FlagFields formId="flag-new" />
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
                  editLabel="Edit flag"
                  editForm={(close) => (
                    <form action={edit(flag, close)} className="grid gap-2.5">
                      <FlagFields formId={`flag-${flag.id}`} flag={flag} />
                      <SubmitButton size="sm">Save</SubmitButton>
                    </form>
                  )}
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
