"use client";

import * as React from "react";
import { Icon } from "@/components/nav/icon";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { DateField } from "@/components/form/date-field";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { formatMoney } from "@/lib/format";
import { summarizeDebts, type DebtDirection } from "@/lib/debts";
import { plainDateKey, type PlainDate } from "@/lib/dates";
import { createDebt, deleteDebt, settleDebt, updateDebt } from "@/server/actions/details";

export interface DebtItem {
  id: string;
  direction: DebtDirection;
  description: string;
  amountCents: number | null;
  currency: string;
  incurredOn: PlainDate;
  settledOn: PlainDate | null;
  notes: string | null;
  isPrivate: boolean;
}

/**
 * Money and things that have moved and not come back.
 *
 * Settled rows stay, behind a disclosure — that someone always pays you back is
 * worth as much as knowing they owe you now, but it shouldn't crowd out what is
 * still outstanding.
 */
function DebtFields({ formId, debt }: { formId: string; debt?: DebtItem }) {
  return (
    <>
      <Field label="What was it?" htmlFor={`${formId}-description`}>
        <Input
          id={`${formId}-description`}
          name="description"
          required
          defaultValue={debt?.description ?? ""}
          placeholder="Covered dinner"
        />
      </Field>

      <Field label="Which way?" htmlFor={`${formId}-direction`}>
        <select
          id={`${formId}-direction`}
          name="direction"
          defaultValue={debt?.direction ?? "THEY_OWE_ME"}
          className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="THEY_OWE_ME">They owe me</option>
          <option value="I_OWE_THEM">I owe them</option>
        </select>
      </Field>

      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field
          label="How much?"
          htmlFor={`${formId}-amount`}
          hint="Leave empty if you lent a thing."
        >
          <Input
            id={`${formId}-amount`}
            name="amount"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            defaultValue={debt?.amountCents == null ? "" : debt.amountCents / 100}
            placeholder="0.00"
          />
        </Field>
        <DateField
          name="incurredOn"
          idPrefix={`${formId}-incurredOn`}
          label="When"
          defaultValue={debt ? plainDateKey(debt.incurredOn) : undefined}
          hint={debt ? undefined : "Defaults to today."}
        />
      </div>

      <Field label="Notes" htmlFor={`${formId}-notes`}>
        <Textarea id={`${formId}-notes`} name="notes" rows={2} defaultValue={debt?.notes ?? ""} />
      </Field>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name="isPrivate"
          value="true"
          defaultChecked={debt?.isPrivate ?? false}
          className="size-4"
        />
        Hide this behind the privacy lock
      </label>
    </>
  );
}

export function DebtsSection({ contactId, debts }: { contactId: string; debts: DebtItem[] }) {
  const run = useAction();
  const add = useAddAction();
  const [showSettled, setShowSettled] = React.useState(false);

  const summary = summarizeDebts(
    debts.map((debt) => ({
      direction: debt.direction,
      amountCents: debt.amountCents,
      currency: debt.currency,
      settled: debt.settledOn !== null,
    })),
  );

  const outstanding = debts.filter((debt) => !debt.settledOn);
  const settled = debts.filter((debt) => debt.settledOn);

  return (
    <SectionCard
      title="Lent and borrowed"
      icon="Scale"
      count={outstanding.length}
      addLabel="Add a debt"
      defaultOpen={false}
      form={(close) => (
        <form action={add(createDebt, close, "Noted")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <DebtFields formId="debt-new" />
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {summary.balances.length > 0 || summary.itemCount > 0 ? (
        <div className="grid gap-0.5 px-1 text-xs">
          {summary.balances.map((balance) => (
            <p key={balance.currency} className="text-muted-foreground">
              {balance.theyOweCents > 0 ? (
                <span>They owe you {formatMoney(balance.theyOweCents, balance.currency)}</span>
              ) : null}
              {balance.theyOweCents > 0 && balance.youOweCents > 0 ? <span> · </span> : null}
              {balance.youOweCents > 0 ? (
                <span>You owe them {formatMoney(balance.youOweCents, balance.currency)}</span>
              ) : null}
              {balance.netCents !== null ? (
                <span className="font-medium text-foreground">
                  {" "}
                  · net {formatMoney(Math.abs(balance.netCents), balance.currency)}{" "}
                  {balance.netCents >= 0 ? "your way" : "their way"}
                </span>
              ) : null}
            </p>
          ))}
          {summary.itemCount > 0 ? (
            <p className="text-muted-foreground">
              {summary.itemCount} {summary.itemCount === 1 ? "thing" : "things"} lent, no sum
              attached
            </p>
          ) : null}
        </div>
      ) : null}

      {outstanding.length === 0 ? (
        <SectionEmpty>Nothing outstanding.</SectionEmpty>
      ) : (
        outstanding.map((debt) => (
          <SectionRow
            key={debt.id}
            onDelete={() => void run(() => deleteDebt(debt.id), "Removed")}
            deleteLabel="Delete debt"
            editLabel="Edit debt"
            editForm={(close) => (
              <form action={add(updateDebt, close, "Saved")} className="grid gap-2.5">
                <input type="hidden" name="id" value={debt.id} />
                <DebtFields formId={`debt-${debt.id}`} debt={debt} />
                <SubmitButton size="sm">Save</SubmitButton>
              </form>
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm">{debt.description}</span>
              {formatMoney(debt.amountCents, debt.currency) ? (
                <span className="text-sm font-medium">
                  {formatMoney(debt.amountCents, debt.currency)}
                </span>
              ) : null}
              <span className="text-[11px] text-muted-foreground">
                {debt.direction === "THEY_OWE_ME" ? "they owe you" : "you owe them"}
              </span>
              {debt.isPrivate ? <Icon name="EyeOff" className="size-3 text-muted-foreground" /> : null}
            </div>
            {debt.notes ? (
              <p className="mt-0.5 whitespace-pre-line text-xs text-muted-foreground">{debt.notes}</p>
            ) : null}
            <button
              type="button"
              onClick={() => void run(() => settleDebt(debt.id, new Date()), "Settled")}
              className="mt-1 text-[11px] font-medium text-accent-11 hover:underline"
            >
              Mark settled
            </button>
          </SectionRow>
        ))
      )}

      {settled.length > 0 ? (
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => setShowSettled((v) => !v)}
            aria-expanded={showSettled}
            className="px-1 text-left text-[11px] font-medium text-muted-foreground hover:underline"
          >
            {settled.length} settled
          </button>
          {showSettled
            ? settled.map((debt) => (
                <SectionRow
                  key={debt.id}
                  className="opacity-70"
                  onDelete={() => void run(() => deleteDebt(debt.id), "Removed")}
                  deleteLabel="Delete debt"
                  editLabel="Edit debt"
                  // Settled, not finished with: a debt squared up for the wrong
                  // amount is still the wrong amount in next year's total.
                  editForm={(close) => (
                    <form action={add(updateDebt, close, "Saved")} className="grid gap-2.5">
                      <input type="hidden" name="id" value={debt.id} />
                      <DebtFields formId={`debt-${debt.id}`} debt={debt} />
                      <SubmitButton size="sm">Save</SubmitButton>
                    </form>
                  )}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm line-through">{debt.description}</span>
                    {formatMoney(debt.amountCents, debt.currency) ? (
                      <span className="text-xs text-muted-foreground">
                        {formatMoney(debt.amountCents, debt.currency)}
                      </span>
                    ) : null}
                  </div>
                </SectionRow>
              ))
            : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
