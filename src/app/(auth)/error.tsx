"use client";

import * as React from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * The boundary for sign-in, sign-up and first-run setup.
 *
 * Sends the reader to `/login` rather than `/` — `/` is behind the session
 * these routes exist to establish, so offering it here would bounce a signed-out
 * person straight back and read as a second failure.
 */
export default function AuthError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Auth page failed to render", error);
  }, [error]);

  return (
    <ErrorState
      title="Something went wrong"
      description="That step could not be loaded. Nothing was submitted — trying again is safe."
      digest={error.digest}
      onRetry={reset}
      homeHref="/login"
      homeLabel="Back to sign in"
    />
  );
}
