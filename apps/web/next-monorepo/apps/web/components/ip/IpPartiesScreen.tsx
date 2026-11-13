"use client"

import React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Building2, Plus, Search, ShieldCheck, Users } from "lucide-react"
import { fetchIpParties } from "@/lib/ip-api"
import { useMe } from "@/hooks/useMe"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
})

/** 60.00 -> "60%", 62.50 -> "62.5%" */
function formatPct(value: number): string {
  return `${Number(value).toFixed(2).replace(/\.?0+$/, "")}%`
}

function SharePill({ ipSharePct }: { ipSharePct: number | undefined }) {
  if (ipSharePct === undefined) {
    return <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">No agreement</span>
  }
  return (
    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
      IP {formatPct(ipSharePct)}
    </span>
  )
}

export default function IpPartiesScreen() {
  const { isMasterAdmin, isLoading: meLoading } = useMe()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["ip-parties"],
    queryFn: fetchIpParties,
    enabled: isMasterAdmin,
    refetchInterval: 60000,
  })

  const [search, setSearch] = React.useState("")

  if (meLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // The tab is hidden for everyone else; this covers a direct URL visit.
  if (!isMasterAdmin) {
    return (
      <Panel title="IP parties" subtitle="Company owner only">
        <EmptyState
          icon={<ShieldCheck size={18} />}
          message="Only the Company owner (master admin) can manage IP parties."
        />
      </Panel>
    )
  }

  const parties = data ?? []
  const term = search.trim().toLowerCase()
  const filtered = term
    ? parties.filter((party) => {
        const haystack = [
          party.name,
          party.city,
          party.state,
          party.ipProfile?.sourceKey,
          party.ipProfile?.legalName,
          party.ipProfile?.pan,
          party.owner?.email,
          party.owner?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        return haystack.includes(term)
      })
    : parties

  const activeAgreements = parties.filter((party) => party.ipAgreements[0]?.status === "ACTIVE").length
  const averageRoyalty = (() => {
    const shares = parties
      .map((party) => party.ipAgreements[0]?.ipSharePct)
      .filter((value): value is number => typeof value === "number")
    if (shares.length === 0) return null
    return shares.reduce((sum, value) => sum + value, 0) / shares.length
  })()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">IP parties</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Register content partners and the royalty share the Company pays them.
          </p>
        </div>
        <Link
          href="/ip/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus size={16} />
          Register IP party
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Building2 size={14} /> IP parties
          </div>
          <p className="mt-1 text-2xl font-semibold">{parties.length}</p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Users size={14} /> Active agreements
          </div>
          <p className="mt-1 text-2xl font-semibold">{activeAgreements}</p>
        </Panel>
        <Panel className="p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ShieldCheck size={14} /> Average royalty
          </div>
          <p className="mt-1 text-2xl font-semibold">
            {averageRoyalty === null ? "—" : formatPct(averageRoyalty)}
          </p>
        </Panel>
      </div>

      <Panel
        title="Registered parties"
        subtitle="Read-only snapshot of each party's source key and active royalty."
        action={
          <div className="relative w-full max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search party, source key, PAN…"
              className={`${inputClass} pl-9`}
              aria-label="Search IP parties"
            />
          </div>
        }
      >
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <ErrorState message="Could not load IP parties." onRetry={() => void refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 size={18} />}
            message={
              parties.length === 0
                ? "No IP parties yet. Register the first content partner to start attributing royalties."
                : "No party matches this search."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Party</th>
                  <th className="px-3 py-2 font-medium">Source key</th>
                  <th className="px-3 py-2 font-medium">Tax / legal</th>
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Royalty</th>
                  <th className="px-3 py-2 font-medium">Since</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((party) => {
                  const agreement = party.ipAgreements[0]
                  return (
                    <tr key={party.id} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-3">
                        <p className="font-medium">{party.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[party.city, party.state].filter(Boolean).join(", ") || "—"}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {party.ipProfile?.sourceKey ?? "—"}
                        </code>
                      </td>
                      <td className="px-3 py-3">
                        <p>{party.ipProfile?.legalName ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">
                          PAN {party.ipProfile?.pan ?? "—"}
                          {party.ipProfile?.gstin ? ` · GSTIN ${party.ipProfile.gstin}` : ""}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <p>{party.owner?.name ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{party.owner?.email ?? "—"}</p>
                      </td>
                      <td className="px-3 py-3">
                        <SharePill ipSharePct={agreement?.ipSharePct} />
                        {agreement ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Company {formatPct(agreement.companySharePct)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {agreement ? dateFmt.format(new Date(agreement.effectiveFrom)) : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {parties.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Royalty is calculated on the Company share of net revenue (after GST and payment-gateway fees), per
          transaction. Settlements run monthly after the daily pipeline completes.
        </p>
      ) : null}
    </div>
  )
}
