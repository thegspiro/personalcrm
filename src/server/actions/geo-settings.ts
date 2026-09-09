"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, fail, isAdmin, ok, owner, str } from "./helpers";
import {
  getGeoStatus,
  setGeoConnection,
  setGeoEnabled,
  setGeoTypeahead,
} from "@/server/geo/config";
import { geoProviderById, typeaheadAllowed } from "@/server/geo/providers";

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

/**
 * Suggestions while you type, on the endpoints that permit them.
 *
 * Separate from `updateGeoEnabled` because it is a separate promise. Turning
 * the lookup on says an address may be sent when asked for; this says it may be
 * sent every time you pause. The stored answer is kept even when the current
 * endpoint cannot honour it — `getGeoStatus` decides whether it applies — so
 * trying Nominatim for an afternoon does not lose the setting.
 */
export async function updateGeoTypeahead(enabled: boolean): Promise<ActionResult> {
  await owner();
  if (!(await isAdmin())) return fail("Only an administrator can change this.");

  // Re-checked here, not merely hidden in the panel: this is a public POST
  // endpoint, and an endpoint whose operator forbids search-as-you-type must
  // not be switched into it by a hand-made request. Switching *off* is always
  // allowed — a refusal that traps the setting on would be the wrong way round.
  if (enabled) {
    const status = await getGeoStatus();
    if (!typeaheadAllowed({ provider: status.provider, baseUrl: status.baseUrl })) {
      return fail("This endpoint doesn't allow suggestions while you type.");
    }
  }

  await setGeoTypeahead(enabled);
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
