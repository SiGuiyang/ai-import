import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@neondatabase/serverless', 'mammoth'],
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
