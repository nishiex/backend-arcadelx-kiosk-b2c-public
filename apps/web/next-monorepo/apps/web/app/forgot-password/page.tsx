import React, { Suspense } from "react"
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm"

export const metadata = {
  title: "Reset password · ArcadeLX",
}

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,theme(colors.primary/8%),transparent_60%)]"
      />
      <div className="relative z-10 w-full max-w-sm">
        <Suspense fallback={null}>
          <ForgotPasswordForm />
        </Suspense>
      </div>
    </main>
  )
}
