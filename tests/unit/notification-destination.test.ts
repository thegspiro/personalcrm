import { describe, expect, it, vi } from "vitest";

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
    // This needs an address whose connect neither completes nor fails, and
    // whether a reserved range behaves that way is the network's business,
    // not this repository's: 192.0.2.1 hangs on one machine here and is
    // refused in 3ms on another. So one is looked for, and the check says so
    // rather than inventing a result when the environment offers none.
    const net = await import("node:net");
    const stalls = async (address: string) =>
      await new Promise<boolean>((decide) => {
        const probe = net.connect({ host: address, port: 2525 });
        const timer = setTimeout(() => { probe.destroy(); decide(true); }, 250);
        const settle = (answer: boolean) => {
          clearTimeout(timer);
          probe.destroy();
          decide(answer);
        };
        probe.once("connect", () => settle(false));
        probe.once("error", () => settle(false));
      });
    let blackhole: string | undefined;
    for (const candidate of ["198.51.100.1", "203.0.113.1", "192.0.2.1"]) {
      if (await stalls(candidate)) { blackhole = candidate; break; }
    }
    if (!blackhole) {
      console.warn("no unroutable address stalls here; the abandoned-dial check did not run");
      return;
    }

    let reached = 0;
    const server = net.createServer((socket) => {
      reached += 1;
      socket.resume();
      socket.write("220 late.example ESMTP\r\n");
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
            // The first answer goes nowhere, so the dial is still in progress
            // when the budget runs out. The second would answer, and must
            // never be tried once the delivery has been given up on.
            resolve: async () => [
              { address: blackhole, family: 4 as const },
              { address: "127.0.0.1", family: 4 as const },
            ],
            isAdministrator: async () => true,
            deadlineMs: 300,
          },
        ),
      ).rejects.toThrow(/deadline|timed out/i);

      // Deliberately long. Without the budget reaching the dial, the first
      // socket runs to its own fifteen-second connect timeout and *then* the
      // second address is tried — so a short wait here would pass against the
      // broken code as readily as the fixed one. Waiting past that point is
      // what makes this a proof rather than a coincidence.
      await new Promise((settle) => setTimeout(settle, 17_000));
      expect(reached).toBe(0);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, 40_000);

  it("enforces the channel owner's current role at delivery time", async () => {
    const resolve = async () => [{ address: "192.168.1.20", family: 4 as const }];
    const http = vi.fn(async () => ({ status: 200 }));
    await expect(deliverToChannel(channel("WEBHOOK", { url: "http://lan.example/hook" }), "s", "b", {
      resolve, http, isAdministrator: async (ownerId) => ownerId === "admin",
    })).rejects.toThrow(/administrator/i);
    expect(http).not.toHaveBeenCalled();
  });
});
