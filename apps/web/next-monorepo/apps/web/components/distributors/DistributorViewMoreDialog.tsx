"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Building2, CalendarDays, Cpu, Gamepad2, Mail, MapPin, Phone, Search, Undo2, X } from "lucide-react"
import { deactivateKiosks, fetchAgreementsForChild, fetchKiosks, fetchKiosksForOrganization, type Distributor } from "@/lib/backend-api"
import { fetchLauncherGames } from "@/lib/devices-api"
import { useMe } from "@/hooks/useMe"
import { EmptyState } from "@/components/dashboard/ui"
import ReviewRequestList from "@/components/requests/ReviewRequestList"

/**
 * Per-distributor detail view, opened from the row's "View details" action.
 *
 * Layout mirrors the rest of the dashboard: a profile header (identity, status, contact),
 * three summary cards, then tabs for Kiosks / Agreements / Partners, with a details rail on
 * wide screens. Data comes from the distributors list endpoint (profile, counts, partners)
 * and `fetchKiosks`, filtered to the kiosks currently held by this distributor.
 *
 * The two review tabs reuse `ReviewRequestList`, which is the same component the Requests
 * page renders, so the API calls, pagination, loading/error states and authorization rules
 * are shared rather than copied.
 */
type Tab = "kiosks" | "partners" | "agreements"

const TABS: { id: Tab; label: string }[] = [
  { id: "kiosks", label: "Kiosks" },
  { id: "agreements", label: "Agreements" },
  { id: "partners", label: "Partners" },
]

const MACHINE_STATUSES = [
  "AVAILABLE",
  "RESERVED",
  "ASSIGNED",
  "INSTALLED",
  "MAINTENANCE",
  "RETURNED",
  "RETURN_REQUESTED",
  "RETIRED",
] as const

const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

const selectClass =
  "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

/**
 * `GET /api/network/distributors` returns each Distributor's associated Partners alongside
 * its profile fields. The field is declared here rather than added to the shared `Distributor`
 * type: that module is not editable in this workspace, and this dialog is its only consumer,
 * so a local extension keeps the change contained and still type-safe.
 */
type DistributorWithPartners = Distributor & {
  partners?: { id: string; name: string; type: string }[]
}

function statusTone(status: string): string {
  if (status === "AVAILABLE") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (status === "ASSIGNED" || status === "INSTALLED") return "bg-blue-500/10 text-blue-700 dark:text-blue-300"
  if (status === "MAINTENANCE" || status === "RETURN_REQUESTED") return "bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (status === "RETIRED" || status === "RETURNED") return "bg-muted text-muted-foreground"
  return "bg-muted text-muted-foreground"
}

function PartnerAgreementAndMachines({
  partner,
  kiosks,
}: {
  partner: { id: string; name: string; type: string }
  kiosks: Awaited<ReturnType<typeof fetchKiosks>> | undefined
}) {
  const [agreementPage, setAgreementPage] = React.useState(1)
  const partnerKiosks = useQuery({
    queryKey: ["partner-kiosks", partner.id],
    queryFn: () => fetchKiosksForOrganization(partner.id),
    staleTime: 10_000,
  })
  const assigned = partnerKiosks.data ?? (kiosks ?? []).filter((kiosk) => kiosk.currentOrgId === partner.id)
  // The request list only carries approvals in flight. An agreement that is already
  // active has no request row, so the terms have to come from the agreements endpoint or
  // the panel reads "No requests" while the Partner is plainly operating.
  const agreements = useQuery({
    queryKey: ["partner-agreements", partner.id],
    queryFn: () => fetchAgreementsForChild(partner.id),
  })
  const rows = agreements.data ?? []
  const current = rows.find((row) => row.status === "ACTIVE") ?? rows[0]

  return (
    <div className="mt-4 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agreement</h4>
        {agreements.isLoading ? (
          <p role="status" className="text-xs text-muted-foreground">Loading agreement…</p>
        ) : agreements.isError ? (
          <p role="alert" className="text-xs text-destructive">Couldn&apos;t load this Partner&apos;s agreement.</p>
        ) : current ? (
          <dl className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{current.status.replaceAll("_", " ").toLowerCase()}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Share</dt>
              <dd className="tabular-nums">{current.parentSharePct}% / {current.childSharePct}%</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Deposit per kiosk</dt>
              <dd className="tabular-nums">₹{Number(current.depositAmountPerMachine).toLocaleString("en-IN")}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Non-refundable</dt>
              <dd className="tabular-nums">₹{Number(current.nonRefundableAmountPerMachine).toLocaleString("en-IN")}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Effective from</dt>
              <dd>{new Date(current.effectiveFrom).toLocaleDateString("en-IN")}</dd>
            </div>
          </dl>
        ) : (
          <ReviewRequestList kind="agreements" page={agreementPage} onPageChange={setAgreementPage} counterpartyId={partner.id} />
        )}
      </section>
      <section className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">Assigned machines</h4>
          <span className="text-xs text-muted-foreground">
            {assigned.length} machine{assigned.length === 1 ? "" : "s"}
          </span>
        </div>
          {partnerKiosks.isLoading ? (
            <p role="status" className="text-xs text-muted-foreground">Loading assigned machines…</p>
          ) : partnerKiosks.isError ? (
            <p role="alert" className="text-xs text-destructive">Couldn&apos;t load this Partner&apos;s machines.</p>
          ) : !assigned.length ? (
          <p className="text-xs text-muted-foreground">No machines are currently assigned to this Partner.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Machine code</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {assigned.map((kiosk) => (
                  <tr key={kiosk.id}>
                    <td className="py-2 pr-3 font-mono font-medium">{kiosk.machineCode}</td>
                    <td className="py-2 pr-3">{kiosk.status.replaceAll("_", " ")}</td>
                    <td className="py-2 text-muted-foreground">{kiosk.location ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Games & pricing for one machine, as the kiosk launcher reports them.
 *
 * The launcher endpoint answers per device and carries the price that device charges, plus
 * the artwork kiosks display. `needsUpdate` marks a game whose price differs from the fleet
 * catalogue (an override in effect), which is exactly the row an operator has to review.
 */
export function GamesPricing({ machines }: { machines: Awaited<ReturnType<typeof fetchKiosks>> }) {
  const [selected, setSelected] = React.useState(machines[0]?.externalDeviceId ?? machines[0]?.machineCode ?? "")
  const [onlyNeedsUpdate, setOnlyNeedsUpdate] = React.useState(false)
  React.useEffect(() => {
    if (!machines.some((machine) => (machine.externalDeviceId ?? machine.machineCode) === selected)) {
      setSelected(machines[0]?.externalDeviceId ?? machines[0]?.machineCode ?? "")
    }
  }, [machines, selected])

  const games = useQuery({
    queryKey: ["launcher-games", selected],
    queryFn: () => fetchLauncherGames(selected),
    enabled: Boolean(selected),
    staleTime: 30_000,
    retry: 1,
  })
  const all = games.data?.games ?? []
  const visible = all.filter((game) => !onlyNeedsUpdate || game.needsUpdate)
  const needsUpdate = all.filter((game) => game.needsUpdate).length

  if (!machines.length) return null

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-3">
        <div>
          <h3 className="text-sm font-semibold">Games &amp; pricing</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Games the launcher offers on this machine, and the price it charges.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            aria-label="Machine to inspect games for"
            className={selectClass}
          >
            {machines.map((machine) => {
              const id = machine.externalDeviceId ?? machine.machineCode
              return (
                <option key={machine.id} value={id}>
                  {machine.machineCode}
                </option>
              )
            })}
          </select>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyNeedsUpdate}
              onChange={(event) => setOnlyNeedsUpdate(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-input"
            />
            Only needs review
          </label>
        </div>
      </div>

      {games.isLoading ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">Loading games…</p>
      ) : games.isError ? (
        <div className="space-y-3 p-4 text-sm">
          <p role="alert" className="text-destructive">Couldn&apos;t load games for this machine.</p>
          <button
            type="button"
            onClick={() => void games.refetch()}
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            Retry
          </button>
        </div>
      ) : !all.length ? (
        <p className="p-4 text-sm text-muted-foreground">This machine reports no games.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
            <span role="status">
              {all.length} game{all.length === 1 ? "" : "s"}
            </span>
            <span className={needsUpdate ? "font-medium text-amber-700 dark:text-amber-300" : undefined}>
              {needsUpdate} need{needsUpdate === 1 ? "s" : ""} review
            </span>
            <span>{all.filter((game) => !game.playable).length} not playable</span>
          </div>
          {!visible.length ? (
            <p className="p-4 text-sm text-muted-foreground">
              Every game on this machine matches the catalogue price.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5 p-3 pb-5 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
              {visible.map((game) => (
                <li key={game.gameId} className="overflow-hidden rounded-xl border border-border bg-card">
                  {/* Launcher posters are 9:16 (1080x1920); a 2:3 frame crops only the edges
                      instead of most of the artwork. */}
                  <div className="relative aspect-[2/3] bg-muted">
                    {game.posterUrl ?? game.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={game.posterUrl ?? game.iconUrl ?? undefined}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center bg-muted text-muted-foreground">
                        <Gamepad2 size={20} />
                      </span>
                    )}
                    {game.needsUpdate && (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-semibold text-black">
                        Needs review
                      </span>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium" title={game.name}>
                      {game.name}
                    </p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-foreground">
                      ₹{game.price} / replay ₹{game.replayPrice}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground tabular-nums">
                      Cat ₹{game.catalogPrice ?? "—"} · v{game.version ?? "—"}
                      {!game.playable ? " · n/a" : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function SummaryCard({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string
  value: number
  hint: string
  tone: string
  icon: React.ComponentType<{ size?: number }>
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
          <Icon size={15} />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

/**
 * The agreement between this Distributor and the viewer's side. A Company sees the terms it
 * signed with the Distributor; a Partner sees the terms its own Distributor signed with it.
 * The request list only holds approvals in flight, so it cannot answer this.
 */
function DistributorAgreementTerms({
  distributorId,
  fallback,
}: {
  distributorId: string
  fallback?: React.ReactNode
}) {
  const { me, orgType } = useMe()
  const selfId = me?.membership?.organizationId
  const childId = orgType === "PARTNER" ? selfId : distributorId
  const query = useQuery({
    queryKey: ["distributor-agreement", distributorId, childId],
    queryFn: () => fetchAgreementsForChild(childId!),
    enabled: !!childId,
  })
  const related = (query.data ?? []).filter(
    (row) => row.childOrg.id === distributorId || row.parentOrg.id === distributorId,
  )
  const row = related.find((item) => item.status === "ACTIVE") ?? related[0]

  if (query.isLoading) {
    return <p role="status" className="text-sm text-muted-foreground">Loading agreement…</p>
  }
  if (query.isError) {
    return <p role="alert" className="text-sm text-destructive">Couldn&apos;t load the agreement.</p>
  }
  if (!row) return <>{fallback ?? <EmptyState message="No agreement has been drafted with this distributor yet." />}</>

  const money = (value: number | string) => `₹${Number(value).toLocaleString("en-IN")}`

  return (
    <dl className="grid gap-3 rounded-xl border border-border bg-card p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted-foreground">Status</dt>
        <dd className="mt-0.5 font-medium">{row.status.replaceAll("_", " ").toLowerCase()}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Share</dt>
        <dd className="mt-0.5 tabular-nums">{row.parentSharePct}% / {row.childSharePct}%</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Deposit per kiosk</dt>
        <dd className="mt-0.5 tabular-nums">{money(row.depositAmountPerMachine)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Non-refundable per kiosk</dt>
        <dd className="mt-0.5 tabular-nums">{money(row.nonRefundableAmountPerMachine)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Effective from</dt>
        <dd className="mt-0.5">{new Date(row.effectiveFrom).toLocaleDateString("en-IN")}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">Effective to</dt>
        <dd className="mt-0.5">{row.effectiveTo ? new Date(row.effectiveTo).toLocaleDateString("en-IN") : "open-ended"}</dd>
      </div>
    </dl>
  )
}

export default function DistributorViewMoreDialog({
  distributor,
  trigger,
}: {
  distributor: DistributorWithPartners
  trigger?: React.ReactElement
}) {
  const { canReviewRequests } = useMe()
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>("kiosks")
  const [agreementPage, setAgreementPage] = React.useState(1)
  const [machineQuery, setMachineQuery] = React.useState("")
  const [machineStatus, setMachineStatus] = React.useState<string>("ALL")
  const kiosks = useQuery({
    queryKey: ["distributor-kiosks", distributor.id],
    queryFn: () => fetchKiosksForOrganization(distributor.id),
    enabled: open && tab === "kiosks",
    staleTime: 10_000,
  })
  const [unassigningId, setUnassigningId] = React.useState<string | null>(null)
  const [assignError, setAssignError] = React.useState<string | null>(null)
  const [expandedPartnerId, setExpandedPartnerId] = React.useState<string | null>(null)

  // Reopening should start clean rather than resume a stale page or filter.
  function change(next: boolean) {
    if (next) {
      setTab("kiosks")
      setAgreementPage(1)
      setAssignError(null)
      setExpandedPartnerId(null)
      setMachineQuery("")
      setMachineStatus("ALL")
    }
    setOpen(next)
  }

  const assigned = (kiosks.data ?? []).filter((kiosk) => kiosk.currentOrgId === distributor.id)
  const available = assigned.filter((kiosk) => kiosk.status === "AVAILABLE").length
  const inUse = assigned.filter((kiosk) => kiosk.status === "ASSIGNED" || kiosk.status === "INSTALLED").length
  const visibleMachines = assigned.filter((kiosk) => {
    const needle = machineQuery.trim().toLowerCase()
    const matchesQuery =
      !needle ||
      [kiosk.machineCode, kiosk.model ?? "", kiosk.location ?? "", kiosk.status].some((value) =>
        value.toLowerCase().includes(needle),
      )
    return matchesQuery && (machineStatus === "ALL" || kiosk.status === machineStatus)
  })

  const created = new Date(distributor.createdAt)
  const memberSince = Number.isNaN(created.getTime())
    ? "—"
    : created.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`Open ${distributor.name}`}
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Open
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col overflow-hidden border-0 bg-card text-card-foreground shadow-xl outline-none">
          {/* Profile header */}
          <header className="border-b border-border p-5 pr-12 sm:p-6">
            <div className="flex flex-wrap items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Building2 size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="break-words text-xl font-semibold tracking-tight">{distributor.name}</Dialog.Title>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                      distributor.isActive
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-red-500/10 text-red-700 dark:text-red-300"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${distributor.isActive ? "bg-emerald-500" : "bg-red-500"}`} />
                    {distributor.isActive ? "Active" : "Inactive"}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      distributor.agreementStatus === "ACTIVE"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : distributor.agreementStatus === "PENDING_APPROVAL"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    Agreement {distributor.agreementStatus ? distributor.agreementStatus.replaceAll("_", " ").toLowerCase() : "not drafted"}
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {distributor.type}
                  </span>
                </div>
                <Dialog.Description className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={13} />
                    {[distributor.city, distributor.state].filter(Boolean).join(", ") || "No location recorded"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Mail size={13} />
                    {distributor.owner?.email ?? "—"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Phone size={13} />
                    {distributor.phone ?? "—"}
                  </span>
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              aria-label="Close distributor details"
              className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X size={18} />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto grid w-full max-w-[1600px] gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0 space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <SummaryCard
                    label="Assigned machines"
                    value={assigned.length}
                    hint="Currently held"
                    tone="bg-blue-500/10 text-blue-700 dark:text-blue-300"
                    icon={Cpu}
                  />
                  <SummaryCard
                    label="Available"
                    value={available}
                    hint="Ready for deployment"
                    tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    icon={Cpu}
                  />
                  <SummaryCard
                    label="In use"
                    value={inUse}
                    hint="Assigned or installed"
                    tone="bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    icon={CalendarDays}
                  />
                </div>

                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Distributor sections">
                  {TABS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      id={`distributor-tab-${item.id}`}
                      role="tab"
                      aria-selected={tab === item.id}
                      aria-controls={`distributor-panel-${item.id}`}
                      tabIndex={tab === item.id ? 0 : -1}
                      onClick={() => setTab(item.id)}
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                        tab === item.id
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-card hover:bg-muted"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div
                  id={`distributor-panel-${tab}`}
                  role="tabpanel"
                  aria-labelledby={`distributor-tab-${tab}`}
                  tabIndex={0}
                  className="outline-none"
                >
                  {tab === "kiosks" ? (
                    kiosks.isLoading ? (
                      <p role="status" className="text-sm text-muted-foreground">Loading assigned kiosks…</p>
                    ) : kiosks.isError ? (
                      <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                        <p role="alert" className="text-destructive">
                          Couldn&apos;t load this distributor&apos;s assigned kiosks.
                        </p>
                        <button
                          type="button"
                          onClick={() => void kiosks.refetch()}
                          className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-5">
                      <section className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
                          <div className="relative min-w-44 flex-1">
                            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                              type="search"
                              value={machineQuery}
                              onChange={(event) => setMachineQuery(event.target.value)}
                              placeholder="Search machine code, model or location…"
                              aria-label="Search assigned machines"
                              className={`${inputClass} pl-9`}
                            />
                          </div>
                          <select
                            value={machineStatus}
                            onChange={(event) => setMachineStatus(event.target.value)}
                            aria-label="Filter machines by status"
                            className={selectClass}
                          >
                            <option value="ALL">All statuses</option>
                            {MACHINE_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status.replaceAll("_", " ").toLowerCase()}
                              </option>
                            ))}
                          </select>
                          <span role="status" className="text-xs text-muted-foreground">
                            {visibleMachines.length} of {assigned.length}
                          </span>
                        </div>
                        {assignError && (
                          <p role="alert" className="border-b border-border bg-destructive/10 p-3 text-xs text-destructive">
                            {assignError}
                          </p>
                        )}
                        {!assigned.length ? (
                          <p className="p-4 text-sm text-muted-foreground">
                            No kiosks are currently assigned to this distributor.
                          </p>
                        ) : !visibleMachines.length ? (
                          <p className="p-4 text-sm text-muted-foreground">No machines match these filters.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                                <tr>
                                  <th className="px-4 py-3 font-medium">Machine code</th>
                                  <th className="px-4 py-3 font-medium">Model</th>
                                  <th className="px-4 py-3 font-medium">Status</th>
                                  <th className="px-4 py-3 font-medium">Location</th>
                                  <th className="px-4 py-3 text-right font-medium">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border">
                                {visibleMachines.map((kiosk) => (
                                  <tr key={kiosk.id} className="hover:bg-muted/40">
                                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium">{kiosk.machineCode}</td>
                                    <td className="whitespace-nowrap px-4 py-3">{kiosk.model ?? "—"}</td>
                                    <td className="px-4 py-3">
                                      <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${statusTone(kiosk.status)}`}>
                                        {kiosk.status.replaceAll("_", " ").toLowerCase()}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{kiosk.location ?? "—"}</td>
                                    <td className="px-4 py-3 text-right">
                                      <button
                                        type="button"
                                        disabled={
                                          unassigningId !== null ||
                                          !["AVAILABLE", "RETURNED", "MAINTENANCE"].includes(kiosk.status)
                                        }
                                        onClick={async () => {
                                          if (!window.confirm(`Deactivate ${kiosk.machineCode}? Its ownership and history will be preserved.`)) return
                                          setUnassigningId(kiosk.id)
                                          setAssignError(null)
                                          try {
                                            await deactivateKiosks({ organizationId: distributor.id, kioskIds: [kiosk.id] })
                                            await kiosks.refetch()
                                          } catch (error) {
                                            setAssignError(error instanceof Error ? error.message : "Couldn’t deactivate kiosk.")
                                          } finally {
                                            setUnassigningId(null)
                                          }
                                        }}
                                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        <Undo2 size={13} />
                                        {unassigningId === kiosk.id ? "Deactivating…" : "Deactivate"}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>
                      <GamesPricing machines={assigned} />
                      </div>
                    )
                  ) : tab === "partners" ? (
                    /* Partners genuinely associated with this Distributor, as returned by the API.
                       A Partner registration records no parent pointer, so this is derived from
                       existing connections/agreements/orders -- an empty list is a real answer,
                       not a loading failure. */
                    !distributor.partners?.length ? (
                      <EmptyState message="No Partners are associated with this distributor yet. A Partner appears here once it is registered by, or shares an agreement or order with, this distributor." />
                    ) : (
                      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                        {distributor.partners.map((partner) => (
                          <li key={partner.id} className="p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{partner.name}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">{partner.type}</p>
                              </div>
                              <button
                                type="button"
                                className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                                onClick={() =>
                                  setExpandedPartnerId((current) => (current === partner.id ? null : partner.id))
                                }
                              >
                                {expandedPartnerId === partner.id ? "Hide details" : "View agreement & machines"}
                              </button>
                            </div>
                            {expandedPartnerId === partner.id && (
                              <PartnerAgreementAndMachines partner={partner} kiosks={kiosks.data} />
                            )}
                          </li>
                        ))}
                      </ul>
                    )
                  ) : (
                    <DistributorAgreementTerms
                      distributorId={distributor.id}
                      fallback={
                        canReviewRequests ? (
                          <ReviewRequestList
                            kind="agreements"
                            page={agreementPage}
                            onPageChange={setAgreementPage}
                            counterpartyId={distributor.id}
                          />
                        ) : (
                          <EmptyState message="No agreement has been drafted with this distributor yet." />
                        )
                      }
                    />
                  )}
                </div>
              </div>

              {/* Details rail (wide screens only) */}
              <aside className="hidden space-y-4 lg:block">
                <section className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold">Distributor details</h3>
                  <dl className="mt-3 space-y-2.5 text-sm">
                    {[
                      ["Owner", distributor.owner?.name ?? "—"],
                      ["Email", distributor.owner?.email ?? "—"],
                      ["Phone", distributor.phone ?? "—"],
                      ["GSTIN", distributor.gstNumber ?? "—"],
                      ["Location", [distributor.city, distributor.state, distributor.pincode].filter(Boolean).join(", ") || "—"],
                      ["Member since", memberSince],
                      ["Team members", String(distributor._count.memberships)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 break-words text-right text-xs font-medium">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold">Agreement</h3>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {distributor.agreementStatus
                      ? `Current status: ${distributor.agreementStatus.replaceAll("_", " ").toLowerCase()}.`
                      : "No agreement has been drafted with this distributor yet."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Open the <strong>Agreements</strong> tab to review the terms, or the{" "}
                    <strong>Agreements</strong> page for the full history.
                  </p>
                </section>

                <section className="rounded-xl border border-border bg-card p-4">
                  <h3 className="text-sm font-semibold">Network</h3>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground">Partners</span>
                    <span className="text-xs font-medium tabular-nums">{distributor.partners?.length ?? 0}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-xs text-muted-foreground">Kiosks held</span>
                    <span className="text-xs font-medium tabular-nums">{distributor._count.kiosks}</span>
                  </div>
                </section>
              </aside>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
