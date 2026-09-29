import type { NextConfig } from "next"

// Backend API base URL. In local dev the Express API runs on :4000.
if (process.env.NODE_ENV === "production" && !process.env.BACKEND_API_URL) {
  throw new Error("Set BACKEND_API_URL to the API origin before building or starting production.")
}
const backendUrl = new URL(process.env.BACKEND_API_URL ?? "http://localhost:4000")
if (!['http:', 'https:'].includes(backendUrl.protocol) || backendUrl.username || backendUrl.password || backendUrl.pathname !== '/' || backendUrl.search || backendUrl.hash) {
  throw new Error("BACKEND_API_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.")
}
const BACKEND_API_URL = backendUrl.origin

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/ui"],
  // Proxy all /api/* calls to the backend so the browser stays same-origin.
  // This keeps cookie-based auth (credentials: "include") working without CORS.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_API_URL}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
