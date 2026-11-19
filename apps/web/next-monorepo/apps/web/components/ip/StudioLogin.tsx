"use client"

import React from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react"

type FormValues = { email: string; password: string }

const fieldCls =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] py-3 pl-10 pr-3 text-sm text-white placeholder:text-white/25 outline-none transition focus:border-blue-400/40 focus:ring-2 focus:ring-blue-400/20"

// IP owners sign in through their own door: the studio's ink-and-blue canvas
// instead of the operator console's centred card. After auth we read the
// organization type once and land IP parties on /ip, everyone else on "/", so a
// non-IP account that lands here still reaches the right place.
export default function StudioLogin() {
  const queryClient = useQueryClient()
  const [showPw, setShowPw] = React.useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { email: "", password: "" } })

  const onSubmit = async (values: FormValues) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(values),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.message || "Invalid email or password")

      queryClient.clear()

      const meRes = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      const meJson = meRes.ok ? await meRes.json().catch(() => ({})) : {}
      const orgType = meJson?.user?.membership?.organization?.type

      toast.success("Signed in")
      window.location.replace(orgType === "IP_PARTY" ? "/ip" : "/")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed")
    }
  }

  return (
    <div className="dark min-h-dvh bg-[#0b1220] text-white">
      <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
        <section className="relative hidden overflow-hidden border-r border-white/5 p-12 lg:flex lg:flex-col lg:justify-between">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -left-24 top-1/3 h-[420px] w-[420px] rounded-full bg-blue-500/20 blur-[140px]" />
            <div className="absolute -bottom-24 right-0 h-[360px] w-[360px] rounded-full bg-indigo-400/15 blur-[130px]" />
          </div>

          <div className="relative flex items-center gap-3">
            <span aria-hidden className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500" />
            <div className="leading-tight">
              <p className="text-sm font-semibold">
                ArcadeLX <span className="font-normal text-white/35">Studio</span>
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/25">IP owner access</p>
            </div>
          </div>

          <div className="relative">
            <h1 className="max-w-md text-4xl font-semibold leading-[1.1] tracking-tight">
              Your titles,
              <br />
              <span className="bg-gradient-to-r from-blue-300 to-indigo-200 bg-clip-text text-transparent">your numbers.</span>
            </h1>
            <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/45">
              Royalties, kiosk reach and monthly statements for the games you own — kept apart from the
              operator&apos;s console.
            </p>
          </div>

          <p className="relative font-mono text-[10px] uppercase tracking-[0.3em] text-white/20">
            Limitless gaming experience
          </p>
        </section>

        <section className="flex items-center justify-center px-6 py-12 sm:px-10">
          <div className="w-full max-w-sm">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <span aria-hidden className="h-7 w-7 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500" />
              <p className="text-sm font-semibold">
                ArcadeLX <span className="font-normal text-white/35">Studio</span>
              </p>
            </div>

            <h2 className="text-2xl font-semibold tracking-tight">Studio sign in</h2>
            <p className="mt-1.5 text-sm text-white/40">Use the account tied to your IP organization.</p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-8 space-y-4">
              <div>
                <label htmlFor="studio-email" className="mb-1.5 block text-xs font-medium text-white/60">
                  Email
                </label>
                <div className="relative">
                  <Mail size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    id="studio-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@studio.com"
                    className={fieldCls}
                    {...register("email", {
                      required: "Email is required",
                      pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
                    })}
                  />
                </div>
                {errors.email && <p className="mt-1.5 text-xs text-rose-300">{errors.email.message}</p>}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label htmlFor="studio-password" className="block text-xs font-medium text-white/60">
                    Password
                  </label>
                  <Link href="/forgot-password" className="text-[11px] text-blue-300/70 hover:text-blue-200">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/25" />
                  <input
                    id="studio-password"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className={`${fieldCls} pr-10`}
                    {...register("password", { required: "Password is required" })}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(value => !value)}
                    aria-label={showPw ? "Hide password" : "Show password"}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/25 transition hover:text-white/70"
                  >
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {errors.password && <p className="mt-1.5 text-xs text-rose-300">{errors.password.message}</p>}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-400 to-indigo-500 py-3 text-sm font-semibold text-[#071329] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting && <Loader2 size={16} className="animate-spin" />}
                {isSubmitting ? "Entering studio…" : "Enter studio"}
              </button>
            </form>

            <div className="mt-8 flex items-center gap-3">
              <span aria-hidden className="h-px flex-1 bg-white/5" />
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/25">or</span>
              <span aria-hidden className="h-px flex-1 bg-white/5" />
            </div>

            <p className="mt-6 text-center text-xs text-white/40">
              Operator or partner?{" "}
              <Link href="/login" className="font-medium text-blue-300/80 hover:text-blue-200">
                Sign in to the console
              </Link>
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
