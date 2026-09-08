"use client";

import * as React from "react";
import { toast } from "sonner";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import {
  confirmTwoFactorEnrolment,
  regenerateTwoFactorRecoveryCodes,
  startTwoFactorEnrolment,
  turnOffTwoFactor,
  type EnrolmentStart,
} from "@/server/actions/two-factor";

export interface TwoFactorView {
  enabled: boolean;
  recoveryCodesLeft: number;
}

/**
 * Turning two-factor sign-in on and off.
 *
 * Enrolment is two steps on purpose: the key is shown, and nothing gates a
 * sign-in until a code proves the authenticator holds the same one. Confirming
 * on the first screen is how a mistyped key locks somebody out of an app with
 * no password recovery.
 *
 * The code is drawn server-side and delivered as a data URI, so the page needs
 * no client-side library and the content security policy needs no relaxing.
 * The typed key stays beside it: a camera is the fast path, not the only one,
 * and it is what enrolment falls back to if the code cannot be drawn.
 */
export function TwoFactorSettings({ state }: { state: TwoFactorView }) {
  const [busy, setBusy] = React.useState(false);
  const [enrolment, setEnrolment] = React.useState<EnrolmentStart | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      console.error("Two-factor change failed", error);
      toast.error("That could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function onStart(form: FormData) {
    void run(async () => {
      const result = await startTwoFactorEnrolment(form);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? result.fieldErrors?.currentPassword ?? "Password incorrect.");
        return;
      }
      setEnrolment(result.data);
      setCodes(null);
    });
  }

  function onConfirm(form: FormData) {
    void run(async () => {
      const result = await confirmTwoFactorEnrolment(form);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? "That code is not right.");
        return;
      }
      setEnrolment(null);
      setCodes(result.data.recoveryCodes);
      toast.success("Two-factor sign-in is on.");
    });
  }

  function onRegenerate(form: FormData) {
    void run(async () => {
      const result = await regenerateTwoFactorRecoveryCodes(form);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? result.fieldErrors?.currentPassword ?? "Password incorrect.");
        return;
      }
      setCodes(result.data.recoveryCodes);
      toast.success("New recovery codes. The old ones no longer work.");
    });
  }

  function onDisable(form: FormData) {
    void run(async () => {
      const result = await turnOffTwoFactor(form);
      if (!result.ok) {
        toast.error(result.error ?? result.fieldErrors?.currentPassword ?? "Password incorrect.");
        return;
      }
      setCodes(null);
      setEnrolment(null);
      toast.success("Two-factor sign-in is off.");
    });
  }

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Two-factor sign-in</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Ask for a code from an authenticator app as well as your password. Nothing else
          about the app changes — it stands in front of signing in.
        </p>
      </div>

      {state.enabled ? (
        <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs">
          <ShieldCheck className="size-4 shrink-0" />
          <span>
            On. {state.recoveryCodesLeft} recovery{" "}
            {state.recoveryCodesLeft === 1 ? "code" : "codes"} left.
          </span>
        </p>
      ) : null}

      {codes ? (
        <div className="grid gap-2 rounded-lg border border-border p-3">
          <p className="text-xs font-medium">
            Your recovery codes — save these now. They are not shown again.
          </p>
          <p className="text-xs text-muted-foreground">
            Each works once, in place of a code from your app, if you lose the phone.
          </p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-xs">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {enrolment ? (
        <div className="grid gap-3 rounded-lg border border-border p-3">
          <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            {enrolment.qr ? (
              /*
                A plain img, not next/image. The source is a data URI holding an
                SVG this server just drew: there is nothing to fetch, resize or
                cache, so the optimiser has no work to do and would only add a
                loader in front of bytes that are already here.
              */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                // Decorative: the same key is beside it as selectable text, so
                // describing the picture would only repeat what is already read
                // out. White background in both themes — a scanner wants the
                // contrast a code is specified with.
                alt=""
                src={enrolment.qr}
                width={140}
                height={140}
                className="rounded-md border border-border bg-white p-1.5"
              />
            ) : null}
            <div className="grid min-w-0 gap-1">
              <p className="text-xs font-medium">
                1. Scan this with your authenticator, or type the key
              </p>
              <p className="font-mono text-sm tracking-wide">{enrolment.secret}</p>
              <p className="break-all text-xs text-muted-foreground">
                Or open{" "}
                <a href={enrolment.uri} className="underline">
                  this link
                </a>{" "}
                on the phone that has the app.
              </p>
            </div>
          </div>
          <form action={onConfirm} className="grid gap-2">
            <Field label="2. Enter the code it shows" htmlFor="tf-code">
              <Input
                id="tf-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                placeholder="123456"
              />
            </Field>
            <Button type="submit" size="sm" loading={busy}>
              Turn on
            </Button>
          </form>
        </div>
      ) : null}

      {!state.enabled && !enrolment ? (
        <form action={onStart} className="grid gap-2">
          <Field label="Confirm your password to begin" htmlFor="tf-start-password">
            <Input
              id="tf-start-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" size="sm" loading={busy} className="justify-self-start">
            <KeyRound />
            Set up
          </Button>
        </form>
      ) : null}

      {state.enabled ? (
        <div className="grid gap-4 border-t border-border pt-4">
          <form action={onRegenerate} className="grid gap-2">
            <Field label="New recovery codes" htmlFor="tf-regen-password">
              <Input
                id="tf-regen-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Confirm your password"
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              loading={busy}
              className="justify-self-start"
            >
              Replace recovery codes
            </Button>
          </form>

          <form action={onDisable} className="grid gap-2">
            <Field label="Turn two-factor off" htmlFor="tf-off-password">
              <Input
                id="tf-off-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="Confirm your password"
              />
            </Field>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              loading={busy}
              className="justify-self-start"
            >
              <ShieldOff />
              Turn off
            </Button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
