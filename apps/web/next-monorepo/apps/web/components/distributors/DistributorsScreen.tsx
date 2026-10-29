"use client"

import React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Building2, Cpu, FileText, Plus, Search, Users } from "lucide-react"
import { fetchDistributors } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"
import DistributorAgreementDialog from "./DistributorAgreementDialog"
import DistributorViewMoreDialog from "./DistributorViewMoreDialog"

/** Indian digit grouping, matching the currency format used elsewhere in the app. */
const countFormat = new Intl.NumberFormat("en-IN")

type StatusFilter = "ALL" | "ACTIVE" | "INACTIVE"
type AgreementFilter = "ALL" | "ACTIVE" | "PENDING_APPROVAL" | "TERMINATED" | "NONE"

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        active
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-red-500/10 text-red-700 dark:text-red-300"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-500" : "bg-red-500"}`} />
      {active ? "Active" : "Inactive"}
    </span>
  )
}

function AgreementPill({ status }: { status: string | null }) {
  const tone =
    status === "ACTIVE"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "PENDING_APPROVAL"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : status === "TERMINATED" || status === "REJECTED"
          ? "bg-red-500/10 text-red-700 dark:text-red-300"
          : "bg-muted text-muted-foreground"
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      {status ? status.replaceAll("_", " ") : "Not drafted"}
    </span>
  )
}

export default function DistributorsScreen() {
  const { canManageDistributors, canManageAgreements, can, isCompany, me } = useMe()
  const canAdd = canManageDistributors && can("DISTRIBUTORS", "CREATE")
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["distributors", me?.membership?.organizationId],
    queryFn: fetchDistributors,
    enabled: isCompany,
    refetchInterval: 30000,
  })

  const distributors = data ?? []
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("ALL")
  const [agreementFilter, setAgreementFilter] = React.useState<AgreementFilter>("ALL")

  const visible = distributors.filter((d) => {
    const needle = search.trim().toLowerCase()
    const matchesSearch =
      !needle ||
      [d.name, d.city, d.state, d.gstNumber ?? "", d.owner?.name ?? "", d.owner?.email ?? ""].some((value) =>
        value.toLowerCase().includes(needle),
      )
    const matchesStatus = statusFilter === "ALL" || (statusFilter === "ACTIVE" ? d.isActive : !d.isActive)
    const matchesAgreement =
      agreementFilter === "ALL" ||
      (agreementFilter === "NONE" ? !d.agreementStatus : d.agreementStatus === agreementFilter)
    return matchesSearch && matchesStatus && matchesAgreement
  })

  const bodyRef = useReveal<HTMLTableSectionElement>([distributors.length])
  const activeCount = distributors.filter((d) => d.isActive).length
  const activeAgreements = distributors.filter((d) => d.agreementStatus === "ACTIVE").length
  const totalKiosks = distributors.reduce((sum, d) => sum + d._count.kiosks, 0)
  const totalMembers = distributors.reduce((sum, d) => sum + d._count.memberships, 0)

  const kpis = [
    { label: "Distributors", value: countFormat.format(distributors.length), hint: `${countFormat.format(activeCount)} active`, icon: Building2 },
    { label: "Active agreements", value: countFormat.format(activeAgreements), hint: `of ${countFormat.format(distributors.length)} distributors`, icon: FileText },
    { label: "Kiosks assigned", value: countFormat.format(totalKiosks), hint: "Machines held by distributors", icon: Cpu },
    { label: "Team members", value: countFormat.format(totalMembers), hint: "Across distributor teams", icon: Users },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Distributors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the distributor organizations in your network.
          </p>
        </div>
        {canAdd && (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/distributors/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              <Plus size={16} /> Register Distributor
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{kpi.label}</p>
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <kpi.icon size={15} />
              </span>
            </div>
            {isLoading ? (
              <Skeleton className="mt-3 h-8 w-16" />
            ) : (
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{kpi.value}</p>
            )}
            <p className="mt-0.5 text-xs text-muted-foreground">{kpi.hint}</p>
          </div>
        ))}
      </div>

      {canManageDistributors && distributors.some((d) => !d.statusManagementAvailable) && (
        <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          Status controls will be available after the database update.
        </p>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
          <div className="relative min-w-56 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, city, GST or owner…"
              aria-label="Search distributors"
              className={`${inputClass} pl-9`}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <select
            value={agreementFilter}
            onChange={(event) => setAgreementFilter(event.target.value as AgreementFilter)}
            aria-label="Filter by agreement"
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="ALL">All agreements</option>
            <option value="ACTIVE">Active</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="TERMINATED">Terminated</option>
            <option value="NONE">Not drafted</option>
          </select>
          <span role="status" className="text-xs text-muted-foreground">
            {visible.length} of {distributors.length}
          </span>
        </div>

        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState className="py-12" message="Couldn't load distributors." onRetry={() => refetch()} />
        ) : !distributors.length ? (
          <EmptyState
            className="py-14"
            icon={<Building2 size={30} />}
            message={
              canAdd
                ? "No distributors yet. Use \"Register Distributor\" to register one."
                : "No distributors to show."
            }
          />
        ) : !visible.length ? (
          <EmptyState className="py-14" icon={<Search size={28} />} message="No distributors match these filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 text-right font-medium">Kiosks</th>
                  <th className="px-4 py-3 text-right font-medium">Members</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Agreement</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {visible.map((d) => (
                  <tr
                    key={d.id}
                    data-reveal
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <DistributorViewMoreDialog
                        distributor={d}
                        trigger={
                          <button
                            type="button"
                            className="flex min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
                            aria-label={`Open ${d.name}`}
                          >
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                              {d.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium hover:underline">{d.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {d.owner?.email ?? "—"}
                              </span>
                            </span>
                          </button>
                        }
                      />
                    </td>
                    <td className="px-4 py-3">
                      {[d.city, d.state].filter(Boolean).join(", ") || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">{d.phone ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{countFormat.format(d._count.kiosks)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{countFormat.format(d._count.memberships)}</td>
                    <td className="px-4 py-3">
                      <StatusPill active={d.isActive} />
                    </td>
                    <td className="px-4 py-3">
                      <AgreementPill status={d.agreementStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {canManageAgreements && me?.membership?.organizationId && (
                          <DistributorAgreementDialog
                            distributor={d}
                            organizationId={me.membership.organizationId}
                          />
                        )}
                        <DistributorViewMoreDialog
                          distributor={d}
                          trigger={
                            <button
                              type="button"
                              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                            >
                              View details
                            </button>
                          }
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              {visible.length} distributor{visible.length === 1 ? "" : "s"}
              {visible.length !== distributors.length ? ` of ${distributors.length}` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
