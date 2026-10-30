import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  experimental: {
    // Receipts (max 4 MB) and logos (max 1 MB) are uploaded through Server Actions, whose default
    // limit is 1 MB. Vercel functions accept at most 4.5 MB per request, so stay under that.
    serverActions: { bodySizeLimit: "4.4mb" },
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
