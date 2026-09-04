import { describe, expect, it, vi } from "vitest";
import type { NetConnectOpts, Socket } from "node:net";

vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ prisma: { user: { findUnique: vi.fn() } } }));

const { isPublicAddress, validateDestination } = await import(
  "@/server/services/notification-destination"
);
const { deliverToChannel } = await import("@/server/services/notify");

const channel = (kind: string, config: Record<string, unknown>) => ({
  id: "channel", ownerId: "owner", kind, name: "Test", config,
  isEnabled: true, createdAt: new Date(), updatedAt: new Date(),
}) as never;

describe("notification destinations", () => {
  it("tags failures past the destination boundary, and only those", async () => {
    // What a member may be told turns on this: up to the boundary a refusal
    // and a name that does not resolve must look alike, or the test button is
    // an internal DNS lookup service. Past it the address has already been
    // shown to be public, so the reason says nothing the member did not supply.
    const { ReachedDestinationError } = await import("@/server/services/notify");
    const publicAnswer = [{ address: "93.184.216.34", family: 4 as const }];

    // Refused at the boundary: not tagged.
    const refused = await deliverToChannel(
      channel("WEBHOOK", { url: "https://hook.example/path" }), "s", "b",
      {
        resolve: async () => [{ address: "10.0.0.8", family: 4 as const }],
        isAdministrator: async () => false,
      },
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(refused).not.toBeInstanceOf(ReachedDestinationError);

    // The transport failing afterwards: tagged, with its reason intact.
    const transportFailed = await deliverToChannel(
      channel("WEBHOOK", { url: "https://hook.example/path" }), "s", "b",
      {
        resolve: async () => publicAnswer,
        isAdministrator: async () => false,
        http: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    ).catch((error: unknown) => error);
    expect(transportFailed).toBeInstanceOf(ReachedDestinationError);
    expect((transportFailed as Error).message).toMatch(/ECONNREFUSED/);

    // And a status the endpoint itself chose.
    const refusedByEndpoint = await deliverToChannel(
      channel("WEBHOOK", { url: "https://hook.example/path" }), "s", "b",
      {
        resolve: async () => publicAnswer,
        isAdministrator: async () => false,
        http: async () => ({ status: 401 }),
      },
    ).catch((error: unknown) => error);
    expect(refusedByEndpoint).toBeInstanceOf(ReachedDestinationError);
    expect((refusedByEndpoint as Error).message).toMatch(/HTTP 401/);
  });

  it("rejects mixed public/private DNS answers for a member", async () => {
    const resolve = vi.fn(async () => [
      { address: "93.184.216.34", family: 4 as const },
      { address: "10.0.0.8", family: 4 as const },
    ]);
    await expect(validateDestination("mixed.example", false, resolve)).rejects.toThrow(/administrator/i);
    expect(resolve).toHaveBeenCalledOnce();
  });

  it("classifies IPv4-mapped IPv6 and other non-public ranges", () => {
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(isPublicAddress("::ffff:0a00:0001")).toBe(false);
    // The same address written out in full. Reading the spelling rather than
    // the address let this one past as public, which is an SMTP host aimed at
    // the loopback interface from a member account.
    expect(isPublicAddress("0:0:0:0:0:ffff:7f00:1")).toBe(false);
    expect(isPublicAddress("0000:0000:0000:0000:0000:ffff:192.168.0.1")).toBe(false);
    // Mapped, but genuinely public: still allowed, since it is the address
    // that decides and not the notation.
    expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
    expect(isPublicAddress("0:0:0:0:0:ffff:5db8:d822")).toBe(true);
    expect(isPublicAddress("100.64.0.1")).toBe(false);
    expect(isPublicAddress("ff02::1")).toBe(false);
    expect(isPublicAddress("2001:db8::1")).toBe(false);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("pins HTTP to the validated answer even if DNS would rebind", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const http = vi.fn(async ({ addresses }: { addresses: { address: string }[] }) => {
      expect(addresses.map((answer) => answer.address)).toEqual(["93.184.216.34"]);
      return { status: 204 };
    });
    await deliverToChannel(channel("WEBHOOK", { url: "https://hook.example/path" }), "s", "b", {
      resolve, http, isAdministrator: async () => false,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(http).toHaveBeenCalledOnce();
  });

  it("answers the lookup callback the way the caller asked for it", async () => {
    // Connection family autoselection calls a custom lookup with `all` set and
    // requires an array back; a bare address raises ERR_INVALID_IP_ADDRESS
    // before a socket is opened, which took out every HTTP channel.
    const answers = [
      { address: "2606:4700::1111", family: 6 as const },
      { address: "93.184.216.34", family: 4 as const },
    ];
    let all: unknown;
    let one: unknown;
    const http = vi.fn(async ({ addresses }: { addresses: typeof answers }) => {
      const lookup = (options: { all?: boolean }, callback: (error: null, value: unknown, family?: number) => void) =>
        options.all
          ? callback(null, addresses, 0)
          : callback(null, addresses[0].address, addresses[0].family);
      lookup({ all: true }, (_error, value) => { all = value; });
      lookup({}, (_error, value) => { one = value; });
      return { status: 200 };
    });
    await deliverToChannel(channel("NTFY", { url: "https://ntfy.example/topic" }), "s", "b", {
      resolve: async () => answers, http, isAdministrator: async () => false,
    });
    expect(Array.isArray(all)).toBe(true);
    expect(all).toEqual(answers);
    // Both answers reach the adapter, so one that will not connect is not the
    // end of the delivery.
    expect(one).toBe("2606:4700::1111");
    expect(http.mock.calls[0][0].addresses).toHaveLength(2);
  });

  it("revalidates and pins SMTP hosts on every delivery", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.9", family: 4 }]);
    const smtp = vi.fn(async (_config: Record<string, unknown>, _addresses: { address: string }[]) => undefined);
    const mail = channel("EMAIL", {
      host: "smtp.example", from: "crm@example.com", to: "me@example.com",
    });
    await deliverToChannel(mail, "s", "b", { resolve, smtp, isAdministrator: async () => true });
    await deliverToChannel(mail, "s", "b", { resolve, smtp, isAdministrator: async () => true });
    expect(smtp.mock.calls.map((call) => call[1][0].address)).toEqual(["203.0.113.9", "10.0.0.9"]);
  });

  it("opens its own connection each time, so a pooled socket cannot skip the pin", async () => {
    // The default global agents keep sockets alive and key them by host and
    // port, not by the addresses a delivery validated. A second request to the
    // same origin could pick up the first one's socket and never call `lookup`
    // — reaching an answer that had since changed, or one an administrator was
    // allowed and a member is not.
    const { createServer } = await import("node:http");
    const sockets = new Set<unknown>();
    let lookups = 0;
    const server = createServer((_request, response) => {
      response.writeHead(204);
      response.end();
    });
    server.on("connection", (socket) => sockets.add(socket));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;

    try {
      const resolve = async () => {
        lookups += 1;
        return [{ address: "127.0.0.1", family: 4 as const }];
      };
      const channel_ = channel("WEBHOOK", { url: `http://127.0.0.1:${port}/hook` });
      // Administrator, so the loopback address is allowed through the boundary.
      const deps = { resolve, isAdministrator: async () => true };
      await deliverToChannel(channel_, "s", "b", deps);
      await deliverToChannel(channel_, "s", "b", deps);

      expect(lookups).toBe(2);
      // Two deliveries, two connections. With a pooled agent the second reuses
      // the first and the count is one.
      expect(sockets.size).toBe(2);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("gives up on a response that trickles rather than outliving the lease", async () => {
    // The transport timeout only fires on silence. An endpoint that sends a
    // byte often enough never trips it, so the send stayed pending past the
    // scheduler's five-minute lease — long enough for another pass to reclaim
    // the row and send it a second time. This drives the real adapter, with
    // only the budget shortened.
    const { createServer } = await import("node:http");
    let drip: NodeJS.Timeout | undefined;
    const server = createServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      drip = setInterval(() => response.write("."), 20);
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;

    try {
      await expect(
        deliverToChannel(channel("WEBHOOK", { url: `http://127.0.0.1:${port}/` }), "s", "b", {
          resolve: async () => [{ address: "127.0.0.1", family: 4 as const }],
          isAdministrator: async () => true,
          deadlineMs: 200,
        }),
      ).rejects.toThrow(/deadline/i);
    } finally {
      clearInterval(drip);
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("fails a response that is cut off after its headers", async () => {
    // The server promises 1024 bytes, sends seven, and closes the connection
    // *gracefully*. That distinction is the whole finding: a reset surfaces as
    // ECONNRESET on the request and would have been caught anyway, while a
    // clean FIN mid-body emits neither `end` nor an error — only `close`.
    // Clearing the deadline there without settling, which the first version of
    // the deadline fix did, left this promise pending for ever: the scheduler
    // pass held open, the lease expiring into the duplicate delivery the
    // deadline exists to prevent. Verified against both shapes.
    const { createServer } = await import("node:http");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": "1024" });
      response.write("partial");
      response.socket?.end();
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;

    try {
      await expect(
        deliverToChannel(channel("WEBHOOK", { url: `http://127.0.0.1:${port}/` }), "s", "b", {
          resolve: async () => [{ address: "127.0.0.1", family: 4 as const }],
          isAdministrator: async () => true,
          // Far longer than this test may take, so a pass here is the promise
          // settling on its own rather than the deadline rescuing it.
          deadlineMs: 30_000,
        }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, 10_000);

  it("ends the SMTP session at the deadline rather than leaving it running", async () => {
    // Rejecting is not enough. Closing a non-pooled transport does
    // transport-level cleanup only and leaves the per-message connection
    // alive, so the send could still be delivered *after* the scheduler had
    // recorded a failure and queued a retry — the duplicate the deadline
    // exists to prevent, arriving by the mechanism meant to stop it.
    const { createServer } = await import("node:net");
    const live = new Set<import("node:net").Socket>();
    const server = createServer((socket) => {
      live.add(socket);
      // Read, or this side never notices the close: a socket with no data
      // listener stays paused and emits neither `end` nor `close`, which made
      // an earlier version of this test fail against a working fix.
      socket.resume();
      socket.on("close", () => live.delete(socket));
      // A greeting, then silence: the session is open and nodemailer waits.
      socket.write("220 slow.example ESMTP\r\n");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;

    try {
      await expect(
        deliverToChannel(
          channel("EMAIL", {
            host: "smtp.example", port, from: "crm@example.com", to: "me@example.com",
          }),
          "s", "b",
          {
            resolve: async () => [{ address: "127.0.0.1", family: 4 as const }],
            isAdministrator: async () => true,
            deadlineMs: 300,
          },
        ),
      ).rejects.toThrow(/deadline/i);

      // The socket is gone, not merely unwatched. Without the destroy the
      // server still holds an open connection here.
      await new Promise((settle) => setTimeout(settle, 100));
      expect(live.size).toBe(0);
    } finally {
      for (const socket of live) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, 15_000);

  it("abandons a dial still working through the addresses at the deadline", async () => {
    // The earlier fix held the *connected* socket, which is undefined while
    // `connectToOne` is still trying answers. Enough unreachable ones and the
    // dial worked on past the abandoned send — then a later address connected
    // and carried the message, after the scheduler had recorded a failure and
    // queued the retry.
    //
    // This needs an address whose connect neither completes nor fails for
    // longer than the deadline, and no real address can be relied on to behave
    // that way: reserved ranges hang on one machine and are refused in 3ms on
    // another, and — twice in CI now — an address that hung for the probe was
    // refused during the dial that followed it, so the second address was then
    // tried entirely legitimately and the check failed having proved nothing.
    // The connector is supplied instead, so the first answer's behaviour is
    // decided here rather than by whatever the runner's network happens to do.
    const DEADLINE_MS = 300;
    // Long enough after the deadline that only the abandon can explain the
    // second address going untried, and short enough to keep the test quick.
    const REFUSED_AFTER_MS = 4 * DEADLINE_MS;
    const net = await import("node:net");

    let reached = 0;
    const server = net.createServer((socket) => {
      reached += 1;
      socket.resume();
      socket.write("220 late.example ESMTP\r\n");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const port = (server.address() as { port: number }).port;

    const STALLED = "198.51.100.1";
    const pending: NodeJS.Timeout[] = [];
    // Silent until well past the deadline, then refused — which is what makes
    // this a proof rather than a coincidence. Without the budget reaching the
    // dial, that refusal moves it on to the second address, and the second
    // address answers.
    const connect = (options: NetConnectOpts): Socket => {
      if ("host" in options && options.host === STALLED) {
        const socket = new net.Socket();
        const refuse = setTimeout(
          () => socket.destroy(new Error("ECONNREFUSED")),
          REFUSED_AFTER_MS,
        );
        pending.push(refuse);
        socket.once("close", () => clearTimeout(refuse));
        return socket;
      }
      return net.connect(options);
    };

    try {
      await expect(
        deliverToChannel(
          channel("EMAIL", {
            host: "smtp.example", port, from: "crm@example.com", to: "me@example.com",
          }),
          "s", "b",
          {
            // The first answer goes nowhere, so the dial is still in progress
            // when the budget runs out. The second would answer, and must
            // never be tried once the delivery has been given up on.
            resolve: async () => [
              { address: STALLED, family: 4 as const },
              { address: "127.0.0.1", family: 4 as const },
            ],
            isAdministrator: async () => true,
            deadlineMs: DEADLINE_MS,
            connect,
          },
        ),
      ).rejects.toThrow(/deadline|timed out/i);

      // Past the point the first address gives up, so a dial that outlived the
      // deadline has had its chance to try the second one.
      await new Promise((settle) => setTimeout(settle, REFUSED_AFTER_MS + 400));
      expect(reached).toBe(0);
    } finally {
      for (const timer of pending) clearTimeout(timer);
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, 15_000);

  it("counts a stalled resolver against the delivery budget", async () => {
    // The budget used to start at the transport, so resolution was unbounded —
    // and a slow answer then handed the transport a fresh full budget on top.
    // A "total" deadline that begins after the first network round trip is not
    // one, and the send could still outlive the lease it exists to fit inside.
    const started = Date.now();
    await expect(
      deliverToChannel(channel("NTFY", { url: "https://slow.example/topic" }), "s", "b", {
        resolve: () => new Promise(() => {}),
        isAdministrator: async () => true,
        deadlineMs: 300,
      }),
    ).rejects.toThrow(/deadline/i);
    // Ended by the budget rather than by anything downstream.
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 10_000);

  it("counts the role lookup against the budget too", async () => {
    // Everything that waits on the world has to be inside the clock. The role
    // lookup was the last await left outside it: a stalled one held the
    // delivery open past the lease, and a later pass could reclaim the row and
    // send while this one waited.
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    await expect(
      deliverToChannel(channel("NTFY", { url: "https://ntfy.example/topic" }), "s", "b", {
        resolve,
        isAdministrator: () => new Promise(() => {}),
        deadlineMs: 300,
      }),
    ).rejects.toThrow(/deadline/i);
    // It never got as far as looking the destination up.
    expect(resolve).not.toHaveBeenCalled();
  }, 10_000);

  it("hands the transport only what the budget has left", async () => {
    // Resolution taking most of the budget must not reset it. The adapter is
    // asked what it was given, so a fresh full budget here is visible.
    const spent = 250;
    const http = vi.fn(async ({ deadlineMs }: { deadlineMs: number }) => {
      expect(deadlineMs).toBeLessThan(400 - spent + 120);
      return { status: 200 };
    });
    await deliverToChannel(channel("NTFY", { url: "https://ntfy.example/topic" }), "s", "b", {
      resolve: async () => {
        await new Promise((settle) => setTimeout(settle, spent));
        return [{ address: "93.184.216.34", family: 4 as const }];
      },
      http,
      isAdministrator: async () => false,
      deadlineMs: 400,
    });
    expect(http).toHaveBeenCalledOnce();
  }, 10_000);

  it("enforces the channel owner's current role at delivery time", async () => {
    const resolve = async () => [{ address: "192.168.1.20", family: 4 as const }];
    const http = vi.fn(async () => ({ status: 200 }));
    await expect(deliverToChannel(channel("WEBHOOK", { url: "http://lan.example/hook" }), "s", "b", {
      resolve, http, isAdministrator: async (ownerId) => ownerId === "admin",
    })).rejects.toThrow(/administrator/i);
    expect(http).not.toHaveBeenCalled();
  });
});
