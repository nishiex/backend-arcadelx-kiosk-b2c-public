"use client"

import React, { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { logout } from "@/lib/backend-api"

export default function Avatar({ name = "User" }: { name?: string }) {
  const initials = name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await logout()
      // Drop any cached identity/data so the next session starts clean.
      queryClient.clear()
      toast.success("Signed out")
      router.replace("/login")
    } catch {
      toast.error("Sign out failed")
      setSigningOut(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex size-9 items-center justify-center rounded-full bg-muted font-medium transition-colors hover:bg-muted/70"
      >
        {initials}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-border bg-card p-1.5 shadow-lg">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2.5 py-2 text-sm hover:bg-muted"
            >
              Profile
            </Link>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
