"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, fail, isAdmin, ok, owner, str } from "./helpers";
import {
  clearApiKey,
  resolveApiKey,
  setAiConnection,
  setAiEnabled,
  storeApiKey,
} from "@/server/ai/config";
import { providerById } from "@/server/ai/providers";

/**
 * Configuring the optional assisted reading.
 *
 * Every one of these is about a feature the app works fine without, so failure
 * here is never fatal — the worst case is that quick add keeps parsing
 * locally, which is what it does by default anyway.
 *
 * All three writes are administrator-only, for the same reason the address
 * lookup's are: the provider is stored per *installation* rather than per
 * account, so `owner()` has no row to scope by. On an install with more than
 * one person, any member could otherwise point the endpoint at a server they
 * control and collect the lines every other account types into quick add —
 * and these same actions store an API key, which makes the endpoint worth
 * pointing somewhere on its own.
 */

const NOT_ADMIN = "Only an administrator can change this.";

function touch() {
  revalidatePath("/settings");
}

export async function updateAiEnabled(enabled: boolean): Promise<ActionResult> {
  await owner();
  if (!(await isAdmin())) return fail(NOT_ADMIN);
  await setAiEnabled(enabled);
  touch();
  return ok();
}

/**
 * Point the app at a model, checking it answers first.
 *
 * Verified before it is stored because the failure mode otherwise is silence:
 * suggestions simply never appear and there is nothing to tell you why.
 */
export async function saveAiConnection(form: FormData): Promise<ActionResult> {
  await owner();
  if (!(await isAdmin())) return fail(NOT_ADMIN);

  const providerId = str(form, "provider") ?? "";
  const definition = providerById(providerId);
  if (!definition) return fail("Pick a provider.");

  const model = str(form, "model");
  if (!model) return fail("Say which model to use.");

  const baseUrl = definition.baseUrlEditable
    ? (str(form, "baseUrl") ?? definition.defaultBaseUrl)
    : definition.defaultBaseUrl;

  if (definition.baseUrlEditable) {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return fail("The address should start with http:// or https://.");
      }
    } catch {
      return fail("That isn't a valid address.");
    }
  }

  // A new key in the form wins; otherwise whatever is already configured.
  const pastedKey = str(form, "apiKey");
  if (pastedKey) await storeApiKey(pastedKey);
  const resolved = await resolveApiKey();

  if (definition.keyRequired && !resolved) {
    return fail(`${definition.label} needs an API key.`);
  }

  const { verifyConnection } = await import("@/server/ai/quick-add");
  const check = await verifyConnection({
    provider: definition.id,
    baseUrl,
    apiKey: resolved?.key ?? null,
    model,
  });
  if (!check.ok) return fail(check.error ?? "That connection didn't work.");

  await setAiConnection({ provider: definition.id, baseUrl, model });

  touch();
  return ok();
}

export async function removeApiKey(): Promise<ActionResult> {
  await owner();
  if (!(await isAdmin())) return fail(NOT_ADMIN);
  await clearApiKey();
  touch();
  return ok();
}
