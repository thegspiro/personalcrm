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
    expect(isPublicAddress("100.64.0.1")).toBe(false);
    expect(isPublicAddress("ff02::1")).toBe(false);
    expect(isPublicAddress("2001:db8::1")).toBe(false);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("pins HTTP to the validated answer even if DNS would rebind", async () => {
    const resolve = vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]);
    const http = vi.fn(async ({ address }: { address: { address: string } }) => {
      expect(address.address).toBe("93.184.216.34");
      return { status: 204 };
    });
    await deliverToChannel(channel("WEBHOOK", { url: "https://hook.example/path" }), "s", "b", {
      resolve, http, isAdministrator: async () => false,
    });
    expect(resolve).toHaveBeenCalledOnce();
    expect(http).toHaveBeenCalledOnce();
  });

  it("revalidates and pins SMTP hosts on every delivery", async () => {
    const resolve = vi.fn()
      .mockResolvedValueOnce([{ address: "203.0.113.9", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.9", family: 4 }]);
    const smtp = vi.fn(async (_config: Record<string, unknown>, _address: { address: string }) => undefined);
    const mail = channel("EMAIL", {
      host: "smtp.example", from: "crm@example.com", to: "me@example.com",
    });
    await deliverToChannel(mail, "s", "b", { resolve, smtp, isAdministrator: async () => true });
    await deliverToChannel(mail, "s", "b", { resolve, smtp, isAdministrator: async () => true });
    expect(smtp.mock.calls.map((call) => call[1].address)).toEqual(["203.0.113.9", "10.0.0.9"]);
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
