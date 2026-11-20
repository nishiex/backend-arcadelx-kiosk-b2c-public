"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { changePassword } from "@/lib/backend-api"

export default function ChangePasswordPage() {
  const router = useRouter()
  const [email, setEmail] = React.useState("")
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [error, setError] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.")
      return
    }
    setSaving(true)
    try {
      await changePassword({ email, currentPassword, newPassword, confirmPassword })
      router.replace("/login?changed=1")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change password.")
      setSaving(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div><h1 className="text-xl font-semibold">Change your password</h1><p className="mt-1 text-sm text-muted-foreground">Your temporary password must be replaced before you can view royalty data.</p></div>
        <label className="block text-sm">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
        <label className="block text-sm">Current password<input required type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
        <label className="block text-sm">New password<input required minLength={8} type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
        <label className="block text-sm">Confirm new password<input required minLength={8} type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2" /></label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button disabled={saving} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Change password"}</button>
      </form>
    </main>
  )
}
