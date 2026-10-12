"use client"

import React, { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Cpu, Gamepad2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { useMe } from "@/hooks/useMe"
import {
  fetchDevicePrices,
  fetchDevices,
  setDeviceGamePrice,
  type DeviceView,
  type GamePriceView,
} from "@/lib/devices-api"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"

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

const TABS = [
  { id: "fleet", label: "Fleet" },
  { id: "pricing", label: "Game pricing" },
] as const

type TabId = (typeof TABS)[number]["id"]

/**
 * Mothership device fleet and per-device game pricing.
 *
 * Two tabs rather than one screen: "Fleet" reports hardware state (Mothership's view of
 * what exists), while "Game pricing" is per-device configuration. They answer different
 * questions about the same device, and mixing them made the table unreadable.
 *
 * Prices are owned by Mothership, so nothing here is optimistic: every write refetches.
 * A price change alters what a deployed kiosk charges a player, so it is confirmed first
 * and the edit control is shown only to COMPANY OWNER/ADMIN, matching the API route.
 */
export default function DevicesScreen() {
  const { me, isLoading, canViewDevices, canManageDevicePrices } = useMe()
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
  const prices = useQuery({
    queryKey: ["device-prices", selectedDevice, ...scope],
    queryFn: () => fetchDevicePrices(selectedDevice!),
    enabled: !!selectedDevice,
    staleTime: 15_000,
    retry: 1,
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
              <th className="px-4 py-3 font-medium">Kiosk no.</th>
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
                <td className="px-4 py-3 tabular-nums">{device.kioskNumber ?? "—"}</td>
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
  onSaved,
}: {
  devices: DeviceView[]
  selectedDevice: string | null
  onSelectDevice: (deviceId: string | null) => void
  prices: ReturnType<typeof useQuery<{ deviceId: string; games: GamePriceView[] }>>
  canWrite: boolean
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
          canWrite={canWrite}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

function GamePriceTable({
  deviceId,
  games,
  canWrite,
  onSaved,
}: {
  deviceId: string
  games: GamePriceView[]
  canWrite: boolean
  onSaved: () => Promise<void>
}) {
  const overrides = games.filter(game => game.hasOverride).length
  const [editing, setEditing] = React.useState<GamePriceView | null>(null)

  return (
    <div className="space-y-4">
      <p role="status" className="text-sm text-muted-foreground">
        {games.length} game{games.length === 1 ? "" : "s"} on{" "}
        <span className="font-mono text-xs">{deviceId}</span>
        {overrides > 0 && ` · ${overrides} with a price override`}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">Game</th>
              <th className="px-4 py-3 font-medium">Price</th>
              <th className="px-4 py-3 font-medium">Replay price</th>
              <th className="px-4 py-3 font-medium">Source</th>
              {canWrite && <th className="px-4 py-3 text-right font-medium">Change</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {games.map(game => (
              <tr key={game.gameId} className="hover:bg-muted/40">
                <td className="px-4 py-3">
                  <p className="font-medium">{game.displayName}</p>
                  <p className="font-mono text-xs text-muted-foreground">{game.gameId}</p>
                </td>
                <td className="px-4 py-3 tabular-nums">{inr.format(game.effectivePrice)}</td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {inr.format(game.effectiveReplayPrice)}
                </td>
                <td className="px-4 py-3">
                  {game.hasOverride ? (
                    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                      Override
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Default</span>
                  )}
                </td>
                {canWrite && (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      aria-label={`Change price for ${game.displayName} on ${deviceId}`}
                      onClick={() => setEditing(game)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      Change price
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <PriceDialog
          deviceId={deviceId}
          game={editing}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

/**
 * Price editor for one game on one device.
 *
 * The change is confirmed explicitly because it alters what a physically deployed kiosk
 * charges. The entered numbers are echoed back in the confirmation so the operator
 * confirms actual values rather than "the form".
 */
function PriceDialog({
  deviceId,
  game,
  onClose,
  onSaved,
}: {
  deviceId: string
  game: GamePriceView
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [price, setPrice] = React.useState(String(game.effectivePrice))
  const [replay, setReplay] = React.useState(String(game.effectiveReplayPrice))
  const [confirming, setConfirming] = React.useState(false)

  const priceValue = Number(price)
  const replayValue = Number(replay)
  const priceValid = price.trim() !== "" && Number.isFinite(priceValue) && priceValue >= 0
  const replayValid = replay.trim() !== "" && Number.isFinite(replayValue) && replayValue >= 0

  const mutation = useMutation({
    mutationFn: () =>
      setDeviceGamePrice(deviceId, game.gameId, priceValue, replayValid ? replayValue : undefined),
    onSuccess: async () => {
      toast.success(`${game.displayName} price updated`)
      await onSaved()
      onClose()
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : "Couldn't update the price"),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Change price for ${game.displayName}`}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl"
      >
        <h2 className="text-lg font-semibold">Change price?</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {deviceId} · {game.gameId}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          This changes what <span className="font-medium">{game.displayName}</span> charges on live
          hardware.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="price" className="mb-1.5 block text-sm font-medium">
              Price (₹)
            </label>
            <input
              id="price"
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={price}
              disabled={mutation.isPending}
              onChange={event => setPrice(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="replay" className="mb-1.5 block text-sm font-medium">
              Replay price (₹)
            </label>
            <input
              id="replay"
              type="number"
              min={0}
              step="0.01"
              className={inputClass}
              value={replay}
              disabled={mutation.isPending}
              onChange={event => setReplay(event.target.value)}
            />
          </div>
        </div>

        {confirming && (
          <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            Confirm: set <span className="font-medium">{game.displayName}</span> on{" "}
            <span className="font-mono text-xs">{deviceId}</span> to{" "}
            <span className="font-semibold">{inr.format(priceValue)}</span>
            {replayValid && (
              <>
                {" "}
                and replay to <span className="font-semibold">{inr.format(replayValue)}</span>
              </>
            )}
            .
          </p>
        )}

        {mutation.isError && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {(mutation.error as Error).message}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          {!confirming ? (
            <button
              type="button"
              disabled={!priceValid || !replayValid}
              onClick={() => setConfirming(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              Review change
            </button>
          ) : (
            <button
              type="button"
              disabled={mutation.isPending || !priceValid || !replayValid}
              onClick={() => mutation.mutate()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {mutation.isPending ? "Saving…" : "Confirm change"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
