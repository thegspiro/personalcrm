"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction, useAddAction } from "@/components/form/use-action";
import {
  removeApiKey,
  saveApiKey,
  updateAiEnabled,
  updateAiModel,
} from "@/server/actions/ai-settings";

export interface AiSettingsProps {
  enabled: boolean;
  hasKey: boolean;
  keySource: "env" | "stored" | null;
  keyHint: string | null;
  model: string;
  models: ReadonlyArray<{ id: string; label: string; cost: string }>;
}

/**
 * The optional assisted reading.
 *
 * Deliberately framed as an extra rather than a feature you are missing out
 * on: quick add works without any of this, and the copy says so before it says
 * anything else.
 */
export function AiSettings({
  enabled,
  hasKey,
  keySource,
  keyHint,
  model,
  models,
}: AiSettingsProps) {
  const run = useAction();
  const save = useAddAction();
  const [showKeyForm, setShowKeyForm] = React.useState(false);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Quick add</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Type a line like &ldquo;coffee with Sarah yesterday&rdquo; and confirm what it
          understood. This runs on this machine — no key, no account, no internet — and it is
          always on.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Smarter suggestions</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. When this is on, the line you type is sent to Anthropic for a better
              reading of awkward phrasing. Everything else is the same — you still confirm before
              anything is saved.
            </p>
          </div>
          <Switch
            checked={enabled}
            aria-label="Use smarter suggestions"
            disabled={!hasKey}
            onCheckedChange={(checked) =>
              void run(() => updateAiEnabled(checked), checked ? "Turned on" : "Turned off")
            }
          />
        </div>

        <div className="mt-3 grid gap-3 border-t border-border/70 pt-3">
          <div className="rounded-lg bg-muted/60 px-3 py-2.5">
            <p className="text-xs font-medium">What gets sent</p>
            <ul className="mt-1 grid gap-1 text-[11px] text-muted-foreground">
              <li>· The line you type, plus your interaction type names and contact names.</li>
              <li>
                · Nothing at all if the line mentions someone you have marked private — those stay
                on this machine whatever this setting says.
              </li>
              <li>· Nothing else. Not your notes, not your history, not anyone else&apos;s.</li>
            </ul>
          </div>

          {hasKey ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-3 px-2.5 py-1 text-xs text-accent-11">
                Key configured {keyHint}
              </span>
              {keySource === "env" ? (
                <span className="text-[11px] text-muted-foreground">
                  From the ANTHROPIC_API_KEY environment variable — change it where you set your
                  container options.
                </span>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (!confirm("Remove the stored key?")) return;
                    void run(() => removeApiKey(), "Key removed");
                  }}
                >
                  Remove key
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No key set, so this stays off. Quick add still works.
            </p>
          )}

          {keySource !== "env" ? (
            showKeyForm ? (
              <form
                action={save(saveApiKey, () => setShowKeyForm(false), "Key saved")}
                className="grid gap-2"
              >
                <Field
                  label="Anthropic API key"
                  htmlFor="apiKey"
                  hint="Checked against Anthropic before it is stored, then encrypted. Never shown again."
                >
                  <Input
                    id="apiKey"
                    name="apiKey"
                    type="password"
                    autoComplete="off"
                    placeholder="sk-ant-…"
                    required
                  />
                </Field>
                <div className="flex items-center gap-2">
                  <SubmitButton size="sm">Save key</SubmitButton>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowKeyForm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => setShowKeyForm(true)}
              >
                {hasKey ? "Replace key" : "Add a key"}
              </Button>
            )
          ) : null}

          <Field label="Model" htmlFor="ai-model" hint="Each quick add costs a fraction of a cent.">
            <select
              id="ai-model"
              defaultValue={model}
              onChange={(event) => void run(() => updateAiModel(event.target.value), "Saved")}
              className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
            >
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} — {entry.cost}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>
    </div>
  );
}
