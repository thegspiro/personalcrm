"use client";

import * as React from "react";

/**
 * The last-resort boundary: it replaces the root layout, so it is what shows
 * when the failure was in the root layout itself or in a route group's layout.
 * `(app)/layout.tsx` loads the user, the privacy state and four queries before
 * rendering anything, and none of that was covered by a boundary — a database
 * hiccup there produced React's unstyled default screen.
 *
 * Deliberately self-contained. It cannot use `ThemeProvider`, `Toaster` or
 * anything else the root layout supplies, and it should not depend on a
 * component that might be implicated in the crash it is reporting — so it
 * imports nothing, carries its own colours, and needs no script to choose
 * between them.
 */
/**
 * The crash screen's own colours, as a stylesheet rather than a script.
 *
 * This used to be an inline script reading the stored theme so an explicit
 * choice beat the system preference. Under a nonce-based policy a client
 * component cannot obtain a nonce — it does not run on the server, so it never
 * sees the request header — and the honest options were a hash to maintain or
 * no script. A media query needs neither and gets the same answer for everyone
 * except the reader who overrode their system preference, who sees their
 * system's instead on one error page. That is a good trade for removing an
 * inline script from the policy entirely.
 *
 * Deliberately not Tailwind's `dark:`, which keys on a class that
 * `ThemeProvider` is not here to set.
 */
const CRASH_STYLE = `
.crash{--bg:#fafafa;--fg:#0f1115;--muted:#5b6170;--line:#e3e5ea}
@media (prefers-color-scheme: dark){
.crash{--bg:#0f1115;--fg:#f5f6f8;--muted:#9aa1b1;--line:#2a2e38}
}
.crash{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;
gap:1rem;padding:1.5rem;text-align:center;background:var(--bg);color:var(--fg)}
.crash p{max-width:28rem;font-size:.875rem;color:var(--muted)}
.crash h1{font-size:1.125rem;font-weight:600}
.crash .row{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}
.crash button,.crash a{display:inline-flex;height:2.25rem;align-items:center;justify-content:center;
border-radius:.375rem;padding:0 1rem;font:inherit;font-size:.875rem;font-weight:500;cursor:pointer}
.crash button{background:var(--fg);color:var(--bg);border:0}
.crash a{border:1px solid var(--line);color:inherit;text-decoration:none}
.crash code{font-family:ui-monospace,monospace}
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
        <style dangerouslySetInnerHTML={{ __html: CRASH_STYLE }} />
      </head>
      <body>
        <div className="crash">
          <h1>Something went wrong</h1>
          <p>
            Personal CRM could not start this page. Your data is untouched. If this keeps
            happening, check the container log for the reference below.
          </p>
          <div className="row">
            <button type="button" onClick={reset}>
              Try again
            </button>
            {/*
              A plain anchor, not next/link, and deliberately so: this boundary
              is showing because the root or a group layout threw, and a client
              navigation would re-enter that same broken tree. A full document
              load is the recovery being offered here.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">Back to home</a>
          </div>
          {error.digest ? (
            <p>
              Reference <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
