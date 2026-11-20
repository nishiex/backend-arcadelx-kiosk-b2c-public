import React, { Suspense } from "react"
import {
  Gamepad2,
  Monitor,
  ReceiptText,
  TrendingUp,
} from "lucide-react"
import LoginForm from "@/components/auth/LoginForm"

export const metadata = {
  title: "IP owner sign in · ArcadeLX",
}

const POINTS = [
  {
    icon: TrendingUp,
    title: "Royalty by title",
    body: "Each game's share of net revenue, calculated per transaction.",
  },
  {
    icon: Monitor,
    title: "Kiosk reach",
    body: "Which machines are running your catalogue, right now.",
  },
  {
    icon: ReceiptText,
    title: "Monthly statements",
    body: "Download the settlement PDF as soon as the month closes.",
  },
]

// The IP owner's door into the console. It shares the operator sign-in's card,
// tokens and motion, but explains the royalty surface instead of the fleet.
export default function IpOwnerLoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,theme(colors.primary/8%),transparent_60%)]"
      />

      <div className="relative z-10 grid w-full max-w-4xl gap-10 lg:grid-cols-[1fr_minmax(0,380px)] lg:items-center">
        <section className="hidden lg:block">
          <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
            IP owner access
          </p>

          <h2 className="mt-4 max-w-md text-3xl font-semibold tracking-tight">
            Your titles,
            <br />
            your numbers.
          </h2>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            Royalties, kiosk reach and monthly statements for the games you own — kept
            apart from the operator&apos;s fleet console.
          </p>

          <ul className="mt-8 space-y-4">
            {POINTS.map((point) => (
              <li key={point.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <point.icon size={16} />
                </span>
                <span>
                  <span className="block text-sm font-medium">{point.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{point.body}</span>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
            <Gamepad2 size={14} className="text-primary" />
            Accounts are created by ArcadeLX when a title is onboarded.
          </p>
        </section>

        <Suspense fallback={null}>
          <LoginForm audience="ip" />
        </Suspense>
      </div>
    </main>
  )
}
