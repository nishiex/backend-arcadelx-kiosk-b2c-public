"use client"

import React from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { fetchUnpairedKiosks, pairKioskDevice } from "@/lib/backend-api"
import { fetchDevices } from "@/lib/devices-api"

const buttonClass =
  "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

export default function MothershipPairingPanel({ onPaired }: { onPaired?: () => Promise<unknown> }) {
  const [machineCode, setMachineCode] = React.useState("")
  const [externalDeviceId, setExternalDeviceId] = React.useState("")
  const devices = useQuery({ queryKey: ["devices", "pairing"], queryFn: fetchDevices, staleTime: 0 })
  const unpaired = useQuery({
    queryKey: ["unpaired-kiosks"],
    queryFn: fetchUnpairedKiosks,
    staleTime: 0,
  })
  const pair = useMutation({
    mutationFn: () => pairKioskDevice(machineCode, externalDeviceId.trim()),
    onSuccess: async () => {
      toast.success(`Device paired to ${machineCode}`)
      setMachineCode("")
      setExternalDeviceId("")
      await unpaired.refetch()
      await onPaired?.()
    },
    onError: (error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn’t pair device"),
  })

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="mothership-pairing-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="mothership-pairing-title" className="font-semibold">Pair Mothership device</h2>
          <p className="mt-1 text-sm text-muted-foreground">Link a business machine code to the hardware UUID reported by Mothership.</p>
        </div>
        <button type="button" className={buttonClass} onClick={() => void unpaired.refetch()} disabled={unpaired.isFetching}>Refresh list</button>
      </div>
      {unpaired.isError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">Couldn&apos;t load unpaired kiosks.</p>
      ) : (
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); if (machineCode && externalDeviceId.trim()) pair.mutate() }}>
          <select aria-label="Machine code" className={inputClass} value={machineCode} onChange={event => setMachineCode(event.target.value)} disabled={pair.isPending || unpaired.isLoading}>
            <option value="">Select machine code…</option>
            {(unpaired.data ?? []).map(kiosk => <option key={kiosk.id} value={kiosk.machineCode}>{kiosk.machineCode}{kiosk.model ? ` · ${kiosk.model}` : ""}</option>)}
          </select>
          <select aria-label="Mothership device" className={inputClass} value={externalDeviceId} onChange={event => setExternalDeviceId(event.target.value)} disabled={pair.isPending || devices.isLoading}>
            <option value="">Select live device UUID…</option>
            {(devices.data?.devices ?? []).map(device => <option key={device.deviceId} value={device.hardwareUuid ?? device.deviceId}>{device.deviceId}{device.hardwareUuid ? ` · ${device.hardwareUuid}` : ""}{device.isOnline ? " · Online" : " · Offline"}</option>)}
          </select>
          <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!machineCode || !externalDeviceId.trim() || pair.isPending || unpaired.isLoading}>
            {pair.isPending && <Loader2 size={16} className="animate-spin" />}
            {pair.isPending ? "Pairing…" : "Pair device"}
          </button>
        </form>
      )}
    </section>
  )
}
