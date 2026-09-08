import type { NextConfig } from "next";

/**
 * Packages that must never be bundled: they are Node-only, and both the server
 * bundle and the edge one need telling, for different reasons. See the webpack
 * hook below.
 */
const NODE_ONLY_PACKAGES = ["bcryptjs", "node-cron", "nodemailer"];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: NODE_ONLY_PACKAGES,
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
  eslint: { ignoreDuringBuilds: true },
  /**
   * Keep Node-only packages out of the edge bundle.
   *
   * `src/middleware.ts` runs on the edge runtime, and its existence makes Next
   * compile `instrumentation.ts` for that runtime too. The guard inside it
   * already stops the work *running* there, but webpack still resolves the
   * dynamic import to build a chunk, which reaches these three — and the edge
   * runtime has no `node:crypto` for them to require. `serverExternalPackages`
   * covers the Node server only and does not apply here.
   *
   * Naming the offending packages one by one was the first attempt and it is a
   * losing game — excluding nodemailer only exposed `node:net` behind it. The
   * whole subtree is replaced at its single entry point instead, so no future
   * dependency of the boot tasks can break the edge build again. Nothing on
   * edge may call it, which the runtime guard in `src/instrumentation.ts`
   * already guarantees.
   */
  webpack: (config, { webpack, nextRuntime }) => {
    if (nextRuntime === "edge") {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]server[\\/]startup(\.ts)?$/,
          require.resolve("./src/server/startup.edge-stub.ts"),
        ),
      );
    }
    return config;
  },
  // Next resolves this at build time and bakes the result into
  // routes-manifest.json, so it cannot branch on runtime configuration.
  // HSTS is therefore left to the TLS-terminating proxy: the image is built
  // long before anyone knows whether a given deployment is served over HTTPS,
  // and a Strict-Transport-Security header sent from a plain-http install is
  // remembered by the browser and locks the operator out of their own app.
  async headers() {
    // No Content-Security-Policy here. It needs a per-request nonce, which a
    // build-time header cannot carry, so `src/middleware.ts` owns it outright —
    // and it has to own it alone, because two CSP headers on one response are
    // enforced as their intersection rather than the later replacing the
    // earlier. The rest need no per-request value and are left here, where they
    // also cover the static assets middleware deliberately skips.
    const security = [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      { source: "/:path*", headers: security },
      ...["/dating/:path*", "/unlock/:path*", "/settings/:path*"].map((source) => ({
        source,
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      })),
    ];
  },
};

export default nextConfig;
