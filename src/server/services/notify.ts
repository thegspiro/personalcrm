import "server-only";
import type { NotificationChannel } from "@prisma/client";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
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
  addresses: ResolvedAddress[];
  headers: Record<string, string>;
  body: string;
  deadlineMs: number;
}

type HttpAdapter = (input: HttpInput) => Promise<{ status: number }>;
type SmtpAdapter = (
  config: Record<string, unknown>,
  addresses: ResolvedAddress[],
  mail: { from: string; to: string; subject: string; text: string },
  deadlineMs: number,
) => Promise<void>;

export interface DeliveryDependencies {
  resolve?: ResolveHostname;
  /** The total delivery budget; only tests ever shorten it. */
  deadlineMs?: number;
  isAdministrator?: (ownerId: string) => Promise<boolean>;
  http?: HttpAdapter;
  smtp?: SmtpAdapter;
}

/**
 * How long one delivery may take in total, measured on the clock rather than
 * on socket activity.
 *
 * The scheduler holds a five-minute lease on the ledger row it is sending. A
 * transport-level timeout only fires on silence, so an endpoint that dribbles
 * a byte more often than that never trips one — the send stays pending past
 * the lease, a later pass reclaims the row and sends it again, and the first
 * attempt is still blocking every other candidate behind it.
 */
const DELIVERY_DEADLINE_MS = 60_000;

const defaultHttp: HttpAdapter = ({ url, addresses, headers, body, deadlineMs }) => new Promise((resolve, reject) => {
  // One settling point for every way this can end, because there are more of
  // them than `end` and `error`. A server that sends headers and then resets
  // or truncates the body emits neither on the request: the socket simply
  // closes. Clearing the deadline there without settling — which is what the
  // first version of this did — left the promise pending for ever, holding the
  // scheduler pass open behind it and letting the lease expire into exactly
  // the duplicate delivery the deadline exists to prevent.
  let settled = false;
  let deadline: NodeJS.Timeout | undefined;
  const settle = (outcome: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    outcome();
  };
  const succeed = (status: number) => settle(() => resolve({ status }));
  const abandon = (error: Error) => settle(() => reject(error));

  const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
    method: "POST",
    headers,
    timeout: 15_000,
    // A dedicated agent with pooling off, because the default global agents
    // keep sockets alive and key them by host and port — not by the addresses
    // this delivery validated. A second request to the same origin could pick
    // up a socket opened for the first and never call `lookup` at all, so an
    // answer that has since changed, or one an administrator was allowed and
    // a member is not, would be reached with no check. A connection per
    // delivery is the only way the pin means anything.
    agent: url.protocol === "https:"
      ? new HttpsAgent({ keepAlive: false, maxSockets: 1 })
      : new HttpAgent({ keepAlive: false, maxSockets: 1 }),
    // The URL retains the configured hostname (Host, TLS SNI and certificate
    // verification), while lookup can return only the addresses just
    // validated. Every answer is handed back, not only the first: node picks
    // between them and moves on from one that will not connect, which an
    // AAAA answer on a host without IPv6 otherwise makes fatal. They all came
    // from the same validated set, so the pinning is unchanged.
    //
    // The array form is not optional. Connection family autoselection calls
    // this with `all` set, and answering that with a bare address raises
    // ERR_INVALID_IP_ADDRESS before a socket is opened — every HTTP channel,
    // every time.
    lookup: (_hostname, options, callback) =>
      options?.all
        ? callback(null, addresses as unknown as string, 0)
        : callback(null, addresses[0].address, addresses[0].family),
  }, (response) => {
    response.resume();
    response.once("end", () => succeed(response.statusCode ?? 0));
    response.once("error", abandon);
    response.once("aborted", () =>
      abandon(new Error("Channel cut the response short.")));
  });
  request.once("timeout", () => request.destroy(new Error("Channel request timed out.")));
  // The wall clock, independent of the socket: `timeout` above only fires on
  // inactivity, so it never ends a response that keeps trickling.
  deadline = setTimeout(
    () => request.destroy(new Error("Channel request exceeded its deadline.")),
    deadlineMs,
  );
  request.once("error", abandon);
  // Last resort. The socket is gone and nothing above settled, so the delivery
  // ended without an answer; saying so is the only outcome that lets the row
  // be retried rather than waited on for ever.
  request.once("close", () =>
    abandon(new Error("Channel closed the connection before the response finished.")));
  request.end(body);
});

/**
 * Connect to the validated answers in turn, so one dead address is not fatal.
 *
 * The fallback listener is removed the moment a socket connects, and anything
 * that settles after the first answer is destroyed rather than handed back.
 * Left attached, a socket that failed *during the SMTP exchange* — long after
 * this resolved — re-entered `attempt` and opened the next address: a
 * connection nobody was waiting for and nobody would close, accumulating a
 * file descriptor per failed delivery and per retry of it.
 */
function connectToOne(
  addresses: ResolvedAddress[],
  port: number,
  budgetMs: number,
  signal: AbortSignal,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let dialing: net.Socket | undefined;
    // The budget is enforced here rather than only raced from outside. Racing
    // it left a tie the dial could win: this attempt's own timeout and the
    // delivery deadline expire together, timers registered for the same
    // instant run in the order they were created, and so the next address was
    // tried a moment before the abort landed.
    const stopAt = Date.now() + budgetMs;
    // The delivery's deadline reaches the dial itself. Without this, enough
    // unreachable answers kept `connectToOne` working through the list long
    // after the send had been abandoned — and a later address could still
    // connect and carry the message, arriving after the scheduler had recorded
    // a failure and queued the retry.
    const abandon = () => {
      if (settled) return;
      settled = true;
      dialing?.destroy();
      reject(new Error("Channel delivery exceeded its deadline."));
    };
    if (signal.aborted) {
      abandon();
      return;
    }
    signal.addEventListener("abort", abandon, { once: true });
    const attempt = (index: number) => {
      if (settled) return;
      const socket = net.connect({
        host: addresses[index].address,
        port,
        family: addresses[index].family,
      });
      dialing = socket;
      // Never longer than the delivery has left. One attempt outliving the
      // whole budget helps nobody, and made the list itself unbounded in time.
      socket.setTimeout(Math.min(15_000, budgetMs), () => socket.destroy(new Error("Channel connection timed out.")));
      const onError = (error: Error) => {
        if (settled) return;
        if (index + 1 < addresses.length && Date.now() < stopAt) attempt(index + 1);
        else {
          settled = true;
          signal.removeEventListener("abort", abandon);
          reject(error);
        }
      };
      socket.once("error", onError);
      socket.once("connect", () => {
        // A late arrival from an earlier attempt has nobody to go to.
        if (settled) {
          socket.destroy();
          return;
        }
        settled = true;
        signal.removeEventListener("abort", abandon);
        socket.off("error", onError);
        socket.setTimeout(0);
        resolve(socket);
      });
    };
    attempt(0);
  });
}

const defaultSmtp: SmtpAdapter = async (config, addresses, mail, deadlineMs) => {
  const host = config.host as string;
  const port = typeof config.port === "number" ? config.port : 587;
  // The socket nodemailer is actually talking on, so the deadline can end the
  // exchange rather than merely stop waiting for it — and a controller for the
  // phase before that, when there is no socket yet because the dial is still
  // working through the addresses.
  let live: net.Socket | undefined;
  let expired = false;
  const dial = new AbortController();
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: config.secure === true,
    auth: typeof config.user === "string" && typeof config.pass === "string"
      ? { user: config.user, pass: config.pass }
      : undefined,
    // Bounded like the HTTP channels are, so a delivery cannot outlive the
    // lease the scheduler holds on its ledger row: an SMTP session that hangs
    // would otherwise still be sending when another scheduler pass reclaimed
    // the row and sent it again.
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    // Nodemailer still owns SMTP, STARTTLS, SNI and certificate verification;
    // only the TCP address selection is replaced with the validated address.
    // The connect itself is bounded here rather than by nodemailer, which
    // hands the socket back already opened and so never sees this phase.
    getSocket: (_options: SMTPTransport.Options, callback: (error: Error | null, value?: { connection: net.Socket }) => void) => {
      connectToOne(addresses, port, deadlineMs, dial.signal).then(
        (connection) => {
          // Held so the deadline below can end the session outright. Closing
          // the transport is not enough: for a non-pooled transport it does
          // transport-level cleanup only and leaves the per-message
          // connection running, so the send could still be delivered after
          // the scheduler had recorded a failure and queued a retry — the
          // duplicate the deadline exists to prevent, arriving by the very
          // mechanism meant to stop it.
          live = connection;
          // Resolved after the deadline had already fired: the abort and this
          // callback are a microtask apart, so the socket must be checked here
          // as well or it would be handed to nodemailer to send on.
          if (expired) {
            connection.destroy();
            return;
          }
          callback(null, { connection });
        },
        (error: Error) => callback(error),
      );
    },
  });
  // The same wall-clock bound as the HTTP path, for the same reason: every
  // nodemailer timeout above fires on silence, so a server that answers each
  // command slowly but never stops can still outlive the scheduler's lease.
  let deadline: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      transport.sendMail(mail),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          // Nothing may be in flight once this rejects: a dial still working
          // through the addresses is abandoned, and a session already open is
          // destroyed.
          expired = true;
          dial.abort();
          live?.destroy();
          reject(new Error("Channel delivery exceeded its deadline."));
        }, deadlineMs);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    transport.close();
  }
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
  const deadlineMs = dependencies.deadlineMs ?? DELIVERY_DEADLINE_MS;

  if (channel.kind === "EMAIL") {
    if (typeof config.host !== "string" || typeof config.to !== "string" || typeof config.from !== "string") {
      throw new Error("Email channel requires host, from, and to.");
    }
    const addresses = await validateDestination(config.host, administrative, resolveDns);
    await (dependencies.smtp ?? defaultSmtp)(config, addresses, {
      from: config.from, to: config.to, subject, text: body,
    }, deadlineMs);
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
    url, addresses, headers, body: JSON.stringify(payload), deadlineMs,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Channel redirected (HTTP ${response.status}), which is not followed. Configure the address it points at.`);
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`Channel returned HTTP ${response.status}.`);
}
