"use client";

import { useActionState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { unlockPrivacyAction } from "@/server/actions/privacy";
import type { ActionResult } from "@/server/actions/helpers";

export function UnlockForm({
  next,
  retryAfterSeconds,
}: {
  next: string;
  retryAfterSeconds: number;
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(
    unlockPrivacyAction,
    { ok: true },
  );

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      {retryAfterSeconds > 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Too many attempts. Try again in {retryAfterSeconds}s.
        </p>
      ) : null}

      <Field label="PIN" htmlFor="pin">
        <Input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          required
          placeholder="••••"
        />
      </Field>

      <Button type="submit" loading={pending} className="h-11 w-full">
        Unlock
      </Button>
    </form>
  );
}
