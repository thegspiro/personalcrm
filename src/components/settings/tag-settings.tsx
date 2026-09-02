"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction } from "@/components/form/use-action";
import {
  createTag,
  deleteTag,
  mergeTag,
  renameTag,
} from "@/server/actions/tags";

export function TagSettings({
  tags,
}: {
  tags: Array<{ id: string; name: string; usageCount: number }>;
}) {
  const run = useAction();
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">
        Rename or combine tags without losing their people. Deleting removes
        assignments, never contacts.
      </p>
      <form
        action={(form) => void run(() => createTag(form), "Tag added")}
        className="flex items-end gap-2"
      >
        <Field label="New tag" htmlFor="new-tag">
          <Input id="new-tag" name="name" required maxLength={96} />
        </Field>
        <SubmitButton size="sm">Add</SubmitButton>
      </form>
      {tags.map((tag) => (
        <TagRow key={tag.id} tag={tag} tags={tags} />
      ))}
    </div>
  );
}

function TagRow({
  tag,
  tags,
}: {
  tag: { id: string; name: string; usageCount: number };
  tags: Array<{ id: string; name: string }>;
}) {
  const run = useAction();
  const [destination, setDestination] = React.useState("");
  return (
    <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto]">
      <form
        action={(form) => void run(() => renameTag(form), "Tag renamed")}
        className="flex items-end gap-2"
      >
        <input type="hidden" name="id" value={tag.id} />
        <Field
          label={`${tag.usageCount} visible ${tag.usageCount === 1 ? "person" : "people"}`}
          htmlFor={`tag-${tag.id}`}
        >
          <Input
            id={`tag-${tag.id}`}
            name="name"
            defaultValue={tag.name}
            required
            maxLength={96}
          />
        </Field>
        <SubmitButton size="sm" variant="outline">
          Rename
        </SubmitButton>
      </form>
      <div className="flex items-end gap-2">
        <select
          aria-label={`Merge ${tag.name} into`}
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className="h-9 rounded-lg border bg-card px-2 text-xs"
        >
          <option value="">Merge into…</option>
          {tags
            .filter((other) => other.id !== tag.id)
            .map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
        </select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!destination}
          onClick={() =>
            void run(() => mergeTag(tag.id, destination), "Tags merged")
          }
        >
          Merge
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={() => {
            if (confirm(`Delete ${tag.name}? Contacts will be kept.`))
              void run(() => deleteTag(tag.id), "Tag deleted");
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
