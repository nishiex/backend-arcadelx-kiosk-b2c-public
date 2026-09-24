"use client"

import React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UserCog, Check, X } from "lucide-react"
import {
  MANAGEABLE_ROLES,
  fetchPendingMembers,
  handleJoinRequest,
  type ManageableRole,
} from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  STAFF: "Staff",
}

export default function UsersScreen() {
  const qc = useQueryClient()
  const { canManageMembers, isLoading: meLoading } = useMe()

  const [error, setError] = React.useState<string | null>(null)
  const [approveRole, setApproveRole] = React.useState<Record<string, ManageableRole>>({})

  const pendingQ = useQuery({
    queryKey: ["pending-members"],
    queryFn: () => fetchPendingMembers(1, 50),
    enabled: canManageMembers,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pending-members"] })
    // Keep the dashboard's "Pending Members" stat in sync.
    qc.invalidateQueries({ queryKey: ["pendingMembers", 1, 1] })
  }

  const approveMut = useMutation({
    mutationFn: ({ id, action, role }: { id: string; action: "APPROVE" | "REJECT"; role?: ManageableRole }) =>
      handleJoinRequest(id, action, role),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const pending = pendingQ.data?.data ?? []

  if (meLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!canManageMembers) {
    return (
      <div className="mx-auto max-w-4xl">
        <EmptyState
          className="py-20"
          icon={<UserCog size={30} />}
          message="You don't have permission to manage members."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and approve people requesting to join your organization.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">
            Pending Join Requests
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                {pending.length}
              </span>
            )}
          </h2>
        </div>

        {pendingQ.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-8 w-40" />
              </div>
            ))}
          </div>
        ) : pendingQ.isError ? (
          <ErrorState className="py-12" message="Couldn't load join requests." onRetry={() => pendingQ.refetch()} />
        ) : !pending.length ? (
          <EmptyState className="py-14" icon={<UserCog size={30} />} message="No pending join requests." />
        ) : (
          <ul className="divide-y divide-border/60">
            {pending.map((req) => {
              const chosen = approveRole[req.id] ?? "STAFF"
              return (
                <li key={req.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {(req.user?.name ?? "?").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{req.user?.name ?? "—"}</div>
                    <div className="truncate text-xs text-muted-foreground">{req.user?.email ?? "—"}</div>
                  </div>
                  <select
                    value={chosen}
                    onChange={(e) =>
                      setApproveRole((p) => ({ ...p, [req.id]: e.target.value as ManageableRole }))
                    }
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {MANAGEABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => approveMut.mutate({ id: req.id, action: "APPROVE", role: chosen })}
                    disabled={approveMut.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    onClick={() => approveMut.mutate({ id: req.id, action: "REJECT" })}
                    disabled={approveMut.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-50"
                  >
                    <X size={14} /> Reject
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
