"use client"

import { UsersRound } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import AddPartnerForm from "./AddPartnerForm"

export default function PartnersScreen() {
  const { canRegisterPartners, isLoading } = useMe()

  if (isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading partners…</p>
  if (!canRegisterPartners) return <p role="alert" className="text-sm text-muted-foreground">You don’t have permission to manage partners.</p>

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Partners</h1>
        <p className="mt-1 text-sm text-muted-foreground">Register partner organizations from your distributor account.</p>
      </div>
      <section aria-labelledby="partner-registration-title" className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><UsersRound size={22} aria-hidden="true" /></span>
            <div>
              <h2 id="partner-registration-title" className="text-lg font-semibold">Partner registration</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">Add the business details and owner’s email address. The owner will receive login credentials for their Partner dashboard.</p>
            </div>
          </div>
          <div className="shrink-0"><AddPartnerForm modal /></div>
        </div>
      </section>
    </div>
  )
}
