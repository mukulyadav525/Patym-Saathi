import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Client-rendered dashboard (session lives in the browser); all data comes from the FastAPI API.
  turbopack: {
    root: path.join(__dirname, ".."), // monorepo: shared/api-types.ts lives one level up
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
