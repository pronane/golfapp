import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The preview sandbox proxies the dev server through a *.e2b.app host.
  serverExternalPackages: ["@libsql/client", "libsql"],
  experimental: {
    serverActions: { allowedOrigins: ["*.e2b.app", "localhost:3000"] },
  },
};

export default nextConfig;
