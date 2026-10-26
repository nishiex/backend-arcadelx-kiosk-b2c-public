"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { RefreshCw, Search } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { fetchAuditLogs, type OrgType } from "@/lib/backend-api"
import { EmptyState, ErrorState, Skeleton } from "@/components/dashboard/ui"

const control = "rounded-lg border border-input bg-background px-3 py-2.5 text-sm"

export default function AuditLogsScreen() {
  const { canManageMembers, isLoading } = useMe()
  const [page, setPage] = React.useState(1)
  const [actorOrgType, setActorOrgType] = React.useState<OrgType | "">("")
  const [entity, setEntity] = React.useState("")
  const [action, setAction] = React.useState("")
  const logs = useQuery({
    queryKey: ["audit-logs", page, actorOrgType, entity, action],
    queryFn: () => fetchAuditLogs(page, 20, { actorOrgType: actorOrgType || undefined, entity: entity || undefined, action: action || undefined }),
    enabled: canManageMembers,
    staleTime: 10_000,
  })

  if (isLoading) return <Skeleton className="h-64" />
  if (!canManageMembers) return <EmptyState message="Only Company Owners and Admins can view audit logs." />
  const rows = logs.data?.logs ?? []
  const meta = logs.data?.meta

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Audit Logs</h1><p className="mt-1 text-sm text-muted-foreground">Review write actions across the network.</p></div>
        <button type="button" onClick={() => void logs.refetch()} disabled={logs.isFetching} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"><RefreshCw size={15} className={logs.isFetching ? "animate-spin" : ""} /> Refresh</button>
      </header>
      <section className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-4">
        <div className="relative min-w-48 flex-1"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Filter audit logs" placeholder="Entity or action…" value={entity || action} onChange={event => { setEntity(event.target.value.toUpperCase()); setAction(""); setPage(1) }} className={`${control} w-full pl-9`} /></div>
        <select aria-label="Filter actor organization" value={actorOrgType} onChange={event => { setActorOrgType(event.target.value as OrgType | ""); setPage(1) }} className={control}><option value="">All organizations</option><option value="COMPANY">Company</option><option value="DISTRIBUTOR">Distributor</option><option value="PARTNER">Partner</option></select>
        <select aria-label="Filter action" value={action} onChange={event => { setAction(event.target.value); setEntity(""); setPage(1) }} className={control}><option value="">All actions</option><option value="CREATE">Create</option><option value="REQUEST">Request</option><option value="APPROVE">Approve</option><option value="UPDATE">Update</option><option value="REJECT">Reject</option><option value="DELETE">Delete</option></select>
      </section>
      {logs.isLoading ? <div className="space-y-3"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : logs.isError ? <ErrorState message="Couldn’t load audit logs." onRetry={() => void logs.refetch()} /> : !rows.length ? <EmptyState message="No audit events match the selected filters." /> : (
        <section className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[900px] text-left text-sm"><caption className="sr-only">Audit log events</caption><thead className="border-b border-border bg-muted/30 text-xs text-muted-foreground"><tr>{["Time", "Actor", "Organization", "Action", "Entity", "Reference", "Result", "Path"].map(label => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map(log => <tr key={log.id} className="hover:bg-muted/30"><td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td><td className="px-3 py-3 font-medium">{log.actorName}</td><td className="px-3 py-3">{log.actorOrgName ?? log.actorOrgType ?? "—"}</td><td className="px-3 py-3">{log.action}</td><td className="px-3 py-3">{log.entity}</td><td className="px-3 py-3 font-mono text-xs">{log.reference ?? "—"}</td><td className={`px-3 py-3 ${log.status === "FAILED" ? "text-destructive" : "text-emerald-700 dark:text-emerald-300"}`}>{log.statusCode} · {log.status}</td><td className="max-w-xs truncate px-3 py-3 text-xs text-muted-foreground" title={log.path}>{log.method} {log.path}</td></tr>)}</tbody></table>
          {meta && <footer className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground"><span>{meta.total} event{meta.total === 1 ? "" : "s"} · Page {meta.page} of {Math.max(meta.totalPages, 1)}</span><span className="flex gap-2"><button type="button" disabled={page <= 1 || logs.isFetching} onClick={() => setPage(value => value - 1)} className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50">Previous</button><button type="button" disabled={page >= meta.totalPages || logs.isFetching} onClick={() => setPage(value => value + 1)} className="rounded-md border border-border px-3 py-2 hover:bg-muted disabled:opacity-50">Next</button></span></footer>}
        </section>
      )}
    </div>
  )
}
