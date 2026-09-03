"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions/helpers";

/**
 * Wraps an action so every section gets the same toast + refresh behaviour.
 *
 * The optional third argument runs only once the refreshed tree has rendered,
 * not when the action returns. The difference is the window in which a row
 * still carries the record as it was: a caller that closed an editor as soon
 * as the action returned closed it onto that stale row, and reopening it
 * before the refresh landed showed — and could save back — the version before
 * the edit. Running the refresh as a transition makes its completion
 * observable, and closing then is closing onto the row as it now is.
 *
 * The refresh is started from an effect rather than inside the action, and
 * the action never waits for it: a transition started inside a pending
 * action joins it, so an action that waited for that refresh would be
 * waiting on itself, and the form would stay pending for good.
 *
 * The form still stays pending until the refresh lands, without anyone
 * waiting. React renders every pending transition together; the refresh
 * suspends that render until its data arrives; and the update that ends the
 * form's pending state is part of it. A submit button reading the form's
 * status is therefore disabled from the click until the refreshed row has
 * rendered — and the editor closes in that same commit, before it is
 * painted, so there is no frame in which it is open with a live button. The
 * plan-checklist spec slows a refresh and checks exactly that.
 */
export function useAction() {
  const router = useRouter();
  const [refreshing, startTransition] = React.useTransition();
  const [requested, setRequested] = React.useState(0);
  const started = React.useRef(0);
  const sawRefreshing = React.useRef(false);
  const afterRefresh = React.useRef<Array<() => void>>([]);

  React.useEffect(() => {
    if (requested === started.current) return;
    started.current = requested;
    startTransition(() => router.refresh());
  }, [requested, router, startTransition]);

  // A layout effect, not a passive one: the commit that lands the refresh
  // also ends the form's pending state, and a passive effect runs only after
  // that commit has been painted — one frame with the editor still open over
  // the refreshed row and its Save button live. Closing from a layout effect
  // re-renders before the paint, so that frame never exists; the plan
  // checklist spec caught it on a slow runner.
  React.useLayoutEffect(() => {
    // The pending render is what proves a refresh was in flight; without
    // waiting for it, the effect that starts the transition and this one
    // run in the same commit, before anything has been fetched.
    if (refreshing) {
      sawRefreshing.current = true;
      return;
    }
    if (!sawRefreshing.current) return;
    sawRefreshing.current = false;
    const settled = afterRefresh.current;
    afterRefresh.current = [];
    for (const callback of settled) callback();
  }, [refreshing]);

  return React.useCallback(
    async (
      run: () => Promise<ActionResult<unknown>>,
      successMessage?: string,
      onRefreshed?: () => void,
    ) => {
      const result = await run();
      if (!result.ok) {
        // Field errors carry the only useful detail — which input is wrong, and
        // why — while `error` beside them is the generic "check the highlighted
        // fields". Toasting that alone highlights nothing and says nothing, so
        // the detail is what gets shown wherever a form is not rendering it per
        // field itself.
        const detail = Object.values(result.fieldErrors ?? {});
        toast.error(
          detail.length > 0 ? detail.join(" ") : (result.error ?? "Something went wrong."),
        );
        return false;
      }
      if (successMessage) toast.success(successMessage);
      if (onRefreshed) afterRefresh.current.push(onRefreshed);
      setRequested((count) => count + 1);
      return true;
    },
    [],
  );
}

/**
 * Wraps an add action so a successful submit collapses the panel. Leaving it
 * open with the typed text still sitting there makes the next click look like
 * it did nothing.
 *
 * The panel closes as soon as the create returns, not once the refresh has
 * landed. An add panel shows no row that could go stale, so there is nothing
 * to wait for — and waiting would leave a filled-in form with a live button
 * on screen for the length of the refresh, where a second click creates the
 * same thing twice. Editors are the other way round, and go through the
 * deferred close in useAction.
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

/**
 * Wraps an update action so a successful submit closes the editor — but only
 * once the refreshed row has rendered. An editor sits over the row it edits,
 * and that row carries the record as it was until the refresh lands; closing
 * onto it and reopening in that window showed, and could save back, the
 * version before the edit. The form stays pending for the wait (see
 * useAction), so it cannot be submitted twice either.
 */
export function useEditAction() {
  const run = useAction();
  return React.useCallback(
    (
      action: (form: FormData) => Promise<ActionResult<unknown>>,
      close: () => void,
      message?: string,
    ) =>
      async (form: FormData) => {
        await run(() => action(form), message, close);
      },
    [run],
  );
}
