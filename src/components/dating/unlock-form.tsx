"use client";

import { useActionState, useEffect, useState } from "react";
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
  const [retrySeconds, setRetrySeconds] = useState(retryAfterSeconds);

  async function submit(previous: ActionResult, form: FormData): Promise<ActionResult> {
    const result = await unlockPrivacyAction(previous, form);
    setRetrySeconds(result.retryAfterSeconds ?? 0);
    return result;
  }

  const [state, action, pending] = useActionState<ActionResult, FormData>(submit, { ok: true });

  useEffect(() => {
    if (retrySeconds <= 0) return;
    const timer = window.setTimeout(() => setRetrySeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retrySeconds]);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      {retrySeconds > 0 ? (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Too many attempts. Try again in {retrySeconds}s.
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
          disabled={retrySeconds > 0}
          placeholder="••••"
        />
      </Field>

      <Button type="submit" loading={pending} disabled={retrySeconds > 0} className="h-11 w-full">
        Unlock
      </Button>
    </form>
  );
}
