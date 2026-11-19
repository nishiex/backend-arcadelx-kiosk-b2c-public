import React from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import Sidebar from '@/components/dashboard/Sidebar'
import Header from '@/components/dashboard/Header'
import AuthGuard from '@/components/dashboard/AuthGuard'

// Cookie scope decides this check: access_token is scoped to "/" and expires after
// 15m, while refresh_token is scoped to /api/auth/refresh and is never sent on a
// page request. has_session is the 7d hint the API sets at login, so someone whose
// access cookie lapsed but whose refresh session is still good keeps the dashboard
// (the client refreshes silently) instead of being bounced to /login.
//
// Checking here means a logged-out visitor never renders the shell at all - they go
// straight to /login instead of watching a loading screen that ends in a redirect.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const hasSession = cookieStore.has('access_token') || cookieStore.has('has_session')

  if (!hasSession) redirect('/login')

  // The shell renders outside AuthGuard on purpose: Sidebar and Header are
  // null-safe while /api/auth/me is in flight, so a cold load paints the app
  // immediately and only the content area waits.
  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-w-0 p-4 sm:p-6">
          <AuthGuard>{children}</AuthGuard>
        </main>
      </div>
    </div>
  )
}
