"use client"

import React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Loader2, Mail, Lock, ShieldCheck, ArrowLeft, Eye, EyeOff } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"
import { beginMutationToast } from "@/lib/mutation-toast"

type Step = "email" | "otp" | "reset"

async function post(path: string, body: unknown) {
  const mutationToast = beginMutationToast({ method: "POST" })
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.message || "Something went wrong")
    return json
  } finally {
    mutationToast?.finish()
  }
}

export default function ForgotPasswordForm() {
  const router = useRouter()
  const cardRef = React.useRef<HTMLDivElement>(null)

  const [step, setStep] = React.useState<Step>("email")
  const [busy, setBusy] = React.useState(false)
  const [showPw, setShowPw] = React.useState(false)

  const [email, setEmail] = React.useState("")
  const [otp, setOtp] = React.useState("")
  const [resetToken, setResetToken] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirm, setConfirm] = React.useState("")

  // Re-run the entrance whenever the step changes so each panel eases in.
  React.useEffect(() => {
    if (!cardRef.current || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        cardRef.current!.querySelectorAll("[data-reveal]"),
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: EASE, stagger: 0.07 }
      )
    }, cardRef)
    return () => ctx.revert()
  }, [step])

  const submitEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast.error("Enter a valid email")
    setBusy(true)
    try {
      await post("/api/auth/forgot-password", { email })
      toast.success("If an account exists, an OTP has been sent")
      setStep("otp")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send OTP")
    } finally {
      setBusy(false)
    }
  }

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(otp)) return toast.error("OTP must be 6 digits")
    setBusy(true)
    try {
      const json = await post("/api/auth/verify-reset-otp", { email, otp })
      const token = json?.data?.resetToken
      if (!token) throw new Error("Verification failed")
      setResetToken(token)
      toast.success("OTP verified")
      setStep("reset")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid or expired OTP")
    } finally {
      setBusy(false)
    }
  }

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) return toast.error("Password must be at least 8 characters")
    if (password !== confirm) return toast.error("Passwords do not match")
    setBusy(true)
    try {
      await post("/api/auth/reset-password", {
        resetToken,
        newPassword: password,
        confirmPassword: confirm,
      })
      toast.success("Password reset — please sign in")
      router.replace("/login")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed")
    } finally {
      setBusy(false)
    }
  }

  const resendOtp = async () => {
    setBusy(true)
    try {
      await post("/api/auth/forgot-password", { email })
      toast.success("A new OTP has been sent")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resend OTP")
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    "w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/40"
  const btnCls = cn(
    "flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground",
    "transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
  )

  const stepMeta: Record<Step, { title: string; sub: string }> = {
    email: { title: "Reset your password", sub: "Enter your email and we'll send a one-time code" },
    otp: { title: "Enter the code", sub: `We sent a 6-digit code to ${email || "your email"}` },
    reset: { title: "Choose a new password", sub: "Pick a strong password you haven't used before" },
  }

  return (
    <div ref={cardRef} className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
      <div data-reveal className="mb-6 flex flex-col items-center text-center">
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ShieldCheck size={20} />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{stepMeta[step].title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{stepMeta[step].sub}</p>
      </div>

      {step === "email" && (
        <form onSubmit={submitEmail} className="space-y-4">
          <div data-reveal>
            <label htmlFor="fp-email" className="mb-1.5 block text-sm font-medium">Email</label>
            <div className="relative">
              <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="fp-email" type="email" autoComplete="email" placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            </div>
          </div>
          <button data-reveal type="submit" disabled={busy} className={btnCls}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "Sending…" : "Send code"}
          </button>
        </form>
      )}

      {step === "otp" && (
        <form onSubmit={submitOtp} className="space-y-4">
          <div data-reveal>
            <label htmlFor="fp-otp" className="mb-1.5 block text-sm font-medium">6-digit code</label>
            <input id="fp-otp" inputMode="numeric" autoComplete="one-time-code" placeholder="••••••"
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-input bg-background py-2.5 text-center text-lg font-semibold tracking-[0.5em] outline-none transition focus:ring-2 focus:ring-ring/40" />
          </div>
          <button data-reveal type="submit" disabled={busy} className={btnCls}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "Verifying…" : "Verify code"}
          </button>
          <button data-reveal type="button" onClick={resendOtp} disabled={busy}
            className="w-full text-center text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-60">
            Didn&apos;t get it? Resend code
          </button>
        </form>
      )}

      {step === "reset" && (
        <form onSubmit={submitReset} className="space-y-4">
          <div data-reveal>
            <label htmlFor="fp-pw" className="mb-1.5 block text-sm font-medium">New password</label>
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="fp-pw" type={showPw ? "text" : "password"} autoComplete="new-password" placeholder="At least 8 characters"
                value={password} onChange={(e) => setPassword(e.target.value)} className={cn(inputCls, "pr-10")} />
              <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div data-reveal>
            <label htmlFor="fp-confirm" className="mb-1.5 block text-sm font-medium">Confirm password</label>
            <div className="relative">
              <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input id="fp-confirm" type={showPw ? "text" : "password"} autoComplete="new-password" placeholder="Re-enter password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} />
            </div>
          </div>
          <button data-reveal type="submit" disabled={busy} className={btnCls}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? "Resetting…" : "Reset password"}
          </button>
        </form>
      )}

      <div data-reveal className="mt-6 text-center">
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </div>
  )
}
