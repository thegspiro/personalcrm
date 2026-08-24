"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { useAction, useAddAction } from "@/components/form/use-action";
import type { ProviderDefinition, ProviderId } from "@/server/ai/providers";
import { removeApiKey, saveAiConnection, updateAiEnabled } from "@/server/actions/ai-settings";

export interface AiSettingsProps {
  enabled: boolean;
  usable: boolean;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  keySource: "env" | "stored" | null;
  keyHint: string | null;
  providers: ProviderDefinition[];
}

/**
 * The optional assisted reading.
 *
 * Framed as an extra rather than something you are missing out on: quick add
 * works without any of it, and the copy says so before it says anything else.
 * No provider is preselected as "the right one" — a box on your own network is
 * a first-class choice, not a fallback.
 */
export function AiSettings({
  enabled,
  usable,
  provider,
  baseUrl,
  model,
  hasKey,
  keySource,
  keyHint,
  providers,
}: AiSettingsProps) {
  const run = useAction();
  const save = useAddAction();
  const [selected, setSelected] = React.useState<ProviderId>(provider);

  const definition = providers.find((entry) => entry.id === selected) ?? providers[0];
  const isCurrent = selected === provider;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Quick add</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Type a line like &ldquo;coffee with Sarah yesterday&rdquo; and confirm what it
          understood. This runs on this machine — no model, no account, no internet — and it is
          always on.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Smarter suggestions</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Optional. When this is on, the line you type is sent to a language model for a
              better reading of awkward phrasing. Everything else is the same — you still confirm
              before anything is saved.
            </p>
          </div>
          <Switch
            checked={enabled}
            aria-label="Use smarter suggestions"
            disabled={!usable}
            onCheckedChange={(checked) =>
              void run(() => updateAiEnabled(checked), checked ? "Turned on" : "Turned off")
            }
          />
        </div>

        <div className="mt-3 grid gap-3 border-t border-border/70 pt-3">
          <div className="rounded-lg bg-muted/60 px-3 py-2.5">
            <p className="text-xs font-medium">What gets sent, and where</p>
            <ul className="mt-1 grid gap-1 text-[11px] text-muted-foreground">
              <li>· The line you type, plus your interaction type names and contact names.</li>
              <li>
                · To whichever endpoint you configure below — including one on your own network,
                in which case nothing leaves it.
              </li>
              <li>
                · Nothing at all if the line mentions someone you have marked private. Those stay
                on this machine whatever this setting says.
              </li>
              <li>· Nothing else. Not your notes, not your history, not anyone else&apos;s.</li>
            </ul>
          </div>

          {!usable ? (
            <p className="text-xs text-muted-foreground">
              Not configured, so this stays off. Quick add still works.
            </p>
          ) : null}

          <form action={save(saveAiConnection, () => {}, "Connection saved")} className="grid gap-2.5">
            <Field label="Provider" htmlFor="ai-provider">
              <select
                id="ai-provider"
                name="provider"
                value={selected}
                onChange={(event) => setSelected(event.target.value as ProviderId)}
                className="h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                {providers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-[11px] text-muted-foreground">{definition.note}</p>

            {definition.baseUrlEditable ? (
              <Field
                label="Endpoint"
                htmlFor="ai-base"
                hint="The OpenAI-compatible base URL, usually ending in /v1."
              >
                <Input
                  id="ai-base"
                  name="baseUrl"
                  defaultValue={isCurrent ? baseUrl : definition.defaultBaseUrl}
                  placeholder={definition.defaultBaseUrl}
                  inputMode="url"
                />
              </Field>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Endpoint: <code>{definition.defaultBaseUrl}</code>
              </p>
            )}

            <Field
              label="Model"
              htmlFor="ai-model"
              hint={`For example: ${definition.suggestedModels.join(", ")}`}
            >
              <Input
                id="ai-model"
                name="model"
                required
                defaultValue={isCurrent ? model : (definition.suggestedModels[0] ?? "")}
                list="ai-model-suggestions"
              />
            </Field>
            <datalist id="ai-model-suggestions">
              {definition.suggestedModels.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>

            {keySource === "env" ? (
              <p className="text-[11px] text-muted-foreground">
                Key {keyHint} comes from an environment variable — change it where you set your
                container options.
              </p>
            ) : (
              <Field
                label={
                  definition.keyRequired
                    ? hasKey
                      ? `API key (${keyHint} stored — leave blank to keep it)`
                      : "API key"
                    : "API key (optional)"
                }
                htmlFor="ai-key"
                hint={
                  definition.keyRequired
                    ? "Checked before it is stored, then encrypted. Never shown again."
                    : "Leave blank if your endpoint doesn't need one."
                }
              >
                <Input
                  id="ai-key"
                  name="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder={hasKey ? "••••••••" : ""}
                />
              </Field>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton size="sm">Test and save</SubmitButton>
              {hasKey && keySource === "stored" ? (
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
              ) : null}
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
