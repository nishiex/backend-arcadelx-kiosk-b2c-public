import type { NextConfig } from "next"

// Backend API base URL. In local dev the Express API runs on :4000.
const BACKEND_API_URL = process.env.BACKEND_API_URL ?? "http://localhost:4000"

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
