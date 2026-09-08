import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { isSetupComplete } from "@/server/db/settings";
import { createLogger } from "@/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("health");

/**
 * Container healthcheck. Verifies the app is serving AND that it can reach the
 * database, so Docker restarts the container if MariaDB never comes up.
 *
 * This endpoint takes no session — the healthcheck runs before anyone signs in
 * — so the failure body has to be written for an anonymous reader. It used to
 * return the driver's own message, which quotes the connection string it failed
 * on and therefore published the database host, user and password to anyone who
 * could reach the port. The detail now goes to the container log, where the
 * operator was already being told to look, and the response says only that the
 * database is down.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    // So an operator can tell a booted-but-unconfigured instance from a working
    // one without opening a browser. Cheap: isSetupComplete short-circuits on an
    // AppSetting row once the first account exists.
    const setup = (await isSetupComplete()) ? "complete" : "pending";
    return NextResponse.json(
      {
        status: "ok",
        database: "up",
        setup,
        latencyMs: Date.now() - startedAt,
        version: process.env.APP_VERSION ?? "dev",
        uptimeSeconds: Math.round(process.uptime()),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    log.error("database unreachable", error, { latencyMs: Date.now() - startedAt });
    return NextResponse.json(
      {
        status: "error",
        database: "down",
        message: "The database could not be reached. See the container log for details.",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
