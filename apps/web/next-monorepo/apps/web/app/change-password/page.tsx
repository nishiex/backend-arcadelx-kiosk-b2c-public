"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff } from "lucide-react"
import { changePassword } from "@/lib/backend-api"

/**
 * Advisory strength score. The API only enforces the 8-character minimum, so this must not
 * pretend to be a rule: it tells the operator what would make the password stronger.
 */
function strengthOf(password: string) {
  return [
    password.length >= 8,
    password.length >= 12,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length
}

/**
 * Password input with a reveal control.
 *
 * The change-password screen shipped three bare `type="password"` inputs, so a temporary
 * password could not be checked before saving and there was no strength guidance at all.
 */
function PasswordField(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  minLength?: number
  hint?: React.ReactNode
}) {
  const [visible, setVisible] = React.useState(false)
  return (
    <label className="block text-sm" htmlFor={props.id}>
      {props.label}
      <span className="relative mt-1 block">
        <input
          id={props.id}
          required
          minLength={props.minLength}
          type={visible ? "text" : "password"}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
      {props.hint}
    </label>
  )
}

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
        <PasswordField id="current-password" label="Current password" value={currentPassword} onChange={setCurrentPassword} />
        <PasswordField
          id="new-password"
          label="New password"
          value={newPassword}
          onChange={setNewPassword}
          minLength={8}
          hint={
            <span className="mt-1 block text-xs text-muted-foreground">
              {newPassword
                ? strengthOf(newPassword) >= 4
                  ? "Strong password."
                  : strengthOf(newPassword) >= 3
                    ? "Good — add a symbol to make it strong."
                    : "Weak — use 8+ characters with upper and lower case, a number and a symbol."
                : "At least 8 characters; mix cases, a number and a symbol."}
            </span>
          }
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          minLength={8}
        />
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button disabled={saving} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving ? "Saving…" : "Change password"}</button>
      </form>
    </main>
  )
}
