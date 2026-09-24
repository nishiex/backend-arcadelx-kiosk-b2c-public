"use client"

import React from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { LifeBuoy } from "lucide-react"
import {
  fetchSupportTickets,
  updateSupportTicketStatus,
  updateSupportTicketPriority,
  SUPPORT_STATUSES,
  SUPPORT_PRIORITIES,
  type SupportTicket,
  type SupportStatus,
  type SupportPriority,
} from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import { cn } from "@workspace/ui/lib/utils"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"
import NewTicketDialog from "./NewTicketDialog"

const STATUS_META: Record<SupportStatus, { label: string; cls: string }> = {
  OPEN: { label: "Open", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  IN_PROGRESS: { label: "In progress", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  RESOLVED: { label: "Resolved", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  CLOSED: { label: "Closed", cls: "bg-muted text-muted-foreground" },
}

const PRIORITY_META: Record<SupportPriority, { label: string; cls: string }> = {
  LOW: { label: "Low", cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  MEDIUM: { label: "Medium", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  HIGH: { label: "High", cls: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  URGENT: { label: "Urgent", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
}

function StatusSelect({ ticket }: { ticket: SupportTicket }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (status: SupportStatus) => updateSupportTicketStatus(ticket.id, status),
    onSuccess: () => {
      toast.success("Ticket updated")
      queryClient.invalidateQueries({ queryKey: ["supportTickets"] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  })
  const meta = STATUS_META[ticket.status]
  return (
    <select
      value={ticket.status}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as SupportStatus)}
      className={cn("rounded-full px-2.5 py-1 text-xs font-medium outline-none disabled:opacity-60", meta.cls)}
    >
      {SUPPORT_STATUSES.map((s) => (
        <option key={s} value={s}>{STATUS_META[s].label}</option>
      ))}
    </select>
  )
}

function PrioritySelect({ ticket }: { ticket: SupportTicket }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (priority: SupportPriority) => updateSupportTicketPriority(ticket.id, priority),
    onSuccess: () => {
      toast.success("Priority updated")
      queryClient.invalidateQueries({ queryKey: ["supportTickets"] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  })
  const pm = PRIORITY_META[ticket.priority] ?? PRIORITY_META.MEDIUM
  return (
    <select
      value={ticket.priority}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as SupportPriority)}
      className={cn("rounded-full px-2.5 py-1 text-xs font-medium outline-none disabled:opacity-60", pm.cls)}
    >
      {SUPPORT_PRIORITIES.map((p) => (
        <option key={p} value={p}>{PRIORITY_META[p].label}</option>
      ))}
    </select>
  )
}

export default function SupportScreen() {
  const { isCompany } = useMe()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["supportTickets"],
    queryFn: fetchSupportTickets,
  })
  const tickets = data ?? []
  const bodyRef = useReveal<HTMLTableSectionElement>([tickets.length])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isCompany ? "Track and resolve tickets across the network." : "Raise and follow up on your support tickets."}
          </p>
        </div>
        <NewTicketDialog />
      </div>

      <div className="rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState className="py-12" message="Couldn't load tickets." onRetry={() => refetch()} />
        ) : !tickets.length ? (
          <EmptyState
            className="py-14"
            icon={<LifeBuoy size={30} />}
            message="No tickets yet. Use “New Ticket” to raise one."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Subject</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  {isCompany && <th className="px-4 py-3 font-medium">Org</th>}
                  <th className="px-4 py-3 font-medium">Raised by</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {tickets.map((t) => {
                  return (
                    <tr key={t.id} data-reveal className="border-b border-border/60 align-top transition-colors last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="font-medium">{t.subject}</div>
                        <div className="max-w-md truncate text-xs text-muted-foreground">
                          {t.category ? `${t.category} · ` : ""}{t.description}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <PrioritySelect ticket={t} />
                      </td>
                      {isCompany && <td className="px-4 py-3 text-muted-foreground">{t.organization?.name ?? "—"}</td>}
                      <td className="px-4 py-3">
                        <div className="text-sm">{t.createdBy?.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{t.createdBy?.email}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{new Date(t.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3"><StatusSelect ticket={t} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
