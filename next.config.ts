import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM packages that must be loaded with Node's require instead of being bundled.
  serverExternalPackages: ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "shiki", "unpdf"],
};

export default nextConfig;
