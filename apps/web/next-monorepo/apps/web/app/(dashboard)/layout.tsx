import React from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import AppShell from '@/components/dashboard/AppShell'
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

  // AppShell picks the chrome by organization type (operator console vs IP studio).
  // It renders outside AuthGuard so the frame paints immediately; only the content
  // area waits for /api/auth/me.
  return (
    <AppShell>
      <AuthGuard>{children}</AuthGuard>
    </AppShell>
  )
}
