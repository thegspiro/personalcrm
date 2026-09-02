"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { DateField } from "@/components/form/date-field";
import { TermSelect, type TermOption } from "@/components/form/term-select";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction, useEditAction } from "@/components/form/use-action";
import { formatMoney } from "@/lib/format";
import { plainDateKey, type PlainDate } from "@/lib/dates";
import { createGift, deleteGift, updateGift } from "@/server/actions/details";

export interface GiftItem {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  status: "IDEA" | "RESERVED" | "PURCHASED" | "GIVEN";
  direction: "OUTGOING" | "INCOMING";
  occurredOn: PlainDate | null;
  priceCents: number | null;
  currency: string;
  occasionId: string | null;
  occasion: { label: string } | null;
}

const GIFT_STATUSES: ReadonlyArray<{ value: GiftItem["status"]; label: string }> = [
  { value: "IDEA", label: "Just an idea" },
  { value: "RESERVED", label: "Set aside" },
  { value: "PURCHASED", label: "Bought" },
  { value: "GIVEN", label: "Given" },
];

/**
 * Adding a gift and correcting one. Shared with the /gifts page.
 *
 * The add form stays short — a gift usually starts as a name and a link — but
 * the status, the price and the day it changed hands have to be here too:
 * `updateGift` writes the whole form, so a field the edit form omitted would be
 * cleared by the next unrelated correction.
 */
export function GiftFields({
  formId,
  occasions,
  gift,
}: {
  formId: string;
  occasions: TermOption[];
  gift?: GiftItem;
}) {
  return (
    <>
      <Field label="What is it?" htmlFor={`${formId}-name`}>
        <Input
          id={`${formId}-name`}
          name="name"
          required
          defaultValue={gift?.name ?? ""}
          placeholder="Banneton proofing basket"
        />
      </Field>
      <Field label="Link" htmlFor={`${formId}-url`}>
        <Input
          id={`${formId}-url`}
          name="url"
          type="url"
          defaultValue={gift?.url ?? ""}
          placeholder="https://"
        />
      </Field>
      <TermSelect
        name="occasionId"
        id={`${formId}-occasionId`}
        label="Occasion"
        terms={occasions}
        defaultValue={gift?.occasionId}
      />
      {gift ? (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Where it's got to" htmlFor={`${formId}-status`}>
              <select
                id={`${formId}-status`}
                name="status"
                defaultValue={gift.status}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                {GIFT_STATUSES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Price" htmlFor={`${formId}-price`}>
              <Input
                id={`${formId}-price`}
                name="price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                defaultValue={gift.priceCents === null ? "" : gift.priceCents / 100}
                placeholder="0.00"
              />
            </Field>
          </div>
          <Field label="Which way?" htmlFor={`${formId}-direction`}>
            <select
              id={`${formId}-direction`}
              name="direction"
              defaultValue={gift.direction}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              <option value="OUTGOING">I gave it</option>
              <option value="INCOMING">They gave it to me</option>
            </select>
          </Field>
          <DateField
            name="occurredOn"
            idPrefix={`${formId}-occurredOn`}
            label="Changed hands"
            allowPrecision={false}
            presets={["today"]}
            defaultValue={gift.occurredOn ? plainDateKey(gift.occurredOn) : undefined}
          />
          <Field label="Notes" htmlFor={`${formId}-description`}>
            <Textarea
              id={`${formId}-description`}
              name="description"
              rows={2}
              defaultValue={gift.description ?? ""}
            />
          </Field>
        </>
      ) : null}
    </>
  );
}

export function GiftsSection({
  contactId,
  gifts,
  occasions,
}: {
  contactId: string;
  gifts: GiftItem[];
  occasions: TermOption[];
}) {
  const run = useAction();
  const add = useAddAction();
  const edit = useEditAction();

  return (
    <SectionCard
      title="Gifts"
      icon="Gift"
      count={gifts.length}
      addLabel="Add a gift idea"
      defaultOpen
      form={(close) => (
        <form action={add(createGift, close, "Added")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <GiftFields formId="gift-new" occasions={occasions} />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {gifts.length === 0 ? (
        <SectionEmpty>No gift ideas yet.</SectionEmpty>
      ) : (
        gifts.map((gift) => (
          <SectionRow
            key={gift.id}
            id={`gift-${gift.id}`}
            onDelete={() => void run(() => deleteGift(gift.id), "Removed")}
            deleteLabel="Delete gift"
            editLabel="Edit gift"
            editForm={(close) => (
              <form action={edit(updateGift, close, "Saved")} className="grid gap-2.5">
                <input type="hidden" name="id" value={gift.id} />
                <GiftFields formId={`gift-${gift.id}`} occasions={occasions} gift={gift} />
                <SubmitButton size="sm">Save</SubmitButton>
              </form>
            )}
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm">{gift.name}</span>
              <Badge variant={gift.status === "GIVEN" ? "success" : "muted"}>
                {gift.status.toLowerCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {[gift.occasion?.label, formatMoney(gift.priceCents, gift.currency)]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
