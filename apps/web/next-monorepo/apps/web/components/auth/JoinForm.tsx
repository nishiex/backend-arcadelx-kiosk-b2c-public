"use client"

import React from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, User, Mail, Lock, Ticket, Eye, EyeOff } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"
import { beginMutationToast } from "@/lib/mutation-toast"

type FormValues = {
  name: string
  email: string
  password: string
  inviteCode: string
}

export default function JoinForm() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [showPw, setShowPw] = React.useState(false)
  const cardRef = React.useRef<HTMLDivElement>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { name: "", email: "", password: "", inviteCode: "" } })

  React.useEffect(() => {
    if (!cardRef.current || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        cardRef.current!.querySelectorAll("[data-reveal]"),
        { opacity: 0, y: 14 },
        { opacity: 1, y: 0, duration: 0.5, ease: EASE, stagger: 0.06 }
      )
    }, cardRef)
    return () => ctx.revert()
  }, [])

  const onSubmit = async (values: FormValues) => {
    const mutationToast = beginMutationToast({ method: "POST" })
    try {
      const res = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(values),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.message || "Could not create your account")
      // Registration replaces the browser session; discard the previous user's data.
      await queryClient.cancelQueries()
      queryClient.clear()
      toast.success(json?.data?.membership?.status === "ACTIVE" ? "Account created — Company dashboard access enabled" : "Account created — pending approval")
      router.replace("/")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign up failed")
    } finally {
      mutationToast?.finish()
    }
  }

  const inputCls = (bad?: boolean) =>
    cn(
      "w-full rounded-lg border bg-background py-2.5 pl-9 pr-3 text-sm outline-none transition focus:ring-2 focus:ring-ring/40",
      bad ? "border-destructive" : "border-input"
    )

  return (
    <div ref={cardRef} className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-lg">
      <div data-reveal className="mb-6 flex flex-col items-center text-center">
        <img src="/logo.png" alt="ArcadeLX" className="mb-3 h-12 w-auto object-contain" />
        <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Join your organization with an invite code</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div data-reveal>
          <label htmlFor="name" className="mb-1.5 block text-sm font-medium">Full name</label>
          <div className="relative">
            <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="name" type="text" autoComplete="name" placeholder="Jane Doe"
              className={inputCls(!!errors.name)}
              {...register("name", { required: "Name is required", minLength: { value: 2, message: "Name is too short" } })} />
          </div>
          {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
        </div>

        <div data-reveal>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">Email</label>
          <div className="relative">
            <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="email" type="email" autoComplete="email" placeholder="you@company.com"
              className={inputCls(!!errors.email)}
              {...register("email", {
                required: "Email is required",
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email" },
              })} />
          </div>
          {errors.email && <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div data-reveal>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">Password</label>
          <div className="relative">
            <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="password" type={showPw ? "text" : "password"} autoComplete="new-password" placeholder="At least 8 characters"
              className={cn(inputCls(!!errors.password), "pr-10")}
              {...register("password", { required: "Password is required", minLength: { value: 8, message: "At least 8 characters" } })} />
            <button type="button" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {errors.password && <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>}
        </div>

        <div data-reveal>
          <label htmlFor="inviteCode" className="mb-1.5 block text-sm font-medium">Invite code</label>
          <div className="relative">
            <Ticket size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input id="inviteCode" type="text" placeholder="Your organization's code"
              autoCapitalize="none" spellCheck={false}
              className={cn(inputCls(!!errors.inviteCode), "font-mono tracking-wide")}
              {...register("inviteCode", { required: "Invite code is required", setValueAs: (value: string) => value.trim(), maxLength: { value: 10, message: "Invalid invite code" } })} />
          </div>
          {errors.inviteCode && <p className="mt-1 text-xs text-destructive">{errors.inviteCode.message}</p>}
        </div>

        <button data-reveal type="submit" disabled={isSubmitting}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground",
            "transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          )}>
          {isSubmitting && <Loader2 size={16} className="animate-spin" />}
          {isSubmitting ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p data-reveal className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
