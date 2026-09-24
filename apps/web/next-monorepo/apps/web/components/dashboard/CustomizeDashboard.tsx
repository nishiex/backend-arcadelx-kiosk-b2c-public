"use client"

import * as RadixDialog from "@radix-ui/react-dialog"
import React from "react"
import { useForm } from "react-hook-form"
import { useDashboard } from "@/components/dashboard/DashboardProvider"

export default function CustomizeDashboard({ open, onOpenChange }: { open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const { all, visible, toggleVisible, setOrder, order, reset } = useDashboard()
  const { register, handleSubmit } = useForm()

  const onSubmit = (values: any) => {
    // save is handled automatically by provider; just close
    onOpenChange?.(false)
  }

  const toggle = (id: string) => {
    toggleVisible(id)
  }

  const handleReset = () => {
    reset()
    onOpenChange?.(false)
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/40" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 max-w-lg w-[95%] -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-md p-4 shadow-lg">
          <h3 className="text-lg font-semibold mb-2">Customize Dashboard</h3>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
            <div className="grid grid-cols-1 gap-2">
              {all.map((w) => (
                <label key={w.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={!!visible[w.id]} onChange={() => toggle(w.id)} />
                  <span className="ml-2">{w.title}</span>
                </label>
              ))}
            </div>

            <div className="text-sm text-muted-foreground">Order (drag to reorder not available in static mode) — current order: {order.join(', ')}</div>

            <div className="flex items-center justify-between">
              <button type="button" onClick={handleReset} className="px-3 py-1 rounded-md bg-muted">Reset</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => onOpenChange?.(false)} className="px-3 py-1 rounded-md bg-muted">Cancel</button>
                <button type="submit" className="px-3 py-1 rounded-md bg-primary text-primary-foreground">Save</button>
              </div>
            </div>
          </form>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
