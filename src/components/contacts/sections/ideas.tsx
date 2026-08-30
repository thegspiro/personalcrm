"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { SectionCard, SectionEmpty, SectionRow } from "../section-card";
import { useAction, useAddAction } from "@/components/form/use-action";
import { createIdea, deleteIdea, setIdeaStatus, updateIdea } from "@/server/actions/details";

export interface IdeaItem {
  id: string;
  content: string;
  status: "OPEN" | "USED" | "ARCHIVED";
}

export function IdeasSection({ contactId, ideas }: { contactId: string; ideas: IdeaItem[] }) {
  const run = useAction();
  const add = useAddAction();
  const open = ideas.filter((idea) => idea.status === "OPEN");

  return (
    <SectionCard
      title="Bring this up"
      icon="MessageSquareQuote"
      count={open.length}
      addLabel="Add an idea"
      form={(close) => (
        <form action={add(createIdea, close, "Saved")} className="grid gap-2.5">
          <input type="hidden" name="contactId" value={contactId} />
          <Field label="What do you want to ask or mention?" htmlFor="idea-content">
            <Textarea
              id="idea-content"
              name="content"
              rows={2}
              required
              placeholder="Ask how the sourdough starter survived the move."
            />
          </Field>
          <SubmitButton size="sm">Add</SubmitButton>
        </form>
      )}
    >
      {open.length === 0 ? (
        <SectionEmpty>Nothing queued up.</SectionEmpty>
      ) : (
        open.map((idea) => (
          <SectionRow
            key={idea.id}
            onDelete={() => void run(() => deleteIdea(idea.id), "Removed")}
            deleteLabel="Delete idea"
            editLabel="Edit idea"
            editForm={(close) => (
              <form action={add(updateIdea, close, "Saved")} className="grid gap-2.5">
                <input type="hidden" name="id" value={idea.id} />
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
            )}
          >
            <div className="flex items-start gap-2">
              <Checkbox
                checked={false}
                onCheckedChange={() => void run(() => setIdeaStatus(idea.id, "USED"), "Marked used")}
                aria-label="Mark as brought up"
                className="mt-0.5"
              />
              <p className="text-sm">{idea.content}</p>
            </div>
          </SectionRow>
        ))
      )}
    </SectionCard>
  );
}
