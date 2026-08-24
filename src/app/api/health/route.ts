import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Container healthcheck. Verifies the app is serving AND that it can reach the
 * database, so Docker restarts the container if MariaDB never comes up.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "ok",
        database: "up",
        latencyMs: Date.now() - startedAt,
        version: process.env.APP_VERSION ?? "dev",
        uptimeSeconds: Math.round(process.uptime()),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        database: "down",
        message: error instanceof Error ? error.message : "unknown error",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
