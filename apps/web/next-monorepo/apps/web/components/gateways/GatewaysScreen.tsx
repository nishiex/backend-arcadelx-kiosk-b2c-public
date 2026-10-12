"use client"

import React, { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useMe } from "@/hooks/useMe"
import {
  deleteGateway,
  fetchGateways,
  reorderGateways,
  saveGateway,
  toggleGateway,
} from "@/lib/gateways-api"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"

const buttonClass =
  "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

/**
 * Payment gateway administration.
 *
 * This manages the live routing order for the payment provider, so the screen is
 * deliberately narrow: COMPANY OWNER/ADMIN only, matching the API route. Every
 * mutation refetches rather than assuming the new local order, because the order is
 * owned by Mothership and a failed write must not look applied.
 */
export default function GatewaysScreen() {
  const { me, isLoading, isError, isCompany, role } = useMe()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const canManage = isCompany && (role === "OWNER" || role === "ADMIN")
  const scope = [me?.id ?? "", me?.membership?.organizationId ?? "", role ?? ""]
  const listKey = ["gateways", ...scope]

  const gateways = useQuery({
    queryKey: listKey,
    queryFn: fetchGateways,
    enabled: canManage,
    staleTime: 30_000,
    // Gateway state changes outside this screen too, so keep it fairly fresh.
    retry: 1,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ["gateways"] })

  const toggle = useMutation({
    mutationFn: ({ provider, active }: { provider: string; active: boolean }) =>
      toggleGateway(provider, active),
    onSuccess: (_r, vars) => {
      toast.success(`${vars.provider} ${vars.active ? "enabled" : "disabled"}`)
      void invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (provider: string) => deleteGateway(provider),
    onSuccess: (_r, provider) => {
      toast.success(`${provider} removed`)
      void invalidate()
    },
  })

  const reorder = useMutation({
    mutationFn: (order: string[]) => reorderGateways(order),
    onSuccess: () => {
      toast.success("Gateway priority updated")
      void invalidate()
    },
  })

  const rows = gateways.data?.gateways ?? []
  const sorted = [...rows].sort((a, b) => a.priority - b.priority)
  const busy = toggle.isPending || remove.isPending || reorder.isPending

  function move(index: number, direction: -1 | 1) {
    if (busy) return
    const next = [...sorted]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    const a = next[index]
    const b = next[target]
    if (!a || !b) return
    next[index] = b
    next[target] = a
    reorder.mutate(next.map((g) => g.provider))
  }

  if (isLoading) {
    return (
      <div aria-label="Loading gateways" className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (isError) {
    return (
      <ErrorState message="Unable to verify your access. Refresh the page to try again." />
    )
  }
  if (!canManage) {
    return (
      <EmptyState message="Payment gateways are managed by the Company Owner or Admin." />
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Payment gateways</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Which providers take payments, and in what order. Priority decides which
            gateway is offered first; changes affect live payment routing.
          </p>
        </div>
        <div className="flex gap-2">
          {canManage && !editing && (
            <button className={buttonClass} onClick={() => setEditing(true)}>
              Add provider
            </button>
          )}
          <button
            className={buttonClass}
            disabled={gateways.isFetching || busy}
            onClick={() => void gateways.refetch()}
          >
            <span className="flex items-center gap-2">
              <RefreshCw
                size={16}
                className={gateways.isFetching ? "animate-spin" : ""}
              />
              {gateways.isFetching ? "Refreshing…" : "Refresh"}
            </span>
          </button>
        </div>
      </header>

      {editing && (
        <Panel title="Add or update a provider">
          <GatewayEditor
            key={scope.join(":")}
            onDone={() => {
              setEditing(false)
              void invalidate()
            }}
            onCancel={() => setEditing(false)}
          />
        </Panel>
      )}

      {/* Surface mutation failures: a rejected reorder/toggle must not look applied. */}
      {(reorder.isError || toggle.isError || remove.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {reorder.error?.message || toggle.error?.message || remove.error?.message}
        </p>
      )}

      <Panel
        title="Configured providers"
        subtitle={
          gateways.data
            ? `${gateways.data.total} provider${gateways.data.total === 1 ? "" : "s"}`
            : undefined
        }
      >
        {gateways.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : gateways.isError ? (
          <ErrorState
            message={gateways.error.message}
            onRetry={() => void gateways.refetch()}
          />
        ) : !sorted.length ? (
          <EmptyState message="No payment gateway is configured yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <caption className="sr-only">
                Payment providers with routing priority and active state
              </caption>
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  {["Priority", "Provider", "Key", "Status", "Actions"].map(
                    (label) => (
                      <th scope="col" key={label} className="px-3 py-3 font-medium">
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {sorted.map((gateway, index) => (
                  <tr
                    key={gateway.provider}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-3 py-3 tabular-nums">
                      <span className="flex items-center gap-1">
                        {gateway.priority}
                        <button
                          className="rounded border border-border p-1 hover:bg-muted disabled:opacity-40"
                          aria-label={`Move ${gateway.provider} up`}
                          disabled={busy || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="rounded border border-border p-1 hover:bg-muted disabled:opacity-40"
                          aria-label={`Move ${gateway.provider} down`}
                          disabled={busy || index === sorted.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                      </span>
                    </td>
                    <th scope="row" className="px-3 py-3 text-left font-medium">
                      {gateway.display_name}
                    </th>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {gateway.provider}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={
                          gateway.is_active
                            ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
                            : "rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400"
                        }
                      >
                        {gateway.is_active ? "Active" : "Disabled"}
                      </span>
                      {!gateway.has_driver && (
                        <span className="ml-2 text-xs text-destructive">
                          no driver
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="flex gap-2">
                        <button
                          className={buttonClass}
                          disabled={busy}
                          onClick={() =>
                            toggle.mutate({
                              provider: gateway.provider,
                              active: !gateway.is_active,
                            })
                          }
                        >
                          {gateway.is_active ? "Disable" : "Enable"}
                        </button>
                        <button
                          className={buttonClass}
                          disabled={busy}
                          onClick={() => remove.mutate(gateway.provider)}
                        >
                          Remove
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function GatewayEditor({
  onDone,
  onCancel,
}: {
  onDone: () => void
  onCancel: () => void
}) {
  const [provider, setProvider] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [priority, setPriority] = useState("")
  const [validation, setValidation] = useState("")

  const mutation = useMutation({
    mutationFn: saveGateway,
    onSuccess: () => {
      toast.success("Gateway saved")
      onDone()
    },
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (mutation.isPending) return
    const key = provider.trim().toLowerCase()
    if (!/^[a-z0-9_-]{1,64}$/.test(key)) {
      setValidation("Provider key must be 1–64 characters: a–z, 0–9, _ or -.")
      return
    }
    let prio: number | undefined
    if (priority.trim()) {
      prio = Number(priority)
      if (!Number.isInteger(prio) || prio < 0) {
        setValidation("Priority must be a whole number of 0 or more.")
        return
      }
    }
    setValidation("")
    mutation.mutate({
      provider: key,
      ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
      ...(prio === undefined ? {} : { priority: prio }),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="provider" className="mb-1.5 block text-sm font-medium">
            Provider key
          </label>
          <input
            id="provider"
            className={inputClass}
            placeholder="razorpay"
            required
            disabled={mutation.isPending}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium">
            Display name
          </label>
          <input
            id="displayName"
            className={inputClass}
            placeholder="Razorpay UPI"
            disabled={mutation.isPending}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="priority" className="mb-1.5 block text-sm font-medium">
            Priority
          </label>
          <input
            id="priority"
            className={inputClass}
            type="number"
            min="0"
            step="1"
            disabled={mutation.isPending}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Credentials are configured on the payment service and are not editable here.
      </p>
      {(validation || mutation.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {validation || mutation.error?.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={mutation.isPending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="submit" className={buttonClass} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save provider"}
        </button>
      </div>
    </form>
  )
}
