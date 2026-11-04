"use client"

import React, { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Cpu, Gamepad2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useMe } from "@/hooks/useMe"
import {
  fetchDevicePrices,
  fetchDevices,
  fetchDevicePriceRequests,
  approveDevicePriceRequest,
  rejectDevicePriceRequest,
  requestDeviceGamePrice,
  type DevicePriceRequest,
  resetAllDevicePrices,
  resetDevicePrices,
  setDeviceGamePrice,
  type DeviceView,
  type GamePriceView,
  type EodPriceUpdate,
} from "@/lib/devices-api"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"
import { localDateKey } from "@/lib/local-date"

const buttonClass =
  "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

/** Indian grouping, matching the currency format used elsewhere in the app. */
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
})

function defaultScheduledDate() {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return localDateKey(date)
}

/** Only an explicit upstream override is resetable; catalog drift is not. */
function gameHasOverride(game: GamePriceView): boolean {
  return (
    game.hasOverride ||
    game.overridePrice !== null ||
    game.overrideReplayPrice !== null
  )
}

/** A device that has not caught up with the catalog still deserves a review badge. */
function gameDiffersFromCatalog(game: GamePriceView): boolean {
  return (
    game.differsFromCatalog ||
    Math.abs(game.effectivePrice - game.basePrice) >= 0.001 ||
    Math.abs(game.effectiveReplayPrice - game.baseReplayPrice) >= 0.001
  )
}

function EodStatus({ update }: { update: EodPriceUpdate }) {
  const label = update.status === "PENDING" ? "Scheduled" : update.status === "PROCESSING" ? "Applying" : update.status === "APPLIED" ? "Applied" : "Failed"
  const tone = update.status === "FAILED" ? "text-destructive" : update.status === "APPLIED" ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"
  return <span className={`text-xs font-medium ${tone}`} title={update.lastError ?? undefined}>{label}: {inr.format(update.price)}</span>
}

const TABS = [
  { id: "fleet", label: "Fleet" },
  { id: "pricing", label: "Game pricing" },
] as const

type TabId = (typeof TABS)[number]["id"]

/**
 * Mothership device fleet and game pricing.
 *
 * Two tabs rather than one screen: "Fleet" reports hardware state (Mothership's view of
 * what exists), while "Game pricing" reports prices per device. They answer different
 * questions about the same device, and mixing them made the table unreadable. Reads are
 * per device, and the default price action writes a device-only override that is read
 * back and checked against the catalog and every other device. A separate, explicitly
 * confirmed "Apply to all kiosks" action updates the game's catalog price for the whole
 * fleet instead; nothing ever falls back to it automatically.
 *
 * Prices are owned by Mothership, so nothing here is optimistic: reset refetches after the
 * API confirms the result. Resetting overrides is device-scoped and shown only to COMPANY
 * OWNER/ADMIN, matching the API route.
 */
export default function DevicesScreen() {
  const { me, isLoading, canViewDevices, canManageDevicePrices, canRequestDevicePrices, canViewDevicePriceRequests, canReviewDevicePriceRequests } = useMe()
  const qc = useQueryClient()
  const [tab, setTab] = useState<TabId>("fleet")
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null)

  const scope = [me?.id ?? "", me?.membership?.organizationId ?? ""]

  const devices = useQuery({
    queryKey: ["devices", ...scope],
    queryFn: fetchDevices,
    staleTime: 30_000,
    retry: 1,
  })
  const prices = useQuery<Awaited<ReturnType<typeof fetchDevicePrices>>>({
    queryKey: ["device-prices", selectedDevice, ...scope],
    queryFn: () => fetchDevicePrices(selectedDevice!),
    enabled: !!selectedDevice,
    staleTime: 15_000,
    retry: 1,
  })
  const requests = useQuery({
    queryKey: ["device-price-requests", ...scope],
    queryFn: fetchDevicePriceRequests,
    enabled: canViewDevicePriceRequests,
    staleTime: 15_000,
  })

  if (isLoading) return <Skeleton className="h-64" />
  // The API enforces the same scope; this only avoids firing a request that would 403.
  if (!canViewDevices) {
    return (
      <EmptyState message="Your role cannot view the device fleet. Ask an Owner or Admin." />
    )
  }

  const list = devices.data?.devices ?? []

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hardware reported by Mothership, and the price each game charges on each machine.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            devices.refetch()
            if (selectedDevice) prices.refetch()
          }}
          disabled={devices.isFetching}
          className={`${buttonClass} inline-flex items-center gap-2`}
        >
          <RefreshCw size={15} className={devices.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {canViewDevicePriceRequests && (
        <PriceRequestQueue
          requests={requests.data?.requests ?? []}
          loading={requests.isLoading}
          onChanged={() => requests.refetch()}
          canReview={canReviewDevicePriceRequests}
        />
      )}

      <div className="flex flex-wrap gap-2" aria-label="Device view">
        {TABS.map(item => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
            className={`rounded-lg border px-4 py-2 text-sm font-medium ${
              tab === item.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {devices.isError ? (
        <ErrorState message="Couldn't load the device fleet." onRetry={() => devices.refetch()} />
      ) : (
        <Panel>
          {tab === "fleet" ? (
            <FleetTab
              devices={list}
              lastUpdated={devices.data?.lastUpdated ?? null}
              busy={devices.isFetching}
              onPickPricing={deviceId => {
                setSelectedDevice(deviceId)
                setTab("pricing")
              }}
            />
          ) : (
            <PricingTab
              devices={list}
              selectedDevice={selectedDevice}
              onSelectDevice={setSelectedDevice}
              prices={prices}
              canWrite={canManageDevicePrices}
              canRequest={canRequestDevicePrices}
              onSaved={async () => {
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["device-prices"] }),
                  qc.invalidateQueries({ queryKey: ["devices"] }),
                ])
              }}
            />
          )}
        </Panel>
      )}
    </div>
  )
}

function PriceRequestQueue({
  requests,
  loading,
  onChanged,
  canReview,
}: {
  requests: DevicePriceRequest[]
  loading: boolean
  onChanged: () => Promise<unknown>
  /** Company reviewers act on requests; a Distributor's view of the queue is read-only. */
  canReview: boolean
}) {
  const approve = useMutation({
    mutationFn: approveDevicePriceRequest,
    onSuccess: async () => {
      toast.success("Price request approved and applied")
      await onChanged()
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't approve request"),
  })
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectDevicePriceRequest(id, reason),
    onSuccess: async () => {
      toast.success("Price request rejected")
      await onChanged()
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't reject request"),
  })
  // Company reviewers work the pending queue; a Distributor sees every request in its
  // network (its own submissions and its Partners'), all read-only — the approve and
  // reject routes stay Company-only.
  const rows = canReview ? requests.filter(request => request.status === "PENDING") : requests
  if (loading || !rows.length) return null
  return (
    <Panel>
      <div className="space-y-3">
        <div>
          <h2 className="font-semibold">{canReview ? "Pending price requests" : "Price requests"}</h2>
          <p className="text-sm text-muted-foreground">
            {canReview
              ? "Review incoming price requests before they reach a kiosk."
              : "Your submissions and your Partners' requests. Only the Company can approve or reject them."}
          </p>
        </div>
        <div className="divide-y divide-border">
          {rows.map(request => (
            <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="text-sm">
                <p className="font-medium">{request.displayName} · {request.deviceId}</p>
                <p className="text-muted-foreground">
                  {request.requesterOrg?.name ?? "Organization"}: {inr.format(request.price)} / replay {inr.format(request.replayPrice)}
                </p>
                {!canReview && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {request.status.replaceAll("_", " ").toLowerCase()}
                    {request.reviewNote ? ` · ${request.reviewNote}` : ""}
                  </p>
                )}
              </div>
              {canReview && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  disabled={approve.isPending || reject.isPending}
                  onClick={() => approve.mutate(request.id)}
                >Approve</button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={approve.isPending || reject.isPending}
                  onClick={() => {
                    const reason = window.prompt("Reason for rejecting this price request:")?.trim()
                    if (reason) reject.mutate({ id: request.id, reason })
                  }}
                >Reject</button>
              </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        online
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-muted-foreground"}`} />
      {online ? "Online" : "Offline"}
    </span>
  )
}

function when(value: string | null): string {
  if (!value) return "—"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function FleetTab({
  devices,
  lastUpdated,
  busy,
  onPickPricing,
}: {
  devices: DeviceView[]
  lastUpdated: string | null
  busy: boolean
  onPickPricing: (deviceId: string) => void
}) {
  if (!devices.length) {
    return (
      <EmptyState
        className="py-14"
        icon={<Cpu size={28} />}
        message="Mothership reports no devices for this account."
      />
    )
  }
  const online = devices.filter(d => d.isOnline).length
  return (
    <div className="space-y-4" aria-busy={busy}>
      <p role="status" className="text-sm text-muted-foreground">
        {devices.length} device{devices.length === 1 ? "" : "s"} · {online} online · reported{" "}
        {when(lastUpdated)}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Device</th>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Last seen</th>
              <th className="px-4 py-3 font-medium">Hardware UUID</th>
              <th className="px-4 py-3 text-right font-medium">Pricing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {devices.map(device => (
              <tr key={device.deviceId} className="hover:bg-muted/40">
                <td className="px-4 py-3 font-mono text-xs font-medium">{device.deviceId}</td>
                <td className="px-4 py-3">
                  <OnlineDot online={device.isOnline} />
                </td>
                <td className="px-4 py-3 text-muted-foreground">{device.location ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {when(device.lastSeen)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                  {device.hardwareUuid ?? "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onPickPricing(device.deviceId)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    View prices
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PricingTab({
  devices,
  selectedDevice,
  onSelectDevice,
  prices,
  canWrite,
  canRequest,
  onSaved,
}: {
  devices: DeviceView[]
  selectedDevice: string | null
  onSelectDevice: (deviceId: string | null) => void
  prices: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchDevicePrices>>>>
  canWrite: boolean
  canRequest: boolean
  onSaved: () => Promise<void>
}) {
  if (!devices.length) {
    return <EmptyState className="py-14" icon={<Gamepad2 size={28} />} message="No devices to price." />
  }
  return (
    <div className="space-y-5">
      <div className="max-w-md">
        <label htmlFor="pricing-device" className="mb-1.5 block text-sm font-medium">
          Device
        </label>
        <select
          id="pricing-device"
          className={inputClass}
          value={selectedDevice ?? ""}
          onChange={event => onSelectDevice(event.target.value || null)}
        >
          <option value="">Select a device…</option>
          {devices.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.deviceId}
              {device.isOnline ? " (online)" : ""}
            </option>
          ))}
        </select>
      </div>

      {!selectedDevice ? (
        <EmptyState
          className="py-10"
          icon={<Gamepad2 size={28} />}
          message="Pick a device to see the price it charges for each game."
        />
      ) : prices.isLoading ? (
        <Skeleton className="h-48" />
      ) : prices.isError ? (
        <ErrorState
          message="Couldn't load prices for this device."
          onRetry={() => prices.refetch()}
        />
      ) : !prices.data?.games.length ? (
        <EmptyState message="This device reports no games." />
      ) : (
        <GamePriceTable
          deviceId={selectedDevice}
          games={prices.data.games}
          isRetired={prices.data.kioskStatus === "RETIRED"}
          eod={prices.data.eod}
          eodMeta={prices.data.eodMeta}
          canWrite={canWrite && prices.data.kioskStatus !== "RETIRED"}
          canRequest={canRequest && prices.data.kioskStatus !== "RETIRED"}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

function GamePriceTable({
  deviceId,
  games,
  isRetired,
  eod,
  eodMeta,
  canWrite,
  canRequest,
  onSaved,
}: {
  deviceId: string
  games: GamePriceView[]
  isRetired: boolean
  eod: Record<string, EodPriceUpdate | null>
  eodMeta: { timezone: string; runTime: string; nextExecutionAt: string }
  canWrite: boolean
  canRequest: boolean
  onSaved: () => Promise<void>
}) {
  const overrides = games.filter(gameHasOverride).length
  const [confirmingReset, setConfirmingReset] = React.useState(false)
  const [confirmingFleetReset, setConfirmingFleetReset] = React.useState(false)
  const [editingGame, setEditingGame] = React.useState<GamePriceView | null>(null)
  const resetMutation = useMutation({
    mutationFn: () => resetDevicePrices(deviceId),
    onSuccess: async result => {
      toast.success(
        result.gamesReset > 0
          ? `Reset overrides for ${result.gamesReset} games on ${deviceId}`
          : `No price overrides to reset on ${deviceId}`
      )
      setConfirmingReset(false)
      await onSaved()
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't reset device prices"),
  })
  const resetAllMutation = useMutation({
    mutationFn: resetAllDevicePrices,
    onSuccess: async result => {
      toast.success(
        result.gamesReset > 0
          ? `Reset ${result.gamesReset} overrides across ${result.devicesReset} kiosks`
          : "No device price overrides to reset",
      )
      setConfirmingFleetReset(false)
      await onSaved()
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't reset fleet device prices"),
  })

  return (
    <div className="space-y-4">
      {isRetired && <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">This kiosk is retired. Game prices cannot be changed or requested.</div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-muted-foreground">
          {games.length} game{games.length === 1 ? "" : "s"} on{" "}
          <span className="font-mono text-xs">{deviceId}</span>
          {overrides > 0 && ` · ${overrides} with a price override`}
        </p>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingReset(true)}
              disabled={resetMutation.isPending || resetAllMutation.isPending || overrides === 0}
              aria-describedby={overrides === 0 ? `${deviceId}-no-overrides` : undefined}
              className={buttonClass}
            >
              Reset device overrides
            </button>
            <button
              type="button"
              onClick={() => setConfirmingFleetReset(true)}
              disabled={resetMutation.isPending || resetAllMutation.isPending}
              className={buttonClass}
            >
              {resetAllMutation.isPending ? "Resetting all…" : "Reset all kiosk overrides"}
            </button>
            {overrides === 0 && (
              <span id={`${deviceId}-no-overrides`} className="text-xs text-muted-foreground">
                This device has no price overrides to reset.
              </span>
            )}
          </div>
        )}
      </div>
      {(canWrite || canRequest) && (
        <p role="status" className="text-sm text-muted-foreground">
          {canRequest
            ? "Price changes are sent to the Company master admin for approval."
            : `Device changes are scheduled for midnight (${eodMeta.timezone}) and verified after application.`}
        </p>
      )}
      {(canWrite || canRequest) && <p role="status" className="text-xs text-muted-foreground">Next EOD run: {new Date(eodMeta.nextExecutionAt).toLocaleString("en-IN", { timeZone: eodMeta.timezone })}</p>}
      {confirmingReset && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Reset price overrides on ${deviceId}`}
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <p className="text-sm">
            Reset all {overrides} game price override{overrides === 1 ? "" : "s"} on{" "}
            <span className="font-mono text-xs">{deviceId}</span> to their catalog prices?
            Other devices and catalog prices will not be changed.
          </p>
          {resetMutation.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {resetMutation.error instanceof Error
                ? resetMutation.error.message
                : "Couldn't reset device prices"}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingReset(false)
                resetMutation.reset()
              }}
              disabled={resetMutation.isPending}
              className={buttonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            >
              {resetMutation.isPending ? "Resetting…" : "Confirm reset"}
            </button>
          </div>
        </div>
      )}
      {confirmingFleetReset && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Reset price overrides on every kiosk"
          className="rounded-xl border border-destructive/40 bg-destructive/10 p-4"
        >
          <p className="text-sm">
            Reset every game price override on <span className="font-medium">all kiosks</span> to its
            catalog price? Catalog prices themselves do not change. This touches the whole fleet
            and cannot be undone from here.
          </p>
          {resetAllMutation.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {resetAllMutation.error instanceof Error
                ? resetAllMutation.error.message
                : "Couldn't reset fleet device prices"}
            </p>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingFleetReset(false)
                resetAllMutation.reset()
              }}
              disabled={resetAllMutation.isPending}
              className={buttonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => resetAllMutation.mutate()}
              disabled={resetAllMutation.isPending}
              className="rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
            >
              {resetAllMutation.isPending ? "Resetting all…" : "Confirm fleet reset"}
            </button>
          </div>
        </div>
      )}
      {resetAllMutation.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Resetting overrides across the fleet. Every kiosk is snapshotted before and after the
          write, so this can take a minute on a large fleet.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Game</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Replay price</th>
              <th className="px-4 py-3 font-medium">Source</th>
              <th className="px-4 py-3 font-medium">Update Price</th>
              {(canWrite || canRequest) && <th className="px-4 py-3 text-right font-medium">Change</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {games.map(game => (
              <React.Fragment key={game.gameId}>
                <tr className="hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {game.iconUrl || game.imageUrl ? (
                        <img src={game.iconUrl || game.imageUrl || undefined} alt="" className="h-9 w-9 rounded-lg object-cover" loading="lazy" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true"><Gamepad2 size={17} /></span>
                      )}
                      <div>
                        <p className="font-medium">{game.displayName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{game.gameId}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{inr.format(game.effectivePrice)}</td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {inr.format(game.effectiveReplayPrice)}
                  </td>
                  <td className="px-4 py-3">
                    {gameHasOverride(game) ? (
                      <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                        Override
                      </span>
                    ) : gameDiffersFromCatalog(game) ? (
                      <span
                        title={`Catalog ${inr.format(game.basePrice)} / replay ${inr.format(game.baseReplayPrice)} - this kiosk has not picked it up`}
                        className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                      >
                        Catalog differs
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">Default</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{eod[game.gameId] ? <EodStatus update={eod[game.gameId]!} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                  {(canWrite || canRequest) && (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        aria-label={`Change ${game.displayName} price on ${deviceId}`}
                        onClick={() => setEditingGame(game)}
                        disabled={resetMutation.isPending}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        Change price
                      </button>
                    </td>
                  )}
                </tr>
                {editingGame?.gameId === game.gameId && (
                  <tr>
                    <td colSpan={canWrite || canRequest ? 6 : 5} className="p-3">
                      <DeviceGamePriceEditor
                        deviceId={deviceId}
                        game={game}
                        scheduledUpdate={eod[game.gameId] ?? null}
                        eodMeta={eodMeta}
                        requestOnly={canRequest && !canWrite}
                        onCancel={() => setEditingGame(null)}
                        onSaved={async () => {
                          setEditingGame(null)
                          await onSaved()
                        }}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DeviceGamePriceEditor({
  deviceId,
  game,
  scheduledUpdate,
  eodMeta,
  requestOnly,
  onCancel,
  onSaved,
}: {
  deviceId: string
  game: GamePriceView
  scheduledUpdate: EodPriceUpdate | null
  eodMeta: { timezone: string; runTime: string; nextExecutionAt: string }
  requestOnly: boolean
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const [price, setPrice] = React.useState(String(scheduledUpdate?.price ?? game.effectivePrice))
  const [replayPrice, setReplayPrice] = React.useState(String(scheduledUpdate?.replayPrice ?? game.effectiveReplayPrice))
  const [scheduledDate, setScheduledDate] = React.useState(scheduledUpdate?.businessDate ?? defaultScheduledDate())
  const [confirmingCatalog, setConfirmingCatalog] = React.useState(false)
  const requestMutation = useMutation({
    mutationFn: () => requestDeviceGamePrice(deviceId, game.gameId, {
      price: Number(price),
      replay_price: Number(replayPrice),
    }),
    onSuccess: async () => {
      toast.success("Price change request sent to the reviewing administrator")
      await onSaved()
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't send price request"),
  })

  const priceValid =
    price.trim() !== "" &&
    replayPrice.trim() !== "" &&
    Number.isFinite(Number(price)) &&
    Number.isFinite(Number(replayPrice)) &&
    Number(price) >= 0 &&
    Number(replayPrice) >= 0 &&
    Number(price) <= 100000 &&
    Number(replayPrice) <= 100000

  // Device scope is the default: it changes only this kiosk and is verified against the
  // catalog and every other device. The catalog scope is a separate action, sent only when
  // the operator confirms it; the form never switches between the two on its own.
  const deviceMutation = useMutation({
    mutationFn: () =>
      setDeviceGamePrice(deviceId, game.gameId, {
        price: Number(price),
        replay_price: Number(replayPrice),
        scheduled_date: scheduledDate,
        scope: "DEVICE",
      }),
    onSuccess: async result => {
      toast.success(
        result.status === "PENDING"
          ? `${result.displayName} scheduled for ${result.scheduledDate ?? scheduledDate} at the EOD run (${eodMeta.runTime} ${eodMeta.timezone}) on ${deviceId}: ${inr.format(result.price)} / ${inr.format(result.replayPrice)}`
          : `${result.displayName} updated on ${deviceId} (this device only): ${inr.format(result.price)} / ${inr.format(result.replayPrice)}`
      )
      await onSaved()
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't update device price"),
  })
  const catalogMutation = useMutation({
    mutationFn: () =>
      setDeviceGamePrice(deviceId, game.gameId, {
        price: Number(price),
        replay_price: Number(replayPrice),
        scope: "GAME_CATALOG",
      }),
    onSuccess: async result => {
      toast.success(
        `${result.displayName} applied to all kiosks through the catalog: ${inr.format(result.price)} / ${inr.format(result.replayPrice)}`
      )
      await onSaved()
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't update the catalog price"),
  })

  const applyNowMutation = useMutation({
    mutationFn: () => setDeviceGamePrice(deviceId, game.gameId, {
      price: Number(price), replay_price: Number(replayPrice), scope: "DEVICE", apply_now: true,
    }),
    onSuccess: async result => {
      toast.success(`${result.displayName} applied live on ${deviceId}: ${inr.format(result.price)} / replay ${inr.format(result.replayPrice)} (verified)`)
      await onSaved()
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't apply the device price"),
  })

  const pending = requestMutation.isPending || deviceMutation.isPending || catalogMutation.isPending || applyNowMutation.isPending
  const activeError = requestMutation.error ?? catalogMutation.error ?? deviceMutation.error ?? applyNowMutation.error

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Change ${game.displayName} price on ${deviceId}`}
      className="rounded-xl border border-primary/30 bg-muted/30 p-4"
    >
      <div className="mb-3">
        <h3 className="font-medium">Change game price</h3>
        <p className="text-sm text-muted-foreground">
          {requestOnly
            ? "Your request will be sent to the Company master admin for approval."
            : <>Current live price: <span className="font-medium text-foreground">{inr.format(game.effectivePrice)}</span> / replay {inr.format(game.effectiveReplayPrice)}. The price below is the scheduled EOD price; it will apply to only <span className="font-mono text-xs">{deviceId}</span> on its scheduled date at the EOD run ({eodMeta.runTime} {eodMeta.timezone}).</>}
        </p>
        {!requestOnly && <p role="note" className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"><strong>Apply now</strong> changes this device immediately. <strong>Scheduled</strong> applies it on the selected calendar date at the EOD run ({eodMeta.runTime} {eodMeta.timezone}).</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span>Price (INR)</span>
          <input
            type="number"
            min="0"
            max="100000"
            step="any"
            required
            className={inputClass}
            value={price}
            onChange={event => setPrice(event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span>Replay price (INR)</span>
          <input
            type="number"
            min="0"
            max="100000"
            step="any"
            required
            className={inputClass}
            value={replayPrice}
            onChange={event => setReplayPrice(event.target.value)}
          />
        </label>
      </div>
      {!requestOnly && (
        <label className="mt-4 block space-y-1.5 text-sm">
          <span>Scheduled date</span>
          <input
            type="date"
            required
            className={inputClass}
            min={localDateKey(new Date())}
            value={scheduledDate}
            onChange={event => setScheduledDate(event.target.value)}
          />
          <span className="block text-xs text-muted-foreground">
            Applied on the selected date at the EOD run ({eodMeta.runTime} {eodMeta.timezone}).
          </span>
        </label>
      )}
      {(requestMutation.isError || catalogMutation.isError || deviceMutation.isError || applyNowMutation.isError) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {activeError instanceof Error
            ? activeError.message
            : "Couldn't verify the price update"}
        </p>
      )}
      {requestOnly ? (
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onCancel} disabled={pending}>Cancel</button>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            onClick={() => requestMutation.mutate()}
            disabled={pending || !priceValid}
          >
            {requestMutation.isPending ? "Sending…" : "Send for approval"}
          </button>
        </div>
      ) : confirmingCatalog ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label={`Apply ${game.displayName} to all kiosks`}
          className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <p className="text-sm">
            Apply {game.displayName} to all kiosks? This sets the game&apos;s catalog price to{" "}
            {inr.format(Number(price))} first play / {inr.format(Number(replayPrice))} replay,
            and every kiosk offering it picks that up. This will apply to all dispatched kiosks
            across the fleet, wherever they are operating. It cannot be limited to{" "}
            <span className="font-mono text-xs">{deviceId}</span>.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingCatalog(false)
                catalogMutation.reset()
              }}
              disabled={pending}
              className={buttonClass}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              onClick={() => catalogMutation.mutate()}
              disabled={pending || !priceValid}
            >
              {catalogMutation.isPending ? "Applying…" : "Apply to all kiosks"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              deviceMutation.reset()
              setConfirmingCatalog(true)
            }}
            disabled={pending || !priceValid}
          >
            Apply to all kiosks
          </button>
          <button type="button" className={buttonClass} onClick={() => deviceMutation.mutate()} disabled={pending || !priceValid}>
            {deviceMutation.isPending ? "Scheduling…" : "Scheduled"}
          </button>
          <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" onClick={() => applyNowMutation.mutate()} disabled={pending || !priceValid}>
            {applyNowMutation.isPending ? "Applying…" : "Apply now"}
          </button>
        </div>
      )}
    </div>
  )
}
