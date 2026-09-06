/**
 * The address this installation is reachable at, for building a link somebody
 * is meant to paste somewhere else.
 *
 * `APP_URL` is the operator's published address and always wins: it is the one
 * an outside service — a calendar client fetching a subscription — has to be
 * able to resolve. The request's own host is the fallback, which is right for
 * the common case of an install nobody has configured `APP_URL` on and is
 * administering over the same address they would subscribe from.
 *
 * Never used for a security decision. `Host` and `X-Forwarded-*` are whatever
 * the request presented, so this is only ever shown back to the signed-in
 * person who asked for it.
 */
export function resolveAppUrl(
  configured: string | undefined,
  headers: { host?: string | null; forwardedHost?: string | null; forwardedProto?: string | null },
): string {
  const explicit = configured?.trim().replace(/\/+$/, "");
  if (explicit) return explicit;

  const host = (headers.forwardedHost ?? headers.host ?? "").split(",")[0]?.trim();
  if (!host) return "";

  const proto = (headers.forwardedProto ?? "").split(",")[0]?.trim();
  // Default to https for anything that is not plainly local: an install
  // reached by hostname is far more often behind TLS than not, and showing
  // http:// for one that is would hand out an address that redirects.
  const scheme = proto || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${scheme}://${host}`;
}
