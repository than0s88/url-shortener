import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for Docker (.next/standalone/server.js).
  output: "standalone",
  // better-sqlite3 is a native Node module — cannot be bundled by webpack/turbopack.
  // Tell Next.js to keep it as an external require at runtime.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
