import "server-only";
import type { NotificationChannel } from "@prisma/client";
import nodemailer from "nodemailer";
import { resolveChannelSecrets } from "@/server/notifications/config";
import type { ChannelKind } from "@/lib/notification-channels";

/**
 * Putting a message on the wire.
 *
 * Extracted from the reminder service so a settings action can send a test
 * without dragging the scheduler, the idempotency ledger and the retry loop
 * into its module graph.
 */
export async function deliverToChannel(
  channel: NotificationChannel,
  subject: string,
  body: string,
): Promise<void> {
  const resolved = resolveChannelSecrets({ kind: channel.kind as ChannelKind, config: channel.config });
  if (!resolved.ok) {
    // Deliberately fatal. Sending anyway would mean an unauthenticated SMTP
    // login, or a POST to a third-party host with its Authorization header
    // missing — the request still leaves, just without its credential.
    throw new Error(
      `This channel's saved ${resolved.field} can't be read. It was most likely encrypted under a different AUTH_SECRET; re-enter it in Settings.`,
    );
  }
  const config = resolved.config;

  if (channel.kind === "EMAIL") {
    if (typeof config.host !== "string" || typeof config.to !== "string" || typeof config.from !== "string") {
      throw new Error("Email channel requires host, from, and to.");
    }
    const transport = nodemailer.createTransport({
      host: config.host,
      port: typeof config.port === "number" ? config.port : 587,
      secure: config.secure === true,
      auth: typeof config.user === "string" && typeof config.pass === "string"
        ? { user: config.user, pass: config.pass }
        : undefined,
    });
    await transport.sendMail({ from: config.from, to: config.to, subject, text: body });
    return;
  }

  const url = typeof config.url === "string" ? config.url : null;
  if (!url) throw new Error(`${channel.kind} channel requires a URL.`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (typeof config.token === "string") headers.authorization = `Bearer ${config.token}`;
  const payload = channel.kind === "DISCORD" ? { content: `${subject}\n${body}` } : { title: subject, message: body };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Channel returned HTTP ${response.status}.`);
}
