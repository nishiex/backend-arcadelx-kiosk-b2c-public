"use client"

import React from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, Lock, Mail, Eye, EyeOff } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"
import { beginMutationToast } from "@/lib/mutation-toast"

type FormValues = { email: string; password: string }

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const queryClient = useQueryClient()
  const [showPw, setShowPw] = React.useState(false)
  const cardRef = React.useRef<HTMLDivElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { email: "", password: "" } })

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
  }, [])

  const onSubmit = async (values: FormValues) => {
    const mutationToast = beginMutationToast({ method: "POST" })
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(values),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.message || "Invalid email or password")
      }
      // Refresh identity so the dashboard picks up the new session.
      await queryClient.invalidateQueries({ queryKey: ["me"] })
      toast.success("Signed in")
      const next = params.get("next") || "/"
      router.replace(next)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign in failed")
    } finally {
      mutationToast?.finish()
    }
  }

  return (
    <div
      ref={cardRef}
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg"
    >
      <div data-reveal className="mb-6 flex flex-col items-center text-center">
        <img src="/logo.png" alt="ArcadeLX" className="mb-3 h-12 w-auto object-contain" />
        <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to your ArcadeLX account</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div data-reveal>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <div className="relative">
            <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              className={cn(
                "w-full rounded-lg border bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/40",
                errors.email ? "border-destructive" : "border-input"
              )}
              {...register("email", {
                required: "Email is required",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
              })}
            />
          </div>
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div data-reveal>
          <div className="mb-1.5">
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
          </div>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              id="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              className={cn(
                "w-full rounded-lg border bg-background py-2.5 pl-9 pr-10 text-sm outline-none transition focus:ring-2 focus:ring-ring/40",
                errors.password ? "border-destructive" : "border-input"
              )}
              {...register("password", { required: "Password is required" })}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <button
          data-reveal
          type="submit"
          disabled={isSubmitting}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground",
            "transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          {isSubmitting && <Loader2 size={16} className="animate-spin" />}
          {isSubmitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p data-reveal className="mt-6 text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <Link href="/join" className="font-medium text-primary hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
