import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["bcryptjs", "node-cron", "nodemailer"],
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
  eslint: { ignoreDuringBuilds: true },
  // Next resolves this at build time and bakes the result into
  // routes-manifest.json, so it cannot branch on runtime configuration.
  // HSTS is therefore left to the TLS-terminating proxy: the image is built
  // long before anyone knows whether a given deployment is served over HTTPS,
  // and a Strict-Transport-Security header sent from a plain-http install is
  // remembered by the browser and locks the operator out of their own app.
  async headers() {
    const security = [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
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
