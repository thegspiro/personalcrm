"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { displayName } from "@/lib/utils";
import { Icon } from "@/components/nav/icon";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { updateIdea } from "@/server/actions/details";

/**
 * Conversation ideas across everyone, on /ideas.
 *
 * A client component only so the rows can be corrected in place. The list
 * itself is still rendered from the server's data — there is no store here, and
 * a saved edit refreshes the route rather than patching an array.
 */

export interface IdeaListItem {
  id: string;
  content: string;
  contact: { id: string; firstName: string; lastName: string | null } | null;
}

export function IdeaList({ ideas }: { ideas: IdeaListItem[] }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {ideas.map((idea) => (
        <IdeaRow key={idea.id} idea={idea} />
      ))}
    </ul>
  );
}

function IdeaRow({ idea }: { idea: IdeaListItem }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);

  async function save(form: FormData) {
    form.set("id", idea.id);
    const result = await updateIdea(form);
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
          <Field label="What do you want to ask or mention?" htmlFor={`idea-${idea.id}`}>
            <Textarea
              id={`idea-${idea.id}`}
              name="content"
              rows={2}
              required
              defaultValue={idea.content}
            />
          </Field>
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
    <li className="group flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{idea.content}</p>
        {idea.contact ? (
          <Link
            href={`/people/${idea.contact.id}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {displayName(idea.contact)}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground">General</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Edit idea"
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Icon name="Pencil" className="size-3.5" />
      </button>
    </li>
  );
}
