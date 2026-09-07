"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { verifyTwoFactorAction, type FormState } from "@/server/actions/auth";

export function VerifyForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(
    verifyTwoFactorAction,
    {},
  );

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Enter your code</h2>
        <p className="text-xs text-muted-foreground">
          The six-digit code from your authenticator app. If you cannot reach it, one of
          your recovery codes works here instead.
        </p>
      </div>

      {state.error ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive-11">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <Field label="Code" htmlFor="code" error={state.fieldErrors?.code}>
        <Input
          id="code"
          name="code"
          // Not `type="number"`: a code can start with a zero, and a spinner on
          // a one-time code is nonsense. `inputMode` still gets the keypad.
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          placeholder="123456"
        />
      </Field>

      <Button type="submit" loading={pending} className="mt-1 h-11 w-full">
        Verify
      </Button>
    </form>
  );
}
