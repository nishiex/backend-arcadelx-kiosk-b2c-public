"use client"

import React from "react"
import * as RadixDialog from "@radix-ui/react-dialog"

export function Dialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  )
}

export const DialogTrigger = RadixDialog.Trigger
export const DialogPortal = RadixDialog.Portal
export const DialogOverlay = (props: any) => <RadixDialog.Overlay className="fixed inset-0 bg-black/40" {...props} />
export function DialogContent({ children, ...props }: any) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-black/40" />
      <RadixDialog.Content className="fixed left-1/2 top-1/2 max-w-lg w-[95%] -translate-x-1/2 -translate-y-1/2 bg-card border border-border rounded-md p-4 shadow-lg" {...props}>
        {children}
        <RadixDialog.Close className="absolute right-3 top-3">Close</RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
