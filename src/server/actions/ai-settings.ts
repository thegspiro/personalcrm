"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, fail, ok, owner, str } from "./helpers";
import {
  clearApiKey,
  setAiEnabled,
  setAiModel,
  storeApiKey,
} from "@/server/ai/config";

/**
 * Configuring the optional assisted reading.
 *
 * Every one of these is about a feature the app works fine without, so failure
 * here is never fatal — the worst case is that quick add keeps parsing
 * locally, which is what it does by default anyway.
 */

function touch() {
  revalidatePath("/settings");
}

export async function updateAiEnabled(enabled: boolean): Promise<ActionResult> {
  await owner();
  await setAiEnabled(enabled);
  touch();
  return ok();
}

export async function updateAiModel(model: string): Promise<ActionResult> {
  await owner();
  await setAiModel(model);
  touch();
  return ok();
}

/**
 * Store a pasted key, after checking Anthropic actually accepts it.
 *
 * Verifying first means a typo is caught here rather than silently turning
 * into "assistance never seems to do anything".
 */
export async function saveApiKey(form: FormData): Promise<ActionResult> {
  await owner();
  const key = str(form, "apiKey");
  if (!key) return fail("Paste a key first.");
  if (!key.startsWith("sk-ant-")) {
    return fail("That doesn't look like an Anthropic API key.");
  }

  const { verifyApiKey } = await import("@/server/ai/quick-add");
  const check = await verifyApiKey(key);
  if (!check.ok) return fail(check.error ?? "That key didn't work.");

  await storeApiKey(key);
  touch();
  return ok();
}

export async function removeApiKey(): Promise<ActionResult> {
  await owner();
  await clearApiKey();
  touch();
  return ok();
}
