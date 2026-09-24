"use client"

import React from "react"
import * as RadixTooltip from "@radix-ui/react-tooltip"

export function Tooltip({ children, content }: { children: React.ReactNode; content: React.ReactNode }) {
  return (
    <RadixTooltip.Provider>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Content className="bg-card border border-border rounded-md p-2 text-xs text-muted-foreground">{content}</RadixTooltip.Content>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
