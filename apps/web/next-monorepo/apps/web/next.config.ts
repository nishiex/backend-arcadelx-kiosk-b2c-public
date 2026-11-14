import type { NextConfig } from "next"

// Backend API base URL comes from the environment so each deployment can choose
// its own API origin without changing application code.
if (!process.env.BACKEND_API_URL) {
  throw new Error("Set BACKEND_API_URL to the API origin before building or starting production.")
}
const backendUrl = new URL(process.env.BACKEND_API_URL)
if (!['http:', 'https:'].includes(backendUrl.protocol) || backendUrl.username || backendUrl.password || backendUrl.pathname !== '/' || backendUrl.search || backendUrl.hash) {
  throw new Error("BACKEND_API_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.")
}
const BACKEND_API_URL = backendUrl.origin

const mothershipUrl = new URL(process.env.MOTHERSHIP_API_URL || "https://main.arcadelx.games")
if (!['http:', 'https:'].includes(mothershipUrl.protocol) || mothershipUrl.username || mothershipUrl.password || mothershipUrl.pathname !== '/' || mothershipUrl.search || mothershipUrl.hash) {
  throw new Error("MOTHERSHIP_API_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.")
}
const MOTHERSHIP_API_URL = mothershipUrl.origin

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@workspace/ui"],
  // Proxy all /api/* calls to the backend so the browser stays same-origin.
  // This keeps cookie-based auth (credentials: "include") working without CORS.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_API_URL}/api/:path*`,
      },
      {
        source: "/mothership-api/:path*",
        destination: `${MOTHERSHIP_API_URL}/:path*`,
      },
    ]
  },
}

export default nextConfig
