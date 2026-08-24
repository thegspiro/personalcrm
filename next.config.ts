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
};

export default nextConfig;
