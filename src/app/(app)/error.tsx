"use client";

import * as React from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * The boundary for every signed-in page.
 *
 * Without one, a transient database error on `/people` replaced the whole
 * application with React's bare production error screen: no navigation, no way
 * back, and nothing telling the reader their data was still there. This keeps
 * the app shell — the layout renders above this boundary — and offers the
 * retry that usually resolves it.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Next has already logged this on the server; this is for the browser
    // console, which is where somebody debugging their own instance looks.
    console.error("Page failed to render", error);
  }, [error]);

  return <ErrorState digest={error.digest} onRetry={reset} />;
}
