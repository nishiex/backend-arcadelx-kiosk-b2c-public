"use client"

import React from "react"
import * as RadixDialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, X, Loader2 } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { createSupportTicket, SUPPORT_PRIORITIES, type CreateSupportTicketInput } from "@/lib/backend-api"

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

export default function NewTicketDialog() {
  const [open, setOpen] = React.useState(false)
  const [subject, setSubject] = React.useState("")
  const [category, setCategory] = React.useState("")
  const [priority, setPriority] = React.useState<CreateSupportTicketInput["priority"]>("MEDIUM")
  const [description, setDescription] = React.useState("")
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (open) {
      setSubject(""); setCategory(""); setPriority("MEDIUM"); setDescription("")
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () =>
      createSupportTicket({ subject, description, category: category || undefined, priority }),
    onSuccess: () => {
      toast.success("Ticket submitted")
      queryClient.invalidateQueries({ queryKey: ["supportTickets"] })
      setOpen(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to submit ticket"),
  })

  const invalid = subject.trim().length < 3 || description.trim().length < 5

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>
        <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
          <Plus size={16} /> New Ticket
        </button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95%] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl">
          <div className="mb-5 flex items-center justify-between">
            <RadixDialog.Title className="text-lg font-semibold">New support ticket</RadixDialog.Title>
            <RadixDialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X size={18} />
            </RadixDialog.Close>
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Subject</label>
              <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary of the issue" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Category</label>
                <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Hardware, Billing" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Priority</label>
                <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as CreateSupportTicketInput["priority"])}>
                  {SUPPORT_PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Description</label>
              <textarea
                className={cn(inputCls, "min-h-28 resize-y")}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what's happening, steps to reproduce, affected machines…"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
            <RadixDialog.Close className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
              Cancel
            </RadixDialog.Close>
            <button
              onClick={() => mutation.mutate()}
              disabled={invalid || mutation.isPending}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
              Submit ticket
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
