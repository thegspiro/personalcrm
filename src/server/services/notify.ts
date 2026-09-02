import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import net from "node:net";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { prisma } from "@/server/db/client";
import { resolveChannelSecrets } from "@/server/notifications/config";
import type { ChannelKind } from "@/lib/notification-channels";
import {
  resolveHostname,
  validateDestination,
  type ResolveHostname,
  type ResolvedAddress,
} from "./notification-destination";

interface HttpInput {
  url: URL;
  address: ResolvedAddress;
  headers: Record<string, string>;
  body: string;
}

type HttpAdapter = (input: HttpInput) => Promise<{ status: number }>;
type SmtpAdapter = (
  config: Record<string, unknown>,
  address: ResolvedAddress,
  mail: { from: string; to: string; subject: string; text: string },
) => Promise<void>;

export interface DeliveryDependencies {
  resolve?: ResolveHostname;
  isAdministrator?: (ownerId: string) => Promise<boolean>;
  http?: HttpAdapter;
  smtp?: SmtpAdapter;
}

const defaultHttp: HttpAdapter = ({ url, address, headers, body }) => new Promise((resolve, reject) => {
  const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
    method: "POST",
    headers,
    timeout: 15_000,
    // The URL retains the configured hostname (Host, TLS SNI and certificate
    // verification), while lookup can return only the address just validated.
    lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
  }, (response) => {
    response.resume();
    response.once("end", () => resolve({ status: response.statusCode ?? 0 }));
  });
  request.once("timeout", () => request.destroy(new Error("Channel request timed out.")));
  request.once("error", reject);
  request.end(body);
});

const defaultSmtp: SmtpAdapter = async (config, address, mail) => {
  const host = config.host as string;
  const port = typeof config.port === "number" ? config.port : 587;
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: config.secure === true,
    auth: typeof config.user === "string" && typeof config.pass === "string"
      ? { user: config.user, pass: config.pass }
      : undefined,
    // Nodemailer still owns SMTP, STARTTLS, SNI and certificate verification;
    // only the TCP address selection is replaced with the validated address.
    getSocket: (_options: SMTPTransport.Options, callback: (error: Error | null, value?: { connection: net.Socket }) => void) => {
      const socket = net.connect({ host: address.address, port, family: address.family });
      socket.once("error", (error) => callback(error));
      socket.once("connect", () => callback(null, { connection: socket }));
    },
  });
  await transport.sendMail(mail);
};

export async function deliverToChannel(
  channel: NotificationChannel,
  subject: string,
  body: string,
  dependencies: DeliveryDependencies = {},
): Promise<void> {
  const resolved = resolveChannelSecrets({ kind: channel.kind as ChannelKind, config: channel.config });
  if (!resolved.ok) {
    throw new Error(
      `This channel's saved ${resolved.field} can't be read. It was most likely encrypted under a different AUTH_SECRET; re-enter it in Settings.`,
    );
  }
  const config = resolved.config;
  const isAdministrator = dependencies.isAdministrator ?? (async (ownerId: string) => {
    const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { role: true } });
    return user?.role === "ADMIN";
  });
  const administrative = await isAdministrator(channel.ownerId);
  const resolveDns = dependencies.resolve ?? resolveHostname;

  if (channel.kind === "EMAIL") {
    if (typeof config.host !== "string" || typeof config.to !== "string" || typeof config.from !== "string") {
      throw new Error("Email channel requires host, from, and to.");
    }
    const addresses = await validateDestination(config.host, administrative, resolveDns);
    await (dependencies.smtp ?? defaultSmtp)(config, addresses[0], {
      from: config.from, to: config.to, subject, text: body,
    });
    return;
  }

  const rawUrl = typeof config.url === "string" ? config.url : null;
  if (!rawUrl) throw new Error(`${channel.kind} channel requires a URL.`);
  const url = new URL(rawUrl);
  const addresses = await validateDestination(url.hostname, administrative, resolveDns);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = typeof config.token === "string" && config.token !== "" ? config.token : null;
  if (token) {
    if (channel.kind === "GOTIFY") headers["x-gotify-key"] = token;
    else headers.authorization = `Bearer ${token}`;
  }
  const payload = channel.kind === "DISCORD" ? { content: `${subject}\n${body}` } : { title: subject, message: body };
  const response = await (dependencies.http ?? defaultHttp)({
    url, address: addresses[0], headers, body: JSON.stringify(payload),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Channel redirected (HTTP ${response.status}), which is not followed. Configure the address it points at.`);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`Channel returned HTTP ${response.status}.`);
}
