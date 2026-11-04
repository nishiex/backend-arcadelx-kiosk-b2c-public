"use client"

import React from "react"
import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { useForm } from "react-hook-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { cn } from "@workspace/ui/lib/utils"
import { useMe } from "@/hooks/useMe"
import { createPartner, retryOrganizationCredentials, type CreatePartnerInput } from "@/lib/backend-api"
import { STATE_NAMES, citiesForState } from "@/lib/india-locations"

const fields = [
  { name: "orgName", label: "Business name", min: 2, max: 100 },
  { name: "ownerName", label: "Contact person name", min: 2, max: 100 },
  { name: "ownerEmail", label: "Email address", min: 1, max: 254, type: "email" },
  { name: "address", label: "Street address", min: 5, max: 300 },
  { name: "state", label: "State", min: 2, max: 100 },
  { name: "city", label: "City", min: 2, max: 100 },
] as const

function PartnerForm({ modal }: { modal: boolean }) {
  const { canRegisterPartners } = useMe()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const busy = React.useRef(false)
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<CreatePartnerInput>()
  const selectedState = watch("state")
  const cityOptions = React.useMemo(() => citiesForState(selectedState), [selectedState])
  const create = useMutation({
    mutationFn: createPartner,
    onSuccess: () => {
      toast.success("Partner registered")
      void queryClient.invalidateQueries({ queryKey: ["partners"] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const retry = useMutation({
    mutationFn: retryOrganizationCredentials,
    onSuccess: result => toast.success(result.credentialsEmailSent ? "Credentials email sent" : "Email delivery is still pending"),
    onError: (error: Error) => toast.error(error.message),
  })
  const result = create.data
  const sent = result?.credentialsEmailSent || retry.data?.credentialsEmailSent
  const submit = async (values: CreatePartnerInput) => {
    if (!canRegisterPartners || busy.current || result) return
    busy.current = true
    try { await create.mutateAsync(values) } catch { /* Shown inline below. */ }
    finally { busy.current = false }
  }

  const content = (
    <div className="mx-auto max-w-3xl space-y-5">
      {!modal && <>
        <Link href="/partners" className="text-sm text-muted-foreground hover:text-foreground">Back to partners</Link>
        <h1 className="text-2xl font-semibold">Register Partner</h1>
      </>}
      {result ? (
        <div role="status" className="space-y-4 rounded-xl border border-border bg-card p-6">
          <p className="font-semibold">Partner “{result.organization.name}” registered.</p>
          <p>{sent ? `Login credentials emailed to ${result.owner.email}.` : `The account was created, but login credentials have not been emailed to ${result.owner.email} yet.`}</p>
          {!sent && <button type="button" disabled={retry.isPending} onClick={() => retry.mutate(result.organization.id)} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{retry.isPending ? "Sending…" : "Retry credentials email"}</button>}
          {retry.data && !retry.data.credentialsEmailSent && <p>Email delivery is still pending. Please try again later.</p>}
          {retry.error && <p role="alert" className="text-destructive">{retry.error.message}</p>}
        </div>
      ) : (
        <form onSubmit={event => { void handleSubmit(submit)(event) }} className="space-y-5 rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">We’ll email the partner a generated password so they can sign in. The Company Master Admin can register Partners directly.</p>
          <fieldset disabled={create.isPending} className="grid gap-4 sm:grid-cols-2">
            {fields.map(field => (
              <div key={field.name}>
                <label htmlFor={field.name} className="mb-1.5 block text-sm font-medium">
                  {field.label}<span className="ml-1 text-destructive" aria-hidden="true">*</span>
                </label>
                {field.name === "state" ? (
                  <select
                    id="state"
                    defaultValue=""
                    aria-invalid={!!errors.state}
                    aria-describedby={errors.state ? "state-error" : undefined}
                    className={cn("w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm", !selectedState && "text-muted-foreground")}
                    {...register("state", {
                      required: "State is required",
                      onChange: () => setValue("city", ""),
                    })}
                  >
                    <option value="" disabled>Select state</option>
                    {STATE_NAMES.map(state => <option key={state} value={state}>{state}</option>)}
                  </select>
                ) : field.name === "city" ? (
                  <select
                    id="city"
                    defaultValue=""
                    disabled={!selectedState}
                    aria-invalid={!!errors.city}
                    aria-describedby={errors.city ? "city-error" : undefined}
                    className={cn("w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm", !selectedState && "cursor-not-allowed opacity-60")}
                    {...register("city", { required: "City is required" })}
                  >
                    <option value="" disabled>{selectedState ? "Select city" : "Select a state first"}</option>
                    {cityOptions.map(city => <option key={city} value={city}>{city}</option>)}
                  </select>
                ) : (
                  <input id={field.name} type={"type" in field ? field.type : "text"} maxLength={field.max} aria-invalid={!!errors[field.name]} aria-describedby={errors[field.name] ? `${field.name}-error` : undefined} className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" {...register(field.name, {
                    required: `${field.label} is required`, setValueAs: (value: string) => value.trim(),
                    minLength: { value: field.min, message: `Enter at least ${field.min} characters` },
                    maxLength: { value: field.max, message: `Enter at most ${field.max} characters` },
                  })} />
                )}
                {errors[field.name] && <p id={`${field.name}-error`} className="mt-1 text-xs text-destructive">{errors[field.name]?.message}</p>}
              </div>
            ))}
            <div>
              <label htmlFor="ownerContact" className="mb-1.5 block text-sm font-medium">Owner contact number<span className="ml-1 text-destructive" aria-hidden="true">*</span></label>
              <input id="ownerContact" type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} aria-invalid={!!errors.ownerContact} aria-describedby={errors.ownerContact ? "ownerContact-error" : undefined}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" {...register("ownerContact", {
                  required: "Owner contact is required", setValueAs: (value: string) => value.trim(),
                  pattern: { value: /^\d{10}$/, message: "Enter a 10-digit contact number" },
                })} />
              {errors.ownerContact && <p id="ownerContact-error" className="mt-1 text-xs text-destructive">{errors.ownerContact.message}</p>}
            </div>
            <div>
              <label htmlFor="pincode" className="mb-1.5 block text-sm font-medium">Postal code<span className="ml-1 text-destructive" aria-hidden="true">*</span></label>
              <input id="pincode" inputMode="numeric" maxLength={6} aria-invalid={!!errors.pincode} aria-describedby={errors.pincode ? "pincode-error" : undefined} className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm" {...register("pincode", {
                valueAsNumber: true, required: "Postal code is required",
                validate: value => (Number.isInteger(value) && value >= 100000 && value <= 999999) || "Enter a valid 6-digit PIN code",
              })} />
              {errors.pincode && <p id="pincode-error" className="mt-1 text-xs text-destructive">{errors.pincode.message}</p>}
            </div>
            <div>
              <label htmlFor="gstNumber" className="mb-1.5 block text-sm font-medium">GST number <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
              <input id="gstNumber" inputMode="numeric" maxLength={12} aria-invalid={!!errors.gstNumber} className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm"
                {...register("gstNumber", {
                  setValueAs: (value: string) => value.trim() || undefined,
                  validate: value => !value || /^\d{12}$/.test(value) || "GST number must be 12 digits",
                })} />
              {errors.gstNumber && <p className="mt-1 text-xs text-destructive">{errors.gstNumber.message}</p>}
            </div>
          </fieldset>
          {create.error && <p role="alert" className="text-sm text-destructive">{create.error.message}</p>}
          <button type="submit" disabled={create.isPending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{create.isPending ? "Registering…" : "Register Partner"}</button>
        </form>
      )}
    </div>
  )

  if (!modal) return content
  return (
    <Dialog.Root open={open} onOpenChange={value => {
      if (busy.current || create.isPending || retry.isPending) return
      if (value) { reset(); create.reset(); retry.reset() }
      setOpen(value)
    }}>
      <Dialog.Trigger asChild>
        <button type="button" className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Register Partner</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-xl sm:p-6">
          <Dialog.Title className="pr-10 text-xl font-semibold">Register Partner</Dialog.Title>
          <Dialog.Description className="mb-5 mt-2 text-sm text-muted-foreground">Create a partner account from your dashboard.</Dialog.Description>
          <Dialog.Close disabled={create.isPending || retry.isPending} aria-label="Close partner registration" className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted disabled:opacity-50"><X size={18} /></Dialog.Close>
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function AddPartnerForm({ modal = false }: { modal?: boolean }) {
  const { canRegisterPartners, isLoading, me } = useMe()
  if (isLoading) return modal ? null : <p>Loading…</p>
  if (!canRegisterPartners) return modal ? null : <p>You don’t have permission to register partners.</p>
  return <PartnerForm key={me?.membership?.organizationId} modal={modal} />
}
