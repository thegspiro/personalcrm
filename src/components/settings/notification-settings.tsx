"use client";

import * as React from "react";
import { Bell, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/ui/label";
import { SubmitButton } from "@/components/form/submit-button";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/form/use-action";
import {
  CHANNEL_BLURBS,
  CHANNEL_FIELDS,
  CHANNEL_KINDS,
  CHANNEL_LABELS,
  type ChannelField,
  type ChannelKind,
} from "@/lib/notification-channels";
import type { RedactedChannel } from "@/server/notifications/config";
import type { ActionResult } from "@/server/actions/helpers";
import {
  createChannel,
  deleteChannel,
  sendTestNotification,
  setChannelEnabled,
  updateChannel,
} from "@/server/actions/notifications";

/**
 * Where reminders are allowed to go.
 *
 * The delivery engine was finished long before this page existed, and with no
 * channel on the account the hourly job had nothing to send to — so every
 * reminder policy set on an important date was stored and silently never
 * acted on. This is the missing destination.
 */
/**
 * Runs a channel form and keeps the field errors it returns.
 *
 * `useAddAction` reports only the top-level message, which for this form is
 * always "Please check the highlighted fields" — with nothing highlighted,
 * because nothing was holding on to the per-field detail. Port ranges, URL
 * schemes and address shapes are all rejected per field, so that detail is the
 * whole answer to "what do I fix".
 */
function useChannelForm() {
  const router = useRouter();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const submit = React.useCallback(
    (
      action: (form: FormData) => Promise<ActionResult<unknown>>,
      done: () => void,
      message: string,
    ) =>
      async (form: FormData) => {
        const result = await action(form);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          toast.error(result.error ?? "Something went wrong.");
          return;
        }
        setErrors({});
        toast.success(message);
        router.refresh();
        done();
      },
    [router],
  );

  return { errors, submit };
}

export function NotificationSettings({ channels }: { channels: RedactedChannel[] }) {
  const { errors, submit } = useChannelForm();
  const [adding, setAdding] = React.useState<ChannelKind | null>(null);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Reminders about important dates</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Once there is at least one channel switched on here, the app checks every hour for
          dates coming due and sends them. Each date carries its own timing — a week before, on
          the day, or whatever you set on it.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          A reminder carries the date&rsquo;s label, the person&rsquo;s name and when it falls.
          Choose where that goes accordingly: an ntfy or webhook URL can point at a box on your
          own network, but email travels through a mail relay whose logs keep the contents.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          While the privacy lock is switched on, people you have marked private are never
          included — whether or not you happen to be unlocked when the check runs.
        </p>
        {channels.length > 0 && channels.every((channel) => !channel.isEnabled) ? (
          <p className="mt-2 text-xs font-medium text-[var(--warning)]">
            Every channel is switched off, so nothing is being sent.
          </p>
        ) : null}
      </section>

      {channels.map((channel) => (
        <ChannelCard key={channel.id} channel={channel} />
      ))}

      <section className="rounded-xl border border-dashed border-border p-4">
        <h3 className="text-sm font-semibold">Add a channel</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CHANNEL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={adding === kind}
              onClick={() => setAdding(adding === kind ? null : kind)}
              className={
                adding === kind
                  ? "min-h-9 rounded-full border border-accent-8 bg-accent-3 px-3 text-xs text-accent-11"
                  : "min-h-9 rounded-full border border-border px-3 text-xs hover:bg-muted"
              }
            >
              {CHANNEL_LABELS[kind]}
            </button>
          ))}
        </div>

        {adding ? (
          <form
            // Keyed on the kind so switching remounts the form. Without it the
            // inputs stay mounted, `defaultValue` is not reapplied, and the
            // fields shared across kinds keep what was typed — so picking ntfy,
            // typing its token, then picking Gotify submits a channel named
            // "ntfy" with the ntfy token encrypted as its application token.
            key={adding}
            action={submit(createChannel, () => setAdding(null), "Channel added")}
            className="mt-3 grid gap-2.5"
          >
            <p className="text-xs text-muted-foreground">{CHANNEL_BLURBS[adding]}</p>
            <input type="hidden" name="kind" value={adding} />
            <Field label="Name" htmlFor="channel-new-name">
              <Input
                id="channel-new-name"
                name="name"
                maxLength={96}
                defaultValue={CHANNEL_LABELS[adding]}
                placeholder="Phone"
              />
            </Field>
            <ChannelFields formId="channel-new" kind={adding} errors={errors} />
            <div className="flex gap-2">
              <SubmitButton size="sm">Add channel</SubmitButton>
              <Button type="button" variant="outline" size="sm" onClick={() => setAdding(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}

function ChannelCard({ channel }: { channel: RedactedChannel }) {
  const run = useAction();
  const { errors, submit } = useChannelForm();
  const [editing, setEditing] = React.useState(false);

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 truncate text-sm font-semibold">
            <Bell className="size-3.5 shrink-0 text-muted-foreground" />
            {channel.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {CHANNEL_LABELS[channel.kind]}
            {typeof channel.config.url === "string" ? ` · ${channel.config.url}` : ""}
            {typeof channel.config.to === "string" ? ` · ${channel.config.to}` : ""}
            {channel.secretsSet.url ? " · webhook saved" : ""}
          </p>
        </div>
        <Switch
          checked={channel.isEnabled}
          aria-label={`Send to ${channel.name}`}
          onCheckedChange={(checked) =>
            void run(
              () => setChannelEnabled(channel.id, checked),
              checked ? "Switched on" : "Switched off",
            )
          }
        />
      </div>

      {channel.unreadableSecret ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <span>
            The saved password or token for this channel can&rsquo;t be read — most likely{" "}
            <code>AUTH_SECRET</code> changed. Nothing is sent to it until you enter it again,
            rather than the request going out without its credential.
          </span>
        </p>
      ) : null}

      {editing ? (
        <form
          action={submit(updateChannel, () => setEditing(false), "Saved")}
          className="mt-3 grid gap-2.5"
        >
          <input type="hidden" name="id" value={channel.id} />
          <Field label="Name" htmlFor={`channel-${channel.id}-name`}>
            <Input
              id={`channel-${channel.id}-name`}
              name="name"
              maxLength={96}
              defaultValue={channel.name}
            />
          </Field>
          <ChannelFields
            formId={`channel-${channel.id}`}
            kind={channel.kind}
            channel={channel}
            errors={errors}
          />
          <div className="flex gap-2">
            <SubmitButton size="sm">Save</SubmitButton>
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void run(() => sendTestNotification(channel.id), "Test message sent")
            }
          >
            Send a test
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!confirm(`Delete ${channel.name}? Reminders will stop going there.`)) return;
              void run(() => deleteChannel(channel.id), "Channel deleted");
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </section>
  );
}

function ChannelFields({
  formId,
  kind,
  channel,
  errors,
}: {
  formId: string;
  kind: ChannelKind;
  channel?: RedactedChannel;
  errors: Record<string, string>;
}) {
  return (
    <>
      {CHANNEL_FIELDS[kind].map((field) => (
        <ChannelFieldInput
          key={field.name}
          formId={formId}
          field={field}
          value={channel?.config[field.name]}
          isSet={channel?.secretsSet[field.name] ?? false}
          error={errors[field.name]}
        />
      ))}
    </>
  );
}

function ChannelFieldInput({
  formId,
  field,
  value,
  isSet,
  error,
}: {
  formId: string;
  field: ChannelField;
  value: string | number | boolean | undefined;
  isSet: boolean;
  error?: string;
}) {
  const id = `${formId}-${field.name}`;

  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          name={field.name}
          value="true"
          defaultChecked={value === true}
          className="size-4"
        />
        {field.label}
      </label>
    );
  }

  if (field.secret) {
    return (
      <Field
        label={field.label}
        htmlFor={id}
        // The value is never sent back, so there is nothing for the browser to
        // resubmit — blank has to mean "leave it alone" rather than "clear it".
        hint={isSet ? "Saved. Leave blank to keep it, or type a new one." : field.hint}
        error={error}
      >
        <Input id={id} name={field.name} type="password" autoComplete="new-password" />
        {isSet ? (
          <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              name={`${field.name}__clear`}
              value="true"
              className="size-4"
            />
            Remove the saved {field.label.toLowerCase()}
          </label>
        ) : null}
      </Field>
    );
  }

  return (
    <Field label={field.label} htmlFor={id} hint={field.hint} error={error}>
      <Input
        id={id}
        name={field.name}
        type={field.type === "number" ? "number" : field.type === "email" ? "email" : "text"}
        inputMode={field.type === "number" ? "numeric" : undefined}
        required={field.required}
        defaultValue={value === undefined ? "" : String(value)}
        placeholder={field.placeholder}
      />
    </Field>
  );
}
