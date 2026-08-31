"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, fail, isAdmin, ok, owner, str } from "./helpers";
import { setGeoConnection, setGeoEnabled } from "@/server/geo/config";
import { geoProviderById } from "@/server/geo/providers";

/**
 * Configuring the optional address lookup.
 *
 * Like the assisted reading, this is a feature the app works fine without: with
 * it off, a place's address is simply something you type. So nothing here is
 * fatal, and the default is off.
 *
 * Both writes are administrator-only, because the endpoint is stored per
 * *installation* rather than per account. On an install with more than one
 * person, any member could otherwise point it at a server they control and
 * collect the place names and addresses every other account looks up — a
 * cross-owner disclosure that owner scoping cannot catch, because there is no
 * owner on the row to scope by.
 */

function touch() {
  revalidatePath("/settings");
  revalidatePath("/locations");
}

export async function updateGeoEnabled(enabled: boolean): Promise<ActionResult> {
  await owner();
  if (!(await isAdmin())) return fail("Only an administrator can change this.");
  await setGeoEnabled(enabled);
  touch();
  return ok();
}

export async function saveGeoConnection(form: FormData): Promise<ActionResult> {
  await owner();
  if (!(await isAdmin())) return fail("Only an administrator can change this.");

  const providerId = str(form, "provider") ?? "";
  const definition = geoProviderById(providerId);
  if (!definition) return fail("Pick a provider.");

  // A fixed endpoint is not editable from the app, so the stored value is the
  // table's rather than whatever was posted.
  let baseUrl = definition.defaultBaseUrl;
  if (definition.baseUrlEditable) {
    const posted = str(form, "baseUrl");
    if (!posted) return fail("Give the endpoint an address.");
    try {
      const parsed = new URL(posted);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return fail("The address should start with http:// or https://.");
      }
      baseUrl = posted.replace(/\/+$/, "");
    } catch {
      return fail("That isn't a valid address.");
    }
  }

  await setGeoConnection(definition.id, baseUrl);
  touch();
  return ok();
}
