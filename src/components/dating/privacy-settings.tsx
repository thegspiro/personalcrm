"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { purgeOfflineCaches } from "@/components/offline/offline";
import { SubmitButton } from "@/components/form/submit-button";
import type { ActionResult } from "@/server/actions/helpers";
import {
  clearPinAction,
  lockPrivacyAction,
  setPrivacyLockEnabled,
  setPinAction,
  updatePrivacyPreferences,
} from "@/server/actions/privacy";

export function PrivacySettings({
  pinSet,
  privacyLockEnabled,
  hideDating,
  blurPrivateNotes,
  retryAfterSeconds,
}: {
  pinSet: boolean;
  privacyLockEnabled: boolean;
  hideDating: boolean;
  blurPrivateNotes: boolean;
  retryAfterSeconds: number;
}) {
  const router = useRouter();
  const [lockEnabled, setLockEnabled] = React.useState(privacyLockEnabled);
  const [hidden, setHidden] = React.useState(hideDating);
  const [blur, setBlur] = React.useState(blurPrivateNotes);
  const [changingPin, setChangingPin] = React.useState(false);
  const [locking, setLocking] = React.useState(false);
  const [retrySeconds, setRetrySeconds] = React.useState(retryAfterSeconds);
  const [disablingLock, setDisablingLock] = React.useState(false);
  const [disableError, setDisableError] = React.useState<string>();

  async function savePin(previous: ActionResult, form: FormData): Promise<ActionResult> {
    const result = await setPinAction(previous, form);
    setRetrySeconds(result.retryAfterSeconds ?? 0);
    if (result.ok) {
      setChangingPin(false);
      toast.success("PIN saved");
      router.refresh();
    }
    return result;
  }

  const [pinState, pinAction] = useActionState<ActionResult, FormData>(savePin, { ok: true });

  async function removePin(previous: ActionResult, form: FormData): Promise<ActionResult> {
    const result = await clearPinAction(previous, form);
    setRetrySeconds(result.retryAfterSeconds ?? 0);
    return result;
  }

  const [clearState, clearAction] = useActionState<ActionResult, FormData>(removePin, { ok: true });

  React.useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(() => setRetrySeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  async function savePreferences(next: { hide?: boolean; blur?: boolean }) {
    const form = new FormData();
    form.set("hideDating", String(next.hide ?? hidden));
    form.set("blurPrivateNotes", String(next.blur ?? blur));

    const result = await updatePrivacyPreferences(form);
    if (!result.ok) {
      toast.error(result.error ?? "Could not save.");
      // Put the toggle back where it was.
      setLockEnabled(privacyLockEnabled);
      return;
    }
    router.refresh();
  }

  async function enableLock() {
    const form = new FormData();
    form.set("enabled", "true");
    const result = await setPrivacyLockEnabled(form);
    if (!result.ok) {
      toast.error(result.error ?? "Could not enable the lock.");
      return;
    }
    setLockEnabled(true);
    router.refresh();
  }

  async function disableLock(form: FormData) {
    form.set("enabled", "false");
    const result = await setPrivacyLockEnabled(form);
    if (!result.ok) {
      setDisableError(result.error ?? "Could not disable the lock.");
      return;
    }
    setDisableError(undefined);
    setDisablingLock(false);
    setLockEnabled(false);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <Card>
        <CardContent className="grid gap-3.5 pt-4">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Privacy lock</p>
              <p className="text-xs text-muted-foreground">
                A separate PIN for your dating notes and anything you mark private. It re-locks
                after 15 minutes idle and whenever you sign out.
              </p>
            </div>
          </div>

          {/*
            Being straight about what this does. It stops someone holding your
            unlocked phone; it is not encryption, and pretending otherwise
            would be worse than not having it.
          */}
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            This guards against someone picking up your device. It doesn&apos;t encrypt anything —
            whoever can read the server&apos;s files or a backup can still read this data.
          </p>

          {pinState.error ? (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {pinState.error}
            </p>
          ) : null}
          {clearState.error ? (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-px size-3.5 shrink-0" />
              {clearState.error}
            </p>
          ) : null}
          {retrySeconds > 0 ? (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Too many PIN attempts. Try again in {retrySeconds}s.
            </p>
          ) : null}

          {pinSet && !changingPin ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-[var(--success)]">
                <ShieldCheck className="size-3.5" />
                PIN set
              </span>
              <Button size="sm" variant="outline" disabled={retrySeconds > 0} onClick={() => setChangingPin(true)}>
                Change PIN
              </Button>
            </div>
          ) : (
            <form action={pinAction} className="grid gap-2.5">
              {pinSet ? (
                <Field label="Current PIN" htmlFor="currentPin">
                  <Input id="currentPin" name="currentPin" type="password" inputMode="numeric" autoComplete="off" required disabled={retrySeconds > 0} />
                </Field>
              ) : null}
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Field label={pinSet ? "New PIN" : "PIN"} htmlFor="newPin" hint="4–12 digits.">
                  <Input id="newPin" name="newPin" type="password" inputMode="numeric" autoComplete="off" required />
                </Field>
                <Field label="Confirm" htmlFor="confirmPin">
                  <Input id="confirmPin" name="confirmPin" type="password" inputMode="numeric" autoComplete="off" required />
                </Field>
              </div>
              <div className="flex gap-2">
                <SubmitButton size="sm" disabled={pinSet && retrySeconds > 0}>{pinSet ? "Change PIN" : "Set PIN"}</SubmitButton>
                {pinSet ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setChangingPin(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          )}

          <ToggleRow
            label="Require the PIN"
            description={
              pinSet
                ? "Lock the dating module and anything marked private."
                : "Set a PIN first."
            }
            checked={lockEnabled}
            disabled={!pinSet}
            onChange={(value) => {
              if (value) void enableLock();
              else setDisablingLock(true);
            }}
          />

          {pinSet && lockEnabled && disablingLock ? (
            <form action={disableLock} className="grid gap-2.5 rounded-lg border border-border p-3">
              <Field
                label="Current PIN"
                htmlFor="disableLockPin"
                hint="Confirm your PIN, or unlock this session first."
              >
                <Input
                  id="disableLockPin"
                  name="currentPin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                />
              </Field>
              {disableError ? <p className="text-xs text-destructive">{disableError}</p> : null}
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="sm" variant="destructive">Disable lock</SubmitButton>
                <Button type="button" size="sm" variant="outline" onClick={() => setDisablingLock(false)}>
                  Cancel
                </Button>
                <Button asChild type="button" size="sm" variant="ghost">
                  <Link href="/unlock?next=/settings">Unlock first</Link>
                </Button>
              </div>
            </form>
          ) : null}

          {pinSet && lockEnabled ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (locking) return;
                setLocking(true);
                // Anything saved for offline reading was saved while unlocked.
                // Leaving it behind would make the lock decorative.
                await purgeOfflineCaches();
                await lockPrivacyAction();
              }}
            >
              <Button type="submit" size="sm" variant="outline" disabled={locking}>
                <Lock />
                {locking ? "Locking…" : "Lock now"}
              </Button>
            </form>
          ) : null}

          {pinSet ? (
            <form action={clearAction} className="grid gap-2.5 border-t border-border pt-3">
              <Field label="Remove the PIN" htmlFor="removePin" hint="Switches the lock off too.">
                <Input id="removePin" name="currentPin" type="password" inputMode="numeric" autoComplete="off" placeholder="Current PIN" disabled={retrySeconds > 0} />
              </Field>
              <SubmitButton size="sm" variant="outline" disabled={retrySeconds > 0}>Remove PIN</SubmitButton>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Discretion
          </p>
          <ToggleRow
            label="Hide the dating module"
            description="Removes Dating from navigation and the dashboard entirely."
            checked={hidden}
            onChange={(value) => {
              setHidden(value);
              void savePreferences({ hide: value });
            }}
          />
          <ToggleRow
            label="Blur private notes"
            description="Notes and flags stay blurred until you tap them, even once unlocked."
            checked={blur}
            onChange={(value) => {
              setBlur(value);
              void savePreferences({ blur: value });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  );
}
