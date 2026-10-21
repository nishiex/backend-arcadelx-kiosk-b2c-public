"use client"

import React from "react"
import { useForm } from "react-hook-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { User, Building2, Lock, Loader2 } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { changePassword, logout } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import { Panel, Skeleton } from "@/components/dashboard/ui"
import CompanyInviteCodeDialog from "@/components/distributors/CompanyInviteCodeDialog"

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

type PwForm = { currentPassword: string; newPassword: string; confirmPassword: string }

function InfoRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value ?? "—"}</span>
    </div>
  )
}

export default function SettingsScreen() {
  const { me, isLoading, orgName, orgType, role } = useMe()
  const queryClient = useQueryClient()
  const ref = useReveal<HTMLDivElement>([isLoading])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<PwForm>()

  const mutation = useMutation({
    mutationFn: (v: PwForm) =>
      changePassword({
        email: me!.email,
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
        confirmPassword: v.confirmPassword,
      }),
    onSuccess: async () => {
      toast.success("Password updated. Please sign in again.")
      reset()
      try {
        await logout()
      } finally {
        queryClient.clear()
        window.location.replace("/login")
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update password"),
  })

  return (
    <div ref={ref} className="mx-auto max-w-3xl space-y-6">
      <div data-reveal>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account and organization.</p>
      </div>

      <div data-reveal>
        <Panel title={<span className="inline-flex items-center gap-2"><User size={16} /> Profile</span>}>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
            </div>
          ) : (
            <div>
              <InfoRow label="Name" value={me?.name} />
              <InfoRow label="Email" value={me?.email} />
            </div>
          )}
        </Panel>
      </div>

      <div data-reveal>
        <Panel 
          title={<span className="inline-flex items-center gap-2"><Building2 size={16} /> Organization</span>}
          action={<CompanyInviteCodeDialog purpose="members" />}
        >
          {isLoading ? (
            <Skeleton className="h-5 w-full" />
          ) : (
            <div>
              <InfoRow label="Organization" value={orgName} />
              <InfoRow label="Type" value={orgType} />
              <InfoRow label="Your role" value={role} />
            </div>
          )}
        </Panel>
      </div>

      <div data-reveal>
        <Panel
          title={<span className="inline-flex items-center gap-2"><Lock size={16} /> Change password</span>}
          subtitle="Use at least 8 characters."
        >
          <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Current password</label>
              <input type="password" autoComplete="current-password" className={inputCls}
                {...register("currentPassword", { required: "Required" })} />
              {errors.currentPassword && <p className="mt-1 text-xs text-destructive">{errors.currentPassword.message}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm font-medium">New password</label>
                <input type="password" autoComplete="new-password" className={inputCls}
                  {...register("newPassword", { required: "Required", minLength: { value: 8, message: "Min 8 characters" } })} />
                {errors.newPassword && <p className="mt-1 text-xs text-destructive">{errors.newPassword.message}</p>}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Confirm new password</label>
                <input type="password" autoComplete="new-password" className={inputCls}
                  {...register("confirmPassword", {
                    required: "Required",
                    validate: (v) => v === watch("newPassword") || "Passwords do not match",
                  })} />
                {errors.confirmPassword && <p className="mt-1 text-xs text-destructive">{errors.confirmPassword.message}</p>}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={mutation.isPending || isLoading}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
                  "disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
                Update password
              </button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  )
}
