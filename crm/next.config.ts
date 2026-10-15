import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["pg", "exceljs", "nodemailer"],
  experimental: {
    // Vercel caps request bodies at 4.5 MB; attachments and imports stay under that.
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default nextConfig;
