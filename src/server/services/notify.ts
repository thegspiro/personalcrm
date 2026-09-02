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
      // Bounded like the HTTP channels are, so a delivery cannot outlive the
      // lease the scheduler holds on its ledger row: an SMTP session that
      // hangs would otherwise still be sending when another scheduler pass
      // reclaimed the row and sent it again.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    await transport.sendMail({ from: config.from, to: config.to, subject, text: body });
    return;
  }

  const url = typeof config.url === "string" ? config.url : null;
  if (!url) throw new Error(`${channel.kind} channel requires a URL.`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = typeof config.token === "string" && config.token !== "" ? config.token : null;
  if (token) {
    // Gotify authenticates an application with its own header, not a bearer
    // token. Sharing ntfy's scheme meant a correctly configured Gotify server
    // rejected every request, so the channel was offered and never delivered.
    if (channel.kind === "GOTIFY") headers["x-gotify-key"] = token;
    else headers.authorization = `Bearer ${token}`;
  }
  const payload = channel.kind === "DISCORD" ? { content: `${subject}\n${body}` } : { title: subject, message: body };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
    // Not followed, deliberately. An address allowed by the private-target
    // check can answer with a redirect to one that would not have been, and a
    // followed redirect never passes back through that check — so the server
    // would make the request the boundary exists to refuse. A notification
    // endpoint has no reason to redirect; the final address is the one to
    // configure.
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `Channel redirected (HTTP ${response.status}), which is not followed. Configure the address it points at.`,
    );
  }
  if (!response.ok) throw new Error(`Channel returned HTTP ${response.status}.`);
}
