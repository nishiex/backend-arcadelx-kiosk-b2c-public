// Fonts use the local system stack so development does not depend on Google Fonts.

import type { Metadata } from "next"
import "@workspace/ui/globals.css"
import ThemeProvider from "@/components/theme-provider"
import { QueryProvider } from "@/providers/QueryProvider"
import { cn } from "@workspace/ui/lib/utils";

export const metadata: Metadata = {
  // Pages already set their own full titles ("Sign in · ArcadeLX"), so no
  // template here: it would append the brand a second time.
  title: "ArcadeLX Kiosk",
  description:
    "Operations console for ArcadeLX arcade kiosk fleets: devices, partners, orders, revenue and settlements.",
  applicationName: "ArcadeLX Kiosk",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", "font-sans")}
    >
      <body>
        <QueryProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
