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

  it("enforces the channel owner's current role at delivery time", async () => {
    const resolve = async () => [{ address: "192.168.1.20", family: 4 as const }];
    const http = vi.fn(async () => ({ status: 200 }));
    await expect(deliverToChannel(channel("WEBHOOK", { url: "http://lan.example/hook" }), "s", "b", {
      resolve, http, isAdministrator: async (ownerId) => ownerId === "admin",
    })).rejects.toThrow(/administrator/i);
    expect(http).not.toHaveBeenCalled();
  });
});
