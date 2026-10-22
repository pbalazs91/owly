import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["whatsapp-web.js", "puppeteer", "pdf-parse"],
};

export default nextConfig;
