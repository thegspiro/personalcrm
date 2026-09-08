import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
const setupComplete = vi.fn();

vi.mock("@/server/db/client", () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock("@/server/db/settings", () => ({ isSetupComplete: setupComplete }));

const { GET } = await import("@/app/api/health/route");

/**
 * The health endpoint takes no session — the container healthcheck runs before
 * anyone signs in — so its failure body is written for an anonymous reader.
 * It used to return the driver's own message, which quotes the connection
 * string, publishing the database host, user and password to anyone who could
 * reach the port. These assert the disclosure is closed and that the shape the
 * CI boot check and the Docker HEALTHCHECK depend on is unchanged.
 */
describe("GET /api/health", () => {
  let stderr: string[];

  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    queryRaw.mockReset();
    setupComplete.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  it("reports ok with the fields the healthcheck and docs promise", async () => {
    queryRaw.mockResolvedValue([{ 1: 1 }]);
    setupComplete.mockResolvedValue(true);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("up");
    expect(body.setup).toBe("complete");
    expect(typeof body.latencyMs).toBe("number");
    expect(typeof body.uptimeSeconds).toBe("number");
  });

  it("distinguishes a booted-but-unconfigured instance", async () => {
    queryRaw.mockResolvedValue([{ 1: 1 }]);
    setupComplete.mockResolvedValue(false);
    expect((await (await GET()).json()).setup).toBe("pending");
  });

  it("answers 503 with database down when the query fails", async () => {
    queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3306"));

    const response = await GET();
    expect(response.status).toBe(503);
    // CI's container boot check greps for this exact pair.
    expect(await response.clone().text()).toContain('"database":"down"');
    expect((await response.json()).status).toBe("error");
  });

  it("never puts the connection string in the response body", async () => {
    queryRaw.mockRejectedValue(
      new Error("Can't reach database server at mysql://crm:hunter2@db.internal:3306/personalcrm"),
    );

    const text = await (await GET()).text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.internal");
    expect(text).not.toContain("mysql://");
  });

  it("puts the detail in the log instead, with the password masked", async () => {
    queryRaw.mockRejectedValue(
      new Error("Can't reach database server at mysql://crm:hunter2@db.internal:3306/personalcrm"),
    );

    await GET();
    const logged = stderr.join("");
    expect(logged).toContain("[health] database unreachable");
    // The operator needs the host to act on it; the password is never useful.
    expect(logged).toContain("db.internal");
    expect(logged).not.toContain("hunter2");
  });

  it("stays 503 when the database is up but the setting read fails", async () => {
    queryRaw.mockResolvedValue([{ 1: 1 }]);
    setupComplete.mockRejectedValue(new Error("table is missing"));
    expect((await GET()).status).toBe(503);
  });
});
