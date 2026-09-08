"use client";

import * as React from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * The boundary for the first-run welcome flow.
 *
 * `/` redirects back to `/welcome` until onboarding is marked complete, so the
 * secondary action points at `/welcome` itself: anything else is a loop.
 */
export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Onboarding failed to render", error);
  }, [error]);

  return (
    <ErrorState
      title="Setup hit a snag"
      description="This step could not be loaded. Your account is fine — trying again picks up where you were."
      digest={error.digest}
      onRetry={reset}
      homeHref="/welcome"
      homeLabel="Restart setup"
    />
  );
}
