"use client";

import * as React from "react";
import "./globals.css";

/**
 * The last-resort boundary: it replaces the root layout, so it is what shows
 * when the failure was in the root layout itself or in a route group's layout.
 * `(app)/layout.tsx` loads the user, the privacy state and four queries before
 * rendering anything, and none of that was covered by a boundary — a database
 * hiccup there produced React's unstyled default screen.
 *
 * Deliberately self-contained. It cannot use `ThemeProvider`, `Toaster` or
 * anything else the root layout supplies, and it should not depend on a
 * component that might be implicated in the crash it is reporting, so the
 * markup here is plain and the only import is the stylesheet.
 */
const THEME_BOOT = `
(function(){try{
var t=localStorage.getItem("theme");
var dark=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(dark)document.documentElement.classList.add("dark");
}catch(e){}})();
`.trim();

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Application failed to render", error);
  }, [error]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Something went wrong · Personal CRM</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Personal CRM could not start this page. Your data is untouched. If this keeps
            happening, check the container log for the reference below.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Try again
            </button>
            {/*
              A plain anchor, not next/link, and deliberately so: this boundary
              is showing because the root or a group layout threw, and a client
              navigation would re-enter that same broken tree. A full document
              load is the recovery being offered here.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex h-9 items-center justify-center rounded-md border border-border px-4 text-sm font-medium"
            >
              Back to home
            </a>
          </div>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Reference <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
