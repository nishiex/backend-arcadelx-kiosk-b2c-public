"use client"

import React from "react"
import * as RadixDialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, X, Loader2 } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { registerKiosk, KIOSK_STATUSES, type RegisterKioskInput } from "@/lib/backend-api"

const MODELS = [
  "Arcade-LX B2C",
  "Arcade-LX B2B",
  "Arcade-LX Kids",
  "Arcade-LX Healthcare",
  "Arcade-LX Mini",
  "Arcade-LX Pro",
]

const hex = (n: number) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("")
const todayISO = () => new Date().toISOString().slice(0, 10)
const plusYearsISO = (y: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() + y)
  return d.toISOString().slice(0, 10)
}
const suggestSerial = () => `SN-KSK-${hex(6).toUpperCase()}`

type Form = {
  model: string
  serialNumber: string
  hardwareFingerprint: string
  firmwareVersion: string
  manufactureDate: string
  warrantyExpiry: string
  location: string
  status: string
}

function freshDefaults(): Form {
  return {
    model: MODELS[0]!,
    serialNumber: suggestSerial(),
    hardwareFingerprint: hex(10),
    firmwareVersion: "v1.0.0",
    manufactureDate: todayISO(),
    warrantyExpiry: plusYearsISO(2),
    location: "",
    status: "AVAILABLE",
  }
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  )
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

export default function AddMachineDialog() {
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Form>(freshDefaults)
  const queryClient = useQueryClient()

  // Reset to fresh suggestions each time the dialog opens.
  React.useEffect(() => {
    if (open) setForm(freshDefaults())
  }, [open])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const mutation = useMutation({
    mutationFn: () => {
      const payload: RegisterKioskInput = {
        model: form.model,
        serialNumber: form.serialNumber || undefined,
        hardwareFingerprint: form.hardwareFingerprint || undefined,
        firmwareVersion: form.firmwareVersion || undefined,
        manufactureDate: form.manufactureDate || undefined,
        warrantyExpiry: form.warrantyExpiry || undefined,
        location: form.location || undefined,
        status: (form.status as RegisterKioskInput["status"]) || undefined,
      }
      return registerKiosk(payload)
    },
    onSuccess: (data) => {
      toast.success(`Registered ${data.kiosk.machineCode}`)
      queryClient.invalidateQueries({ queryKey: ["kiosks"] })
      queryClient.invalidateQueries({ queryKey: ["inventorySummary"] })
      setOpen(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to register machine"),
  })

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>
        <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
          <Plus size={16} /> Add Machine
        </button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95%] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
          <div className="mb-5 flex items-center justify-between">
            <RadixDialog.Title className="text-lg font-semibold">Register Machine</RadixDialog.Title>
            <RadixDialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X size={18} />
            </RadixDialog.Close>
          </div>

          {/* Hardware Details */}
          <h3 className="mb-3 text-sm font-semibold">Hardware Details</h3>
          <div className="mb-4 flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <p className="text-xs text-muted-foreground">Auto-generated Machine Code</p>
              <p className="mt-0.5 font-mono text-lg font-bold tracking-tight">Assigned on save</p>
            </div>
            <p className="max-w-[220px] text-right text-xs text-muted-foreground">
              The code is generated server-side and guaranteed unique.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Machine Model">
              <select className={inputCls} value={form.model} onChange={(e) => set("model", e.target.value)}>
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Serial Number">
              <input className={inputCls} value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} placeholder="SN-KSK-XXXXXX" />
            </Field>
            <Field label="Hardware Fingerprint">
              <input className={inputCls} value={form.hardwareFingerprint} onChange={(e) => set("hardwareFingerprint", e.target.value)} />
            </Field>
            <Field label="Firmware Version">
              <input className={inputCls} value={form.firmwareVersion} onChange={(e) => set("firmwareVersion", e.target.value)} placeholder="v1.0.0" />
            </Field>
            <Field label="Manufacture Date">
              <input type="date" className={inputCls} value={form.manufactureDate} onChange={(e) => set("manufactureDate", e.target.value)} />
            </Field>
            <Field label="Warranty Expiry">
              <input type="date" className={inputCls} value={form.warrantyExpiry} onChange={(e) => set("warrantyExpiry", e.target.value)} />
            </Field>
          </div>

          {/* Initial Setup */}
          <h3 className="mb-3 mt-6 border-t border-border pt-6 text-sm font-semibold">Initial Setup</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Base Location (City)">
              <input className={inputCls} value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Mumbai" />
            </Field>
            <Field label="Initial Status">
              <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value)}>
                {KIOSK_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
            <RadixDialog.Close className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
              Cancel
            </RadixDialog.Close>
            <button
              onClick={() => mutation.mutate()}
              disabled={!form.model.trim() || mutation.isPending}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
              Register Machine
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
