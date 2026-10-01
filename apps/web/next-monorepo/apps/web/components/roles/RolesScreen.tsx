"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Shield, Trash2, Save, Check } from "lucide-react"
import {
  PERMISSION_MODULES,
  PERMISSION_ACTIONS,
  fetchRoles,
  fetchRole,
  createRole,
  updateRole,
  saveRoleMatrix,
  deleteRole,
  assignRole,
  fetchMembers,
  type PermissionModule,
  type PermissionAction,
} from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { cn } from "@workspace/ui/lib/utils"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"

// The roles/permissions backend is not implemented: /api/roles* and the
// /api/members roster/create routes do not exist on this API, so every query
// on this screen would 404. Keep the page gated until those routes ship, rather
// than firing doomed requests. Flip to true once the backend lands.
const ROLES_BACKEND_AVAILABLE = false

const cellKey = (m: PermissionModule, a: PermissionAction) => `${m}:${a}`

const MODULE_LABELS: Record<PermissionModule, string> = {
  STAFF: "Staff",
  ROLES: "Roles & Permissions",
  DISTRIBUTORS: "Distributors",
  PARTNERS: "Partners",
  KIOSKS: "Kiosks",
  ORDERS: "Orders",
  REVENUE: "Revenue",
  REPORTS: "Reports",
  SETTLEMENTS: "Settlements",
  PAYMENTS: "Payments",
  AGREEMENTS: "Agreements",
  NETWORK: "Network",
  SUPPORT: "Support",
  AUDIT_LOGS: "Audit Logs",
  SETTINGS: "Settings",
}

const ACTION_LABELS: Record<PermissionAction, string> = {
  CREATE: "Add",
  EDIT: "Edit",
  DELETE: "Delete",
  VIEW: "View",
  VIEW_ALL: "View All",
  EXPORT: "Export",
}

// PLACEHOLDER_BODY

export default function RolesScreen() {
  const qc = useQueryClient()
  const router = useRouter()
  const { canManageRoles, isLoading: meLoading } = useMe()
  // Roles & permissions are managed only by a COMPANY OWNER/ADMIN. That single
  // gate governs viewing, creating, editing and deleting alike.
  const canView = canManageRoles
  const canEdit = canManageRoles
  const canCreate = canManageRoles
  const canDelete = canManageRoles

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [granted, setGranted] = React.useState<Set<string>>(new Set())
  const [creating, setCreating] = React.useState(false)
  const [newName, setNewName] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  const rolesQ = useQuery({ queryKey: ["roles"], queryFn: fetchRoles, enabled: canView && ROLES_BACKEND_AVAILABLE })
  const membersQ = useQuery({ queryKey: ["members"], queryFn: fetchMembers, enabled: canView && ROLES_BACKEND_AVAILABLE })
  const roleQ = useQuery({
    queryKey: ["role", selectedId],
    queryFn: () => fetchRole(selectedId as string),
    enabled: canView && ROLES_BACKEND_AVAILABLE && !!selectedId,
  })

  const roles = rolesQ.data ?? []

  // Default the selection to the first role once loaded.
  React.useEffect(() => {
    if (!selectedId && roles.length) setSelectedId(roles[0]!.id)
  }, [roles, selectedId])

  // Sync editable fields + matrix whenever the selected role's detail loads.
  React.useEffect(() => {
    const r = roleQ.data
    if (!r) return
    setName(r.name)
    setDescription(r.description ?? "")
    setGranted(new Set(r.permissions.map((p) => cellKey(p.module, p.action))))
  }, [roleQ.data])

  const selectedRole = roleQ.data
  const isSystem = !!selectedRole?.isSystem
  const editable = canEdit && !isSystem && !!selectedRole

  const invalidateRoles = () => {
    qc.invalidateQueries({ queryKey: ["roles"] })
    qc.invalidateQueries({ queryKey: ["members"] })
    qc.invalidateQueries({ queryKey: ["me"] })
  }

  const createMut = useMutation({
    mutationFn: (n: string) => createRole({ name: n }),
    onSuccess: (role) => {
      setCreating(false)
      setNewName("")
      setError(null)
      invalidateRoles()
      setSelectedId(role.id)
    },
    onError: (e: Error) => setError(e.message),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!selectedId) return
      const entries = Array.from(granted).map((k) => {
        const [module, action] = k.split(":") as [PermissionModule, PermissionAction]
        return { module, action }
      })
      if (
        (name !== selectedRole?.name || description !== (selectedRole?.description ?? "")) &&
        name.trim().length >= 2
      ) {
        await updateRole(selectedId, { name: name.trim(), description: description.trim() })
      }
      await saveRoleMatrix(selectedId, entries)
    },
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: ["role", selectedId] })
      invalidateRoles()
    },
    onError: (e: Error) => setError(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteRole(id),
    onSuccess: () => {
      setSelectedId(null)
      setError(null)
      invalidateRoles()
    },
    onError: (e: Error) => setError(e.message),
  })

  const assignMut = useMutation({
    mutationFn: ({ membershipId, roleId }: { membershipId: string; roleId: string | null }) =>
      assignRole(membershipId, roleId),
    onSuccess: () => invalidateRoles(),
    onError: (e: Error) => setError(e.message),
  })

  const toggleCell = (m: PermissionModule, a: PermissionAction) => {
    if (!editable) return
    setGranted((prev) => {
      const next = new Set(prev)
      const k = cellKey(m, a)
      next.has(k) ? next.delete(k) : next.add(k)
      return next
    })
  }

  const toggleModuleRow = (m: PermissionModule, on: boolean) => {
    if (!editable) return
    setGranted((prev) => {
      const next = new Set(prev)
      for (const a of PERMISSION_ACTIONS) {
        const k = cellKey(m, a)
        on ? next.add(k) : next.delete(k)
      }
      return next
    })
  }

  const allSelected =
    PERMISSION_MODULES.length * PERMISSION_ACTIONS.length === granted.size
  const toggleAll = (on: boolean) => {
    if (!editable) return
    if (!on) return setGranted(new Set())
    const next = new Set<string>()
    for (const m of PERMISSION_MODULES) for (const a of PERMISSION_ACTIONS) next.add(cellKey(m, a))
    setGranted(next)
  }

  // PLACEHOLDER_RENDER

  // Roles & Permissions is a COMPANY OWNER/ADMIN feature. Anyone else (all
  // Distributor/Partner members, and company MANAGER/STAFF) is bounced back to
  // the dashboard so the page is effectively hidden, not just empty.
  React.useEffect(() => {
    if (!meLoading && !canManageRoles) router.replace("/")
  }, [meLoading, canManageRoles, router])

  if (meLoading || !canManageRoles) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  // No roles/permissions backend yet — show a clear notice instead of 404s.
  if (!ROLES_BACKEND_AVAILABLE) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define named roles, grant them a module &times; action matrix, and assign them to members.
          </p>
        </div>
        <EmptyState
          className="py-16"
          icon={<Shield size={30} />}
          message="Roles & permissions aren't available yet. This feature is coming soon."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles &amp; Permissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define named roles, grant them a module &times; action matrix, and assign them to members.
          </p>
        </div>
        {canCreate &&
          (creating ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (newName.trim().length >= 2) createMut.mutate(newName.trim())
              }}
              className="flex items-center gap-2"
            >
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New role name"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                type="submit"
                disabled={newName.trim().length < 2 || createMut.isPending}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false)
                  setNewName("")
                }}
                className="rounded-lg border border-border px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              <Plus size={16} /> New Role
            </button>
          ))}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* PLACEHOLDER_MAIN */}
      {rolesQ.isLoading ? (
        <Skeleton className="h-72 w-full" />
      ) : rolesQ.isError ? (
        <ErrorState message="Couldn't load roles." onRetry={() => rolesQ.refetch()} />
      ) : !roles.length ? (
        <EmptyState
          className="py-16"
          icon={<Shield size={30} />}
          message={canCreate ? 'No roles yet. Use "New Role" to create one.' : "No roles to show."}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">Role</span>
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => setSelectedId(e.target.value || null)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.isSystem ? " (system)" : ""} · {r._count.memberships} member
                      {r._count.memberships === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
              {selectedRole && canDelete && !isSystem && (
                <button
                  onClick={() => {
                    if (
                      confirm(`Delete role "${selectedRole.name}"? This cannot be undone.`)
                    )
                      deleteMut.mutate(selectedRole.id)
                  }}
                  disabled={deleteMut.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Trash2 size={15} /> Delete
                </button>
              )}
            </div>

            {roleQ.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : !selectedRole ? null : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Role Name</span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={!editable}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">Description</span>
                    <input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={!editable}
                      placeholder="Optional"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
                    />
                  </label>
                </div>

                {isSystem && (
                  <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    This is a built-in system role with full access. It can't be edited or deleted.
                  </p>
                )}

                {/* PLACEHOLDER_MATRIX */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Permission Matrix</span>
                  <label
                    className={cn(
                      "flex items-center gap-2 text-xs",
                      editable ? "cursor-pointer" : "cursor-not-allowed opacity-60"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => toggleAll(e.target.checked)}
                      disabled={!editable}
                      className="h-4 w-4 accent-primary"
                    />
                    Select all
                  </label>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2.5 font-medium">Module</th>
                        {PERMISSION_ACTIONS.map((a) => (
                          <th key={a} className="px-3 py-2.5 text-center font-medium">
                            {ACTION_LABELS[a]}
                          </th>
                        ))}
                        <th className="px-3 py-2.5 text-center font-medium">All</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PERMISSION_MODULES.map((m) => {
                        const rowOn = PERMISSION_ACTIONS.every((a) => granted.has(cellKey(m, a)))
                        return (
                          <tr key={m} className="border-b border-border/60 last:border-0">
                            <td className="px-3 py-2 font-medium">{MODULE_LABELS[m]}</td>
                            {PERMISSION_ACTIONS.map((a) => (
                              <td key={a} className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={granted.has(cellKey(m, a))}
                                  onChange={() => toggleCell(m, a)}
                                  disabled={!editable}
                                  className="h-4 w-4 accent-primary disabled:opacity-50"
                                  aria-label={`${MODULE_LABELS[m]} ${ACTION_LABELS[a]}`}
                                />
                              </td>
                            ))}
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={rowOn}
                                onChange={(e) => toggleModuleRow(m, e.target.checked)}
                                disabled={!editable}
                                className="h-4 w-4 accent-primary disabled:opacity-50"
                                aria-label={`Toggle all ${MODULE_LABELS[m]}`}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {editable && (
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-xs text-muted-foreground">{granted.size} granted</span>
                    <button
                      onClick={() => saveMut.mutate()}
                      disabled={saveMut.isPending}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                    >
                      <Save size={15} /> {saveMut.isPending ? "Saving…" : "Save Matrix"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* PLACEHOLDER_MEMBERS */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Member Assignments</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Assign a custom role to a member, or clear it to fall back to their base role.
              </p>
            </div>

            {membersQ.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : membersQ.isError ? (
              <ErrorState message="Couldn't load members." onRetry={() => membersQ.refetch()} />
            ) : !membersQ.data?.length ? (
              <EmptyState className="py-8" message="No active members yet." />
            ) : (
              <ul className="divide-y divide-border/60">
                {membersQ.data.map((mem) => (
                  <li key={mem.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {mem.user.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{mem.user.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {mem.role ?? "—"}
                      </div>
                    </div>
                    {canEdit ? (
                      <select
                        value={mem.permissionRoleId ?? ""}
                        onChange={(e) =>
                          assignMut.mutate({
                            membershipId: mem.id,
                            roleId: e.target.value || null,
                          })
                        }
                        disabled={assignMut.isPending}
                        className="max-w-[9rem] shrink-0 rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                      >
                        <option value="">No custom role</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {mem.permissionRole ? (
                          <>
                            <Check size={13} /> {mem.permissionRole.name}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}



