"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/form/submit-button";
import type { TermOption } from "@/components/form/term-select";
import { GiftFields, type GiftItem } from "@/components/contacts/sections/gifts";
import { formatMoney } from "@/lib/format";
import { updateGift } from "@/server/actions/details";

/**
 * Every gift across everyone, on /gifts.
 *
 * The same form the contact page uses, because this is the page you are more
 * likely to be on when a gift stops being an idea and becomes something you
 * have bought.
 */

export interface GiftListItem extends GiftItem {
  contact: { id: string; firstName: string; lastName: string | null };
}

export function GiftList({ gifts, occasions }: { gifts: GiftListItem[]; occasions: TermOption[] }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {gifts.map((gift) => (
        <GiftRow key={gift.id} gift={gift} occasions={occasions} />
      ))}
    </ul>
  );
}

function GiftRow({ gift, occasions }: { gift: GiftListItem; occasions: TermOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);

  async function save(form: FormData) {
    form.set("id", gift.id);
    const result = await updateGift(form);
    if (!result.ok) {
      toast.error(result.error ?? "Could not save.");
      return;
    }
    toast.success("Saved");
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <li className="rounded-xl border border-accent-8 bg-card p-3">
        <form action={save} className="grid gap-2.5">
          <GiftFields formId={`gift-${gift.id}`} occasions={occasions} gift={gift} />
          <SubmitButton size="sm">Save</SubmitButton>
        </form>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{gift.name}</p>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <Link href={`/people/${gift.contact.id}`} className="hover:text-foreground">
            {displayName(gift.contact)}
          </Link>
          {gift.occasion ? <span>{gift.occasion.label}</span> : null}
          {formatMoney(gift.priceCents, gift.currency) ? (
            <span>{formatMoney(gift.priceCents, gift.currency)}</span>
          ) : null}
        </div>
      </div>
      <Badge variant={gift.status === "GIVEN" ? "success" : "muted"}>
        {gift.status.toLowerCase()}
      </Badge>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit gift"
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon name="Pencil" className="size-3.5" />
      </button>
    </li>
  );
}
