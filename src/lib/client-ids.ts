/**
 * Ids for rows a form is still building — React keys, and the checklist item
 * ids that go on to be stored.
 *
 * Not `crypto.randomUUID()` on its own, which is the obvious answer and is
 * wrong here: it is exposed only in a **secure context**, and this app's own
 * documented deployment is not one. An Unraid WebUI on `http://[IP]:3000`, or
 * any other plain-HTTP LAN address, leaves `crypto.randomUUID` undefined — so
 * calling it while rendering an editor throws before the form appears, and the
 * failure lands on exactly the self-hosted setups the project is built for.
 *
 * The uniqueness required is per-document, not global: these distinguish rows
 * inside one form, and the checklist ids only have to stay distinct within one
 * plan (`planChecklistSchema` enforces that). A counter plus a random suffix
 * covers that on every origin.
 */
let counter = 0;

export function clientRowId(): string {
  counter += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 10)}`;
}
