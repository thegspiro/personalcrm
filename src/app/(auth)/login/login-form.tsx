"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { loginAction, type FormState } from "@/server/actions/auth";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Welcome back</h2>
        <p className="text-xs text-muted-foreground">Sign in to pick up where you left off.</p>
      </div>

      {state.error ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          required
          placeholder="you@example.com"
        />
      </Field>

      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
        />
      </Field>

      <Button type="submit" loading={pending} className="mt-1 h-11 w-full">
        Sign in
      </Button>
    </form>
  );
}
