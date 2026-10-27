// Fonts use the local system stack so development does not depend on Google Fonts.

import "@workspace/ui/globals.css"
import ThemeProvider from "@/components/theme-provider"
import { QueryProvider } from "@/providers/QueryProvider"
import { cn } from "@workspace/ui/lib/utils";

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
