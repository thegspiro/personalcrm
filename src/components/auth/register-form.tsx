"use client";

import { useActionState, useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import type { FormState } from "@/server/actions/auth";

export function RegisterForm({
  action,
  heading,
  subheading,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  heading: string;
  subheading: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const timezoneRef = useRef<HTMLInputElement>(null);

  // Default the account's timezone to the browser's, which is almost always right.
  useEffect(() => {
    try {
      if (timezoneRef.current) {
        timezoneRef.current.value = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
      }
    } catch {
      // An empty value makes the server use its validated default timezone.
    }
  }, []);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">{heading}</h2>
        <p className="text-xs text-muted-foreground">{subheading}</p>
      </div>

      {state.error ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <input ref={timezoneRef} type="hidden" name="timezone" defaultValue="" />

      <Field label="Your name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="name" autoFocus required placeholder="Alex Rivera" />
      </Field>

      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          required
          placeholder="you@example.com"
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={state.fieldErrors?.password}
        hint="At least 10 characters, with a number or symbol."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          placeholder="••••••••••"
        />
      </Field>

      <Button type="submit" loading={pending} className="mt-1 h-11 w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
