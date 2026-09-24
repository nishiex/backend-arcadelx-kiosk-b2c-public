"use client"

import React from "react"
import * as RadixDropdown from "@radix-ui/react-dropdown-menu"

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  return <RadixDropdown.Root>{children}</RadixDropdown.Root>
}

export const DropdownMenuTrigger = RadixDropdown.Trigger
export const DropdownMenuContent = (props: any) => <RadixDropdown.Content className="bg-card border border-border rounded-md p-2" {...props} />
export const DropdownMenuItem = RadixDropdown.Item
