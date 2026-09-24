"use client"

import React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { UserCog, Trash2, Check, X, UserPlus } from "lucide-react"
import {
  MANAGEABLE_ROLES,
  fetchMembers,
  fetchPendingMembers,
  fetchRoles,
  createMember,
  handleJoinRequest,
  updateMemberRole,
  removeMember,
  assignRole,
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
  const { me, can, isLoading: meLoading } = useMe()
  const canView = can("STAFF", "VIEW")
  const canCreate = can("STAFF", "CREATE")
  const canEdit = can("STAFF", "EDIT")
  const canDelete = can("STAFF", "DELETE")
  // Custom permission-role assignment is a ROLES capability, not a STAFF one.
  const canAssignRoles = can("ROLES", "EDIT")

  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [approveRole, setApproveRole] = React.useState<Record<string, ManageableRole>>({})
  const [createOpen, setCreateOpen] = React.useState(false)
  const emptyForm = {
    name: "",
    email: "",
    role: "STAFF" as ManageableRole,
    password: "",
    aadharNumber: "",
    panNumber: "",
    mobile: "",
    alternateMobile: "",
    dateOfBirth: "",
    emergencyContact: "",
    address: "",
  }
  const [form, setForm] = React.useState(emptyForm)
  const setField = (k: keyof typeof emptyForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const membersQ = useQuery({ queryKey: ["members"], queryFn: fetchMembers, enabled: canView })
  const pendingQ = useQuery({
    queryKey: ["pending-members"],
    queryFn: () => fetchPendingMembers(1, 50),
    enabled: canView,
  })
  const rolesQ = useQuery({
    queryKey: ["roles"],
    queryFn: fetchRoles,
    enabled: canView && canAssignRoles,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["members"] })
    qc.invalidateQueries({ queryKey: ["pending-members"] })
  }

  const createMut = useMutation({
    mutationFn: createMember,
    onSuccess: (r) => {
      setError(null)
      setCreateOpen(false)
      setForm(emptyForm)
      setNotice(
        !r.passwordGenerated
          ? `${r.member.user.name} was created with the password you set.`
          : r.credentialsEmailSent
            ? `${r.member.user.name} was created — login credentials were emailed to ${r.member.user.email}.`
            : `${r.member.user.name} was created, but the credentials email could not be sent. Share a password reset link with ${r.member.user.email}.`
      )
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const approveMut = useMutation({
    mutationFn: ({ id, action, role }: { id: string; action: "APPROVE" | "REJECT"; role?: ManageableRole }) =>
      handleJoinRequest(id, action, role),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  // PLACEHOLDER_MUTATIONS
  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: ManageableRole }) => updateMemberRole(id, role),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const permRoleMut = useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string | null }) => assignRole(id, roleId),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => removeMember(id),
    onSuccess: () => {
      setError(null)
      invalidate()
    },
    onError: (e: Error) => setError(e.message),
  })

  const members = membersQ.data ?? []
  const pending = pendingQ.data?.data ?? []
  const roles = rolesQ.data ?? []

  if (meLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-6xl">
        <EmptyState
          className="py-20"
          icon={<UserCog size={30} />}
          message="You don't have permission to manage users."
        />
      </div>
    )
  }

  // PLACEHOLDER_RENDER
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your organization&apos;s members, approve join requests, and assign roles.
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => {
              setError(null)
              setNotice(null)
              setCreateOpen(true)
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <UserPlus size={16} /> New User
          </button>
        )}
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* PLACEHOLDER_PENDING */}
      {canEdit && pending.length > 0 && (
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight">
              Pending Join Requests
              <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                {pending.length}
              </span>
            </h2>
          </div>
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
        </div>
      )}

      {/* PLACEHOLDER_MEMBERS */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">Active Members</h2>
        </div>
        {membersQ.isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-8 w-28" />
              </div>
            ))}
          </div>
        ) : membersQ.isError ? (
          <ErrorState className="py-12" message="Couldn't load members." onRetry={() => membersQ.refetch()} />
        ) : !members.length ? (
          <EmptyState className="py-14" icon={<UserPlus size={30} />} message="No active members yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Member</th>
                  <th className="px-4 py-3 font-medium">Base Role</th>
                  {canAssignRoles && <th className="px-4 py-3 font-medium">Permission Role</th>}
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {/* PLACEHOLDER_ROWS */}
                {members.map((mem) => {
                  const isSelf = mem.user.id === me?.id
                  const isOwner = mem.role === "OWNER"
                  const roleEditable = canEdit && !isSelf && !isOwner
                  return (
                    <tr key={mem.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                            {mem.user.name.slice(0, 2).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {mem.user.name}
                              {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">{mem.user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {roleEditable ? (
                          <select
                            value={mem.role ?? "STAFF"}
                            onChange={(e) => roleMut.mutate({ id: mem.id, role: e.target.value as ManageableRole })}
                            disabled={roleMut.isPending}
                            className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                          >
                            {MANAGEABLE_ROLES.map((r) => (
                              <option key={r} value={r}>
                                {ROLE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm">{mem.role ? ROLE_LABELS[mem.role] ?? mem.role : "—"}</span>
                        )}
                      </td>
                      {canAssignRoles && (
                        <td className="px-4 py-3">
                          <select
                            value={mem.permissionRoleId ?? ""}
                            onChange={(e) => permRoleMut.mutate({ id: mem.id, roleId: e.target.value || null })}
                            disabled={permRoleMut.isPending}
                            className="max-w-[11rem] rounded-lg border border-border bg-background px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                          >
                            <option value="">No custom role</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right">
                        {canDelete && !isSelf && !isOwner ? (
                          <button
                            onClick={() => {
                              if (confirm(`Remove ${mem.user.name} from the organization?`))
                                removeMut.mutate(mem.id)
                            }}
                            disabled={removeMut.isPending}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive transition hover:bg-destructive/10 disabled:opacity-50"
                          >
                            <Trash2 size={14} /> Remove
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !createMut.isPending && setCreateOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">New User</h2>
              <button
                onClick={() => setCreateOpen(false)}
                disabled={createMut.isPending}
                className="opacity-70 transition hover:opacity-100 disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                createMut.mutate(form)
              }}
              className="space-y-5"
            >
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Personal Information
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Full Name *</label>
                    <input
                      value={form.name}
                      onChange={(e) => setField("name", e.target.value)}
                      required
                      minLength={2}
                      placeholder="e.g. John Smith"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Email *</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={(e) => setField("email", e.target.value)}
                      required
                      placeholder="e.g. john@icit.com"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Password</label>
                    <input
                      type="text"
                      value={form.password}
                      onChange={(e) => setField("password", e.target.value)}
                      placeholder="Leave blank for auto-generated secure password"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Role</label>
                    <select
                      value={form.role}
                      onChange={(e) => setField("role", e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {MANAGEABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  KYC Documents
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Aadhar Number</label>
                    <input
                      inputMode="numeric"
                      value={form.aadharNumber}
                      onChange={(e) => setField("aadharNumber", e.target.value)}
                      placeholder="XXXX XXXX XXXX"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">PAN Number</label>
                    <input
                      value={form.panNumber}
                      onChange={(e) => setField("panNumber", e.target.value.toUpperCase())}
                      placeholder="ABCDE1234F"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Personal Details
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Mobile</label>
                    <input
                      inputMode="numeric"
                      value={form.mobile}
                      onChange={(e) => setField("mobile", e.target.value)}
                      placeholder="9876543210"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Alternate Mobile</label>
                    <input
                      inputMode="numeric"
                      value={form.alternateMobile}
                      onChange={(e) => setField("alternateMobile", e.target.value)}
                      placeholder="Alternate number"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Date Of Birth</label>
                    <input
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) => setField("dateOfBirth", e.target.value)}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Emergency Contact</label>
                    <input
                      inputMode="numeric"
                      value={form.emergencyContact}
                      onChange={(e) => setField("emergencyContact", e.target.value)}
                      placeholder="Contact number"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Address</label>
                  <textarea
                    value={form.address}
                    onChange={(e) => setField("address", e.target.value)}
                    rows={2}
                    placeholder="Full address"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </section>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={createMut.isPending}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                >
                  <UserPlus size={15} /> {createMut.isPending ? "Creating…" : "Create User"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
