"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions/helpers";

/** Wraps an action so every section gets the same toast + refresh behaviour. */
export function useAction() {
  const router = useRouter();
  return React.useCallback(
    async (run: () => Promise<ActionResult<unknown>>, successMessage?: string) => {
      const result = await run();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong.");
        return false;
      }
      if (successMessage) toast.success(successMessage);
      router.refresh();
      return true;
    },
    [router],
  );
}

/**
 * Wraps an add action so a successful submit collapses the panel. Leaving it
 * open with the typed text still sitting there makes the next click look like
 * it did nothing.
 */
export function useAddAction() {
  const run = useAction();
  return React.useCallback(
    (
      action: (form: FormData) => Promise<ActionResult<unknown>>,
      close: () => void,
      message?: string,
    ) =>
      async (form: FormData) => {
        if (await run(() => action(form), message)) close();
      },
    [run],
  );
}
