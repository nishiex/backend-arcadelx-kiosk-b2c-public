import React from 'react'
import Sidebar from '@/components/dashboard/Sidebar'
import Header from '@/components/dashboard/Header'
import AuthGuard from '@/components/dashboard/AuthGuard'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="p-6">
          <AuthGuard>{children}</AuthGuard>
        </main>
      </div>
    </div>
  )
}
