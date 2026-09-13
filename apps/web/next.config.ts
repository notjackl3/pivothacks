import path from "node:path";
import type { NextConfig } from "next";

// The shared .env lives at the monorepo root; load it before anything else so that
// NEXT_PUBLIC_* values are inlined into the client bundle and API_BASE_URL reaches the proxy.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // No root .env (or unreadable): rely on the environment that started the process.
}

const nextConfig: NextConfig = {
  transpilePackages: ["@reelrelay/shared"],
};

export default nextConfig;
