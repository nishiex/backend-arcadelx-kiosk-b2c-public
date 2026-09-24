"use client"

import React from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { ShieldCheck, Activity, ChevronLeft, ChevronRight } from "lucide-react"
import { fetchAuditLogs, type AuditLog, type OrgType } from "@/lib/backend-api"
import { cn } from "@workspace/ui/lib/utils"
import { useReveal } from "@/hooks/useReveal"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

// Human labels for the action codes emitted by the audit middleware.
const ACTION_LABELS: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
  GENERATE: "Generated",
  STATUS_CHANGE: "Status Changed",
  RECORD: "Recorded",
  RECORD_BATCH: "Recorded (Batch)",
}
const actionLabel = (a: string) => ACTION_LABELS[a] ?? a

const statusStyle = (status: string) =>
  status === "COMPLETED"
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : "bg-rose-500/10 text-rose-600 dark:text-rose-400"

// PLACEHOLDER_BODY

const PAGE_SIZE = 20

type ActorFilter = "ALL" | OrgType
const ACTOR_TABS: { value: ActorFilter; label: string }[] = [
  { value: "ALL", label: "All activity" },
  { value: "DISTRIBUTOR", label: "Distributors" },
  { value: "PARTNER", label: "Partners" },
  { value: "COMPANY", label: "Company" },
]

export default function AuditLogsScreen() {
  const [page, setPage] = React.useState(1)
  const [actor, setActor] = React.useState<ActorFilter>("ALL")
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", page, actor],
    queryFn: () =>
      fetchAuditLogs(page, PAGE_SIZE, actor === "ALL" ? {} : { actorOrgType: actor }),
    placeholderData: keepPreviousData,
  })

  // Reset to the first page whenever the actor filter changes.
  const changeActor = (next: ActorFilter) => {
    setActor(next)
    setPage(1)
  }

  const logs: AuditLog[] = data?.logs ?? []
  const meta = data?.meta
  const totalPages = meta?.totalPages ?? 1
  const total = meta?.total ?? 0
  const bodyRef = useReveal<HTMLTableSectionElement>([logs.length, page, actor])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A record of every write action across the network — who did what, and when.
        </p>
      </div>

      {/* Actor filter — jump straight to what Distributors (or others) have done. */}
      <div className="flex flex-wrap gap-1.5">
        {ACTOR_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => changeActor(t.value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              actor === t.value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-sm font-semibold">
          <Activity size={16} className="text-primary" />
          Activity Trail
        </div>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState className="py-12" message="Couldn't load audit logs." onRetry={() => refetch()} />
        ) : !logs.length ? (
          <EmptyState
            className="py-14"
            icon={<ShieldCheck size={30} />}
            message={
              actor === "ALL"
                ? "No activity recorded yet."
                : `No activity recorded by ${ACTOR_TABS.find((t) => t.value === actor)?.label ?? actor} yet.`
            }
          />
        ) : (
          <>
          {/* Only the table scrolls sideways on narrow screens; the pager below stays put. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Actor</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Entity</th>
                  <th className="px-5 py-3 font-medium">Reference</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {logs.map((l) => (
                  <tr
                    key={l.id}
                    data-reveal
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground tabular-nums">
                      {fmtTime(l.createdAt)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium">{l.actorName}</div>
                      {l.actorOrgName && (
                        <div className="text-xs text-muted-foreground">
                          {l.actorOrgName}
                          {l.actorOrgType ? ` · ${l.actorOrgType}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span>{actionLabel(l.action)}</span>
                        {l.detail && (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
                            → {l.detail}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">{l.entity}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      {l.reference ?? "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle(l.status)}`}>
                        {l.status === "COMPLETED" ? "Completed" : "Failed"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
              <span className="text-xs text-muted-foreground">
                {total.toLocaleString()} event{total === 1 ? "" : "s"} · page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isFetching}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft size={14} />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => (p < totalPages ? p + 1 : p))}
                  disabled={page >= totalPages || isFetching}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
