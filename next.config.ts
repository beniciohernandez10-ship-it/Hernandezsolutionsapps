import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // PGlite (local development database) loads WebAssembly from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  async redirects() {
    return [{ source: "/", destination: "/portal", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "cache-control", value: "no-cache" },
          { key: "service-worker-allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
