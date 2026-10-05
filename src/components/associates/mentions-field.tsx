"use client";

import * as React from "react";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
  loadAssociateMentionOptions,
  type AssociateMentionOptions,
} from "@/server/actions/interactions";

const NEW = "__new";
const SELECT_CLASS = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm";

interface Row {
  key: number;
  sourceId: string;
  /** An associate id, `NEW` for someone not yet noted, or "" before choosing. */
  about: string;
  name: string;
  content: string;
}

export interface MentionParticipant {
  id: string;
  name: string;
}

/**
 * "They talked about…": news about the people in a participant's life, noted
 * while logging the conversation it came up in.
 *
 * Each line is who told you, who it is about, and what is new. The first
 * comes first because it decides the second: the people offered are the ones
 * in *that* friend's life, which is also whose page the news lands on. With
 * one person there, who told you is not asked.
 *
 * The rows are dynamic, so they travel as one JSON field; the action parses it
 * with a schema and re-checks every id, as it would any form field. Mount it
 * with a key that changes when the sheet opens, so a fresh sheet starts empty
 * — the form's `reset()` cannot reach state.
 */
export function AssociateMentionsField({
  formId,
  participants,
}: {
  formId: string;
  participants: MentionParticipant[];
}) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [options, setOptions] = React.useState<AssociateMentionOptions[]>([]);
  const nextKey = React.useRef(0);
  const participantKey = participants.map((person) => person.id).join("\0");

  // Re-read who is in whose life whenever the participants change. Late
  // answers for an older selection are dropped rather than applied over a
  // newer one. Nothing is set when there is no one to ask about: the options
  // are ignored below instead, so the effect only ever sets state from the
  // answer it was waiting for.
  React.useEffect(() => {
    const ids = participantKey ? participantKey.split("\0") : [];
    if (ids.length === 0) return;
    let current = true;
    void loadAssociateMentionOptions(ids).then((result) => {
      if (current && result.ok && result.data) setOptions(result.data);
    });
    return () => {
      current = false;
    };
  }, [participantKey]);

  /**
   * A line as it stands against the participants now: a source who has left
   * the list falls back to the first one still there, and a pick that is not
   * in that source's life falls back to unchosen. Derived on every render
   * rather than written back, so the hidden field never carries a source or
   * a person the action would refuse.
   */
  function resolve(row: Row) {
    const sourceId = participants.some((person) => person.id === row.sourceId)
      ? row.sourceId
      : (participants[0]?.id ?? "");
    const known =
      participants.length === 0
        ? []
        : (options.find((option) => option.contactId === sourceId)?.associates ?? []);
    const about =
      row.about === NEW || known.some((associate) => associate.id === row.about) ? row.about : "";
    return { sourceId, known, about };
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  const payload = rows
    .filter((row) => row.about || row.content.trim() || row.name.trim())
    .map((row) => {
      const { sourceId, about } = resolve(row);
      return {
        heardFromContactId: sourceId,
        content: row.content,
        ...(about && about !== NEW ? { associateId: about } : { name: row.name }),
      };
    });

  return (
    <div className="grid gap-2">
      <div>
        <span className="text-xs font-medium text-muted-foreground">
          People in their lives (optional)
        </span>
        <p className="text-[11px] text-muted-foreground">
          News about someone they mentioned — a colleague, a partner. It is kept as something
          they told you.
        </p>
      </div>
      <input type="hidden" name="associateMentions" value={payload.length ? JSON.stringify(payload) : ""} />

      {rows.map((row, index) => {
        const id = `${formId}-mention-${row.key}`;
        const { sourceId, known, about } = resolve(row);
        return (
          <fieldset
            key={row.key}
            className="grid min-w-0 gap-2 rounded-lg border border-border/70 p-2.5"
          >
            <legend className="sr-only">Person they talked about {index + 1}</legend>
            {participants.length > 1 ? (
              <Field label="Who told you?" htmlFor={`${id}-source`}>
                <select
                  id={`${id}-source`}
                  value={sourceId}
                  onChange={(event) => update(row.key, { sourceId: event.target.value, about: "" })}
                  className={SELECT_CLASS}
                >
                  {participants.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="About" htmlFor={`${id}-about`}>
              <select
                id={`${id}-about`}
                value={about}
                onChange={(event) => update(row.key, { about: event.target.value })}
                className={SELECT_CLASS}
              >
                <option value="">Pick someone</option>
                {known.map((associate) => (
                  <option key={associate.id} value={associate.id}>
                    {associate.name}
                  </option>
                ))}
                <option value={NEW}>Someone new…</option>
              </select>
            </Field>
            {about === NEW ? (
              <Field label="Their name" htmlFor={`${id}-name`}>
                <Input
                  id={`${id}-name`}
                  value={row.name}
                  maxLength={191}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                  placeholder="Priya"
                />
              </Field>
            ) : null}
            <Field label="What's new with them?" htmlFor={`${id}-content`}>
              <Textarea
                id={`${id}-content`}
                rows={2}
                maxLength={10_000}
                value={row.content}
                onChange={(event) => update(row.key, { content: event.target.value })}
                placeholder="Started night shifts at the hospital."
              />
            </Field>
            <button
              type="button"
              onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}
              className="justify-self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Remove
            </button>
          </fieldset>
        );
      })}

      <button
        type="button"
        disabled={participants.length === 0}
        onClick={() => {
          nextKey.current += 1;
          setRows((current) => [
            ...current,
            { key: nextKey.current, sourceId: participants[0]?.id ?? "", about: "", name: "", content: "" },
          ]);
        }}
        className="justify-self-start text-xs text-accent-11 underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
      >
        {participants.length === 0 ? "Pick who was there first" : "Add someone they talked about"}
      </button>
    </div>
  );
}
