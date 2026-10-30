import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Client-rendered dashboard (session lives in the browser); all data comes from the FastAPI API.
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
