/**
 * The Content-Security-Policy, built per request around a fresh nonce.
 *
 * The policy this replaces named only `frame-ancestors`, `base-uri` and
 * `form-action` — real protections, but none of them a mitigation for script
 * injection. Adding `script-src` is the point of this: with a nonce, a `<script>`
 * an attacker manages to inject has no way to acquire one, so it does not run.
 *
 * Kept pure and out of the middleware so the policy can be asserted directly
 * rather than by reading a response header, and so the shape is legible in one
 * place instead of concatenated inline.
 */

export interface CspOptions {
  /** Development builds evaluate to keep fast refresh working. */
  development?: boolean;
}

export function buildCsp(nonce: string, options: CspOptions = {}): string {
  const script = [
    `'nonce-${nonce}'`,
    // Lets the bundles Next loads from a nonced bootstrap run without each one
    // needing its own nonce, and — the reason it is worth having — causes
    // modern browsers to ignore the host allow-list entirely, so a path
    // traversal onto our own origin does not become a script source.
    "'strict-dynamic'",
    // Ignored by anything that honours 'strict-dynamic'; there for older
    // browsers, which would otherwise be left with no usable source at all.
    "'self'",
    // Fast refresh compiles in the browser. Never in a production build, which
    // is what the container ships.
    ...(options.development ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${script}`,
    // Next and Tailwind both emit inline style, and there is no nonce path
    // that reaches all of it. Style injection is a defacement and a
    // data-exfiltration aid rather than code execution, and this is the
    // standard trade every Next CSP makes; it is called out in privacy.md
    // rather than left to look deliberate-by-omission.
    "style-src 'self' 'unsafe-inline'",
    // `data:` for the icons drawn at build time, `blob:` for an avatar being
    // previewed before it is uploaded.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Nothing in the browser talks to anything else. The optional AI and
    // address-lookup calls are made by the server, which no policy here binds.
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Nothing here is framed, so there is nothing to allow.
    "frame-src 'none'",
  ].join("; ");
}

/**
 * Which header to send the policy under.
 *
 * Enforcing is the default because a report-only policy mitigates nothing and,
 * in practice, is never switched over. The escape hatch exists because this is
 * self-hosted software: an operator whose deployment trips the policy needs a
 * way back that is not "wait for a release".
 */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

export function parseReportOnly(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
