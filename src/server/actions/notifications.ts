"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { type ActionResult, fail, isAdmin, ok, owner, str } from "./helpers";
import {
  CHANNEL_FIELDS,
  CHANNEL_LABELS,
  isPrivateHostname,
  targetsPrivateHost,
  isChannelKind,
  TEST_NOTIFICATION_BODY,
  TEST_NOTIFICATION_SUBJECT,
  validateChannelConfig,
  type ChannelKind,
} from "@/lib/notification-channels";
import { configOf, mergeChannelSecrets } from "@/server/notifications/config";
import { deliverToChannel } from "@/server/services/notify";

/**
 * Where a reminder is allowed to go.
 *
 * The delivery engine has always been complete; until this existed there was
 * no way to give it a destination, so the hourly job found no channel on every
 * account and sent nothing.
 */

const nameSchema = z.string().trim().min(1, "Give the channel a name.").max(96);

function touch() {
  revalidatePath("/settings");
}

/** The shared `fieldError` takes one field; a channel form can fail several. */
function fieldErrors(errors: Record<string, string>): ActionResult<never> {
  return { ok: false, error: "Please check the highlighted fields.", fieldErrors: errors };
}

/** Read every declared field for a kind out of the form. */
function submitted(kind: ChannelKind, form: FormData): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (const field of CHANNEL_FIELDS[kind]) {
    values[field.name] = str(form, field.name);
    if (field.secret) values[`${field.name}__clear`] = str(form, `${field.name}__clear`);
  }
  return values;
}

/**
 * A username without a password, or the reverse, is not a configuration.
 *
 * `deliverToChannel` hands nodemailer `auth` only when both are strings, so a
 * channel saved with one of them appears configured and then sends
 * unauthenticated — which most relays reject, on every reminder, silently.
 * Checked after the merge because a blank password on an edit means "keep the
 * stored one", so the submitted form alone cannot answer this.
 */
/**
 * Whether every secret this kind cannot work without has ended up stored.
 *
 * Validation cannot decide it: a blank field on an edit means "keep the saved
 * one", so only the merged config knows. Gotify will not accept a message
 * without an application token, and a Discord webhook URL is the credential.
 */
const REQUIRED_SECRETS: Partial<Record<ChannelKind, string[]>> = {
  GOTIFY: ["token"],
  DISCORD: ["url"],
};

function requiredSecretsPresent(kind: ChannelKind, config: Record<string, unknown>): string | null {
  for (const field of REQUIRED_SECRETS[kind] ?? []) {
    const stored = config[`${field}Enc`];
    if (typeof stored !== "string" || stored === "") return field;
  }
  return null;
}

function credentialsComplete(config: Record<string, unknown>): boolean {
  const user = typeof config.user === "string" && config.user !== "";
  const pass = typeof config.passEnc === "string" && config.passEnc !== "";
  return user === pass;
}

/**
 * A channel aimed inside the network is an administrator's call.
 *
 * Not a block: pointing ntfy or Gotify at a box on your own network is the
 * documented use, and the privacy page promises nothing leaves it. But the
 * server makes the request and hands back what came out, so on an install with
 * more than one person it is otherwise a way for any member to probe the
 * host's own network. A single-account install is unaffected — the only
 * account is the administrator.
 */
async function privateTargetAllowed(input: Record<string, string | undefined>): Promise<boolean> {
  // Both shapes a destination takes: a URL for the HTTP kinds, and a bare
  // hostname for SMTP. Checking only the URL left the boundary with a hole
  // exactly the size of an email channel — `host` plus any port, which
  // nodemailer then opens from the server.
  const url = input.url?.trim();
  const host = input.host?.trim();
  const inward = (url && targetsPrivateHost(url)) || (host && isPrivateHostname(host));
  if (!inward) return true;
  return isAdmin();
}

function kindFrom(form: FormData): ChannelKind | null {
  const raw = str(form, "kind");
  return isChannelKind(raw) ? raw : null;
}

export async function createChannel(form: FormData): Promise<ActionResult<{ id: string }>> {
  const { ownerId } = await owner();

  const kind = kindFrom(form);
  if (!kind) return fail("Pick a kind of channel.");

  const parsedName = nameSchema.safeParse(str(form, "name") ?? CHANNEL_LABELS[kind]);
  if (!parsedName.success) {
    return fieldErrors({ name: parsedName.error.issues[0]?.message ?? "That name is too long." });
  }
  const name = parsedName.data;

  const input = submitted(kind, form);
  const validated = validateChannelConfig(kind, input);
  if (!validated.ok) return fieldErrors(validated.errors);

  if (!(await privateTargetAllowed(input))) {
    return fieldErrors({
      [kind === "EMAIL" ? "host" : "url"]:
        "Only an administrator can point a channel at an address on this network.",
    });
  }

  const config = mergeChannelSecrets(kind, validated.config, input, {});
  if (kind === "EMAIL" && !credentialsComplete(config)) {
    return fieldErrors({ pass: "Give a username and a password, or neither." });
  }
  const missing = requiredSecretsPresent(kind, config);
  if (missing) {
    return fieldErrors({
      [missing]: missing === "url" ? "A URL is required." : "This channel needs a token.",
    });
  }

  const created = await prisma.notificationChannel.create({
    data: { ownerId, kind, name, config },
  });

  touch();
  return ok({ id: created.id });
}

export async function updateChannel(form: FormData): Promise<ActionResult> {
  const { ownerId } = await owner();

  const id = str(form, "id");
  if (!id) return fail("Missing channel.");
  const existing = await prisma.notificationChannel.findFirst({ where: { id, ownerId } });
  if (!existing) return fail("Not found.");

  // The kind is fixed once created: changing it would leave a config shaped
  // for the old one, and the sender reads that JSON with raw type guards.
  const kind = existing.kind as ChannelKind;
  const parsedName = nameSchema.safeParse(str(form, "name") ?? existing.name);
  if (!parsedName.success) {
    return fieldErrors({ name: parsedName.error.issues[0]?.message ?? "That name is too long." });
  }
  const name = parsedName.data;

  const input = submitted(kind, form);
  const validated = validateChannelConfig(kind, input);
  if (!validated.ok) return fieldErrors(validated.errors);

  if (!(await privateTargetAllowed(input))) {
    return fieldErrors({
      [kind === "EMAIL" ? "host" : "url"]:
        "Only an administrator can point a channel at an address on this network.",
    });
  }

  const config = mergeChannelSecrets(kind, validated.config, input, configOf(existing));
  if (kind === "EMAIL" && !credentialsComplete(config)) {
    return fieldErrors({ pass: "Give a username and a password, or neither." });
  }
  const missing = requiredSecretsPresent(kind, config);
  if (missing) {
    return fieldErrors({
      [missing]: missing === "url" ? "A URL is required." : "This channel needs a token.",
    });
  }

  await prisma.notificationChannel.update({ where: { id }, data: { name, config } });

  touch();
  return ok();
}

export async function setChannelEnabled(id: string, enabled: boolean): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.notificationChannel.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!existing) return fail("Not found.");

  await prisma.notificationChannel.update({ where: { id }, data: { isEnabled: enabled } });
  touch();
  return ok();
}

export async function deleteChannel(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const existing = await prisma.notificationChannel.findFirst({
    where: { id, ownerId },
    select: { id: true },
  });
  if (!existing) return fail("Not found.");

  // ReminderLog.channelId is SET NULL, so the ledger keeps its record of what
  // was already sent and cannot start re-sending it.
  await prisma.notificationChannel.delete({ where: { id } });
  touch();
  return ok();
}

/**
 * Rate limit for the test button.
 *
 * This is a public POST that makes an outbound request to a URL the caller
 * supplied. Self-hosted and single-user keeps the blast radius small, but the
 * guard is four lines and the alternative is an open relay for whoever holds a
 * session.
 */
const COOLDOWN_MS = 30_000;

/**
 * Keyed by account, not by channel.
 *
 * Keyed by channel, the guard is reset by creating another one — and nothing
 * stops a caller pointing ten channels at the same host and testing each, which
 * is the request rate the limit exists to bound.
 */
const lastTestAt = new Map<string, number>();

/**
 * Send a fixed message, to prove the channel is reachable.
 *
 * Separate from saving on purpose. Verifying before storing is right for the
 * AI key — one global value, where a bad key means silent nothingness — and
 * wrong for a row: a Gotify box that is down for ten minutes must not stop you
 * recording its address.
 *
 * Writes no `ReminderLog`. The ledger's unique key is the occurrence, and a
 * test has none; inventing an entityId for it would pollute the idempotency
 * space that stops a real reminder being sent twice.
 */
export async function sendTestNotification(id: string): Promise<ActionResult> {
  const { ownerId } = await owner();
  const channel = await prisma.notificationChannel.findFirst({ where: { id, ownerId } });
  if (!channel) return fail("Not found.");

  const previous = lastTestAt.get(ownerId);
  if (previous && Date.now() - previous < COOLDOWN_MS) {
    return fail(
      "Give it a moment before testing again.",
      Math.ceil((COOLDOWN_MS - (Date.now() - previous)) / 1000),
    );
  }
  lastTestAt.set(ownerId, Date.now());

  try {
    // Fixed copy, no interpolation. Settings stays reachable while the privacy
    // lock is closed, so this is the one button there that could otherwise put
    // a private person's name on the wire.
    await deliverToChannel(channel, TEST_NOTIFICATION_SUBJECT, TEST_NOTIFICATION_BODY);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That didn't work.");
  }

  return ok();
}
