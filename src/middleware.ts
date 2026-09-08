import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspHeaderName, parseReportOnly } from "@/lib/csp";

/**
 * The app's only middleware, and it exists for one reason: a nonce has to be
 * fresh per request, and `next.config.ts` headers are evaluated once at build
 * time and baked into the routes manifest.
 *
 * It also has to be the *only* place that sets a Content-Security-Policy. Two
 * CSP headers on one response are not "the last one wins" — a browser enforces
 * both, so the effective policy is their intersection, which is a very quiet
 * way to end up with something nobody wrote. The static policy that used to
 * live in `next.config.ts` was therefore moved here whole; the other security
 * headers stay there, since they need no per-request value and apply to static
 * assets this does not run on.
 *
 * The nonce is handed to the render through a request header, which is how Next
 * learns to put it on its own bootstrap scripts, and which `layout.tsx` reads
 * for the one inline script this app writes itself.
 */
export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const csp = buildCsp(nonce, { development: process.env.NODE_ENV !== "production" });
  const header = cspHeaderName(parseReportOnly(process.env.CSP_REPORT_ONLY));

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the policy off the *request* to nonce the scripts it emits, and
  // it looks for the enforcing name specifically. Under report-only the
  // response carries the report-only header while the request still carries
  // this, so the nonce keeps being applied and switching modes changes only
  // whether the browser acts on it.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Documents only. Static assets are immutable, already covered by the
     * headers in `next.config.ts`, and a policy on a JavaScript file governs
     * nothing — running this on them would be latency for no protection.
     *
     * `_next/static` and `_next/image` are Next's own; the file extensions
     * catch what `public/` serves, the service worker among them.
     */
    {
      source:
        "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|webmanifest)$).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
