"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Full-viewport dialog for large, form-heavy workflows.
 *
 * The header and footer stay fixed; only the body scrolls, so the primary action is
 * always reachable on a phone. Safe-area insets are applied to the outer content so
 * notches and home indicators never cover controls.
 */
export function FullScreenDialog({
  open,
  onOpenChange,
  title,
  description,
  trigger,
  footer,
  children,
  className,
  bodyClassName,
  contentClassName,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  trigger?: React.ReactNode
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  contentClassName?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={description ? undefined : undefined}
          className={cn(
            "fixed inset-0 z-50 flex h-[100dvh] max-h-none w-screen max-w-none flex-col overflow-hidden rounded-none border-0 bg-background p-0 text-foreground shadow-none outline-none",
            className,
          )}
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label="Close dialog"
              className="-mr-1 shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X size={18} />
            </Dialog.Close>
          </header>

          <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-6", bodyClassName)}>
            <div className={cn("mx-auto w-full max-w-5xl", contentClassName)}>{children}</div>
          </div>

          {footer ? (
            <footer className="shrink-0 border-t border-border bg-background px-4 py-3 sm:px-6">
              <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-end gap-2">{footer}</div>
            </footer>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
