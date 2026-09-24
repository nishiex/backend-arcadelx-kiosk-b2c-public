import React, { Suspense } from "react"
import JoinForm from "@/components/auth/JoinForm"

export const metadata = {
  title: "Sign up · ArcadeLX",
}

export default function JoinPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,theme(colors.primary/8%),transparent_60%)]"
      />
      <div className="relative z-10 w-full max-w-sm">
        <Suspense fallback={null}>
          <JoinForm />
        </Suspense>
      </div>
    </main>
  )
}
